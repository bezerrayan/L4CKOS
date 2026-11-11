import { describe, expect, it } from "vitest";
import net from "node:net";
import mysql from "mysql2/promise";
import {
  CORE_TABLES,
  TABLES,
  createTlsConnectionConfig,
  productionConnectionConfig,
  runOneShot,
  safeFailure,
} from "../../scripts/mysql-schema-attestation.mjs";

const integrationEnabled = process.env.MYSQL_ATTESTATION_TEST === "1";
const localHost =
  process.env.MYSQL_ATTESTATION_TEST_HOST ?? "mysql-attestation.local";
const localPort = Number(process.env.MYSQL_ATTESTATION_TEST_PORT ?? 0);
const localSchema =
  process.env.MYSQL_ATTESTATION_TEST_DATABASE ?? "l4ckos_stock_test";
const localCa = process.env.MYSQL_ATTESTATION_TEST_CA ?? "";
const wrongCa = process.env.MYSQL_ATTESTATION_TEST_WRONG_CA ?? "";

function localConnection(
  user: string,
  password: string,
  ca = localCa,
  host = localHost
) {
  return {
    ...createTlsConnectionConfig({
      host,
      expectedHost: host,
      user,
      password,
      database: localSchema,
      ca,
    }),
    port: localPort,
  };
}

async function connectLocal(
  user: string,
  password: string,
  ca = localCa,
  host = localHost
) {
  const stream = net.connect({ host: "127.0.0.1", port: localPort });
  try {
    return await mysql.createConnection({
      ...localConnection(user, password, ca, host),
      stream,
    });
  } catch (error) {
    stream.destroy();
    throw error;
  }
}

