import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createConnection, type Connection } from "mysql2/promise";
import {
  runLocalOrder13,
  evidenceFromSandbox,
  zeroRefunds,
  digest,
  OPERATION,
  PAYMENT,
  CREATED,
  type Approval,
  Order13Incident,
} from "../../database/order13Reconciliation/operator";

// Only fault injection wraps a real local mysql2 connection; no SQL/provider emulation.
const fault = vi.hoisted(() => ({
  database: "",
  commit: false,
  expiry: false,
}));
vi.mock("mysql2/promise", async original => {
  const actual = await original<typeof import("mysql2/promise")>();
  return {
    ...actual,
    createConnection: async (options: any) => {
      const c = await actual.createConnection(options);
      if (options.database === fault.database) {
        const commit = c.commit.bind(c);
        c.commit = async () => {
          await commit();
          if (fault.commit) throw Error("synthetic lost acknowledgement");
        };
        const execute = c.execute.bind(c);
        c.execute = (async (...args: any[]) => {
          const result = await (execute as any)(...args);
          if (
            fault.expiry &&
            String(args[0]).startsWith("INSERT INTO auditLogs")
          )
            await c.query("DO SLEEP(1.2)");
          return result;
        }) as typeof c.execute;
      }
      return c;
    },
  };
});
const socketPath =
  process.env.L4CKOS_ORDER13_LOCAL_SOCKET ??
  "/tmp/l4ckos-order13-mysql/mysqld.sock";
const database =
  "l4ckos_order13_test_" + randomUUID().replaceAll("-", "").slice(0, 12);
const target = { socketPath, database };
let root: Connection, c: Connection;
const q = async (sql: string, args: unknown[] = []) =>
  (await c.query<any[]>(sql, args))[0];
const tables = [
  "orders",
  "orderItems",
  "products",
  "stockReservations",
  "payments",
  "auditLogs",
  "asaasWebhookInbox",
  "asaasWebhookEvents",
  "paymentEvents",
  "notificationOutbox",
  "orderEmailEvents",
];
const payment = () => ({
  id: PAYMENT,
  externalReference: "13",
  status: "RECEIVED",
  billingType: "PIX",
  value: 99,
  netValue: 98.01,
  deleted: false,
  refunds: null,
});
const refunds = () => ({
  object: "list",
  data: null,
  offset: 0,
  limit: 100,
  totalCount: 0,
  hasMore: false,
});
const evidence = () =>
  evidenceFromSandbox(payment(), refunds(), new Date().toISOString());
const approval = (): Approval => ({
  operation: OPERATION,
  actorUserId: 14,
  reference: "LOCAL_ORDER13_APPROVAL",
  justification:
    "Synthetic approval for expired reservation fulfillment using current stock",
  expiredReservationDecision: "FULFILL_WITH_CURRENT_AVAILABLE_STOCK",
  unknownReceiptTimeAccepted: true,
  stockHistoryGapAccepted: true,
  panelReviewReference: "LOCAL_PANEL_FIXTURE_ONLY",
  backupRestoreReference: "LOCAL_DISPOSABLE_SNAPSHOT",
  writersQuiesced: true,
  dispatchersQuiesced: true,
  notification: "ONE_HELD_INTENT_NO_DISPATCH",
  webhook: "KEEP_INTERRUPTED",
  validFrom: new Date(Date.now() - 1000).toISOString(),
  validUntil: new Date(Date.now() + 60000).toISOString(),
});
async function plan(e = evidence()) {
  const result = await runLocalOrder13(target, { evidence: e });
  expect(result.status).toBe("dry-run");
  if (result.status !== "dry-run") throw Error("EXPECTED_DRY_RUN");
  return {
    mode: "execute-local" as const,
    evidence: e,
    approval: approval(),
    checkpoint: result.checkpoint,
  };
}
async function snapshot() {
  const s: Record<string, unknown> = {};
  for (const table of tables)
    s[table] = await q(
      "SELECT * FROM `" +
        table +
        "` ORDER BY " +
        (table === "asaasWebhookInbox" ? "eventId" : "id")
    );
  return s;
}
async function immutable() {
  return {
    inbox: await q("SELECT * FROM asaasWebhookInbox"),
    ledgers: await q("SELECT * FROM asaasWebhookEvents"),
    events: await q("SELECT * FROM paymentEvents"),
    audits: await q("SELECT * FROM auditLogs WHERE correlationId IS NULL"),
    legacies: await q("SELECT * FROM notificationOutbox WHERE orderId IN(2,3)"),
    expiry: await q("SELECT expiresAt FROM stockReservations WHERE id=10"),
  };
}
let historical: unknown;
describe("Order13 refund contract (offline)", () => {
  it("distinguishes null zero-count from an inconclusive or populated envelope", () => {
    expect(zeroRefunds(refunds())).toBe("sandbox-null-zero-count");
    expect(zeroRefunds({ ...refunds(), data: [] })).toBe("empty-array");
    for (const body of [
      { ...refunds(), totalCount: 1 },
      { ...refunds(), hasMore: true },
      { ...refunds(), data: [{}] },
      { ...refunds(), offset: 100 },
      { ...refunds(), data: undefined },
      { ...refunds(), totalCount: undefined },
      { ...refunds(), totalCount: "0" },
    ])
      expect(() => zeroRefunds(body)).toThrow();
  });
  it("refuses refunded, mismatched, deleted, chargeback or embedded refund evidence", () => {
    for (const change of [
      { id: "other" },
      { status: "REFUNDED" },
      { value: 98 },
      { externalReference: "12" },
      { deleted: true },
      { chargeback: {} },
      { chargebackStatus: "REQUESTED" },
      { refunds: [{}] },
    ])
      expect(() =>
        evidenceFromSandbox(
          { ...payment(), ...change },
          refunds(),
          new Date().toISOString()
        )
      ).toThrow();
  });
  it("rejects any remote or ordinary database before opening a connection", async () => {
    await expect(
      runLocalOrder13(
        { ...target, database: "l4ckos_staging" },
        { evidence: evidence() }
      )
    ).rejects.toThrow("LOCAL_DISPOSABLE_TARGET_REQUIRED");
    await expect(
      runLocalOrder13(
        { ...target, socketPath: "/var/run/mysqld/mysqld.sock" },
        { evidence: evidence() }
      )
    ).rejects.toThrow("LOCAL_DISPOSABLE_TARGET_REQUIRED");
  });
});

