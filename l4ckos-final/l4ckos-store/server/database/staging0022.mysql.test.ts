import { adoptBarrier } from "../../database/staging0022/barrier";
import { applyGovernedWindow } from "../../database/staging0022/window";
import { inspect0022Recovery, recoverPartial0022 } from "../../database/staging0022/recovery";
import { digest } from "../../database/staging0022/policy";
import { afterAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import type { Connection } from "mysql2/promise";
import { openBackupConnection } from "./backupRestore";
import {
  bootstrapArtifacts,
  readArtifact,
} from "../../database/schema/artifacts";
import {
  migrateDatabase,
  type LineageManifest,
} from "../../database/migrations/runner";
import { quote, rows, sha256 } from "../../database/schema/fingerprint";
import {
  capture,
  verifyPrivateGzip,
} from "../../database/staging0022/evidence";
import {
  activateBarrier,
  assertBarrier,
  releaseBarrier,
  allowApplicationReads,
  type BarrierState,
} from "../../database/staging0022/barrier";
import {
  localCapability,
  remoteCapability,
} from "../../database/staging0022/capability";
import { execute0022 } from "../../database/staging0022/runner";
import { restoreAndProve } from "../../database/staging0022/restore";
import {
  RC,
  SQL_SHA,
  TARGET,
  PRE,
  POST,
  assertPlan,
  type WindowPlan,
} from "../../database/staging0022/policy";

const changed = vi.hoisted(() => ({ sql: false }));
vi.mock("../../database/schema/artifacts", async original => {
  const actual =
    await original<typeof import("../../database/schema/artifacts")>();
  return {
    ...actual,
    readArtifact: async (...args: Parameters<typeof actual.readArtifact>) => {
      const bytes = await actual.readArtifact(...args);
      return changed.sql && args[0].includes("0022_")
        ? Buffer.concat([bytes, Buffer.from(" ")])
        : bytes;
    },
  };
});
const socketPath =
  process.env.L4CKOS_LOCAL_MYSQL_SOCKET ??
  "/tmp/l4ckos-0022-socket/mysqld.sock";
const container = "l4ckos-0022-local-test";
const docker = (args: string[], input?: Buffer) =>
  execFileSync(
    "docker",
    [
      "--host",
      "unix:///var/run/docker.sock",
      "exec",
      ...(input ? ["-i"] : []),
      container,
      ...args,
    ],
    {
      input,
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 8 * 1024 * 1024,
      timeout: 30000,
    }
  );
const names: string[] = [];
async function fixture() {
  process.env.L4CKOS_LOCAL_SCHEMA = "1";
  const name = `l4ckos_test_0022_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const restored = `${name}_restore`;
  names.push(name, restored);
  const admin = await openBackupConnection(
    "mysql://root@localhost/mysql",
    socketPath
  );
  await admin.query("SET GLOBAL read_only=OFF");
  await admin.query("ALTER USER 'root'@'%' ACCOUNT UNLOCK");
  await admin.query(
    `CREATE DATABASE ${quote(name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await admin.query(
    `CREATE DATABASE ${quote(restored)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await admin.end();
  const local = { url: `mysql://root@localhost/${name}`, socketPath };
  const c = await openBackupConnection(local.url, socketPath);
  for (const e of (await bootstrapArtifacts()).statements)
    if (e.table !== "asaasWebhookEvents") await c.query(e.sql);
  const manifest = JSON.parse(
    (
      await readArtifact(
        "database/migrations/manifest.json",
        "database/migrations"
      )
    ).toString()
  ) as LineageManifest;
  await migrateDatabase(
    c,
    {
      ...local,
      applicationCommit: RC,
      approvedFingerprint: manifest.migrations[0].expectedPreFingerprint,
    },
    { ...manifest, migrations: [] }
  );
  await migrateDatabase(
    c,
    { ...local, applicationCommit: RC, approvedFingerprint: PRE },
    manifest
  );
  await c.query(
    "INSERT INTO users (id,openId,name) VALUES (901,'fixture-0022','Synthetic')"
  );
  await c.query(
    "INSERT INTO products (id,name,category,price,stock) VALUES (901,'Synthetic','fixture',100,3)"
  );
  await c.query(
    "INSERT INTO orders (id,userId,totalPrice) VALUES (901,901,100)"
  );
  await c.query(
    "INSERT INTO orderItems (id,orderId,productId,productName,unitPrice,quantity,totalPrice) VALUES (901,901,901,'Synthetic',100,1,100)"
  );
  await c.query(
    "INSERT INTO productionBatches (id,name) VALUES (901,'Synthetic legacy')"
  );
  const sourceBefore = await capture(c),
    createdAt = new Date().toISOString();
  const sql = docker([
    "mysqldump",
    "--socket=/var/run/mysqld/mysqld.sock",
    "-uroot",
    "--single-transaction",
    "--quick",
    "--skip-lock-tables",
    "--set-gtid-purged=OFF",
    "--no-tablespaces",
    name,
  ]);
  const sourceAfter = await capture(c);
  const privateDir = await mkdtemp("/tmp/l4ckos-0022-backup-");
  const file = `${privateDir}/backup.sql.gz`;
  await writeFile(file, gzipSync(sql), { mode: 0o600 });
  const restoredTarget = {
    url: `mysql://root@localhost/${restored}`,
    socketPath,
  };
  const backup = await restoreAndProve(restoredTarget, file, process.cwd(), {
    createdAt,
    sourceBefore,
    sourceAfter,
  });
  const plan: WindowPlan = {
    version: 1,
    applicationCommit: RC,
    sqlSourceCommit: RC,
    sqlChecksum: SQL_SHA,
    target: TARGET,
    deploymentId: randomUUID(),
    serverUuid: String((await rows(c, "SELECT @@server_uuid uuid"))[0].uuid),
    endpointHash: "a".repeat(64),
    backup,
    operator: "operator_fixture",
    approver: "founder_fixture",
    expiresAt: new Date(
      Date.parse(sourceBefore.at) + 15 * 60 * 1000
    ).toISOString(),
  };
  const cap = await localCapability(c, plan, local);
  const finish = async () => {
    changed.sql = false;
    try {
      await c.query("SET GLOBAL read_only=OFF");
      await c.query("ALTER USER 'root'@'%' ACCOUNT UNLOCK");
    } finally {
      await c.end();
    }
  };
  return { c, local, plan, cap, file, finish };
}

describe.skipIf(process.env.L4CKOS_MYSQL_TEST !== "1")(
  "0022 governed window, isolated MySQL 8.4 only",
  () => {
    afterAll(async () => {
      const c = await openBackupConnection(
        "mysql://root@localhost/mysql",
        socketPath
      );
      await c.query("SET GLOBAL read_only=OFF");
      await c.query("ALTER USER 'root'@'%' ACCOUNT UNLOCK");
      for (const name of names) await c.query(`DROP DATABASE ${quote(name)}`);
      await c.end();
    });
    it("quarantines old sessions/new admission, restores backup, applies once, preserves rows and reopens", async () => {
      const f = await fixture();
      try {
        // Synthetic candidate identity for the local ledger; immutable SQL remains RC.
        f.plan.applicationCommit = "d".repeat(40);
        f.cap = await localCapability(f.c, f.plan, f.local);
        const writer = await openBackupConnection(f.local.url, socketPath);
        await f.c.query("CREATE USER 'fixture_readonly_app'@'localhost'");
        await f.c.query(
          `GRANT SELECT,INSERT,UPDATE,DELETE ON ${quote(f.c.config.database!)}.* TO 'fixture_readonly_app'@'localhost'`
        );
        let saved: BarrierState | undefined;
        let barrier = await activateBarrier(f.c, f.plan, f.cap, async s => {
          saved = s;
        });
        expect(saved?.ready).toBe(false);
        await assertBarrier(f.c);
        await expect(
          writer.query(
            "INSERT INTO productionBatches (name) VALUES ('forbidden')"
          )
        ).rejects.toThrow();
        await expect(
          writer.query("UPDATE products SET stock=1 WHERE id=901")
        ).rejects.toThrow();
        const privileged = (
          await rows(
            f.c,
            "SELECT account_locked locked FROM mysql.user WHERE User='root' AND Host='%'"
          )
        ).map(v => v.locked);
        expect(privileged).toEqual(["Y"]);
        // New app admission is tested with a non-recovery account even over local socket.
        await f.c.query("CREATE USER 'fixture_app'@'localhost' ACCOUNT LOCK");
        await expect(
          openBackupConnection(
            `mysql://fixture_app@localhost/${f.c.config.database}`,
            socketPath
          )
        ).rejects.toThrow();
        const events: string[] = [];
        expect(
          await execute0022(f.c, f.plan, f.cap, e => events.push(e))
        ).toMatchObject({
          status: "APPLIED",
          fingerprint: POST,
          applicationCommit: f.plan.applicationCommit,
          sqlSourceCommit: RC,
        });
        expect(events.filter(v => v === "statement_completed")).toHaveLength(3);
        const after = await capture(f.c, f.plan.backup.sourceAfter);
        for (const [n, t] of Object.entries(f.plan.backup.sourceAfter.tables))
          if (!n.startsWith("_l4ckos_")) expect(after.tables[n]).toEqual(t);
        expect(
          await rows(
            f.c,
            "SELECT manufacturingScheduleRequired, estimatedManufacturingStart FROM productionBatches"
          )
        ).toMatchObject([
          {
            manufacturingScheduleRequired: 0,
            estimatedManufacturingStart: null,
          },
        ]);
        expect(
          (
            await rows(
              f.c,
              "SELECT completedStatements,state FROM _l4ckos_schema_executions WHERE operation=?",
              ["0022_preorder_manufacturing_schedule"]
            )
          )[0]
        ).toMatchObject({ completedStatements: 3, state: "COMPLETED" });
        await expect(execute0022(f.c, f.plan, f.cap)).rejects.toThrow(
          "0022_ALREADY_APPLIED"
        );
        await expect(
          allowApplicationReads(f.c, barrier, { user: "root", host: "%" }, true)
        ).rejects.toThrow("APPLICATION_READ_ONLY_BYPASS_PRIVILEGES");
        barrier = await allowApplicationReads(
          f.c,
          barrier,
          { user: "fixture_readonly_app", host: "localhost" },
          true
        );
        const app = await openBackupConnection(
          `mysql://fixture_readonly_app@localhost/${f.c.config.database}`,
          socketPath
        );
        expect(
          Number((await rows(app, "SELECT COUNT(*) n FROM orders"))[0].n)
        ).toBe(1);
        await expect(
          app.query("UPDATE products SET stock=8 WHERE id=901")
        ).rejects.toThrow();
        await app.end();
        await expect(releaseBarrier(f.c, barrier, false)).rejects.toThrow(
          "BARRIER_RELEASE_APPROVAL_REQUIRED"
        );
        await releaseBarrier(f.c, barrier, true);
        await f.c.query("DROP USER 'fixture_app'@'localhost'");
        await f.c.query("DROP USER 'fixture_readonly_app'@'localhost'");
        const renewed = await openBackupConnection(f.local.url, socketPath);
        await renewed.query(
          "INSERT INTO productionBatches (name) VALUES ('Synthetic future')"
        );
        expect(
          (
            await rows(
              renewed,
              "SELECT manufacturingScheduleRequired FROM productionBatches WHERE name='Synthetic future'"
            )
          )[0].manufacturingScheduleRequired
        ).toBe(1);
        await renewed.end();
        expect(
          Number((await rows(f.c, "SELECT COUNT(*) n FROM orders"))[0].n)
        ).toBe(1);
      } finally {
        await f.finish();
      }
    });
    it.each([
      "sha",
      "checksum",
      "target",
      "expired",
      "stale-backup",
      "source-data",
      "gzip",
      "restore-proof",
      "capability",
      "sql",
      "barrier",
      "ledger",
      "pending-execution",
    ])("blocks %s before new migration writes", async kind => {
      const f = await fixture();
      const approvedPlan = structuredClone(f.plan);
      try {
        if (kind === "sha")
          f.plan.applicationCommit = "a".repeat(40) as typeof RC;
        if (kind === "checksum")
          f.plan.sqlChecksum = "b".repeat(64) as typeof SQL_SHA;
        if (kind === "target")
          f.plan.target = {
            ...TARGET,
            database: "unexpected",
          } as typeof TARGET;
        if (kind === "expired") f.plan.expiresAt = "2000-01-01T00:00:00Z";
        if (kind === "stale-backup")
          f.plan.backup.createdAt = "2000-01-01T00:00:00Z";
        if (kind === "restore-proof")
          f.plan.backup.restored.tables.products.hash = "b".repeat(64);
        if (kind === "gzip") {
          await writeFile(f.file, "corrupt", { mode: 0o600 });
          await expect(
            verifyPrivateGzip(f.file, process.cwd())
          ).rejects.toThrow("BACKUP_GZIP_INVALID");
          return;
        }
        if (kind === "source-data")
          await f.c.query("UPDATE products SET stock=8 WHERE id=901");
        if (kind === "ledger")
          await f.c.query(
            "UPDATE _l4ckos_schema_migrations SET checksum=? WHERE name='0021_preorder_production_batches'",
            ["b".repeat(64)]
          );
        if (kind === "pending-execution")
          await f.c.query(
            "UPDATE _l4ckos_schema_executions SET state='FAILED' WHERE operation='0021_preorder_production_batches'"
          );
        if (kind === "sql") changed.sql = true;
        if (kind !== "barrier")
          await activateBarrier(f.c, approvedPlan, f.cap, async () => {});
        await expect(
          execute0022(
            f.c,
            f.plan,
            kind === "capability" ? ({} as typeof f.cap) : f.cap
          )
        ).rejects.toThrow();
        expect(
          await rows(
            f.c,
            "SELECT name FROM _l4ckos_schema_migrations WHERE name=?",
            ["0022_preorder_manufacturing_schedule"]
          )
        ).toHaveLength(0);
        expect((await capture(f.c)).fingerprint).toBe(PRE);
      } finally {
        await f.finish();
      }
    });
    it("rejects active transactions before quarantine", async () => {
      const f = await fixture(),
        writer = await openBackupConnection(f.local.url, socketPath);
      try {
        await writer.beginTransaction();
        await writer.query("SELECT * FROM products FOR UPDATE");
        await expect(
          activateBarrier(f.c, f.plan, f.cap, async () => {})
        ).rejects.toThrow("BARRIER_TRANSACTIONS_NOT_DRAINED");
        expect(
          Number((await rows(f.c, "SELECT @@GLOBAL.read_only ro"))[0].ro)
        ).toBe(0);
      } finally {
        await writer.rollback();
        await writer.end();
        await f.finish();
      }
    });
    it("rejects backup/scope persistence failure before changing global state", async () => {
      const f = await fixture();
      try {
        await expect(
          activateBarrier(f.c, f.plan, f.cap, async () => {
            throw Error("disk");
          })
        ).rejects.toThrow("disk");
        expect(
          Number((await rows(f.c, "SELECT @@GLOBAL.read_only ro"))[0].ro)
        ).toBe(0);
      } finally {
        await f.finish();
      }
    });
    it("quarantine failure keeps read_only on and never proceeds to DDL", async () => {
      const f = await fixture(),
        original = f.c.query.bind(f.c);
      try {
        f.c.query = (async (sql: any, params: any) => {
          if (typeof sql === "string" && sql.startsWith("ALTER USER"))
            throw Error("synthetic quarantine failure");
          return (original as any)(sql, params);
        }) as Connection["query"];
        await expect(
          activateBarrier(f.c, f.plan, f.cap, async () => {})
        ).rejects.toThrow("synthetic quarantine failure");
        f.c.query = original;
        expect(
          Number((await rows(f.c, "SELECT @@GLOBAL.read_only ro"))[0].ro)
        ).toBe(1);
        await expect(execute0022(f.c, f.plan, f.cap)).rejects.toThrow(
          "BARRIER_CAPABILITY_REQUIRED"
        );
        expect((await capture(f.c)).fingerprint).toBe(PRE);
      } finally {
        f.c.query = original;
        await f.finish();
      }
    });
    it("barrier loss after first DDL stops before the second and records FAILED", async () => {
      const f = await fixture(),
        original = f.c.query.bind(f.c);
      let lost = false;
      try {
        await activateBarrier(f.c, f.plan, f.cap, async () => {});
        f.c.query = (async (sql: any, params: any) => {
          const result = await (original as any)(sql, params);
          if (
            !lost &&
            typeof sql === "string" &&
            sql.startsWith("ALTER TABLE")
          ) {
            lost = true;
            await original("SET GLOBAL read_only=OFF");
          }
          return result;
        }) as Connection["query"];
        await expect(execute0022(f.c, f.plan, f.cap)).rejects.toThrow(
          "RECOVERY_REQUIRED"
        );
        f.c.query = original;
        expect(
          (
            await rows(
              f.c,
              "SELECT state,completedStatements FROM _l4ckos_schema_executions WHERE operation=?",
              ["0022_preorder_manufacturing_schedule"]
            )
          )[0]
        ).toMatchObject({ state: "FAILED", completedStatements: 1 });
      } finally {
        f.c.query = original;
        await f.finish();
      }
    });
    it("two calls on the same connection cannot share a reentrant schema lock", async () => {
      const f = await fixture();
      try {
        await activateBarrier(f.c, f.plan, f.cap, async () => {});
        const outcomes = await Promise.allSettled([
          execute0022(f.c, f.plan, f.cap),
          execute0022(f.c, f.plan, f.cap),
        ]);
        expect(outcomes.filter(v => v.status === "fulfilled")).toHaveLength(1);
        const stopped = outcomes.find(
          v => v.status === "rejected"
        ) as PromiseRejectedResult;
        expect(stopped.reason.message).toBe("0022_EXECUTION_ALREADY_ACTIVE");
        expect(
          await rows(
            f.c,
            "SELECT name FROM _l4ckos_schema_migrations WHERE name=?",
            ["0022_preorder_manufacturing_schedule"]
          )
        ).toHaveLength(1);
      } finally {
        await f.finish();
      }
    });
    it("a valid gzip with incomplete SQL cannot produce a restore proof", async () => {
      const f = await fixture();
      try {
        const name = `${f.c.config.database}_broken`;
        names.push(name);
        await f.c.query(
          `CREATE DATABASE ${quote(name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
        );
        const folder = await mkdtemp("/tmp/l4ckos-0022-backup-"),
          file = `${folder}/incomplete.sql.gz`;
        await writeFile(
          file,
          gzipSync(Buffer.from("-- synthetic incomplete export\n")),
          { mode: 0o600 }
        );
        await expect(
          restoreAndProve(
            { url: `mysql://root@localhost/${name}`, socketPath },
            file,
            process.cwd(),
            {
              sourceBefore: f.plan.backup.sourceBefore,
              sourceAfter: f.plan.backup.sourceAfter,
              createdAt: f.plan.backup.createdAt,
            }
          )
        ).rejects.toThrow();
        expect(
          (await verifyPrivateGzip(file, process.cwd())).bytes
        ).toBeGreaterThan(0);
      } finally {
        await f.finish();
      }
    });
    it.each([0, 1, 2, 3])(
      "failure after %i statements leaves durable FAILED and rejects blind retry",
      async stop => {
        const f = await fixture();
        const original = f.c.query.bind(f.c);
        let completed = 0;
        try {
          await activateBarrier(f.c, f.plan, f.cap, async () => {});
          f.c.query = (async (sql: any, params: any) => {
            if (typeof sql === "string" && sql.startsWith("ALTER TABLE")) {
              if (completed === stop) throw Error("synthetic DDL failure");
              completed++;
            }
            if (
              stop === 3 &&
              typeof sql === "string" &&
              sql.startsWith("INSERT INTO _l4ckos_schema_migrations") &&
              params?.[0] === "0022_preorder_manufacturing_schedule"
            )
              throw Error("synthetic ledger failure");
            return (original as any)(sql, params);
          }) as Connection["query"];
          await expect(execute0022(f.c, f.plan, f.cap)).rejects.toThrow(
            "RECOVERY_REQUIRED"
          );
          f.c.query = original;
          expect(
            (
              await rows(
                f.c,
                "SELECT state,completedStatements FROM _l4ckos_schema_executions WHERE operation=?",
                ["0022_preorder_manufacturing_schedule"]
              )
            )[0]
          ).toMatchObject({ state: "FAILED", completedStatements: stop });
          await expect(execute0022(f.c, f.plan, f.cap)).rejects.toThrow(
            "RECOVERY_REQUIRED"
          );
          expect(
            Number((await rows(f.c, "SELECT @@GLOBAL.read_only ro"))[0].ro)
          ).toBe(1);
        } finally {
          f.c.query = original;
          await f.finish();
        }
      }
    );
    it("same schema advisory lock rejects a competing migrator", async () => {
      const f = await fixture();
      try {
        await activateBarrier(f.c, f.plan, f.cap, async () => {});
        const other = await openBackupConnection(f.local.url, socketPath);
        const lock = `l4ckos_schema_v2_${sha256(f.c.config.database!).slice(0, 32)}`;
        await other.query("SELECT GET_LOCK(?,0)", [lock]);
        // The barrier additionally rejects the foreign privileged session before DDL.
        await expect(execute0022(f.c, f.plan, f.cap)).rejects.toThrow(
          "BARRIER_FOREIGN_SESSION"
        );
        await other.query("SELECT RELEASE_LOCK(?)", [lock]);
        await other.end();
        expect(
          await rows(
            f.c,
            "SELECT operation FROM _l4ckos_schema_executions WHERE operation=?",
            ["0022_preorder_manufacturing_schedule"]
          )
        ).toHaveLength(0);
      } finally {
        await f.finish();
      }
    });
    it("remote issuer rejects local socket with no Railway override", async () => {
      const f = await fixture();
      try {
        await expect(remoteCapability(f.c, f.plan)).rejects.toThrow(
          "STAGING_RUNTIME_IDENTITY_MISMATCH"
        );
        assertPlan(f.plan);
      } finally {
        await f.finish();
      }
    });
    it("operator admission can be locked without losing its session; local recovery survives disconnect", async () => {
      const f = await fixture(),
        user = "fixture_operator_0022";
      await f.c.query("CREATE USER ?@'localhost'", [user]);
      await f.c.query("GRANT ALL PRIVILEGES ON *.* TO ?@'localhost'", [user]);
      const local = {
        url: `mysql://${user}@localhost/${f.c.config.database}`,
        socketPath,
      };
      const operator = await openBackupConnection(local.url, socketPath);
      await f.c.end();
      let saved: BarrierState | undefined;
      try {
        const cap = await localCapability(operator, f.plan, local);
        await activateBarrier(operator, f.plan, cap, async s => {
          saved = s;
        });
        expect(
          (
            await rows(
              operator,
              "SELECT account_locked locked FROM mysql.user WHERE User=? AND Host='localhost'",
              [user]
            )
          )[0].locked
        ).toBe("Y");
        expect(await execute0022(operator, f.plan, cap)).toMatchObject({
          status: "APPLIED",
        });
        await operator.end();
        const recovery = await openBackupConnection(f.local.url, socketPath);
        expect(
          Number((await rows(recovery, "SELECT @@GLOBAL.read_only ro"))[0].ro)
        ).toBe(1);
        // Recovery restores only admission/global state; schema/ledger remain v3.
        for (const a of saved!.accounts)
          await recovery.query("ALTER USER ?@? ACCOUNT UNLOCK", [
            a.user,
            a.host,
          ]);
        await recovery.query("SET GLOBAL read_only=OFF");
        expect((await capture(recovery)).fingerprint).toBe(POST);
        await recovery.query("DROP USER ?@'localhost'", [user]);
        await recovery.end();
      } catch (error) {
        await operator.end().catch(() => {});
        const recovery = await openBackupConnection(f.local.url, socketPath);
        for (const a of saved?.accounts ?? [])
          await recovery.query("ALTER USER ?@? ACCOUNT UNLOCK", [
            a.user,
            a.host,
          ]);
        await recovery.query("SET GLOBAL read_only=OFF");
        await recovery.query("DROP USER IF EXISTS ?@'localhost'", [user]);
        await recovery.end();
        throw error;
      }
    });
    it.each([0, 1])("socket interruption during DDL %i requires approved forward recovery and keeps quarantine", async stop => {
      const f = await fixture();
      let saved: BarrierState | undefined;
      let recovery: Connection | undefined;
      const original = f.c.query.bind(f.c);
      let sent = 0;
      try {
        await activateBarrier(f.c, f.plan, f.cap, async state => { saved = state; });
        f.c.query = (function (statement: any, params: any) {
          const pending = (original as any)(statement, params);
          if (typeof statement === 'string' && statement.startsWith('ALTER TABLE') && sent++ === stop)
            setTimeout(() => f.c.destroy(), 0);
          return pending;
        }) as Connection['query'];
        await expect(execute0022(f.c, f.plan, f.cap)).rejects.toThrow();
        f.c.destroy();
        recovery = await openBackupConnection(f.local.url, socketPath);
        expect(Number((await rows(recovery,'SELECT @@GLOBAL.read_only ro'))[0].ro)).toBe(1);
        const cap = await localCapability(recovery, f.plan, f.local);
        await expect(adoptBarrier(recovery, f.plan, cap, saved!, false)).rejects.toThrow('BARRIER_RECOVERY_APPROVAL_REQUIRED');
        const barrier = await adoptBarrier(recovery, f.plan, cap, saved!, true);
        const proposal = await inspect0022Recovery(recovery, f.plan, cap);
        expect(proposal.actualStep).toBeGreaterThanOrEqual(stop);
        expect(proposal.actualStep).toBeLessThanOrEqual(stop+1);
        expect(proposal.checkpoint).toBe(stop);
        await expect(recoverPartial0022(recovery, f.plan, cap, 'wrong')).rejects.toThrow('RECOVERY_CONTINUATION_APPROVAL_REQUIRED');
        expect(await recoverPartial0022(recovery, f.plan, cap, digest(proposal))).toMatchObject({status:'RECOVERED_FORWARD',fingerprint:POST,barrier:'HELD'});
        expect(await rows(recovery,"SELECT state,completedStatements FROM _l4ckos_schema_executions WHERE operation=?",['0022_preorder_manufacturing_schedule'])).toMatchObject([{state:'COMPLETED',completedStatements:3}]);
        expect(Number((await rows(recovery,"SELECT COUNT(*) n FROM _l4ckos_schema_migrations WHERE name='0022_preorder_manufacturing_schedule'"))[0].n)).toBe(1);
        expect(Number((await rows(recovery,'SELECT @@GLOBAL.read_only ro'))[0].ro)).toBe(1);
        await expect(releaseBarrier(recovery, barrier, false)).rejects.toThrow('BARRIER_RELEASE_APPROVAL_REQUIRED');
        await releaseBarrier(recovery, barrier, true);
        expect(Number((await rows(recovery,'SELECT @@GLOBAL.read_only ro'))[0].ro)).toBe(0);
      } finally {
        f.c.destroy();
        if (!recovery) recovery=await openBackupConnection(f.local.url,socketPath);
        for (const a of saved?.accounts ?? []) await recovery.query('ALTER USER ?@? ACCOUNT UNLOCK',[a.user,a.host]);
        await recovery.query('SET GLOBAL read_only=OFF');await recovery.end();
      }
    });
    it("two full window activations arbitrate before quarantine and migrate exactly once", async () => {
      const f=await fixture(), other=await openBackupConnection(f.local.url,socketPath);
      let saved: BarrierState | undefined, release!:()=>void, entered!:()=>void;
      const enteredPromise=new Promise<void>(r=>entered=r), hold=new Promise<void>(r=>release=r);
      let firstPreserves=0, secondPreserves=0;
      try {
        const otherCap=await localCapability(other,f.plan,f.local);
        const winner=applyGovernedWindow(f.c,f.plan,f.cap,async state=>{saved=state;firstPreserves++;entered();await hold;});
        await enteredPromise;
        await expect(applyGovernedWindow(other,f.plan,otherCap,async()=>{secondPreserves++;})).rejects.toThrow('WINDOW_EXECUTOR_BUSY');
        expect(Number((await rows(other,'SELECT @@GLOBAL.read_only ro'))[0].ro)).toBe(0);
        expect(secondPreserves).toBe(0);await other.end();release();
        expect(await winner).toMatchObject({status:'APPLIED',fingerprint:POST});expect(firstPreserves).toBe(1);
        expect(Number((await rows(f.c,'SELECT @@GLOBAL.read_only ro'))[0].ro)).toBe(1);
        // Saved pre-mutation inventory has ready=false; use verified active state.
        const barrier={...saved!,ready:true};
        await expect(releaseBarrier(f.c,barrier,false)).rejects.toThrow('BARRIER_RELEASE_APPROVAL_REQUIRED');
        await releaseBarrier(f.c,barrier,true);
        expect(Number((await rows(f.c,"SELECT COUNT(*) n FROM _l4ckos_schema_migrations WHERE name='0022_preorder_manufacturing_schedule'"))[0].n)).toBe(1);
      }finally{release?.();await other.end().catch(()=>{});await f.finish();}
    });

  }
);
