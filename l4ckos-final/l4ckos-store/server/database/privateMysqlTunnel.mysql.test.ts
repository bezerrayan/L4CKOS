import { describe, beforeAll, afterAll, it, expect } from "vitest";
import { createServer, connect, type Socket } from "node:net";
import { createConnection, type Connection } from "mysql2/promise";
import { readFile, mkdir, readdir, lstat, rm } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import {
  BACKUP_TARGET,
  verifyPhysicalBackupIdentity,
} from "../../database/financialWindow/backupIdentity";
import {
  PrivateMysqlTcpTunnel,
  type TunnelProcess,
} from "../../database/financialWindow/privateMysqlTunnel";
import { rehearseExternalBackup } from "../../database/financialWindow/externalBackup";
import {
  takeFullBackup,
  decryptBackup,
  restoreFullBackup,
} from "../../database/financialWindow/backup";
import { setupWindowFixture } from "./financialWindow.fixture";
describe.skipIf(process.env.L4CKOS_EXTERNAL_BACKUP_LOCAL !== "1")(
  "private TCP simulated tunnel MySQL",
  () => {
    const socket = "/tmp/l4ckos-external-backup-socket/mysqld.sock",
      database = "l4ckos_test_tcp_backup";
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
    const reference = () => ({
      ...BACKUP_TARGET,
      database,
      uuidHash,
      account: "root@localhost" as const,
    });
    const inventory = async () => ({
      projectId: BACKUP_TARGET.projectId,
      environmentId: BACKUP_TARGET.environmentId,
      capturedAt: Date.now(),
      services: [
        {
          id: BACKUP_TARGET.mysqlServiceId,
          name: "mysql",
          deploymentId: BACKUP_TARGET.mysqlDeploymentId,
          active: true,
        },
      ],
    });
    beforeAll(async () => {
      uuidHash = (
        await readFile("/tmp/l4ckos-external-backup-uuid", "utf8")
      ).trim();
      root = await createConnection({ ...options, database: "mysql" });
      await root.query("CREATE DATABASE " + database);
      await root.changeUser({ database });
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
        await root.query("DROP DATABASE " + database);
        await root.end();
      }
    });
    function tunnel(password = "synthetic-local-only") {
      let active = true;
      const sockets = new Set<Socket>(),
        callbacks = new Set<() => void>();
      const server = createServer(front => {
        const back = connect(socket);
        sockets.add(front);
        sockets.add(back);
        front.pipe(back);
        back.pipe(front);
        for (const s of [front, back]) {
          s.on("error", () => {
            front.destroy();
            back.destroy();
          });
          s.on("close", () => sockets.delete(s));
        }
      });
      const ready = new Promise<any>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () =>
          resolve({
            host: "127.0.0.1",
            port: (server.address() as any).port,
            user: "root",
            password,
            database,
          })
        );
      });
      const provider: TunnelProcess = {
        ready,
        alive: () => active,
        onStop: fn => callbacks.add(fn),
        close: async () => {
          active = false;
          callbacks.forEach(fn => fn());
          sockets.forEach(s => s.destroy());
          await new Promise<void>(resolve => server.close(() => resolve()));
        },
      };
      return {
        transport: new PrivateMysqlTcpTunnel(
          inventory,
          () => provider,
          database
        ),
        provider,
      };
    }
    it("uses TCP mysql2, rejects unapproved MySQL account and physical UUID", async () => {
      const { transport } = tunnel();
      try {
        const c = await transport.connectTcp();
        expect(c.config.socketPath).toBeUndefined();
        expect(c.config.host).toBe("127.0.0.1");
        await expect(
          verifyPhysicalBackupIdentity(c, reference())
        ).resolves.toBeUndefined();
        await expect(
          verifyPhysicalBackupIdentity(c, { ...reference(), account: "root@%" })
        ).rejects.toThrow("WINDOW_BACKUP_PHYSICAL_IDENTITY");
        await expect(
          verifyPhysicalBackupIdentity(c, {
            ...reference(),
            uuidHash: "a".repeat(64),
          })
        ).rejects.toThrow("WINDOW_BACKUP_PHYSICAL_IDENTITY");
      } finally {
        await transport.close();
      }
    });
    it("rejects wrong TCP authentication with sanitized error", async () => {
      const { transport } = tunnel("secret-wrong");
      await expect(transport.connectTcp()).rejects.toThrow(
        "WINDOW_TUNNEL_MYSQL_AUTH_FAILED"
      );
    });
    it("destroys connection on tunnel interruption and rejects further attestations", async () => {
      const { transport, provider } = tunnel();
      const c = await transport.connectTcp();
      await provider.close();
      await expect(transport.attest()).rejects.toThrow("WINDOW_TUNNEL_CLOSED");
      await expect(c.query("SELECT 1")).rejects.toThrow();
      await transport.close();
    });
    it("encrypts before storage, restores 31 tables and creates only protected ciphertext", async () => {
      const { transport } = tunnel(),
        dir = "/tmp/l4ckos-tcp-proof-" + randomUUID();
      await mkdir(dir, { mode: 0o700 });
      const key = randomBytes(32);
      let stored: Buffer | undefined;
      try {
        const proof = await rehearseExternalBackup(
          transport,
          {
            recoverKey: async () => Buffer.from(key),
            putCiphertext: async b => {
              expect(b.toString()).not.toContain("Fixture Admin");
              stored = Buffer.from(b);
            },
            readCiphertext: async () => stored!,
          },
          { path: dir + "/backup.enc", keyReference: "independent-custody" },
          reference()
        );
        expect(await readdir(dir)).toEqual(["backup.enc"]);
        expect((await lstat(dir)).mode & 0o777).toBe(0o700);
        expect((await lstat(dir + "/backup.enc")).mode & 0o777).toBe(0o600);
        const clone = "l4ckos_test_tcp_restore";
        await root.query("CREATE DATABASE " + clone);
        const c = await createConnection({ ...options, database: clone });
        try {
          expect(
            (
              await restoreFullBackup(
                c,
                decryptBackup(stored!, key, proof.ciphertextSha256),
                socket
              )
            ).tables
          ).toBe(31);
        } finally {
          await c.end();
          await root.query("DROP DATABASE " + clone);
        }
      } finally {
        key.fill(0);
        await transport.close();
        await rm(dir, { recursive: true });
      }
    }, 30000);
    it("maintains TCP consistent snapshot despite concurrent DML", async () => {
      const { transport } = tunnel();
      try {
        const c = await transport.connectTcp(),
          q = c.query.bind(c);
        c.query = (async (s: any, ...a: any[]) => {
          const result = await q(s, ...(a as [any]));
          if (s === "START TRANSACTION WITH CONSISTENT SNAPSHOT")
            await root.query("UPDATE products SET stock=99 WHERE id=1");
          return result;
        }) as any;
        const b = await takeFullBackup(c, () =>
          verifyPhysicalBackupIdentity(c, reference())
        );
        expect(
          String(b.tables.products.rows.find(r => String(r.id) === "1")!.stock)
        ).toBe("98");
      } finally {
        await transport.close();
        await root.query("UPDATE products SET stock=98 WHERE id=1");
      }
    }, 30000);
    it("interrupted export produces no ciphertext or storage upload", async () => {
      const { transport, provider } = tunnel();
      const dir = "/tmp/l4ckos-tcp-abort-" + randomUUID();
      await mkdir(dir, { mode: 0o700 });
      let uploaded = false;
      const connectTcp = transport.connectTcp.bind(transport);
      transport.connectTcp = async () => {
        const c = await connectTcp(),
          q = c.query.bind(c);
        c.query = (async (s: any, ...a: any[]) => {
          if (s === "START TRANSACTION WITH CONSISTENT SNAPSHOT")
            await provider.close();
          return q(s, ...(a as [any]));
        }) as any;
        return c;
      };
      try {
        await expect(
          rehearseExternalBackup(
            transport,
            {
              recoverKey: async () => randomBytes(32),
              putCiphertext: async () => {
                uploaded = true;
              },
              readCiphertext: async () => Buffer.alloc(0),
            },
            { path: dir + "/backup.enc", keyReference: "separate" },
            reference()
          )
        ).rejects.toThrow();
        expect(uploaded).toBe(false);
        expect(await readdir(dir)).toEqual([]);
      } finally {
        await transport.close();
        await rm(dir, { recursive: true });
      }
    });
    it.each([
      "schemaHash",
      "governanceHash",
      "migrationChecksum",
      "tableCount",
      "mysqlVersion",
    ])("rejects TCP divergent %s", async field => {
      const { transport } = tunnel();
      try {
        const c = await transport.connectTcp();
        await expect(
          verifyPhysicalBackupIdentity(c, {
            ...reference(),
            [field]: field === "tableCount" ? 30 : "wrong",
          })
        ).rejects.toThrow();
      } finally {
        await transport.close();
      }
    });
    it.each(["missing0023", "unfinished0023"])(
      "rejects TCP %s",
      async fault => {
        const { transport } = tunnel();
        try {
          const c = await transport.connectTcp();
          await c.beginTransaction();
          if (fault === "missing0023")
            await c.query("DELETE FROM _l4ckos_schema_migrations");
          else
            await c.query(
              "UPDATE _l4ckos_schema_executions SET state='STARTED'"
            );
          await expect(
            verifyPhysicalBackupIdentity(c, reference())
          ).rejects.toThrow("WINDOW_BACKUP_MIGRATION_IDENTITY");
          await c.rollback();
        } finally {
          await transport.close();
        }
      }
    );
  }
);