describe("MySQL production schema attestation runner", () => {
  it("fails closed unless explicit production approval and fixed target are set", () => {
    expect(() => productionConnectionConfig({} as NodeJS.ProcessEnv)).toThrow(
      "EXPLICIT_APPROVAL_FLAG_REQUIRED"
    );
    expect(() =>
      productionConnectionConfig({
        MYSQL_ATTESTATION_PRIVILEGE_ACK: "REFERENCES_METADATA_ONLY",
        MYSQL_ATTESTATION_APPROVED: "YES",
        MYSQL_ATTESTATION_HOST: "127.0.0.1",
        MYSQL_ATTESTATION_DATABASE: "db",
        MYSQL_ATTESTATION_USER: "user",
        MYSQL_ATTESTATION_PASSWORD: "synthetic",
      } as NodeJS.ProcessEnv)
    ).toThrow("MYSQL_TLS_HOST_MISMATCH");
    expect(() =>
      productionConnectionConfig({
        MYSQL_ATTESTATION_APPROVED: "YES",
        MYSQL_ATTESTATION_HOST: "mysql-w5fk.railway.internal",
        MYSQL_ATTESTATION_DATABASE: "db",
        MYSQL_ATTESTATION_USER: "user",
        MYSQL_ATTESTATION_PASSWORD: "synthetic",
      } as NodeJS.ProcessEnv)
    ).toThrow("REFERENCES_PRIVILEGE_ACK_REQUIRED");
    expect(() =>
      productionConnectionConfig(
        {
          MYSQL_ATTESTATION_APPROVED: "YES",
          MYSQL_ATTESTATION_PRIVILEGE_ACK: "REFERENCES_METADATA_ONLY",
          MYSQL_ATTESTATION_HOST: "mysql-w5fk.railway.internal",
          MYSQL_ATTESTATION_DATABASE: "db",
          MYSQL_ATTESTATION_USER: "user",
          MYSQL_ATTESTATION_PASSWORD: "synthetic",
        } as NodeJS.ProcessEnv,
        { includeDrizzleHistory: true }
      )
    ).toThrow("MIGRATION_HISTORY_ROW_READ_ACK_REQUIRED");
  });

  it("rejects hostname mismatch and unsafe schema identifiers before connecting", async () => {
    expect(() =>
      createTlsConnectionConfig({
        host: "wrong.example",
        expectedHost: "mysql-w5fk.railway.internal",
        user: "user",
        password: "synthetic",
        database: "db",
        ca: "-----BEGIN CERTIFICATE-----\nlocal\n-----END CERTIFICATE-----",
      })
    ).toThrow("MYSQL_TLS_HOST_MISMATCH");
    await expect(
      runOneShot({
        createConnection: async () => {
          throw new Error("must not connect");
        },
        connectionOptions: {},
        expectedSchema: "db' OR 1=1 --",
        runId: "local",
        timeoutMs: 1000,
      })
    ).rejects.toThrow("INVALID_EXPECTED_SCHEMA");
  });

  it("sanitizes connector errors so passwords and server messages never enter JSON", () => {
    const failure = safeFailure(
      Object.assign(new Error("password=do-not-print"), {
        code: "ER_ACCESS_DENIED_ERROR",
      }),
      "synthetic-run"
    );
    expect(JSON.stringify(failure)).toBe(
      JSON.stringify({
        schemaVersion: 1,
        runId: "synthetic-run",
        status: "failed",
        error: "ER_ACCESS_DENIED_ERROR",
      })
    );
    expect(JSON.stringify(failure)).not.toContain("do-not-print");
  });

  it("destroys a stalled connection on timeout and closes after failure", async () => {
    let destroyed = 0;
    let ended = 0;
    const fake = {
      query: () => new Promise(() => undefined),
      destroy: () => {
        destroyed += 1;
      },
      end: async () => {
        ended += 1;
      },
    };
    await expect(
      runOneShot({
        createConnection: async () => fake,
        connectionOptions: {},
        expectedSchema: "fixture",
        runId: "timeout-test",
        timeoutMs: 1000,
      })
    ).rejects.toThrow("ATTESTATION_TIMEOUT");
    expect(destroyed).toBe(1);
    expect(ended).toBe(1);
  }, 5000);

  it.skipIf(!integrationEnabled)(
    "attests a disposable MySQL schema over verified TLS 1.3 and reports sanitized JSON",
    async () => {
      expect(localPort).toBeGreaterThan(0);
      expect(localCa).toContain("BEGIN CERTIFICATE");
      const connectionOptions = localConnection(
        "attest_metadata",
        "synthetic-metadata-password"
      );
      const queryTrace: string[] = [];
      const connection = await connectLocal(
        "attest_metadata",
        "synthetic-metadata-password"
      );
      const proxy = {
        query: (
          options: string | { sql: string; timeout?: number },
          values?: unknown[]
        ) => {
          queryTrace.push(typeof options === "string" ? options : options.sql);
          return connection.query(options as never, values as never);
        },
        end: () => connection.end(),
        destroy: () => connection.destroy(),
      };
      const result = await runOneShot({
        createConnection: async () => proxy,
        connectionOptions,
        expectedSchema: localSchema,
        runId: "synthetic-mysql-attestation",
        timeoutMs: 10_000,
      });
      expect(result.status).toBe("partial");
      expect(result.attestedSchema).toBe(localSchema);
      expect(result.session.selectedSchema).toBeNull();
      expect(result.session.tlsVersion).toBe("TLSv1.3");
      expect(result.schema.tables).toHaveLength(TABLES.length);
      expect(result.uncoveredAllowlistTables).toEqual([]);
      expect(result.schema.tables.map(row => row.tableName)).toContain(
        "productVariants"
      );
      const orderColumns = result.schema.columns
        .filter(row => row.tableName === "orders")
        .map(row => row.columnName);
      expect(orderColumns).toEqual(["id", "userId", "totalPrice", "status"]);
      expect(result.triggers.status).toBe("not_attested");
      expect(result.privilegeModel.runnerReadsApplicationRows).toBe(false);
      expect(result.privilegeModel.rowReadCapability).toBe("none");
      expect(
        queryTrace.some(sql => /INFORMATION_SCHEMA\.TRIGGERS/i.test(sql))
      ).toBe(false);
      expect(queryTrace.every(sql => /^(SELECT|SHOW)\b/i.test(sql))).toBe(true);
      expect(
        queryTrace
          .filter(sql => /^SELECT\b/i.test(sql))
          .every(
            sql =>
              /FROM\s+INFORMATION_SCHEMA\./i.test(sql) ||
              /^SELECT VERSION\(\)/i.test(sql)
          )
      ).toBe(true);
      expect(
        queryTrace
          .filter(sql => /^SHOW\b/i.test(sql))
          .every(sql =>
            /^SHOW (SESSION STATUS|GRANTS FOR CURRENT_USER)/i.test(sql)
          )
      ).toBe(true);
      expect(
        queryTrace.some(sql =>
          /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(sql)
        )
      ).toBe(false);
      expect(JSON.stringify(result)).not.toContain("synthetic-reader-password");
      expect(result.schema.tables.length).toBeGreaterThanOrEqual(
        CORE_TABLES.length
      );
    }
  );

  it.skipIf(!integrationEnabled)(
    "fails closed when the account cannot see authorized metadata",
    async () => {
      const config = localConnection(
        "attest_empty",
        "synthetic-empty-password"
      );
      await expect(
        runOneShot({
          createConnection: () =>
            connectLocal("attest_empty", "synthetic-empty-password"),
          connectionOptions: config,
          expectedSchema: localSchema,
          runId: "no-privilege-test",
          timeoutMs: 10_000,
        })
      ).rejects.toThrow("METADATA_VISIBILITY_INCOMPLETE");
    }
  );

  it.skipIf(!integrationEnabled)(
    "can enumerate metadata with REFERENCES while table rows remain unreadable",
    async () => {
      const connection = await connectLocal(
        "attest_metadata",
        "synthetic-metadata-password"
      );
      try {
        const [columns] = await connection.query(
          `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'orders'
            ORDER BY ORDINAL_POSITION`,
          [localSchema]
        );
        const [indexes] = await connection.query(
          `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'orders'`,
          [localSchema]
        );
        const [constraints] = await connection.query(
          `SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
            WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = 'orders'`,
          [localSchema]
        );
        expect(columns).toHaveLength(4);
        expect(indexes).toHaveLength(1);
        expect(constraints).toHaveLength(1);
        await expect(
          connection.query("SELECT * FROM orders")
        ).rejects.toBeDefined();
      } finally {
        await connection.end();
      }
    }
  );

  it.skipIf(!integrationEnabled)(
    "rejects migration-history row access unless that mode is explicitly enabled",
    async () => {
      await expect(
        runOneShot({
          createConnection: () =>
            connectLocal("attest_history", "synthetic-history-password"),
          connectionOptions: {},
          expectedSchema: localSchema,
          runId: "history-not-requested",
          timeoutMs: 10_000,
        })
      ).rejects.toThrow("UNREVIEWED_PRIVILEGE");
    }
  );

  it.skipIf(!integrationEnabled)(
    "reads migration history only when explicitly confirmed",
    async () => {
      await expect(
        runOneShot({
          createConnection: () =>
            connectLocal("attest_history", "synthetic-history-password"),
          connectionOptions: {},
          expectedSchema: localSchema,
          runId: "synthetic-history-attestation",
          timeoutMs: 10_000,
          includeDrizzleHistory: true,
        })
      ).resolves.toMatchObject({
        migrationHistory: {
          status: "attested",
          rows: [{ id: 1, hash: "synthetic-hash", createdAt: 1000 }],
        },
        privilegeModel: {
          runnerReadsApplicationRows: false,
          rowReadCapability:
            "SELECT is granted only on the explicitly confirmed migration-history table",
        },
      });
    }
  );

  it.skipIf(!integrationEnabled)(
    "rejects TRIGGER privilege because it grants DDL capability",
    async () => {
      await expect(
        runOneShot({
          createConnection: () =>
            connectLocal("attest_trigger", "synthetic-trigger-password"),
          connectionOptions: {},
          expectedSchema: localSchema,
          runId: "trigger-privilege-test",
          timeoutMs: 10_000,
        })
      ).rejects.toThrow("TRIGGER_PRIVILEGE_NOT_READ_ONLY");
    }
  );

  it.skipIf(!integrationEnabled)(
    "rejects a wrong CA during the TLS handshake",
    async () => {
      expect(wrongCa).toContain("BEGIN CERTIFICATE");
      await expect(
        connectLocal("attest_metadata", "synthetic-metadata-password", wrongCa)
      ).rejects.toBeDefined();
    }
  );

  it.skipIf(!integrationEnabled)(
    "rejects an incorrect server hostname through certificate identity validation",
    async () => {
      await expect(
        connectLocal(
          "attest_metadata",
          "synthetic-metadata-password",
          localCa,
          "wrong.attestation.local"
        )
      ).rejects.toBeDefined();
    }
  );
});