describe.skipIf(process.env.L4CKOS_ORDER13_MYSQL !== "1")(
  "Order13 isolated transaction, preservation and failure paths",
  () => {
    beforeAll(async () => {
      if (!/^\/tmp\/l4ckos-order13-[a-z0-9-]+\/mysqld\.sock$/.test(socketPath))
        throw Error("LOCAL_SOCKET_REQUIRED");
      root = await createConnection({ user: "root", socketPath });
      await root.query("CREATE DATABASE `" + database + "`");
      c = await createConnection({
        user: "root",
        socketPath,
        database,
        dateStrings: true,
      });
      await q("SET time_zone='+00:00'");
      await q("SET FOREIGN_KEY_CHECKS=0");
      const needed = [...tables, "users"];
      for (const file of (await readdir("database/bootstrap/v2")).filter(f =>
        needed.includes(f.slice(0, -4))
      ))
        await q(await readFile("database/bootstrap/v2/" + file, "utf8"));
      await q(
        await readFile(
          "database/migrations/0023_asaas_webhook_inbox.sql",
          "utf8"
        )
      );
      await q("SET FOREIGN_KEY_CHECKS=1");
    });
    beforeEach(async () => {
      fault.database = database;
      fault.commit = false;
      fault.expiry = false;
      for (const t of [
        "notificationOutbox",
        "orderEmailEvents",
        "paymentEvents",
        "payments",
        "asaasWebhookInbox",
        "asaasWebhookEvents",
        "auditLogs",
        "stockReservations",
        "orderItems",
        "orders",
        "products",
        "users",
      ])
        await q("DELETE FROM `" + t + "`");
      await q(
        "INSERT INTO users(id,openId,role) VALUES(14,'local-admin','admin'),(594,'local-buyer','user')"
      );
      await q(
        "INSERT INTO products(id,name,category,price,stock) VALUES(1,'local fixture','fixture',9900,98)"
      );
      await q(
        "INSERT INTO orders(id,userId,totalPrice,createdAt) VALUES(13,594,9900,DATE_SUB(NOW(),INTERVAL 2 HOUR)),(2,594,9900,NOW()),(3,594,9900,NOW())"
      );
      await q(
        "INSERT INTO orderItems(id,orderId,productId,productName,unitPrice,totalPrice,quantity) VALUES(14,13,1,'fixture',9900,9900,1)"
      );
      await q(
        "INSERT INTO stockReservations(id,orderId,userId,productId,orderItemId,quantity,status,expiresAt) VALUES(10,13,594,1,14,1,'active',DATE_SUB(NOW(),INTERVAL 1 HOUR))"
      );
      await q(
        "INSERT INTO auditLogs(id,actorType,action,entity,entityId,metadata) VALUES(72,'system','checkout.charge_created','order','13',?)",
        [JSON.stringify({ payment: { paymentId: PAYMENT, method: "PIX" } })]
      );
      const payload = {
        id: CREATED,
        event: "PAYMENT_CREATED",
        payment: {
          id: PAYMENT,
          externalReference: "13",
          status: "PENDING",
          value: 99,
        },
      };
      await q(
        "INSERT INTO asaasWebhookInbox(eventId,payloadHash,payload,state,attempts,errorCode,completedAt) VALUES(?,?,?,'rejected',1,'WEBHOOK_VALIDATION_REJECTED',NOW())",
        [CREATED, digest(payload), JSON.stringify(payload)]
      );
      await q(
        "INSERT INTO notificationOutbox(dedupeKey,type,orderId) VALUES('legacy-2','payment-approved',2),('legacy-3','payment-approved',3)"
      );
      historical = await immutable();
    });
    afterEach(async () => {
      fault.commit = false;
      fault.expiry = false;
      expect(await immutable()).toEqual(historical);
    });
    afterAll(async () => {
      await c?.end();
      if (root) {
        await root.query("DROP DATABASE `" + database + "`");
        await root.end();
      }
    });
    it("defaults to read-only dry-run and changes no persisted rows", async () => {
      const before = await snapshot();
      const result = await runLocalOrder13(target, { evidence: evidence() });
      expect(result).toMatchObject({
        status: "dry-run",
        mutations: 0,
        stock: { stock: 98, reserved: 0, available: 98 },
      });
      expect(await snapshot()).toEqual(before);
    });
    it("executes once, keeps expiry and unknown receipt time, and repeats as a complete no-op", async () => {
      const request = await plan();
      expect(await runLocalOrder13(target, request)).toMatchObject({
        status: "completed",
        commitState: "confirmed",
        independentlyVerified: true,
      });
      expect(await q("SELECT stock FROM products WHERE id=1")).toEqual([
        { stock: 97 },
      ]);
      expect(
        await q(
          "SELECT status,paidAmount,netAmount,statusSource,receivedAt FROM payments WHERE orderId=13"
        )
      ).toEqual([
        {
          status: "received",
          paidAmount: 9900,
          netAmount: 9801,
          statusSource: "reconciliation",
          receivedAt: null,
        },
      ]);
      expect(
        (await q("SELECT * FROM notificationOutbox WHERE orderId=13"))[0]
      ).toMatchObject({
        dedupeKey: OPERATION,
        type: "payment-approved",
        status: "pending",
        attempts: 0,
        sentAt: null,
      });
      const after = await snapshot();
      expect(await runLocalOrder13(target, request)).toMatchObject({
        status: "already_completed",
        mutations: 0,
      });
      expect(await snapshot()).toEqual(after);
      expect(await q("SELECT * FROM paymentEvents")).toHaveLength(0);
      expect(await q("SELECT * FROM asaasWebhookEvents")).toHaveLength(0);
    });
    it.each([
      "products",
      "stockReservations",
      "payments",
      "orders",
      "auditLogs",
      "notificationOutbox",
    ])("rolls back all six effects on %s failure", async table => {
      const request = await plan(),
        before = await snapshot();
      await q(
        "CREATE TRIGGER order13_fault BEFORE " +
          (["products", "stockReservations", "orders"].includes(table)
            ? "UPDATE"
            : "INSERT") +
          " ON " +
          table +
          " FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='local fault'"
      );
      try {
        await expect(runLocalOrder13(target, request)).rejects.toMatchObject({
          commitState: "rolled_back",
        });
        expect(await snapshot()).toEqual(before);
      } finally {
        await q("DROP TRIGGER order13_fault");
      }
    });
    it("concurrent attempts produce exactly one completion", async () => {
      const request = await plan();
      const results = await Promise.allSettled([
        runLocalOrder13(target, request),
        runLocalOrder13(target, request),
      ]);
      expect(
        results.filter(
          r => r.status === "fulfilled" && r.value.status === "completed"
        )
      ).toHaveLength(1);
      expect(await q("SELECT stock FROM products WHERE id=1")).toEqual([
        { stock: 97 },
      ]);
      expect(await q("SELECT * FROM payments WHERE orderId=13")).toHaveLength(
        1
      );
      expect(
        await q("SELECT * FROM auditLogs WHERE correlationId=?", [OPERATION])
      ).toHaveLength(1);
      expect(
        await q("SELECT * FROM notificationOutbox WHERE orderId=13")
      ).toHaveLength(1);
    });
    it("a competing checkout product lock aborts safely without retries", async () => {
      const request = await plan(),
        before = await snapshot();
      const writer = await createConnection({
        user: "root",
        socketPath,
        database,
      });
      try {
        await writer.beginTransaction();
        await writer.query("SELECT id FROM products WHERE id=1 FOR UPDATE");
        await expect(runLocalOrder13(target, request)).rejects.toMatchObject({
          commitState: "rolled_back",
        });
        expect(await snapshot()).toEqual(before);
      } finally {
        await writer.rollback();
        await writer.end();
      }
    });
    it("live commitments prevent fulfillment even when physical stock is positive", async () => {
      await q("UPDATE products SET stock=1 WHERE id=1");
      await q(
        "INSERT INTO stockReservations(orderId,userId,productId,quantity,status,expiresAt) VALUES(2,594,1,1,'active',DATE_ADD(NOW(),INTERVAL 1 HOUR))"
      );
      const before = await snapshot();
      await expect(plan()).rejects.toThrow("INSUFFICIENT_AVAILABLE_STOCK");
      expect(await snapshot()).toEqual(before);
    });
    it("stock changed after dry-run invalidates the checkpoint", async () => {
      const request = await plan();
      await q("UPDATE products SET stock=97 WHERE id=1");
      const before = await snapshot();
      await expect(runLocalOrder13(target, request)).rejects.toThrow(
        "CHECKPOINT_DIVERGED"
      );
      expect(await snapshot()).toEqual(before);
    });
    it("payment bound to another order blocks the operation", async () => {
      await q(
        "INSERT INTO payments(orderId,providerPaymentId,billingType,amount,externalReference) VALUES(2,?,'PIX',9900,'2')",
        [PAYMENT]
      );
      const before = await snapshot();
      await expect(plan()).rejects.toThrow("PAYMENT_CONFLICT");
      expect(await snapshot()).toEqual(before);
    });
    it.each([
      "expiredReservationDecision",
      "unknownReceiptTimeAccepted",
      "stockHistoryGapAccepted",
      "panelReviewReference",
      "backupRestoreReference",
    ])("requires explicit operational decision: %s", async field => {
      const request = await plan();
      delete (request.approval as any)[field];
      const before = await snapshot();
      await expect(runLocalOrder13(target, request)).rejects.toThrow();
      expect(await snapshot()).toEqual(before);
    });
    it("schema without the provider payment unique constraint is refused", async () => {
      await q(
        "ALTER TABLE payments DROP INDEX payments_providerPaymentId_unique"
      );
      try {
        await expect(plan()).rejects.toThrow("UNIQUE_CONSTRAINT_REQUIRED");
      } finally {
        await q(
          "ALTER TABLE payments ADD UNIQUE KEY payments_providerPaymentId_unique(providerPaymentId)"
        );
      }
    });
    it("consumed or cancelled reservation is never treated as a fresh expired hold", async () => {
      await q("UPDATE stockReservations SET status='consumed' WHERE id=10");
      historical = await immutable();
      await expect(plan()).rejects.toThrow("EXPIRED_RESERVATION_REQUIRED");
    });
    it("stale financial evidence cannot authorize a transaction", async () => {
      const e = evidence();
      e.observedAt = new Date(Date.now() - 121000).toISOString();
      await expect(runLocalOrder13(target, { evidence: e })).rejects.toThrow(
        "EVIDENCE_STALE"
      );
    });
    it("approval expiry during writes rolls everything back before commit", async () => {
      const request = await plan();
      request.approval.validUntil = new Date(Date.now() + 900).toISOString();
      fault.expiry = true;
      const before = await snapshot();
      await expect(runLocalOrder13(target, request)).rejects.toThrow(
        "APPROVAL_EXPIRED_BEFORE_COMMIT"
      );
      expect(await snapshot()).toEqual(before);
    });
    it("lost commit acknowledgement requires independent read, then repeats without a second effect", async () => {
      const request = await plan();
      fault.commit = true;
      await expect(runLocalOrder13(target, request)).rejects.toBeInstanceOf(
        Order13Incident
      );
      fault.commit = false;
      // c is a separately opened connection; this snapshot does not trust the failed client.
      expect(await q("SELECT stock FROM products WHERE id=1")).toEqual([
        { stock: 97 },
      ]);
      const after = await snapshot();
      expect(await runLocalOrder13(target, request)).toMatchObject({
        status: "already_completed",
      });
      expect(await snapshot()).toEqual(after);
    });
    it("partial completion after an unrelated change cannot be blindly repeated", async () => {
      const request = await plan();
      await runLocalOrder13(target, request);
      await q("UPDATE payments SET status='refunded' WHERE orderId=13");
      const after = await snapshot();
      await expect(runLocalOrder13(target, request)).rejects.toThrow(
        "COMPLETION_DIVERGED"
      );
      expect(await snapshot()).toEqual(after);
    });
    it("a new financial event before execution blocks reconciliation without deleting it", async () => {
      const request = await plan();
      await q(
        "INSERT INTO paymentEvents(providerEventId,orderId,providerPaymentId,eventType) VALUES('local-refund',13,?,'PAYMENT_REFUNDED')",
        [PAYMENT]
      );
      historical = await immutable();
      const before = await snapshot();
      await expect(runLocalOrder13(target, request)).rejects.toThrow(
        "LEDGER_REQUIRES_REVIEW"
      );
      expect(await snapshot()).toEqual(before);
    });
  }
);
