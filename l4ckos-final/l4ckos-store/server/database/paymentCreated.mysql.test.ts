import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createConnection, createPool, type Connection, type Pool } from "mysql2/promise";
import type * as mysqlOrm from "drizzle-orm/mysql2";
import { asaasWebhookHandler, preflightAsaasWebhookEnvelope, processWebhookEnvelope, type AsaasWebhookPreflight } from "../controllers/paymentController";
import { financialEnvelope, processStoredWebhook, receiveWebhook, recoverWebhooks } from "../payments/webhookInbox";

import { addStockColumnsToFixture } from "../stock/testing/applyStockV6Migration";
const injected = vi.hoisted(() => ({ orm: null as unknown, provider: vi.fn() }));
vi.mock("drizzle-orm/mysql2", async original => ({ ...await original<typeof mysqlOrm>(), drizzle: () => injected.orm }));
vi.mock("../services/emailService.js", () => ({
  sendPaymentApprovedEmail: vi.fn(async () => {}), sendInternalNewSaleAlertEmail: vi.fn(async () => {}),
  sendInternalLowStockAlertEmail: vi.fn(async () => {}), sendPaymentFailedEmail: vi.fn(async () => {}),
  sendInternalPaymentFailedAlertEmail: vi.fn(async () => {}),
}));
vi.mock("../services/asaasService", () => ({
  validateAsaasWebhookSignature: (headers: Record<string, unknown>) => headers["asaas-access-token"] === "synthetic-token",
  getAsaasPayment: injected.provider,
  createAsaasCheckout: vi.fn(() => { throw Error("FORBIDDEN_EXTERNAL_CHARGE"); }),
  createAsaasCustomer: vi.fn(() => { throw Error("FORBIDDEN_EXTERNAL_CUSTOMER"); }),
}));

const socketPath = process.env.L4CKOS_LOCAL_MYSQL_SOCKET ?? "/tmp/l4ckos-0022-socket/mysqld.sock";
const database = "l4ckos_test_created_" + randomUUID().replaceAll("-", "").slice(0, 12);
let root: Connection, connection: Connection, pool: Pool;
const query = async (sql: string, values: unknown[] = []) => (await connection.query<any[]>(sql, values))[0];
const created = (id = randomUUID()) => ({
  id, event: "PAYMENT_CREATED",
  payment: { id: "pay-staging-synthetic", externalReference: "13", status: "PENDING", value: 99, netValue: 98.01, billingType: "PIX" },
});
const paid = (event = "PAYMENT_RECEIVED") => ({ ...created(), event, account: { id: "sandbox-account-created" }, payment: { ...created().payment, status: event === "PAYMENT_CONFIRMED" ? "CONFIRMED" : "RECEIVED" } });
const processWithPreflight = (payload: unknown, result?: unknown) =>
  processWebhookEnvelope(payload, undefined, undefined, result as AsaasWebhookPreflight | undefined);
const receive = (payload: unknown, process = processWithPreflight) =>
  receiveWebhook(payload, process, preflightAsaasWebhookEnvelope);
const receiveAuthenticated = async (payload: unknown) => {
  let status = 0, body: Record<string, unknown> = {};
  await asaasWebhookHandler({ headers: { "asaas-access-token": "synthetic-token" }, body: payload, ip: "isolated-local" } as any,
    { status(code: number) { status = code; return this; }, json(value: Record<string, unknown>) { body = value; return this; } } as any);
  return { status, body };
};
const inbox = async (id: string) => (await query("SELECT * FROM asaasWebhookInbox WHERE eventId=?", [id]))[0];
const order = async () => (await query("SELECT status,paymentStatus,fulfillmentStatus FROM orders WHERE id=13"))[0];
const stock = async () => Number((await query("SELECT stock FROM products WHERE id=1"))[0].stock);
const reservation = async () => (await query("SELECT status FROM stockReservations WHERE orderId=13"))[0].status;
const financialSnapshot = async () => {
  const snapshot: Record<string, unknown> = {};
  for (const table of ["orders", "payments", "orderItems", "stockReservations", "products", "auditLogs"])
    snapshot[table] = await query("SELECT * FROM `" + table + "`");
  return snapshot;
};

