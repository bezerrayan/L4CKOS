import {
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { createConnection, type Connection } from "mysql2/promise";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID, randomBytes, generateKeyPairSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  FinancialIsolation,
  EXECUTOR_GRANTS,
  type IsolationApproval,
} from "../../database/financialIsolation/controller";
import {
  runIsolatedRecovery,
  runIsolatedPreflight,
} from "../../database/financialIsolation/adapter";
import {
  TARGET,
  type Checkpoint,
} from "../../database/financialRecovery/policy";
import {
  captureSnapshot,
  verifyFinancial,
} from "../../database/financialRecovery/evidence";
import {
  type Runtime,
  RecoveryIncident,
} from "../../database/financialRecovery/operator";
import {
  rows,
  readStructuralSchema,
  structuralHash,
} from "../../database/schema/fingerprint";
import {
  takeFullBackup,
  restoreFullBackup,
  writeEncryptedBackup,
  decryptBackup,
  validateFullBackup,
} from "../../database/financialWindow/backup";
import { collectDrainage } from "../../database/financialWindow/drainage";
import {
  controlRecoveryPlan,
  inspectAfterControlLoss,
} from "../../database/financialWindow/recovery";
import { createIsolationJournal } from "../../database/financialIsolation/journal";
import {
  setupWindowFixture,
  fixtureEnvironment,
  fixtureExecute,
} from "./financialWindow.fixture";
import { WindowSession } from "../../database/financialWindow/session";
import {
  WindowAuthorizer,
  signWindowCommand,
} from "../../database/financialWindow/authorization";
const socket = "/tmp/l4ckos-window-v4-socket/mysqld.sock";
let password: string,
  db: string,
  root: Connection,
  rescue: Connection,
  foreign: Connection,
  executors: Connection[],
  isolation: FinancialIsolation,
  runtime: Runtime,
  journal: Awaited<ReturnType<typeof createIsolationJournal>>;
const hash = "a".repeat(64);
const connect = (user = "root", database = db) =>
  createConnection({
    user,
    password: user === "root" ? password : undefined,
    socketPath: socket,
    database,
    dateStrings: true,
    jsonStrings: true,
    timezone: "Z",
    supportBigNumbers: true,
    bigNumberStrings: true,
    multipleStatements: false,
  });
