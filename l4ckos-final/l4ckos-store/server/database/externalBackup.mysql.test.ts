import { describe, beforeAll, afterAll, it, expect } from "vitest";
import { createConnection, type Connection } from "mysql2/promise";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { setupWindowFixture } from "./financialWindow.fixture";
import { BACKUP_TARGET } from "../../database/financialWindow/backupIdentity";
import {
  rehearseExternalBackup,
  type PrivateBackupTransport,
} from "../../database/financialWindow/externalBackup";
import {
  decryptBackup,
  restoreFullBackup,
} from "../../database/financialWindow/backup";
import { sha256, rows } from "../../database/schema/fingerprint";
describe.skipIf(process.env.L4CKOS_EXTERNAL_BACKUP_LOCAL !== "1")(
  "external private backup local rehearsal",
  () => {
    const socket = "/tmp/l4ckos-external-backup-socket/mysqld.sock";
    const db = "l4ckos_test_external_backup";
    const options = {
      user: "root",
      password: "synthetic-local-only",
      socketPath: socket,
      dateStrings: true,
      jsonStrings: true,
      timezone: "Z",
      supportBigNumbers: true,
      bigNumberStrings: true,
    };
    let root: Connection, uuidHash: string;
    beforeAll(async () => {
      if (process.env.L4CKOS_EXTERNAL_BACKUP_LOCAL !== "1")
        throw Error("LOCAL_OPT_IN_REQUIRED");
      uuidHash = (
        await readFile("/tmp/l4ckos-external-backup-uuid", "utf8")
      ).trim();
      if (!/^[a-f0-9]{64}$/.test(uuidHash)) throw Error("LOCAL_UUID_REQUIRED");
      root = await createConnection({ ...options, database: "mysql" });
      await root.query("CREATE DATABASE " + db);
      await root.changeUser({ database: db });
      await setupWindowFixture(root);
      await root.query(
        "INSERT INTO _l4ckos_schema_executions(operation,checksum,applicationCommit,state,preFingerprint,observedFingerprint,finishedAt) VALUES(?,?,?,'COMPLETED',?,?,NOW())",
        [
          BACKUP_TARGET.migration,
          BACKUP_TARGET.migrationChecksum,
          "a".repeat(40),
          BACKUP_TARGET.schemaHash,
          BACKUP_TARGET.schemaHash,
        ]
      );
    }, 30000);
    afterAll(async () => {
      if (root) {
        await root.query("DROP DATABASE " + db);
        await root.end();
      }
    });
    async function trial(fault = "", restore = false) {
      const dir = "/tmp/l4ckos-external-trial-" + randomUUID();
      await mkdir(dir, { mode: 0o700 });
      const master = randomBytes(32);
      let stored: Buffer | undefined,
        opened = 0,
        closed = false,
        attests = 0;
      const transport: PrivateBackupTransport = {
        async attest() {
          attests++;
          return {
            authenticated: fault !== "auth",
            restricted: fault !== "public",
            railway: {
              RAILWAY_PROJECT_ID: BACKUP_TARGET.projectId,
              RAILWAY_ENVIRONMENT_ID: BACKUP_TARGET.environmentId,
              RAILWAY_SERVICE_ID: BACKUP_TARGET.mysqlServiceId,
              RAILWAY_DEPLOYMENT_ID:
                fault === "deployment" ||
                (fault === "interrupted" && attests > 1)
                  ? "wrong"
                  : BACKUP_TARGET.mysqlDeploymentId,
            },
          };
        },
        async connectSocket() {
          opened++;
          return createConnection({
            ...options,
            database: db,
            password: fault === "password" ? "wrong" : options.password,
            socketPath: fault === "socket" ? socket + ".absent" : socket,
          });
        },
        async close() {
          closed = true;
        },
      };
      let keyCalls = 0;
      const custody = {
        async recoverKey() {
          keyCalls++;
          return fault === "key" && keyCalls > 1
            ? randomBytes(32)
            : Buffer.from(master);
        },
        async putCiphertext(b: Buffer, h: string) {
          expect(sha256(b)).toBe(h);
          expect(b.toString()).not.toContain("Fixture Admin");
          stored = Buffer.from(b);
          if (fault === "transfer") throw Error("SIMULATED_INTERRUPTION");
        },
        async readCiphertext() {
          if (fault === "readback") return Buffer.from("partial");
          return stored!;
        },
      };
      try {
        const result = await rehearseExternalBackup(
          transport,
          custody,
          { path: dir + "/backup.enc", keyReference: "separate-custodian" },
          {
            ...BACKUP_TARGET,
            database: db,
            uuidHash: fault === "uuid" ? "a".repeat(64) : uuidHash,
          }
        );
        expect(result.tables).toBe(31);
        expect(result.restore).toBe("NOT_PROVEN");
        if (restore) {
          const clone = "l4ckos_test_external_restore";
          await root.query("CREATE DATABASE " + clone);
          const c = await createConnection({ ...options, database: clone });
          try {
            expect(
              (
                await restoreFullBackup(
                  c,
                  decryptBackup(stored!, master, result.ciphertextSha256),
                  socket
                )
              ).tables
            ).toBe(31);
          } finally {
            await c.end();
            await root.query("DROP DATABASE " + clone);
          }
          const v = JSON.parse(stored!.toString());
          v.tag = "00".repeat(16);
          const tampered = Buffer.from(JSON.stringify(v));
          expect(() =>
            decryptBackup(tampered, master, sha256(tampered))
          ).toThrow();
        }
        return result;
      } finally {
        expect(closed).toBe(true);
        if (["auth", "public", "deployment"].includes(fault))
          expect(opened).toBe(0);
        master.fill(0);
        await rm(dir, { recursive: true });
      }
    }
    it(
      "exports, authenticates, transfers, retrieves key separately and restores 31 tables",
      () => trial("", true),
      30000
    );
    it.each([
      "auth",
      "public",
      "deployment",
      "interrupted",
      "password",
      "socket",
      "uuid",
      "transfer",
      "readback",
      "key",
    ])(
      "stops safely on %s",
      async fault => {
        await expect(trial(fault)).rejects.toThrow();
      },
      30000
    );
    it("rejects unexpected config before opening transport", async () => {
      let touched = false;
      await expect(
        rehearseExternalBackup(
          {
            attest: async () => {
              touched = true;
              throw Error("unexpected");
            },
            connectSocket: async () => {
              throw Error("unexpected");
            },
            close: async () => {},
          },
          {} as any,
          {
            path: "/tmp/l4ckos-test/backup.enc",
            keyReference: "safe",
            host: "public",
          } as any,
          { ...BACKUP_TARGET, database: db, uuidHash }
        )
      ).rejects.toThrow("WINDOW_BACKUP_CONFIGURATION");
      expect(touched).toBe(false);
    });
    it("keeps snapshot consistent during concurrent synthetic update", async () => {
      const { takeFullBackup } = await import(
        "../../database/financialWindow/backup"
      );
      const { verifyPhysicalBackupIdentity } = await import(
        "../../database/financialWindow/backupIdentity"
      );
      const c = await createConnection({ ...options, database: db });
      const query = c.query.bind(c);
      let changed = false;
      c.query = (async (s: any, ...a: any[]) => {
        const result = await query(s, ...(a as [any]));
        if (String(s) === "START TRANSACTION WITH CONSISTENT SNAPSHOT") {
          await root.query("UPDATE products SET stock=99 WHERE id=1");
          changed = true;
        }
        return result;
      }) as any;
      try {
        const b = await takeFullBackup(c, () =>
          verifyPhysicalBackupIdentity(c, {
            ...BACKUP_TARGET,
            database: db,
            uuidHash,
          })
        );
        expect(changed).toBe(true);
        expect(
          String(b.tables.products.rows.find(r => String(r.id) === "1")!.stock)
        ).toBe("98");
        expect(
          String(
            (await rows(root, "SELECT stock FROM products WHERE id=1"))[0].stock
          )
        ).toBe("99");
      } finally {
        await c.end();
        await root.query("UPDATE products SET stock=98 WHERE id=1");
      }
    }, 30000);
  }
);
