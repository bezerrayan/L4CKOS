import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
} from "vitest";
import { createConnection, type Connection } from "mysql2/promise";
import { PassThrough } from "node:stream";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  createSupervisedObserver,
  FRAME,
} from "../../database/order13Reconciliation/supervisedObserver";
import {
  observeAdministrativeGate,
  type AdministrativeObserver,
  type ObservationTarget,
} from "../../database/order13Reconciliation/administrativeObserver";
const enabled = process.env.L4CKOS_ORDER13_BRIDGE_MYSQL === "1";
const socketPath =
  process.env.L4CKOS_ORDER13_LOCAL_SOCKET ??
  "/tmp/l4ckos-order13-bridge/mysqld.sock";
const database =
  "l4ckos_order13_bridge_test_" + randomUUID().replaceAll("-", "").slice(0, 12);
let app: Connection, admin: Connection, target: ObservationTarget;
const open = () => createConnection({ user: "root", socketPath, database });
let input: PassThrough, output: PassThrough, observer: AdministrativeObserver;
let fault = "",
  saved: any,
  count = 0;
const pending: Promise<unknown>[] = [];
async function sample(request: any, runId: string, gate: string) {
  const [rows] = await admin.execute<any[]>(
    "SELECT DATABASE() db,SHA2(@@server_uuid,256) h,CURRENT_USER() account,DATE_FORMAT(UTC_TIMESTAMP(3),'%Y-%m-%dT%H:%i:%s.%fZ') observedAt,(SELECT COUNT(*) FROM information_schema.INNODB_TRX WHERE trx_mysql_thread_id<>?) n,(SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE ID=? AND USER=?) visible,(SELECT COUNT(*) FROM information_schema.INNODB_TRX WHERE trx_mysql_thread_id=?) active",
    [
      request.operatorSession,
      request.operatorSession,
      request.operatorUser,
      request.operatorSession,
    ]
  );
  const r = rows[0];
  return {
    version: 1,
    runId,
    gate,
    nonce: request.nonce,
    operatorSession: request.operatorSession,
    ...target,
    database: r.db,
    uuidHash: r.h,
    account: r.account,
    observedAt: r.observedAt,
    otherTransactions: Number(r.n),
    operatorVisible: Number(r.visible),
    operatorInTransaction: Number(r.active),
  };
}
describe.skipIf(!enabled)("supervised observer on disposable MySQL", () => {
  beforeAll(async () => {
    if (!socketPath.startsWith("/tmp/l4ckos-order13-"))
      throw Error("LOCAL_SOCKET_ONLY");
    const root = await createConnection({ user: "root", socketPath });
    const [rows] = await root.query<any[]>("SELECT SHA2(@@server_uuid,256) h");
    if (
      rows[0].h ===
      "92e96ae744d2112c5b4a430abc9a75d557a43d293652dd68369aa81786479f09"
    )
      throw Error("REMOTE_FORBIDDEN");
    await root.query("CREATE DATABASE ??", [database]);
    await root.end();
    app = await open();
    admin = await open();
    target = {
      project: "2bb90c8e-eb65-43ee-826b-f93750f0499c",
      environment: "15545eee-bc02-4b70-afc4-19a5db9e6f46",
      mysqlService: "bcda5d78-4a0d-4682-8659-8316847addb7",
      database,
      uuidHash: rows[0].h,
    };
    await admin.query(
      "CREATE TABLE probe (id INT PRIMARY KEY, stock INT) ENGINE=InnoDB"
    );
    await admin.query("INSERT INTO probe VALUES (1,98)");
  });
  afterAll(async () => {
    await app?.end();
    if (admin) {
      await admin.query("DROP DATABASE ??", [database]);
      await admin.end();
    }
  });
  beforeEach(async () => {
    fault = "";
    saved = undefined;
    count = 0;
    pending.length = 0;
    input = new PassThrough();
    output = new PassThrough();
    const runId = randomUUID();
    observer = createSupervisedObserver(input, output, runId);
    const lines = createInterface({ input: output });
    lines.on("line", line => {
      pending.push(
        (async () => {
          const frame = JSON.parse(line.slice(FRAME.length));
          ++count;
          if (fault === "eof" && count === 2) {
            input.end();
            return;
          }
          if (fault === "timeout") return;
          let response = await sample(frame.request, runId, frame.gate);
          if (fault === "identity") response.uuidHash = "0".repeat(64);
          if (fault === "stale") response.observedAt = "2020-01-01T00:00:00Z";
          if (fault === "replay" && count === 2) response = saved;
          saved = response;
          input.write(FRAME + JSON.stringify(response) + "\n");
        })()
      );
    });
    await app.beginTransaction();
    await app.query("SELECT id FROM probe WHERE id=1");
    await new Promise(r => setTimeout(r, 150));
  });
  afterEach(async () => {
    input.end();
    output.end();
    await Promise.all(pending);
    await app.rollback();
  });
  const gate = () => observeAdministrativeGate(app, observer, target);
  it("two fresh observations exclude the actual active operator session", async () => {
    await gate();
    await gate();
    expect(count).toBe(2);
    await expect(gate()).rejects.toThrow("UNAVAILABLE");
  });
  it("supervisor loss between gates aborts and rolls back candidate writes", async () => {
    await gate();
    await app.query("UPDATE probe SET stock=stock-1 WHERE id=1");
    fault = "eof";
    await expect(gate()).rejects.toThrow("CHANNEL_LOST");
    await app.rollback();
    const [rows] = await admin.query<any[]>(
      "SELECT stock FROM probe WHERE id=1"
    );
    expect(rows[0].stock).toBe(98);
  });
  it("instance mismatch rejects the sample", async () => {
    fault = "identity";
    await expect(gate()).rejects.toThrow("INSTANCE_MISMATCH");
  });
  it("stale sample is not accepted", async () => {
    fault = "stale";
    await expect(gate()).rejects.toThrow("STALE");
  });
  it("first-gate response cannot be replayed at the second gate", async () => {
    await gate();
    fault = "replay";
    await expect(gate()).rejects.toThrow("BINDING_MISMATCH");
  });
  it("another transaction is never excluded", async () => {
    const other = await open();
    try {
      await other.beginTransaction();
      await other.query("SELECT id FROM probe WHERE id=1 FOR UPDATE");
      await new Promise(r => setTimeout(r, 150));
      await expect(gate()).rejects.toThrow("OTHER_DATABASE_TRANSACTION_ACTIVE");
    } finally {
      await other.rollback();
      await other.end();
    }
  });
  it("unavailable SSH peer times out safely", async () => {
    fault = "timeout";
    await expect(gate()).rejects.toThrow("CHANNEL_LOST");
  }, 7000);
  it("real shell/mysql protocol handles two challenges on one private pipe", async () => {
    // Only this disposable copy changes the physical UUID/socket/schema and fixture user.
    const script = (
      await readFile("scripts/backup/order13-socket-observer.sh", "utf8")
    )
      .replaceAll("/var/run/mysqld/mysqld.sock", "/socket/mysqld.sock")
      .replaceAll("l4ckos_staging", database)
      .replaceAll(
        "92e96ae744d2112c5b4a430abc9a75d557a43d293652dd68369aa81786479f09",
        target.uuidHash
      )
      .replace('[ "$user" = l4ckos_app ]', '[ "$user" = root ]');
    const run = randomUUID();
    const child = spawn(
      "docker",
      [
        "exec",
        "-i",
        "-e",
        "RAILWAY_PROJECT_ID=" + target.project,
        "-e",
        "RAILWAY_ENVIRONMENT_ID=" + target.environment,
        "-e",
        "RAILWAY_SERVICE_ID=" + target.mysqlService,
        "-e",
        "ORDER13_RUN_ID=" + run,
        "l4ckos-order13-bridge",
        "bash",
        "-c",
        script,
      ],
      { stdio: ["pipe", "pipe", "pipe"] }
    );
    const lines = createInterface({ input: child.stdout })[
      Symbol.asyncIterator
    ]();
    const next = async () => {
      const v = await Promise.race([
        lines.next(),
        new Promise<never>((_, reject) => {
          const t = setTimeout(() => reject(Error("SHELL_TIMEOUT")), 3000);
          t.unref();
        }),
      ]);
      if (v.done) throw Error("SHELL_EOF");
      return JSON.parse(v.value.slice(FRAME.length));
    };
    try {
      expect((await next()).type).toBe("ready");
      const [rows] = await app.query<any[]>("SELECT CONNECTION_ID() id");
      for (const g of ["beforeWrite", "beforeCommit"]) {
        const nonce = randomUUID();
        child.stdin.write(`OBSERVE ${run} ${g} ${nonce} ${rows[0].id} root\n`);
        const r = await next();
        expect(r).toMatchObject({
          gate: g,
          nonce,
          operatorSession: rows[0].id,
          operatorVisible: 1,
          operatorInTransaction: 1,
          otherTransactions: 0,
          uuidHash: target.uuidHash,
        });
      }
      child.stdin.end();
      const status = await new Promise<number | null>(resolve =>
        child.on("close", resolve)
      );
      expect(status).toBe(0);
    } finally {
      child.kill();
      await lines.return?.();
    }
  }, 10000);
});
