import { beforeAll, afterAll, it, expect, describe } from "vitest";
import { createConnection, type Connection } from "mysql2/promise";
import { readFile, readdir } from "node:fs/promises";
import {
  FinancialIsolation,
  EXECUTOR_GRANTS,
  type IsolationApproval,
} from "../../database/financialIsolation/controller";
import { TARGET } from "../../database/financialRecovery/policy";
import {
  readStructuralSchema,
  structuralHash,
} from "../../database/schema/fingerprint";
const socket = "/tmp/l4ckos-financial-isolation-socket/mysqld.sock";
const db = "l4ckos_test_financial_isolation";
let root: Connection, rescue: Connection, executor: Connection, app: Connection;
let isolation: FinancialIsolation;
let drained = true;
const audit: string[] = [];
const approval = (operation: "isolate" | "release"): IsolationApproval => ({
  operation,
  reference: "LOCAL_ISOLATION_FIXTURE",
  expiresAt: Date.now() + 60000,
  projectId: TARGET.projectId,
  environmentId: TARGET.environmentId,
  mysqlServiceId: "bcda5d78-4a0d-4682-8659-8316847addb7",
});
const open = (user = "root") =>
  createConnection({ user, socketPath: socket, database: db });
describe.skipIf(process.env.L4CKOS_ISOLATION_TEST !== "1")(
  "exclusive isolation, local MySQL v4 only (no B)",
  () => {
    beforeAll(async () => {
      root = await createConnection({ user: "root", socketPath: socket });
      await root.query("CREATE DATABASE " + db);
      await root.changeUser({ database: db });
      rescue = await open();
      await root.query("SET FOREIGN_KEY_CHECKS=0");
      for (const f of (await readdir("database/bootstrap/v2")).filter(x =>
        x.endsWith(".sql")
      )) {
        let ddl = await readFile("database/bootstrap/v2/" + f, "utf8");
        const cols =
          f === "orderItems.sql"
            ? "`estimatedManufacturingStartAtPurchase` date DEFAULT NULL,`estimatedManufacturingEndAtPurchase` date DEFAULT NULL,"
            : f === "productionBatches.sql"
              ? "`estimatedManufacturingStart` date DEFAULT NULL,`estimatedManufacturingEnd` date DEFAULT NULL,`manufacturingScheduleRequired` tinyint NOT NULL DEFAULT '1',"
              : "";
        ddl = ddl.replace("  PRIMARY KEY", "  " + cols + " PRIMARY KEY");
        await root.query(ddl);
      }
      await root.query("SET FOREIGN_KEY_CHECKS=1");
      await root.query(
        await readFile(
          "database/migrations/0023_asaas_webhook_inbox.sql",
          "utf8"
        )
      );
      expect(structuralHash(await readStructuralSchema(root))).toBe(
        TARGET.schemaHash
      );
      await root.query(
        await readFile("database/governance/ledger.sql", "utf8")
      );
      await root.query(
        await readFile("database/governance/executions.sql", "utf8")
      );
      const [tables] = await root.query<any[]>(
        "SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()"
      );
      expect(tables[0].n).toBe(31);
      await root.query(
        "INSERT INTO products(id,name,category,price,stock) VALUES(1,'synthetic','fixture',9900,98)"
      );
      await root.query("CREATE USER 'l4ckos_financial_window'@'localhost'");
      await root.query("CREATE USER 'l4ckos_fixture_app'@'localhost'");
      for (const [t, p] of Object.entries(EXECUTOR_GRANTS))
        await root.query(
          `GRANT ${p.join(", ")} ON ${db}.${t} TO 'l4ckos_financial_window'@'localhost'`
        );
      await root.query(
        `GRANT ALL ON ${db}.* TO 'l4ckos_fixture_app'@'localhost'`
      );
      executor = await open("l4ckos_financial_window");
      app = await open("l4ckos_fixture_app");
      isolation = new FinancialIsolation(root, rescue, [executor], {
        identity: async () => {
          expect(String(root.config.socketPath)).toBe(socket);
          expect(structuralHash(await readStructuralSchema(root))).toBe(
            TARGET.schemaHash
          );
        },
        evidence: async () => ({
          httpBlocked: true,
          workersBlocked: true,
          dispatchersDrained: drained,
          externalJobsInventoried: true,
          observedAt: Date.now(),
        }),
        persist: async event => {
          audit.push(event);
        },
      });
    });
    afterAll(async () => {
      await root?.query("SET GLOBAL read_only=OFF");
      for (const u of ["root", "l4ckos_financial_window", "l4ckos_fixture_app"])
        await root
          ?.query("ALTER USER ?@? ACCOUNT UNLOCK", [u, "localhost"])
          .catch(() => {});
      await executor?.end().catch(() => {});
      await app?.end().catch(() => {});
      await rescue?.end();
      await root?.query(
        "DROP USER 'l4ckos_financial_window'@'localhost','l4ckos_fixture_app'@'localhost'"
      );
      await root?.query("DROP DATABASE " + db);
      await root?.end();
    });
    it("rejects missing operational approval", async () => {
      await expect(
        isolation.activate({ ...approval("isolate"), reference: "" })
      ).rejects.toThrow("APPROVAL");
    });
    it("rejects uncertain dispatchers before quarantine", async () => {
      drained = false;
      await expect(isolation.activate(approval("isolate"))).rejects.toThrow(
        "ADMISSION"
      );
      drained = true;
    });
    it("rejects an executor with broader privileges", async () => {
      await root.query(
        `GRANT DELETE ON ${db}.products TO 'l4ckos_financial_window'@'localhost'`
      );
      await expect(isolation.activate(approval("isolate"))).rejects.toThrow(
        "GRANTS"
      );
      await root.query(
        `REVOKE DELETE ON ${db}.products FROM 'l4ckos_financial_window'@'localhost'`
      );
    });
    it("does not mutate globals when durable inventory persistence fails", async () => {
      const bad = new FinancialIsolation(root, rescue, [executor], {
        identity: async () => {},
        evidence: async () => ({
          httpBlocked: true,
          workersBlocked: true,
          dispatchersDrained: true,
          externalJobsInventoried: true,
          observedAt: Date.now(),
        }),
        persist: async () => {
          throw Error("LOCAL_DISK_FAILED");
        },
      });
      await expect(bad.activate(approval("isolate"))).rejects.toThrow(
        "LOCAL_DISK"
      );
      const [m] = await root.query<any[]>("SELECT @@GLOBAL.read_only ro");
      expect(m[0].ro).toBe(0);
    });
    it("quarantines all admission and disconnects existing checkout/admin/worker/direct sessions", async () => {
      await isolation.activate(approval("isolate"));
      expect((await isolation.inspect()).phase).toBe("exclusive");
      for (const purpose of [
        "checkout",
        "admin-stock",
        "worker",
        "expiry-release",
        "direct-session",
      ]) {
        void purpose;
        await expect(open("l4ckos_fixture_app")).rejects.toThrow();
      }
      await expect(
        app.query("UPDATE products SET stock=0 WHERE id=1")
      ).rejects.toThrow();
      await expect(open()).rejects.toThrow();
      await expect(open("l4ckos_financial_window")).rejects.toThrow();
      await isolation.assertExclusive();
    });
    it("rejects DRY-RUN as a write capability and rechecks dispatcher evidence", async () => {
      await expect(
        isolation.lease(
          { operation: "financial-b", mode: "dry-run" },
          "a".repeat(64)
        )
      ).rejects.toThrow();
      drained = false;
      await expect(isolation.assertExclusive()).rejects.toThrow("ADMISSION");
      drained = true;
      await root.query("SET GLOBAL read_only=ON");
      await expect(isolation.assertExclusive()).rejects.toThrow("BARRIER_LOST");
      await root.query("SET GLOBAL read_only=OFF");
    });
    it("executor can validate complete schema without reading unrelated user data", async () => {
      expect(structuralHash(await readStructuralSchema(executor))).toBe(
        TARGET.schemaHash
      );
      await expect(
        executor.query("SELECT * FROM userAddresses")
      ).rejects.toThrow();
    });
    it("executor cannot use DDL, delete, historic updates or global bypass", async () => {
      for (const sql of [
        "CREATE TABLE forbidden(id INT)",
        "DELETE FROM products",
        "UPDATE payments SET amount=0",
        "SET GLOBAL read_only=OFF",
      ])
        await expect(executor.query(sql)).rejects.toThrow();
    });
    it("rollback before commit preserves synthetic stock", async () => {
      await executor.beginTransaction();
      await executor.query("SELECT id FROM products WHERE id=1 FOR UPDATE");
      await executor.query("UPDATE products SET stock=stock-1 WHERE id=1");
      await executor.rollback();
      const [r] = await root.query<any[]>(
        "SELECT stock FROM products WHERE id=1"
      );
      expect(r[0].stock).toBe(98);
    });
    it("approved exclusive transaction commits once; post-commit exception cannot rollback it", async () => {
      await isolation.assertExclusive();
      await executor.beginTransaction();
      await executor.query("SELECT id FROM products WHERE id=1 FOR UPDATE");
      await executor.query(
        "UPDATE products SET stock=97 WHERE id=1 AND stock=98"
      );
      await executor.commit();
      await executor.rollback();
      const [r] = await root.query<any[]>(
        "SELECT stock FROM products WHERE id=1"
      );
      expect(r[0].stock).toBe(97);
    });
    it("synthetic compare-and-set reentry has no second consumption", async () => {
      const [r] = await executor.query<any>(
        "UPDATE products SET stock=97 WHERE id=1 AND stock=98"
      );
      expect(r.affectedRows).toBe(0);
    });
    it("read lease is bounded and cannot be reused or changed into a write operation", async () => {
      await expect(
        isolation.readLease({ operation: "created" })
      ).rejects.toThrow("SCOPE");
      const openRead = await isolation.readLease({ operation: "financial-b" });
      const c = await openRead();
      await c.query("SELECT id FROM products");
      await expect(openRead()).rejects.toThrow("REVOKED");
      await expect(
        isolation.readLease({ operation: "financial-b" })
      ).rejects.toThrow("SCOPE");
    });
    it("revokes existing channel, preserves quarantine, requires separate release", async () => {
      await expect(isolation.release(approval("release"))).rejects.toThrow(
        "REVOKE"
      );
      await isolation.revoke();
      await expect(
        executor.query("UPDATE products SET stock=0 WHERE id=1")
      ).rejects.toThrow();
      await expect(open("l4ckos_fixture_app")).rejects.toThrow();
      await expect(
        isolation.release({ ...approval("release"), expiresAt: 0 })
      ).rejects.toThrow("APPROVAL");
    });
    it("supervised release restores app but leaves financial account locked and audit intact", async () => {
      await isolation.release(approval("release"));
      const c = await open("l4ckos_fixture_app");
      await c.query("SELECT id FROM products");
      await c.end();
      await expect(open("l4ckos_financial_window")).rejects.toThrow();
      expect(audit).toEqual([
        "before-isolation",
        "quarantine-proven",
        "exclusive-ready",
        "channel-revoked",
        "before-release",
        "released",
      ]);
    });
    it("aborts on transaction in flight, keeps read-only quarantine until supervised incident recovery", async () => {
      await root.query(
        "ALTER USER 'l4ckos_financial_window'@'localhost' ACCOUNT UNLOCK"
      );
      executor = await open("l4ckos_financial_window");
      app = await open("l4ckos_fixture_app");
      await app.beginTransaction();
      await app.query("UPDATE products SET stock=96 WHERE id=1");
      isolation = new FinancialIsolation(root, rescue, [executor], {
        identity: async () => {},
        evidence: async () => ({
          httpBlocked: true,
          workersBlocked: true,
          dispatchersDrained: true,
          externalJobsInventoried: true,
          observedAt: Date.now(),
        }),
        persist: async () => {},
      });
      await expect(isolation.activate(approval("isolate"))).rejects.toThrow(
        "TRANSACTIONS_NOT_DRAINED"
      );
      expect((await isolation.inspect()).phase).toBe("incident");
      await expect(open("l4ckos_fixture_app")).rejects.toThrow();
      await app.rollback();
      await new Promise(r => setTimeout(r, 250));
      const [m] = await root.query<any[]>("SELECT @@GLOBAL.read_only ro");
      expect(m[0].ro).toBe(1);
      await isolation.revoke();
      await app.end();
      await isolation.release(approval("release"));
    });
  }
);