describe.skipIf(process.env.L4CKOS_MYSQL_TEST !== "1")("PAYMENT_CREATED durable classification", () => {
  beforeAll(async () => {
    // Local socket only; fresh schema fixtures, no migration runner or remote database.
    if (!/^\/tmp\/l4ckos-[a-z0-9-]+\/mysqld\.sock$/.test(socketPath)) throw Error("LOCAL_SOCKET_REQUIRED");
    root = await createConnection({ user: "root", socketPath });
    await root.query("CREATE DATABASE `" + database + "`");
    connection = await createConnection({ user: "root", socketPath, database, dateStrings: true });
    await connection.query("SET FOREIGN_KEY_CHECKS=0");
    for (const table of ["users", "products", "productVariants", "productionBatches", "orders", "payments", "notificationOutbox", "orderItems", "stockReservations", "auditLogs", "asaasWebhookEvents"]) {
      let definition = await readFile(new URL("../../database/bootstrap/v2/" + table + ".sql", import.meta.url), "utf8");
      // Include the nullable schedule columns in the fresh CREATE definitions.
      // This is fixture setup, not execution of existing ALTER/migration scripts.
      const scheduleColumns = table === "orderItems"
        ? "  `estimatedManufacturingStartAtPurchase` date DEFAULT NULL,\n  `estimatedManufacturingEndAtPurchase` date DEFAULT NULL,\n"
        : table === "productionBatches"
          ? "  `estimatedManufacturingStart` date DEFAULT NULL,\n  `estimatedManufacturingEnd` date DEFAULT NULL,\n  `manufacturingScheduleRequired` tinyint NOT NULL DEFAULT '1',\n"
          : "";
      definition = definition.replace("  PRIMARY KEY", scheduleColumns + "  PRIMARY KEY");
      await connection.query(definition);
    }
    await connection.query("SET FOREIGN_KEY_CHECKS=1");
    await addStockColumnsToFixture(connection);
    await connection.query(`CREATE TABLE asaasWebhookInbox (
      eventId varchar(191) COLLATE utf8mb4_bin PRIMARY KEY, payload text,
      payloadHash varchar(64) NOT NULL,
      state enum('received','processing','processed','failed','rejected') NOT NULL DEFAULT 'received',
      attempts int NOT NULL DEFAULT 0, errorCode varchar(64), nextAttemptAt timestamp NULL,
      completedAt timestamp NULL, createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX inbox_pending(state,nextAttemptAt,createdAt)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`);
    const orm = await vi.importActual<typeof mysqlOrm>("drizzle-orm/mysql2");
    pool = createPool({ user: "root", socketPath, database, connectionLimit: 5 });
    injected.orm = orm.drizzle(pool);
  });
  beforeEach(async () => {
    vi.unstubAllEnvs(); vi.stubEnv("DATABASE_URL", "mysql://root@localhost/l4ckos_test_synthetic");
    vi.stubEnv("ASAAS_WEBHOOK_ACCOUNT_ID", "sandbox-account-created"); vi.stubEnv("ASAAS_WEBHOOK_ACCOUNT_CURRENCY", "BRL");
    vi.stubEnv("ASAAS_WEBHOOK_TOKEN", "synthetic-token");
    vi.clearAllMocks(); injected.provider.mockReset();
    injected.provider.mockResolvedValue({ id: "pay-staging-synthetic", externalReference: "13", status: "RECEIVED", value: 99,
      currency: "BRL", customer: "created-customer-synthetic", deleted: false });
    for (const table of ["asaasWebhookInbox", "asaasWebhookEvents", "auditLogs", "stockReservations", "orderItems", "notificationOutbox", "payments", "orders", "products", "users"])
      await query("DELETE FROM `" + table + "`");
    await query("INSERT INTO users(id,openId,name,email,asaasCustomerId) VALUES(594,'synthetic-created-customer','STAGING RC2 synthetic','synthetic@example.invalid','created-customer-synthetic')");
    await query("INSERT INTO products(id,name,category,price,stock) VALUES(1,'STAGING RC2 synthetic','fixture',9900,98)");
    await query("INSERT INTO orders(id,userId,totalPrice) VALUES(13,594,9900)");
    await query("INSERT INTO payments(orderId,providerPaymentId,providerCustomerId,billingType,amount,status,creationStatus,externalReference) VALUES(13,'pay-staging-synthetic','created-customer-synthetic','PIX',9900,'pending','created','13')");
    await query("INSERT INTO orderItems(id,orderId,productId,productName,unitPrice,quantity,totalPrice) VALUES(14,13,1,'STAGING RC2 synthetic',9900,1,9900)");
    await query("INSERT INTO stockReservations(userId,orderId,orderItemId,productId,quantity,status,expiresAt) VALUES(594,13,14,1,1,'active',DATE_ADD(NOW(),INTERVAL 1 HOUR))");
  });
  afterAll(async () => {
    vi.unstubAllEnvs(); await pool?.end(); await connection?.end();
    if (root) { await root.query("DROP DATABASE `" + database + "`"); await root.end(); }
  });

  it("durably classifies the sanitized real CREATED shape without financial effects", async () => {
    const event = created(), before = await financialSnapshot();
    expect(financialEnvelope(event).payment).toEqual({
      id: event.payment.id, externalReference: event.payment.externalReference, status: event.payment.status,
      value: event.payment.value, netValue: event.payment.netValue,
    });
    expect((await receive(event)).status).toBe(200);
    expect(await inbox(event.id)).toMatchObject({ state: "processed", attempts: 1, errorCode: null });
    expect((await query("SELECT eventType,status,orderId FROM asaasWebhookEvents"))[0]).toMatchObject({ eventType: "PAYMENT_CREATED", status: "processed", orderId: 13 });
    expect(await financialSnapshot()).toEqual(before);
    const email = await import("../services/emailService.js");
    expect(email.sendPaymentApprovedEmail).not.toHaveBeenCalled();
    expect(email.sendInternalNewSaleAlertEmail).not.toHaveBeenCalled();
  });
  it("acknowledges repeated CREATED only once in both durable ledgers", async () => {
    const event = created();
    expect((await receive(event)).status).toBe(200);
    expect((await receive(event)).body).toMatchObject({ reason: "duplicate_event" });
    expect(await inbox(event.id)).toMatchObject({ state: "processed", attempts: 1 });
    expect((await query("SELECT COUNT(*) n FROM asaasWebhookEvents"))[0].n).toBe(1);
    expect(await stock()).toBe(98); expect(await reservation()).toBe("active");
  });
  it("CREATED followed by provider-verified PAYMENT_RECEIVED confirms and consumes exactly once", async () => {
    expect((await receive(created())).status).toBe(200);
    const event = paid("PAYMENT_RECEIVED");
    expect((await receive(event)).status).toBe(200);
    expect((await receive(event)).status).toBe(200);
    expect((await receive(paid())).status).toBe(200);
    expect(await order()).toMatchObject({ status: "paid", paymentStatus: "confirmed" });
    expect(await stock()).toBe(97); expect(await reservation()).toBe("consumed");
    const email = await import("../services/emailService.js");
    expect(email.sendPaymentApprovedEmail).toHaveBeenCalledTimes(1);
    expect(email.sendInternalNewSaleAlertEmail).toHaveBeenCalledTimes(1);
  });
  it("PIX PAYMENT_CONFIRMED is audited but cannot confirm or consume before PAYMENT_RECEIVED", async () => {
    expect((await receive(created())).status).toBe(200);
    injected.provider.mockResolvedValueOnce({ id: "pay-staging-synthetic", externalReference: "13", status: "CONFIRMED", value: 99,
      currency: "BRL", customer: "created-customer-synthetic", deleted: false });
    const confirmed = paid("PAYMENT_CONFIRMED");
    expect(await receiveAuthenticated(confirmed)).toMatchObject({ status: 200, body: { reconciliationRequired: true, financialMutation: false } });
    expect(await order()).toMatchObject({ status: "pending", paymentStatus: "unconfirmed" });
    expect((await query("SELECT status FROM payments WHERE orderId=13"))[0].status).toBe("pending");
    expect(await stock()).toBe(98); expect(await reservation()).toBe("active");
    const [receiptAudit] = await query("SELECT metadata FROM auditLogs WHERE action='payment.webhook_reconciliation_required.v1'");
    expect(JSON.parse(receiptAudit.metadata)).toMatchObject({ event: "PAYMENT_CONFIRMED", reason: "PIX_PAYMENT_RECEIVED_REQUIRED", financialMutation: false, stockMutation: false });
    expect(await query("SELECT id FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1'")).toHaveLength(1);

    const received = paid("PAYMENT_RECEIVED");
    expect((await receiveAuthenticated(received)).status).toBe(200);
    expect((await receiveAuthenticated(received)).status).toBe(200);
    expect(await order()).toMatchObject({ status: "paid", paymentStatus: "confirmed" });
    expect((await query("SELECT status FROM payments WHERE orderId=13"))[0].status).toBe("received");
    expect(await stock()).toBe(97); expect(await reservation()).toBe("consumed");
  });
  it("late CREATED never reverts a previously RECEIVED payment or consumes again", async () => {
    expect((await receive(paid())).status).toBe(200);
    const before = await financialSnapshot();
    expect((await receive(created())).status).toBe(200);
    expect(await financialSnapshot()).toEqual(before);
    expect(await stock()).toBe(97);
  });
  it.each([
    ["missing payment id", { id: undefined }, 400],
    ["missing value", { value: undefined }, 400],
    ["incompatible status", { status: "RECEIVED" }, 409],
    ["different amount", { value: 1 }, 200],
    ["different currency", { currency: "USD" }, 200],
    ["unresolved order", { externalReference: "999999" }, 200],
    ["legacy prefixed reference remains audit-only", { externalReference: "L4CKOS-ORDER-13" }, 200],
  ] as const)("rejects or durably quarantines %s without confirming or consuming", async (_name, changes, status) => {
    const event = created();
    const before = await financialSnapshot();
    const reply = await receive({ ...event, payment: { ...event.payment, ...changes } });
    expect(reply.status).toBe(status);
    const after = await financialSnapshot();
    for (const table of ["orders", "payments", "orderItems", "stockReservations", "products", "notificationOutbox"])
      expect(after[table]).toEqual(before[table]);
    if (status === 200) {
      expect((await inbox(event.id)).state).toBe("processed");
      if (_name === "legacy prefixed reference remains audit-only") {
        expect(await query("SELECT status FROM asaasWebhookEvents WHERE eventId=?", [event.id])).toMatchObject([{ status: "processed" }]);
      } else {
        expect(await query("SELECT action FROM auditLogs WHERE action='payment.webhook_reconciliation_required.v1'")).toHaveLength(1);
        expect(await query("SELECT type FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1'")).toHaveLength(1);
      }
    } else if (status < 500) expect((await inbox(event.id)).state).toBe("rejected");
  });
  it("malformed envelopes remain 400 without durable admission", async () => {
    const event = created();
    expect((await receive({ ...event, payment: { ...event.payment, value: "NaN" } })).status).toBe(400);
    expect(await inbox(event.id)).toBeUndefined();
  });
  it("preserves authentication before persisting CREATED", async () => {
    let status = 0;
    const response = { status(code: number) { status = code; return this; }, json() { return this; } };
    const event = created();
    await asaasWebhookHandler({ headers: { "asaas-access-token": "wrong" }, body: event } as any, response as any);
    expect(status).toBe(401); expect(await inbox(event.id)).toBeUndefined();
  });
  it("does not return 200 when ledger persistence fails", async () => {
    await query("CREATE TRIGGER created_ledger_fail BEFORE INSERT ON asaasWebhookEvents FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic failure'");
    try {
      const event = created();
      expect((await receive(event)).status).not.toBe(200);
      expect((await inbox(event.id)).state).toBe("failed"); expect(await stock()).toBe(98);
    } finally { await query("DROP TRIGGER created_ledger_fail"); }
  });
  it("rejects conflicting content for the same event id", async () => {
    const event = created(); await receive(event);
    expect((await receive({ ...event, payment: { ...event.payment, value: 1 } })).status).toBe(409);
    expect(await inbox(event.id)).toMatchObject({ state: "processed", attempts: 1 });
    expect(await stock()).toBe(98);
  });
  it("never automatically reopens a previously rejected historical inbox entry", async () => {
    const event = created();
    await query("INSERT INTO asaasWebhookInbox(eventId,payload,payloadHash,state,attempts,errorCode,completedAt) VALUES(?,?,'synthetic','rejected',1,'WEBHOOK_VALIDATION_REJECTED',NOW())", [event.id, JSON.stringify(financialEnvelope(event))]);
    const before = await inbox(event.id);
    expect(await recoverWebhooks(processWithPreflight, 25, preflightAsaasWebhookEnvelope)).toMatchObject({ examined: 0, rejected: 1 });
    expect((await processStoredWebhook(event.id, processWithPreflight, preflightAsaasWebhookEnvelope)).status).toBe(422);
    expect(await inbox(event.id)).toEqual(before); expect(await stock()).toBe(98);
  });
  it("does not ACK an unknown event merely to clear a provider penalty", async () => {
    const event = { ...created(), event: "UNSUPPORTED_FIXTURE" };
    expect(await receive(event)).toMatchObject({ status: 200, body: { reconciliationRequired: true, financialMutation: false } });
    expect((await inbox(event.id)).state).toBe("processed"); expect(await stock()).toBe(98);
    expect(await query("SELECT action FROM auditLogs WHERE action='payment.webhook_reconciliation_required.v1'")).toHaveLength(1);
  });
  it("preserves reconciliation when RECEIVED arrives after reservation expiry", async () => {
    await query("UPDATE stockReservations SET expiresAt=DATE_SUB(NOW(),INTERVAL 1 MINUTE) WHERE orderId=13");
    expect((await receive(created())).status).toBe(200);
    const reply = await receive(paid());
    expect(reply.body).toMatchObject({ reason: "invalid_status_transition" });
    expect(await order()).toMatchObject({ status: "pending", paymentStatus: "unconfirmed" });
    expect(await stock()).toBe(98);
    expect((await query("SELECT action FROM auditLogs"))[0].action).toBe("payment.reconciliation_required");
  });
});