const isolationApproval = (
  operation: "isolate" | "release"
): IsolationApproval => ({
  operation,
  reference: "LOCAL_WINDOW_APPROVAL",
  expiresAt: Date.now() + 60000,
  projectId: TARGET.projectId,
  environmentId: TARGET.environmentId,
  mysqlServiceId: "bcda5d78-4a0d-4682-8659-8316847addb7",
});
async function identity() {
  if (
    root.config.socketPath !== socket ||
    !/^l4ckos_test_window_[a-f0-9]+$/.test(db) ||
    structuralHash(await readStructuralSchema(root)) !== TARGET.schemaHash
  )
    throw Error("LOCAL_ONLY");
}
const externalProof = () => ({
  observedAt: Date.now(),
  httpStatus: 503 as const,
  oldInstancesTerminated: true as const,
  workersPaused: true as const,
  dispatchersPaused: true as const,
  externalWriterInventoryComplete: true as const,
  providerCallsInFlight: 0 as const,
  reference: "LOCAL_EVIDENCE_DRained",
});
async function prepareWindow() {
  rescue = await connect();
  await root.query(
    "ALTER USER 'l4ckos_financial_window'@'localhost' ACCOUNT UNLOCK"
  );
  executors = await Promise.all(
    Array.from({ length: 4 }, () => connect("l4ckos_financial_window"))
  );
  for (const c of executors) {
    const raw = c.query.bind(c);
    c.query = (async (sql: any, ...args: any[]) => {
      try {
        return await raw(sql, ...(args as [any]));
      } catch (error: any) {
        console.log(
          JSON.stringify({
            safeMysqlCode: error?.code,
            errno: error?.errno,
            verb: /^\s*([A-Z]+)/i.exec(
              typeof sql === "string" ? sql : sql.sql
            )?.[1],
            table: /(?:INTO|UPDATE|FROM)\s+`?([a-zA-Z_]+)/i.exec(
              typeof sql === "string" ? sql : sql.sql
            )?.[1],
          })
        );
        throw error;
      }
    }) as any;
  }
  for (const c of executors) await c.query("SET SESSION time_zone='+00:00'");
  journal = await createIsolationJournal(
    "/tmp/l4ckos-financial-isolation-window-" + randomUUID()
  );
  isolation = new FinancialIsolation(root, rescue, executors, {
    identity,
    evidence: () => collectDrainage(root, externalProof()),
    persist: journal.persist,
  });
  runtime = {
    environment: fixtureEnvironment(),
    artifactHash: hash,
    open: async () => {
      throw Error("NO_GENERIC_OPEN");
    },
    identity: async () => ({
      database: TARGET.database,
      uuidHash: TARGET.mysqlUuidHash,
    }),
    bundleHash: async () => TARGET.bundleHash,
    fetch: vi.fn(async (url: any, options: any) => {
      expect(options.method).toBe("GET");
      expect(options.redirect).toBe("error");
      return new Response(
        JSON.stringify(
          String(url).endsWith("/refunds")
            ? { data: null, hasMore: false, totalCount: 0 }
            : {
                id: TARGET.paymentId,
                externalReference: "13",
                status: "RECEIVED",
                billingType: "PIX",
                value: 99,
                netValue: 98.01,
                deleted: false,
                refunds: null,
              }
        ),
        { status: 200 }
      );
    }) as any,
  };
}
async function preflight() {
  await isolation.activate(isolationApproval("isolate"));
  const a = await runIsolatedPreflight(
    { operation: "financial-b" },
    runtime,
    isolation
  );
  if (a.status !== "dry-run") throw Error("CHECKPOINT");
  return a.checkpoint;
}
async function closeWindow() {
  if ((await isolation.inspect()).phase !== "revoked") await isolation.revoke();
  await isolation.release(isolationApproval("release"));
  await rescue.end();
  await journal.close();
}
async function restartRecovery() {
  const plan = controlRecoveryPlan(
    true,
    "LOCAL_CONTROL_LOSS_RECOVERY",
    "b".repeat(64)
  );
  expect(plan.automaticRetry).toBe(false);
  execFileSync("docker", ["stop", "l4ckos-window-v4-local-auth"], {
    stdio: "ignore",
  });
  await writeFile("/tmp/l4ckos-window-v4-runtime/recovery/init.sql", plan.sql, {
    mode: 0o644,
  });
  execFileSync("docker", ["start", "l4ckos-window-v4-local-auth"], {
    stdio: "ignore",
  });
  for (let i = 0; i < 100; i++) {
    try {
      root = await connect();
      return;
    } catch {
      await new Promise(r => setTimeout(r, 100));
    }
  }
  throw Error("LOCAL_RESTART_NOT_READY");
}
describe.skipIf(process.env.L4CKOS_WINDOW_TEST !== "1")(
  "real isolated operator + controller + full backup v4, simulated provider",
  () => {
    beforeAll(async () => {
      password = (
        await readFile("/tmp/l4ckos-window-v4-runtime/root-password", "utf8")
      ).trim();
    }, 30000);
    beforeEach(async () => {
      db =
        "l4ckos_test_window_" + randomUUID().replaceAll("-", "").slice(0, 12);
      root = await connect("root", "mysql");
      await root.query("SET GLOBAL super_read_only=OFF");
      await root.query("SET GLOBAL read_only=OFF");
      await root.query("CREATE DATABASE " + db);
      await root.changeUser({ database: db });
      await root.query("SET SESSION time_zone='+00:00'");
      await setupWindowFixture(root);
      await root.query("CREATE USER 'l4ckos_financial_window'@'localhost'");
      await root.query("CREATE USER 'l4ckos_fixture_writer'@'localhost'");
      for (const [t, p] of Object.entries(EXECUTOR_GRANTS))
        await root.query(
          `GRANT ${p.join(", ")} ON ${db}.${t} TO 'l4ckos_financial_window'@'localhost'`
        );
      await root.query(
        `GRANT ALL ON ${db}.* TO 'l4ckos_fixture_writer'@'localhost'`
      );
      foreign = await connect("l4ckos_fixture_writer");
      await prepareWindow();
    }, 30000);
    afterEach(async () => {
      for (const c of executors ?? []) await c.end().catch(() => {});
      await foreign?.end().catch(() => {});
      await rescue?.end().catch(() => {});
      await journal?.close().catch(() => {});
      try {
        await root.query("SELECT 1");
      } catch {
        await restartRecovery();
      }
      await root.query("SET GLOBAL super_read_only=OFF");
      await root.query("SET GLOBAL read_only=OFF");
      await root.query("ALTER USER 'root'@'localhost' ACCOUNT UNLOCK");
      await root.query("ALTER USER 'root'@'%' ACCOUNT UNLOCK").catch(() => {});
      await root.query(
        "DROP USER IF EXISTS 'l4ckos_financial_window'@'localhost','l4ckos_fixture_writer'@'localhost'"
      );
      await root.query("DROP DATABASE " + db);
      await root.end();
      await writeFile(
        "/tmp/l4ckos-window-v4-runtime/recovery/init.sql",
        "SET GLOBAL event_scheduler=OFF;\n"
      );
    }, 30000);
    it("full snapshot, encryption/readback and isolated restore cover all31 tables including governance", async () => {
      const b = await takeFullBackup(root, identity);
      expect(Object.keys(b.tables)).toHaveLength(31);
      const directory = "/tmp/l4ckos-window-backup-" + randomUUID();
      await mkdir(directory, { mode: 0o700 });
      const key = randomBytes(32),
        proof = await writeEncryptedBackup(b, directory + "/backup.enc", key);
      const encrypted = await readFile(directory + "/backup.enc");
      expect(encrypted.toString()).not.toContain("synthetic@example.invalid");
      const restored = decryptBackup(encrypted, key, proof.ciphertextSha256);
      await root.query("CREATE DATABASE l4ckos_test_window_restore");
      const c = await connect("root", "l4ckos_test_window_restore");
      try {
        expect((await restoreFullBackup(c, restored, socket)).tables).toBe(31);
        await expect(restoreFullBackup(c, restored, socket)).rejects.toThrow(
          "EMPTY"
        );
      } finally {
        await c.end();
        await root.query("DROP DATABASE l4ckos_test_window_restore");
      }
      expect(() =>
        decryptBackup(encrypted, randomBytes(32), proof.ciphertextSha256)
      ).toThrow();
      expect(() => decryptBackup(encrypted, key, "0".repeat(64))).toThrow();
      const missing = structuredClone(b);
      delete missing.tables.orders;
      expect(() => validateFullBackup(missing)).toThrow("INTEGRITY");
      const changed = structuredClone(b);
      changed.tables.products.rows[0].stock = 0;
      expect(() => validateFullBackup(changed)).toThrow("INTEGRITY");
      await root.query(
        "CREATE TRIGGER l4ckos_local_backup_probe BEFORE INSERT ON products FOR EACH ROW SET NEW.stock=NEW.stock"
      );
      await expect(takeFullBackup(root, identity)).rejects.toThrow(
        "LOCAL_ONLY"
      );
      await root.query("DROP TRIGGER l4ckos_local_backup_probe");
    });
    it("blocks writers; real A/B consume once, audit, independent verification and idempotent reentry", async () => {
      const before = await captureSnapshot(root);
      const keys = generateKeyPairSync("ed25519");
      const publicKey = keys.publicKey
        .export({ type: "spki", format: "pem" })
        .toString();
      const privateKey = keys.privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString();
      const session = new WindowSession(
        new WindowAuthorizer(publicKey, hash),
        root,
        isolation,
        runtime,
        identity
      );
      const dispatch = (command: any) =>
        session.dispatch({
          ...command,
          authorization: signWindowCommand(
            command,
            command.operation,
            hash,
            "LOCAL_SIGNED_APPROVAL",
            privateKey
          ),
        });
      expect(await session.dispatch({ operation: "inspect" })).toMatchObject({
        status: "DRY_RUN",
        writes: false,
      });
      await expect(
        session.dispatch({
          mode: "execute",
          operation: "activate",
          isolationApproval: isolationApproval("isolate"),
        })
      ).rejects.toThrow();
      await dispatch({
        mode: "execute",
        operation: "activate",
        isolationApproval: isolationApproval("isolate"),
      });
      const a = (await dispatch({
        mode: "execute",
        operation: "preflight",
        request: { operation: "financial-b" },
      })) as any;
      expect(a.status).toBe("dry-run");
      const checkpoint: Checkpoint = a.checkpoint;
      expect(checkpoint.snapshot.tableHashes).toEqual(before.tableHashes);
      for (const actor of [
        "checkout",
        "admin",
        "worker",
        "release",
        "direct",
      ]) {
        void actor;
        await expect(connect("l4ckos_fixture_writer")).rejects.toThrow();
      }
      await expect(
        foreign.query("UPDATE products SET stock=0 WHERE id=1")
      ).rejects.toThrow();
      await expect(
        executors[2].query("UPDATE payments SET amount=0 WHERE id=1")
      ).rejects.toMatchObject({ code: "ER_COLUMNACCESS_DENIED_ERROR" });
      const request = fixtureExecute(checkpoint),
        r = await dispatch({
          mode: "execute",
          operation: "financial-b",
          request,
        });
      expect(r).toMatchObject({
        status: "completed",
        commitState: "confirmed",
        independentlyVerified: true,
      });
      expect((await captureSnapshot(root)).stock).toBe(97);
      await verifyFinancial(
        root,
        checkpoint.snapshot,
        request.approval!.reference,
        hash
      );
      const committed = await captureSnapshot(root);
      expect(committed.historicalHash).toBe(before.historicalHash);
      expect(committed.createdHash).toBe(before.createdHash);
      await closeWindow();
      await prepareWindow();
      await isolation.activate(isolationApproval("isolate"));
      const duplicate = await runIsolatedRecovery(request, runtime, isolation);
      expect(duplicate.status).toBe("already_completed");
      expect((await captureSnapshot(root)).tableHashes).toEqual(
        committed.tableHashes
      );
      await closeWindow();
    }, 30000);
    it("real operator rollback before commit leaves all14 hashes unchanged", async () => {
      const checkpoint = await preflight();
      let faultHits = 0;
      const writer = executors[2],
        original = writer.query.bind(writer);
      writer.query = (async (sql: any, ...args: any[]) => {
        if (
          /INSERT INTO payments/.test(typeof sql === "string" ? sql : sql.sql)
        ) {
          faultHits++;
          throw Error("LOCAL_PRECOMMIT_FAULT");
        }
        return original(sql, ...(args as [any]));
      }) as any;
      await expect(
        runIsolatedRecovery(fixtureExecute(checkpoint), runtime, isolation)
      ).rejects.toMatchObject({ commitState: "rolled_back" });
      expect(faultHits).toBe(1);
      expect((await captureSnapshot(root)).tableHashes).toEqual(
        checkpoint.snapshot.tableHashes
      );
      await closeWindow();
    });
    it("lost commit acknowledgement is unknown until independent financial verification", async () => {
      const checkpoint = await preflight(),
        request = fixtureExecute(checkpoint),
        writer = executors[2],
        commit = writer.commit.bind(writer);
      writer.commit = async () => {
        await commit();
        throw Error("LOCAL_COMMIT_ACK_LOST");
      };
      await expect(
        runIsolatedRecovery(request, runtime, isolation)
      ).rejects.toMatchObject({ commitState: "unknown" });
      await verifyFinancial(
        root,
        checkpoint.snapshot,
        request.approval!.reference,
        hash
      );
      expect((await captureSnapshot(root)).stock).toBe(97);
      await closeWindow();
    });
    it("pending dispatcher or uninventoried external writer prevents activation", async () => {
      await root.query(
        "UPDATE orderEmailEvents SET status='processing' WHERE id=(SELECT x.id FROM (SELECT MIN(id) id FROM orderEmailEvents) x)"
      );
      await expect(collectDrainage(root, externalProof())).rejects.toThrow(
        "DRAIN"
      );
      await expect(
        collectDrainage(root, {
          ...externalProof(),
          externalWriterInventoryComplete: false,
        } as any)
      ).rejects.toThrow("EXTERNAL");
    });
    it.each(["not_started", "rolled_back", "confirmed", "unknown"] as const)(
      "both administrative sessions lost: authenticated offline recovery classifies %s without retry",
      async expected => {
        const checkpoint = await preflight(),
          request = fixtureExecute(checkpoint);
        if (expected === "confirmed" || expected === "unknown")
          await runIsolatedRecovery(request, runtime, isolation);
        if (expected === "unknown") {
          // privileged control corruption fixture; must never authorize replay
          await root.query("SET GLOBAL read_only=OFF");
          await root.query("UPDATE products SET stock=0 WHERE id=1");
          await root.query("SET GLOBAL read_only=ON");
        }
        if (expected === "rolled_back") {
          await executors[1].beginTransaction();
          await executors[1].query(
            "UPDATE products SET stock=stock-1 WHERE id=1"
          );
        }
        await root.end();
        await rescue.end();
        await restartRecovery();
        await expect(connect("l4ckos_fixture_writer")).rejects.toThrow();
        await expect(connect("l4ckos_financial_window")).rejects.toThrow();
        const result = await inspectAfterControlLoss(
          root,
          checkpoint,
          request.approval!.reference,
          identity,
          expected !== "not_started"
        );
        expect(result).toMatchObject({
          commitState: expected,
          retryAuthorized: false,
        });
      },
      30000
    );
  }
);
