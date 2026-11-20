import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { createPool, type Pool, type Connection } from "mysql2/promise";
import type * as mysqlOrm from "drizzle-orm/mysql2";
import { openBackupConnection } from "./backupRestore";
import { bootstrapReleaseDatabase } from "../../database/bootstrap/bootstrap";
import { readReleaseContract } from "../../database/schema/artifacts";
import { canonical } from "../../database/schema/fingerprint";
import {
  asaasWebhookHandler,
  processWebhookEnvelope,
} from "../controllers/paymentController";
import { digest, financialEnvelope, receiveWebhook } from "../payments/webhookInbox";
import { RECONCILIATION_PRIORITY_BY_CATEGORY } from "../payments/reconciliationAlerts";

import { applyStockV6Migration } from "../stock/testing/applyStockV6Migration";
const injected = vi.hoisted(() => ({
  orm: null as unknown,
  mail: vi.fn(async () => ({ id: "synthetic-mail" })),
  provider: vi.fn(),
}));
vi.mock("drizzle-orm/mysql2", async original => ({
  ...(await original<typeof mysqlOrm>()),
  drizzle: () => injected.orm,
}));
vi.mock("../services/emailService.js", () => ({
  sendPaymentApprovedEmail: injected.mail,
  sendOrderCreatedEmail: injected.mail,
  sendPaymentPendingEmail: injected.mail,
  sendInternalNewSaleAlertEmail: injected.mail,
  sendInternalLowStockAlertEmail: injected.mail,
  sendPaymentFailedEmail: injected.mail,
  sendInternalPaymentFailedAlertEmail: injected.mail,
}));
vi.mock("../services/asaasService", () => ({
  validateAsaasWebhookSignature: (h: Record<string, unknown>) =>
    h["asaas-access-token"] === "synthetic-token",
  getAsaasPayment: injected.provider,
  createAsaasCheckout: vi.fn(() => {
    throw Error("NO_EXTERNAL_CHARGE");
  }),
  createAsaasCustomer: vi.fn(() => {
    throw Error("NO_EXTERNAL_CUSTOMER");
  }),
}));
const socket = process.env.L4CKOS_LOCAL_MYSQL_SOCKET ?? "";
const database =
  "l4ckos_test_event_semantics_" +
  randomUUID().replaceAll("-", "").slice(0, 10);
const PAYMENT1 = "pay_9c8ztqdst866k0ll",
  PAYMENT13 = "pay_dog6ppexq4gyw3k6";
const DELETED_ID = "evt_d545b50fbb17a226c5f4f4fd193922b7&21454361";
const CREATED_ID = "evt_05b708f961d739ea7eba7e4db318f621&21683762";
let root: Connection, c: Connection, pool: Pool;
const query = async (sql: string, params: unknown[] = []) =>
  (await c.query<any[]>(sql, params))[0];
const businessAudits = () => query("SELECT * FROM auditLogs WHERE action <> 'webhook.ingress_authenticated.v1'");
const envelope = (event: string, id = randomUUID(), orderId = 13) => ({
  id,
  event,
  payment: {
    id: orderId === 1 ? PAYMENT1 : PAYMENT13,
    externalReference: orderId === 1 ? "L4CKOS-ORDER-1" : "13",
    status: event === "PAYMENT_CREATED" ? "PENDING" : "RECEIVED",
    value: 99,
    billingType: "PIX",
  },
});
const deleted = () => ({
  ...envelope("PAYMENT_DELETED", DELETED_ID, 1),
  payment: {
    ...envelope("PAYMENT_DELETED", DELETED_ID, 1).payment,
    status: "OVERDUE",
    deleted: true,
    description: "Pedido #1",
  },
});
async function send(body: unknown, token: unknown = "synthetic-token") {
  let status = 0,
    data: any;
  await asaasWebhookHandler(
    {
      body,
      headers: { "asaas-access-token": token },
      ip: "isolated-local",
    } as any,
    {
      status(code: number) {
        status = code;
        return this;
      },
      json(value: unknown) {
        data = value;
        return this;
      },
    } as any
  );
  return { status, data };
}
async function financialSnapshot() {
  const state: Record<string, unknown> = {};
  for (const table of [
    "orders",
    "payments",
    "products",
    "stockReservations",
    "orderItems",
    "notificationOutbox",
    "orderEmailEvents",
  ])
    // Reconciliation alerts are operator records, never e-mail/notification intent: they are asserted separately where expected.
    state[table] = await query("SELECT * FROM `" + table + "`" + (table === "notificationOutbox" ? " WHERE type <> 'financial-reconciliation-alert-v1'" : "") + " ORDER BY id");
  return state;
}
async function seedRejected(body: unknown) {
  const p = financialEnvelope(body),
    content: any = { ...p };
  delete content.sourcePayloadHash;
  await query(
    "INSERT INTO asaasWebhookInbox(eventId,payload,payloadHash,state,attempts,errorCode,completedAt) VALUES(?,?,?,'rejected',1,'WEBHOOK_VALIDATION_REJECTED',NOW())",
    [
      p.id,
      JSON.stringify(p),
      createHash("sha256").update(canonical(content)).digest("hex"),
    ]
  );
}
describe.skipIf(process.env.L4CKOS_MYSQL_TEST !== "1")(
  "identified Asaas payloads on isolated local MySQL",
  () => {
    beforeAll(async () => {
      if (!/^\/tmp\/l4ckos-[a-z0-9-]+\/mysqld\.sock$/.test(socket))
        throw Error("LOCAL_SOCKET_REQUIRED");
      vi.stubEnv("L4CKOS_LOCAL_SCHEMA", "1");
      vi.stubEnv("L4CKOS_LOCAL_RESTORE", "1");
      root = await openBackupConnection("mysql://root@localhost/mysql", socket);
      const [identity] = await root.query<any[]>(
        "SELECT SHA2(@@server_uuid,256) h"
      );
      if (
        identity[0].h ===
        "92e96ae744d2112c5b4a430abc9a75d557a43d293652dd68369aa81786479f09"
      )
        throw Error("REMOTE_DB_FORBIDDEN");
      await root.query("CREATE DATABASE `" + database + "` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
      c = await openBackupConnection(
        "mysql://root@localhost/" + database,
        socket
      );
      await bootstrapReleaseDatabase(c, {
        url: "mysql://root@localhost/" + database,
        socketPath: socket,
        applicationCommit: "a".repeat(40),
        approvedFingerprint: (await readReleaseContract()).fingerprint,
      });
      // The integrated app also owns the STOCK V1 columns: apply the isolated V6-aware candidate to this disposable DB.
      await applyStockV6Migration(c, database);
      const actual =
        await vi.importActual<typeof mysqlOrm>("drizzle-orm/mysql2");
      pool = createPool({
        user: "root",
        socketPath: socket,
        database,
        connectionLimit: 8,
      });
      injected.orm = actual.drizzle(pool);
    }, 30000);
    beforeEach(async () => {
      vi.unstubAllEnvs();
      vi.stubEnv("ASAAS_WEBHOOK_TOKEN", "synthetic-token");
      vi.stubEnv("DATABASE_URL", "mysql://root@localhost/l4ckos_test_synthetic");
      injected.mail.mockClear();
      injected.provider.mockReset();
      injected.provider.mockImplementation(async (id: string) => ({
        id,
        externalReference: id === PAYMENT1 ? "L4CKOS-ORDER-1" : "13",
        status: id === PAYMENT1 ? "OVERDUE" : "RECEIVED",
        deleted: id === PAYMENT1,
        value: 99,
      }));
      await query("DROP TRIGGER IF EXISTS reject_observation_audit");
      await query("DROP TRIGGER IF EXISTS reject_deleted_preflight_audit");
      await query("DROP TRIGGER IF EXISTS reject_provider_preflight_alert");
      for (const table of [
        "notificationOutbox",
        "orderEmailEvents",
        "asaasWebhookInbox",
        "asaasWebhookEvents",
        "paymentEvents",
        "payments",
        "auditLogs",
        "stockReservations",
        "orderItems",
        "orders",
        "products",
        "users",
      ])
        await query("DELETE FROM `" + table + "`");
      await query(
        "INSERT INTO users(id,openId,name,email) VALUES(999901,'isolated-semantics','Synthetic','synthetic@example.invalid')"
      );
      await query(
        "INSERT INTO products(id,name,category,price,stock) VALUES(1,'Synthetic','fixture',9900,97)"
      );
      await query(
        "INSERT INTO orders(id,userId,totalPrice,status,paymentStatus,paymentConfirmationSource,paymentConfirmedAt,paymentConfirmedBy,fulfillmentStatus) VALUES(1,999901,9900,'cancelled','unconfirmed',NULL,NULL,NULL,'cancelled'),(13,999901,9900,'paid','confirmed','manual',NOW(),14,'ready')"
      );
      await query(
        "INSERT INTO payments(orderId,providerPaymentId,externalReference,billingType,amount,status,creationStatus,statusSource,paidAmount,netAmount) VALUES(1,?,'L4CKOS-ORDER-1','PIX',9900,'overdue','created','provider',0,0),(13,?,'13','PIX',9900,'received','created','reconciliation',9900,9801)",
        [PAYMENT1, PAYMENT13]
      );
      await query(
        "INSERT INTO orderItems(id,orderId,productId,productName,unitPrice,quantity,totalPrice) VALUES(1,1,1,'Synthetic',9900,1,9900),(14,13,1,'Synthetic',9900,1,9900)"
      );
      await query(
        "INSERT INTO stockReservations(id,orderId,userId,productId,orderItemId,quantity,status,expiresAt) VALUES(1,1,999901,1,1,1,'expired','2026-09-09 22:02:56'),(10,13,999901,1,14,1,'consumed','2026-10-11 16:09:10')"
      );
      await query(
        "INSERT INTO notificationOutbox(dedupeKey,type,orderId,payload) VALUES('held-order13','payment-approved',13,'{}')"
      );
    });
    afterAll(async () => {
      vi.unstubAllEnvs();
      await pool?.end();
      await c?.end();
      if (root) {
        await root.query("DROP DATABASE `" + database + "`");
        await root.end();
      }
    });

    it("A: acknowledges and deduplicates historical rejected CREATED after reconciliation without changing financial rows or the rejection", async () => {
      const body = envelope("PAYMENT_CREATED", CREATED_ID);
      await seedRejected(body);
      const before = await financialSnapshot(),
        rejection = await query("SELECT * FROM asaasWebhookInbox");
      expect((await send(body)).status).toBe(200);
      expect((await send(body)).status).toBe(200);
      expect(await financialSnapshot()).toEqual(before);
      expect(await query("SELECT * FROM asaasWebhookInbox")).toEqual(rejection);
      expect(await businessAudits()).toHaveLength(1);
      expect(await query("SELECT * FROM asaasWebhookEvents")).toHaveLength(0);
      expect(injected.mail).not.toHaveBeenCalled();
      expect(injected.provider).not.toHaveBeenCalled();
    });
    it("A: full CREATED payload deleted=false keeps the existing canonical envelope/hash", async () => {
      const body = envelope("PAYMENT_CREATED", CREATED_ID);
      await seedRejected(body);
      const before = await query("SELECT * FROM asaasWebhookInbox");
      expect(
        (await send({ ...body, payment: { ...body.payment, deleted: false } }))
          .status
      ).toBe(200);
      expect(await query("SELECT * FROM asaasWebhookInbox")).toEqual(before);
    });
    it("fresh CREATED is a durable observation with no payment or stock effects", async () => {
      const before = await financialSnapshot(),
        body = envelope("PAYMENT_CREATED");
      expect((await send(body)).status).toBe(200);
      expect((await send(body)).status).toBe(200);
      expect(await financialSnapshot()).toEqual(before);
      expect(await query("SELECT * FROM asaasWebhookEvents")).toHaveLength(1);
      expect(injected.mail).not.toHaveBeenCalled();
    });
    it("B: OVERDUE + deleted=true and legacy reference are durably held for review exactly once", async () => {
      const before = await financialSnapshot();
      expect(await send(deleted())).toMatchObject({
        status: 200,
        data: {
          reconciliationRequired: true,
          financialMutation: false,
          orderId: 1,
        },
      });
      expect((await send(deleted())).status).toBe(200);
      expect(await financialSnapshot()).toEqual(before);
      const inbox = (await query("SELECT * FROM asaasWebhookInbox"))[0];
      expect(inbox).toMatchObject({
        eventId: DELETED_ID,
        state: "processed",
        attempts: 1,
      });
      expect(JSON.parse(inbox.payload).payment.deleted).toBe(true);
      const audits = await businessAudits();
      expect(audits).toHaveLength(2);
      expect(JSON.parse(audits[0].metadata)).toMatchObject({
        event: "PAYMENT_DELETED",
        financialMutation: false,
        reservationMutation: false,
        orderStatus: "cancelled",
        observation: {
          eventDeleted: true,
          currentDeleted: true,
          currentStatus: "OVERDUE",
          currentAmountCents: 9900,
        },
      });
      expect(await query("SELECT * FROM auditLogs WHERE action='payment.webhook_reconciliation_required.v1'")).toHaveLength(1);
      const [alert] = await query("SELECT payload FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1'");
      expect(JSON.parse(alert.payload)).toMatchObject({ providerEventId: DELETED_ID, financialMutation: false, stockMutation: false });
      expect(await query("SELECT * FROM asaasWebhookEvents")).toHaveLength(1);
      expect(injected.provider).toHaveBeenCalledTimes(1);
      expect(injected.mail).not.toHaveBeenCalled();
    });
    it("a stale deletion after receipt/restoration never downgrades a paid reconciled order", async () => {
      const before = await financialSnapshot(),
        body = {
          ...envelope("PAYMENT_DELETED"),
          payment: {
            ...envelope("PAYMENT_DELETED").payment,
            deleted: true,
            status: "OVERDUE",
          },
        };
      expect((await send(body)).status).toBe(200);
      expect(await financialSnapshot()).toEqual(before);
      expect(
        JSON.parse((await query("SELECT metadata FROM auditLogs WHERE action='payment.reconciliation_required'"))[0].metadata)
          .observation
      ).toMatchObject({ currentDeleted: false, currentStatus: "RECEIVED" });
      expect(injected.mail).not.toHaveBeenCalled();
    });
    it("concurrent deletion redelivery serializes one review and permits retry after a busy response", async () => {
      const before = await financialSnapshot();
      const results = await Promise.all([send(deleted()), send(deleted())]);
      expect(results.some(r => r.status === 200)).toBe(true);
      expect(results.every(r => [200, 503].includes(r.status))).toBe(true);
      expect((await send(deleted())).status).toBe(200);
      expect(await businessAudits()).toHaveLength(2);
      expect(await query("SELECT * FROM asaasWebhookEvents")).toHaveLength(1);
      expect(await query("SELECT * FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1'")).toHaveLength(1);
      expect(await financialSnapshot()).toEqual(before);
      expect(injected.mail).not.toHaveBeenCalled();
    });
    it.each([false, undefined])(
      "deletion flag %s is not accepted or allowed to mutate financial state",
      async flag => {
        const before = await financialSnapshot(),
          body = deleted();
        body.payment.deleted = flag as any;
        expect((await send(body)).status).toBe(409);
        expect(await financialSnapshot()).toEqual(before);
        expect(
          (await query("SELECT state FROM asaasWebhookInbox"))[0].state
        ).toBe("rejected");
        expect(await businessAudits()).toHaveLength(0);
        expect(injected.provider).not.toHaveBeenCalled();
      }
    );
    it("provider outage is retryable and never gets a false 2xx", async () => {
      const before = await financialSnapshot();
      injected.provider.mockRejectedValueOnce(Error("OFFLINE_PROVIDER"));
      expect((await send(deleted())).status).toBe(503);
      expect(
        (await query("SELECT state FROM asaasWebhookInbox"))[0].state
      ).toBe("failed");
      expect(await financialSnapshot()).toEqual(before);
      expect(await query("SELECT * FROM asaasWebhookEvents")).toHaveLength(0);
    });
    it.each([
      ["404", Object.assign(Error("HTTP_404_NOT_FOUND"), { providerStatus: 404 }), 1],
      ["timeout", Error("ETIMEDOUT"), 3],
      ["provider error", Object.assign(Error("HTTP_503_PROVIDER_FAILURE"), { providerStatus: 503 }), 3],
    ])("PAYMENT_DELETED %s during current-state lookup is durably escalated", async (_kind, failure, expectedAttempts) => {
      const before = await financialSnapshot();
      let last: { status: number; data: any } | undefined;
      for (let attempt = 1; attempt <= Number(expectedAttempts); attempt += 1) {
        injected.provider.mockRejectedValueOnce(failure as Error);
        last = await send(deleted());
        expect(last.status).toBe(attempt < Number(expectedAttempts) ? 503 : 200);
        const [inbox] = await query("SELECT state,errorCode,attempts,nextAttemptAt FROM asaasWebhookInbox");
        expect(inbox).toMatchObject({
          state: attempt < Number(expectedAttempts) ? "failed" : "rejected",
          errorCode: "PAYMENT_CURRENT_STATE_UNAVAILABLE", attempts: attempt,
        });
        expect(Boolean(inbox.nextAttemptAt)).toBe(attempt < Number(expectedAttempts));
      }
      expect(last).toMatchObject({ status: 200, data: { handled: false, reason: "payment_reconciliation_required", reconciliationRequired: true } });
      expect(injected.provider).toHaveBeenCalledTimes(Number(expectedAttempts));
      const escalations = await query("SELECT action,metadata FROM auditLogs WHERE action='payment.deleted_preflight_reconciliation_required.v1'");
      expect(escalations).toHaveLength(1);
      expect(JSON.parse(escalations[0].metadata)).toMatchObject({
        eventId: DELETED_ID, payloadHash: expect.any(String), paymentId: PAYMENT1,
        attempts: Number(expectedAttempts), reconciliationRequired: true, financialMutation: false, stockMutation: false,
      });
      expect((await send(deleted())).status).toBe(200);
      expect(injected.provider).toHaveBeenCalledTimes(Number(expectedAttempts));
      expect(await query("SELECT action FROM auditLogs WHERE action='payment.deleted_preflight_reconciliation_required.v1'")).toHaveLength(1);
      expect(await financialSnapshot()).toEqual(before);
      const alerts = await query("SELECT payload,status FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1'");
      expect(alerts).toHaveLength(1); // exactly one durable operator alert, committed with the escalation audit, still pending
      expect(JSON.parse(alerts[0].payload)).toMatchObject({ kind: "PAYMENT_DELETED_PREFLIGHT_ESCALATED", category: "provider_state_unavailable", paymentId: PAYMENT1 });
      expect(alerts[0].status).toBe("pending");
      expect((await businessAudits()).map(row => row.action)).toEqual(["payment.deleted_preflight_reconciliation_required.v1"]);
      expect(await query("SELECT * FROM asaasWebhookEvents")).toHaveLength(0);
    });
    it.each(["id", "reference", "local-binding"])(
      "wrong %s is rejected with no financial or audit effects",
      async kind => {
        const before = await financialSnapshot();
        if (kind === "id")
          injected.provider.mockResolvedValueOnce({
            id: "other",
            externalReference: "L4CKOS-ORDER-1",
            status: "OVERDUE",
            deleted: true,
          });
        if (kind === "reference")
          injected.provider.mockResolvedValueOnce({
            id: PAYMENT1,
            externalReference: "13",
            status: "OVERDUE",
            deleted: true,
          });
        if (kind === "local-binding")
          await query(
            "UPDATE payments SET providerPaymentId='other' WHERE orderId=1"
          );
        const expected =
          kind === "local-binding" ? await financialSnapshot() : before;
        expect((await send(deleted())).status).toBe(409);
        expect(await financialSnapshot()).toEqual(expected);
        expect(await businessAudits()).toHaveLength(0);
        expect(injected.mail).not.toHaveBeenCalled();
      }
    );
    it("the same event ID with changed deletion flag/value is a content conflict, not a replay", async () => {
      expect((await send(deleted())).status).toBe(200);
      const before = await financialSnapshot();
      expect(
        (
          await send({
            ...deleted(),
            payment: { ...deleted().payment, value: 100 },
          })
        ).status
      ).toBe(409);
      expect(
        (
          await send({
            ...deleted(),
            payment: { ...deleted().payment, deleted: false },
          })
        ).status
      ).toBe(409);
      expect(await financialSnapshot()).toEqual(before);
      expect(await businessAudits()).toHaveLength(2);
      expect(await query("SELECT * FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1'")).toHaveLength(1);
      expect(injected.provider).toHaveBeenCalledTimes(1);
    });
    for (const event of [
      "PAYMENT_OVERDUE",
      "PAYMENT_UPDATED",
      "PAYMENT_RESTORED",
      "PAYMENT_REFUNDED",
      "PAYMENT_PARTIALLY_REFUNDED",
      "PAYMENT_REFUND_IN_PROGRESS",
      "PAYMENT_REFUND_DENIED",
      "PAYMENT_CHARGEBACK_REQUESTED",
      "PAYMENT_CHARGEBACK_DISPUTE",
      "PAYMENT_AWAITING_CHARGEBACK_REVERSAL",
      "PAYMENT_RECEIVED_IN_CASH_UNDONE",
    ])
      it(`${event} is persisted/deduplicated for review, never ignored or applied financially`, async () => {
        const before = await financialSnapshot(),
          body = envelope(event);
        expect(await send(body)).toMatchObject({
          status: 200,
          data: { reconciliationRequired: true, financialMutation: false },
        });
        expect((await send(body)).status).toBe(200);
        expect(await financialSnapshot()).toEqual(before);
        expect(await businessAudits()).toHaveLength(2);
        expect(await query("SELECT * FROM auditLogs WHERE action='payment.reconciliation_required'")).toHaveLength(1);
        expect(await query("SELECT * FROM auditLogs WHERE action='payment.webhook_reconciliation_required.v1'")).toHaveLength(1);
        expect(await query("SELECT * FROM asaasWebhookEvents")).toHaveLength(1);
        const alerts = await query("SELECT payload FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1'");
        expect(alerts).toHaveLength(1);
        expect(JSON.parse(alerts[0].payload)).toMatchObject({
          providerEventId: body.id, financialMutation: false, stockMutation: false, externalNotification: false,
        });
        expect(injected.mail).not.toHaveBeenCalled();
      });
    const prepareLegacyPaidReceipt = async (event: string, id: string, accountId: string) => {
      const customerId = "cus_synthetic_legacy_1";
      await query("UPDATE users SET asaasCustomerId=? WHERE id=999901", [customerId]);
      await query("UPDATE orders SET status='pending',paymentStatus='unconfirmed',paymentConfirmationSource=NULL,paymentConfirmedAt=NULL,paymentConfirmedBy=NULL,fulfillmentStatus='awaiting_payment' WHERE id=1");
      await query("UPDATE payments SET status='pending',creationStatus='created',statusSource='provider',externalReference='1',paidAmount=0,netAmount=0 WHERE orderId=1");
      await query("UPDATE stockReservations SET status='active',expiresAt=DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR) WHERE orderId=1");
      const body: any = { ...envelope(event, id, 1), account: { id: accountId, ownerId: null } };
      body.payment.externalReference = "1";
      return { body, customerId };
    };
    it("P1-A PAYMENT_RECEIVED accepts missing currency only under an explicit pinned BRL account policy and exact provider binding", async () => {
      const accountId = "sandbox-account-synthetic-legacy";
      vi.stubEnv("ASAAS_WEBHOOK_ACCOUNT_ID", accountId);
      vi.stubEnv("ASAAS_WEBHOOK_ACCOUNT_CURRENCY", "BRL");
      const { body, customerId } = await prepareLegacyPaidReceipt("PAYMENT_RECEIVED", randomUUID(), accountId);
      let openTransactions = -1;
      injected.provider.mockImplementationOnce(async paymentId => {
        const [rows] = await root.query<any[]>("SELECT COUNT(*) n FROM information_schema.innodb_trx trx JOIN performance_schema.threads th ON th.PROCESSLIST_ID=trx.trx_mysql_thread_id WHERE th.PROCESSLIST_DB=? AND trx.trx_mysql_thread_id<>CONNECTION_ID()", [database]);
        openTransactions = Number(rows[0].n);
        return { id: paymentId, externalReference: "1", status: "RECEIVED", deleted: false, value: 99, customer: customerId, billingType: "PIX" };
      });
      expect(body.payment).not.toHaveProperty("currency");
      expect(await send(body)).toMatchObject({ status: 200 });
      expect((await query("SELECT status,paymentStatus FROM orders WHERE id=1"))[0]).toMatchObject({ status: "paid", paymentStatus: "confirmed" });
      expect((await query("SELECT status,paidAmount FROM payments WHERE orderId=1"))[0]).toMatchObject({ status: "received", paidAmount: 9900 });
      expect(openTransactions).toBe(0);
      expect(await query("SELECT * FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1'")).toHaveLength(0);
    });
    it.each([
      { label: "matching PIX", webhookBillingType: "PIX", providerBillingType: "PIX", settles: true },
      { label: "authoritative cash-receipt type", webhookBillingType: "PIX", providerBillingType: "RECEIVED_IN_CASH", settles: false },
      { label: "authoritative non-PIX type", webhookBillingType: "PIX", providerBillingType: "CREDIT_CARD", settles: false },
      { label: "webhook and GET disagree", webhookBillingType: "RECEIVED_IN_CASH", providerBillingType: "PIX", settles: false },
      { label: "authoritative type is missing", webhookBillingType: "PIX", providerBillingType: undefined, settles: false },
      { label: "authoritative type is invalid", webhookBillingType: "PIX", providerBillingType: "UNDEFINED", settles: false },
      { label: "webhook type is missing", webhookBillingType: undefined, providerBillingType: "PIX", settles: false },
      { label: "webhook type is invalid", webhookBillingType: "UNDEFINED", providerBillingType: "PIX", settles: false },
    ])("P1-A PAYMENT_RECEIVED requires matching authoritative PIX billingType: $label", async ({ webhookBillingType, providerBillingType, settles }) => {
      const accountId = "sandbox-account-synthetic-legacy";
      vi.stubEnv("ASAAS_WEBHOOK_ACCOUNT_ID", accountId);
      vi.stubEnv("ASAAS_WEBHOOK_ACCOUNT_CURRENCY", "BRL");
      const { body, customerId } = await prepareLegacyPaidReceipt("PAYMENT_RECEIVED", randomUUID(), accountId);
      if (webhookBillingType === undefined) delete body.payment.billingType;
      else body.payment.billingType = webhookBillingType;
      injected.provider.mockResolvedValueOnce({ id: PAYMENT1, externalReference: "1", status: "RECEIVED", deleted: false,
        value: 99, currency: "BRL", customer: customerId,
        ...(providerBillingType === undefined ? {} : { billingType: providerBillingType }) });
      const before = await financialSnapshot();
      const response = await send(body);
      expect(response.status).toBe(200);
      if (settles) {
        expect(response.data).toMatchObject({ handled: true });
        expect((await query("SELECT status,paymentStatus FROM orders WHERE id=1"))[0])
          .toMatchObject({ status: "paid", paymentStatus: "confirmed" });
        expect((await query("SELECT status,paidAmount FROM payments WHERE orderId=1"))[0])
          .toMatchObject({ status: "received", paidAmount: 9900 });
        expect(await query("SELECT * FROM auditLogs WHERE action='payment.webhook_reconciliation_required.v1'")).toHaveLength(0);
        expect((await send(body)).data).toMatchObject({ reason: "duplicate_event" });
        expect(injected.provider).toHaveBeenCalledTimes(1);
      } else {
        expect(response.data).toMatchObject({ reconciliationRequired: true, financialMutation: false, stockMutation: false });
        expect((await financialSnapshot()).orders).toEqual((before as any).orders);
        expect((await query("SELECT status,paymentStatus,fulfillmentStatus FROM orders WHERE id=1"))[0])
          .toMatchObject({ status: "pending", paymentStatus: "unconfirmed", fulfillmentStatus: "awaiting_payment" });
        expect((await query("SELECT status,paidAmount FROM payments WHERE orderId=1"))[0])
          .toMatchObject({ status: "pending", paidAmount: 0 });
        expect((await query("SELECT status FROM stockReservations WHERE orderId=1"))[0].status).toBe("active");
        expect(await query("SELECT stock FROM products WHERE id=1")).toMatchObject([{ stock: 97 }]);
        const [audit] = await query("SELECT metadata FROM auditLogs WHERE action='payment.webhook_reconciliation_required.v1'");
        expect(JSON.parse(audit.metadata)).toMatchObject({ reason: "PROVIDER_BILLING_TYPE_MISMATCH",
          observedBillingType: webhookBillingType ?? null, providerObservedBillingType: providerBillingType ?? null,
          financialMutation: false, stockMutation: false });
        const [alert] = await query("SELECT payload FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1'");
        expect(JSON.parse(alert.payload)).toMatchObject({ providerEventId: body.id, financialMutation: false, stockMutation: false,
          observedBillingType: providerBillingType ?? null });
        expect(await query("SELECT * FROM asaasWebhookEvents")).toHaveLength(0);
        expect(injected.mail).not.toHaveBeenCalled();
        expect((await send(body)).data).toMatchObject({ reason: "duplicate_event" });
        expect(injected.provider).toHaveBeenCalledTimes(1);
        expect(await query("SELECT * FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1'")).toHaveLength(1);
      }
    });
    it.each([
      { label: "CREDIT_CARD webhook differs from stored card method", method: "CREDIT_CARD", event: "PAYMENT_CONFIRMED", status: "CONFIRMED", webhookType: "PIX", providerType: "CREDIT_CARD" },
      { label: "CREDIT_CARD provider read differs from stored card method", method: "CREDIT_CARD", event: "PAYMENT_CONFIRMED", status: "CONFIRMED", webhookType: "CREDIT_CARD", providerType: "PIX" },
      { label: "BOLETO webhook reports manual cash receipt", method: "BOLETO", event: "PAYMENT_RECEIVED", status: "RECEIVED", webhookType: "RECEIVED_IN_CASH", providerType: "BOLETO" },
      { label: "BOLETO provider read reports manual cash receipt", method: "BOLETO", event: "PAYMENT_RECEIVED", status: "RECEIVED", webhookType: "BOLETO", providerType: "RECEIVED_IN_CASH" },
    ])("P1-A binds legacy paid event to persisted method: $label", async ({ method, event, status, webhookType, providerType }) => {
      const accountId = "sandbox-account-synthetic-legacy";
      vi.stubEnv("ASAAS_WEBHOOK_ACCOUNT_ID", accountId);
      vi.stubEnv("ASAAS_WEBHOOK_ACCOUNT_CURRENCY", "BRL");
      const { body, customerId } = await prepareLegacyPaidReceipt(event, randomUUID(), accountId);
      await query("UPDATE payments SET billingType=? WHERE orderId=1", [method]);
      body.payment.status = status;
      body.payment.billingType = webhookType;
      injected.provider.mockResolvedValueOnce({ id: PAYMENT1, externalReference: "1", status, deleted: false,
        value: 99, currency: "BRL", customer: customerId, billingType: providerType });
      const before = await financialSnapshot();
      const response = await send(body);
      expect(response.status).toBe(200);
      expect(response.data).toMatchObject({ reconciliationRequired: true, financialMutation: false, stockMutation: false });
      expect((await financialSnapshot()).orders).toEqual((before as any).orders);
      expect((await query("SELECT status,paymentStatus,fulfillmentStatus FROM orders WHERE id=1"))[0])
        .toMatchObject({ status: "pending", paymentStatus: "unconfirmed", fulfillmentStatus: "awaiting_payment" });
      expect((await query("SELECT status,paidAmount FROM payments WHERE orderId=1"))[0])
        .toMatchObject({ status: "pending", paidAmount: 0 });
      expect((await query("SELECT status FROM stockReservations WHERE orderId=1"))[0].status).toBe("active");
      expect(await query("SELECT stock FROM products WHERE id=1")).toMatchObject([{ stock: 97 }]);
      const [audit] = await query("SELECT metadata FROM auditLogs WHERE action='payment.webhook_reconciliation_required.v1'");
      expect(JSON.parse(audit.metadata)).toMatchObject({ reason: "PROVIDER_BILLING_TYPE_MISMATCH",
        observedBillingType: webhookType, providerObservedBillingType: providerType, financialMutation: false, stockMutation: false });
      expect(await query("SELECT * FROM asaasWebhookEvents")).toHaveLength(0);
      expect(injected.mail).not.toHaveBeenCalled();
      expect((await send(body)).data).toMatchObject({ reason: "duplicate_event" });
      expect(await query("SELECT * FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1'")).toHaveLength(1);
    });
    it("P1-A missing webhook and provider currency without account-currency proof stays in reconciliation", async () => {
      const accountId = "sandbox-account-synthetic-legacy";
      vi.stubEnv("ASAAS_WEBHOOK_ACCOUNT_ID", accountId);
      const { body, customerId } = await prepareLegacyPaidReceipt("PAYMENT_RECEIVED", randomUUID(), accountId);
      injected.provider.mockResolvedValueOnce({ id: PAYMENT1, externalReference: "1", status: "RECEIVED", deleted: false, value: 99, customer: customerId, billingType: "PIX" });
      expect(await send(body)).toMatchObject({ status: 200, data: { reconciliationRequired: true, financialMutation: false } });
      expect((await query("SELECT status,paymentStatus FROM orders WHERE id=1"))[0]).toMatchObject({ status: "pending", paymentStatus: "unconfirmed" });
      expect(await query("SELECT action FROM auditLogs WHERE action='payment.webhook_reconciliation_required.v1'")).toHaveLength(1);
      const [alert] = await query("SELECT payload FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1'");
      expect(JSON.parse(alert.payload)).toMatchObject({ providerEventId: body.id, category: "order_attempt_payment_inconsistent" });
    });
    it("P1-A incompatible provider currency and divergent account identity fail closed", async () => {
      const accountId = "sandbox-account-synthetic-legacy";
      vi.stubEnv("ASAAS_WEBHOOK_ACCOUNT_ID", accountId);
      vi.stubEnv("ASAAS_WEBHOOK_ACCOUNT_CURRENCY", "BRL");
      const { body, customerId } = await prepareLegacyPaidReceipt("PAYMENT_RECEIVED", randomUUID(), accountId);
      injected.provider.mockResolvedValueOnce({ id: PAYMENT1, externalReference: "1", status: "RECEIVED", deleted: false, value: 99, currency: "USD", customer: customerId, billingType: "PIX" });
      expect(await send(body)).toMatchObject({ status: 200, data: { reconciliationRequired: true, financialMutation: false } });
      expect((await query("SELECT paymentStatus FROM orders WHERE id=1"))[0].paymentStatus).toBe("unconfirmed");
      expect(await query("SELECT * FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1'")).toHaveLength(1);

      const beforeCalls = injected.provider.mock.calls.length;
      const divergent = { ...body, id: randomUUID(), account: { id: "sandbox-account-other", ownerId: null } };
      expect(await send(divergent)).toMatchObject({ status: 200, data: { reconciliationRequired: true, financialMutation: false } });
      expect(injected.provider.mock.calls).toHaveLength(beforeCalls);
      expect((await query("SELECT paymentStatus FROM orders WHERE id=1"))[0].paymentStatus).toBe("unconfirmed");
      expect(await query("SELECT * FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1'")).toHaveLength(2);
    });
    it("P1-A does not change PAYMENT_CONFIRMED missing-currency policy", async () => {
      const accountId = "sandbox-account-synthetic-legacy";
      vi.stubEnv("ASAAS_WEBHOOK_ACCOUNT_ID", accountId);
      vi.stubEnv("ASAAS_WEBHOOK_ACCOUNT_CURRENCY", "BRL");
      const { body, customerId } = await prepareLegacyPaidReceipt("PAYMENT_CONFIRMED", randomUUID(), accountId);
      injected.provider.mockResolvedValueOnce({ id: PAYMENT1, externalReference: "1", status: "CONFIRMED", deleted: false, value: 99, customer: customerId, billingType: "PIX" });
      expect(await send(body)).toMatchObject({ status: 200, data: { reconciliationRequired: true, financialMutation: false } });
      expect((await query("SELECT paymentStatus FROM orders WHERE id=1"))[0].paymentStatus).toBe("unconfirmed");
    });
    it.each(["CONFIRMED", "RECEIVED_IN_CASH"])("H1 PAYMENT_RECEIVED with authoritative %s is reconciled without settlement", async providerStatus => {
      const accountId = "sandbox-account-synthetic-legacy";
      vi.stubEnv("ASAAS_WEBHOOK_ACCOUNT_ID", accountId);
      vi.stubEnv("ASAAS_WEBHOOK_ACCOUNT_CURRENCY", "BRL");
      const { body, customerId } = await prepareLegacyPaidReceipt("PAYMENT_RECEIVED", randomUUID(), accountId);
      injected.provider.mockResolvedValueOnce({ id: PAYMENT1, externalReference: "1", status: providerStatus,
        deleted: false, value: 99, currency: "BRL", customer: customerId });
      const before = await financialSnapshot();
      expect(await send(body)).toMatchObject({ status: 200,
        data: { reconciliationRequired: true, financialMutation: false, stockMutation: false } });
      expect((await query("SELECT status,paymentStatus,fulfillmentStatus FROM orders WHERE id=1"))[0])
        .toMatchObject({ status: "pending", paymentStatus: "unconfirmed", fulfillmentStatus: "awaiting_payment" });
      expect((await query("SELECT status,paidAmount FROM payments WHERE orderId=1"))[0])
        .toMatchObject({ status: "pending", paidAmount: 0 });
      expect((await query("SELECT status FROM stockReservations WHERE orderId=1"))[0].status).toBe("active");
      expect(await query("SELECT stock FROM products WHERE id=1")).toMatchObject([{ stock: 97 }]);
      expect(await query("SELECT * FROM asaasWebhookEvents")).toHaveLength(0);
      expect((await financialSnapshot()).orders).toEqual((before as any).orders);
      expect(await query("SELECT * FROM auditLogs WHERE action='payment.webhook_reconciliation_required.v1'")).toHaveLength(1);
      const [alert] = await query("SELECT payload FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1'");
      expect(JSON.parse(alert.payload)).toMatchObject({ providerEventId: body.id, paymentId: PAYMENT1,
        reason: "PROVIDER_STATUS_NOT_RECEIVED", observedStatus: providerStatus, financialMutation: false, stockMutation: false });
      expect((await send(body)).data).toMatchObject({ reason: "duplicate_event" });
      expect(injected.provider).toHaveBeenCalledTimes(1);
      expect(await query("SELECT * FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1'")).toHaveLength(1);
    });
    it("H1 PAYMENT_RECEIVED with authoritative PENDING remains retryable under backoff and never settles", async () => {
      const accountId = "sandbox-account-synthetic-legacy";
      vi.stubEnv("ASAAS_WEBHOOK_ACCOUNT_ID", accountId);
      vi.stubEnv("ASAAS_WEBHOOK_ACCOUNT_CURRENCY", "BRL");
      const { body, customerId } = await prepareLegacyPaidReceipt("PAYMENT_RECEIVED", "evt-legacy-provider-pending-h1", accountId);
      injected.provider.mockResolvedValueOnce({ id: PAYMENT1, externalReference: "1", status: "PENDING",
        deleted: false, value: 99, currency: "BRL", customer: customerId });
      expect(await send(body)).toMatchObject({ status: 503, data: { code: "PAYMENT_NOT_RECEIVED_YET", retryable: true } });
      let inbox = (await query("SELECT state,errorCode,attempts,nextAttemptAt FROM asaasWebhookInbox WHERE eventId=?", [body.id]))[0];
      expect(inbox).toMatchObject({ state: "failed", errorCode: "PAYMENT_RECEIVED_PROVIDER_STATUS_PENDING", attempts: 1 });
      expect(new Date(inbox.nextAttemptAt).getTime()).toBeGreaterThan(Date.now());
      const calls = injected.provider.mock.calls.length;
      expect(await send(body)).toMatchObject({ status: 503, data: { code: "PAYMENT_PROVIDER_RETRY_BACKOFF", retryable: true } });
      expect(injected.provider).toHaveBeenCalledTimes(calls);
      await query("UPDATE asaasWebhookInbox SET nextAttemptAt=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE eventId=?", [body.id]);
      injected.provider.mockResolvedValueOnce({ id: PAYMENT1, externalReference: "1", status: "PENDING",
        deleted: false, value: 99, currency: "BRL", customer: customerId });
      expect(await send(body)).toMatchObject({ status: 503, data: { code: "PAYMENT_NOT_RECEIVED_YET", retryable: true } });
      inbox = (await query("SELECT state,errorCode,attempts FROM asaasWebhookInbox WHERE eventId=?", [body.id]))[0];
      expect(inbox).toMatchObject({ state: "failed", errorCode: "PAYMENT_RECEIVED_PROVIDER_STATUS_PENDING", attempts: 2 });
      expect((await query("SELECT status,paymentStatus FROM orders WHERE id=1"))[0])
        .toMatchObject({ status: "pending", paymentStatus: "unconfirmed" });
      expect((await query("SELECT status,paidAmount FROM payments WHERE orderId=1"))[0])
        .toMatchObject({ status: "pending", paidAmount: 0 });
      expect((await query("SELECT status FROM stockReservations WHERE orderId=1"))[0].status).toBe("active");
      expect(await query("SELECT stock FROM products WHERE id=1")).toMatchObject([{ stock: 97 }]);
      expect(await query("SELECT * FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1'")).toHaveLength(0);
    });
    it("P1-B retries transient PAYMENT_RECEIVED provider reads with bounded backoff, then durably escalates once", async () => {
      const accountId = "sandbox-account-synthetic-legacy";
      vi.stubEnv("ASAAS_WEBHOOK_ACCOUNT_ID", accountId);
      vi.stubEnv("ASAAS_WEBHOOK_ACCOUNT_CURRENCY", "BRL");
      const { body } = await prepareLegacyPaidReceipt("PAYMENT_RECEIVED", "evt-provider-retry-p1", accountId);
      const failures = [Object.assign(Error("ETIMEDOUT"), { code: "ETIMEDOUT" }), Object.assign(Error("HTTP_429"), { providerStatus: 429 }), Object.assign(Error("HTTP_503"), { providerStatus: 503 })];
      injected.provider.mockRejectedValueOnce(failures[0]).mockRejectedValueOnce(failures[1]).mockRejectedValueOnce(failures[2]);
      const first = await send(body);
      expect(first.status).toBe(503);
      let row = (await query("SELECT state,errorCode,attempts,nextAttemptAt FROM asaasWebhookInbox WHERE eventId=?", [body.id]))[0];
      expect(row).toMatchObject({ state: "failed", errorCode: "PAYMENT_CURRENCY_PROVIDER_READ_FAILED", attempts: 1 });
      expect(new Date(row.nextAttemptAt).getTime()).toBeGreaterThan(Date.now());
      expect(await query("SELECT * FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1'")).toHaveLength(0);
      const callCount = injected.provider.mock.calls.length;
      expect((await send(body)).status).toBe(503);
      expect(injected.provider.mock.calls).toHaveLength(callCount);
      await query("UPDATE asaasWebhookInbox SET nextAttemptAt=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE eventId=?", [body.id]);
      expect((await send(body)).status).toBe(503);
      row = (await query("SELECT state,errorCode,attempts,nextAttemptAt FROM asaasWebhookInbox WHERE eventId=?", [body.id]))[0];
      expect(row).toMatchObject({ state: "failed", errorCode: "PAYMENT_CURRENCY_PROVIDER_READ_FAILED", attempts: 2 });
      expect(new Date(row.nextAttemptAt).getTime()).toBeGreaterThan(Date.now());
      await query("UPDATE asaasWebhookInbox SET nextAttemptAt=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE eventId=?", [body.id]);
      expect(await send(body)).toMatchObject({ status: 200, data: { reconciliationRequired: true } });
      row = (await query("SELECT state,errorCode,attempts,nextAttemptAt FROM asaasWebhookInbox WHERE eventId=?", [body.id]))[0];
      expect(row).toMatchObject({ state: "processed", errorCode: null, attempts: 3, nextAttemptAt: null });
      expect(await query("SELECT * FROM auditLogs WHERE action='payment.provider_preflight_failure.v1' AND entityId=SHA2(?,256)", [body.id])).toHaveLength(3);
      const [alert] = await query("SELECT payload FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1'");
      expect(JSON.parse(alert.payload)).toMatchObject({ category: "order_attempt_payment_inconsistent", providerEventId: body.id, paymentId: PAYMENT1 });
      expect((await query("SELECT paymentStatus FROM orders WHERE id=1"))[0].paymentStatus).toBe("unconfirmed");
      expect((await query("SELECT status FROM stockReservations WHERE orderId=1"))[0].status).toBe("active");
      expect((await send(body)).data).toMatchObject({ reason: "duplicate_event" });
      expect(injected.provider).toHaveBeenCalledTimes(3);
    });
    it("P1-B does not ACK the retry-limit attempt unless audit and P1 alert commit atomically", async () => {
      const accountId = "sandbox-account-synthetic-legacy";
      vi.stubEnv("ASAAS_WEBHOOK_ACCOUNT_ID", accountId);
      vi.stubEnv("ASAAS_WEBHOOK_ACCOUNT_CURRENCY", "BRL");
      const { body } = await prepareLegacyPaidReceipt("PAYMENT_RECEIVED", "evt-provider-alert-atomic-p1", accountId);
      injected.provider.mockRejectedValueOnce(Object.assign(Error("HTTP_503"), { providerStatus: 503 }))
        .mockRejectedValueOnce(Object.assign(Error("HTTP_429"), { providerStatus: 429 }))
        .mockRejectedValueOnce(Object.assign(Error("HTTP_503"), { providerStatus: 503 }))
        .mockRejectedValueOnce(Object.assign(Error("HTTP_503"), { providerStatus: 503 }));
      expect((await send(body)).status).toBe(503);
      await query("UPDATE asaasWebhookInbox SET nextAttemptAt=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE eventId=?", [body.id]);
      expect((await send(body)).status).toBe(503);
      await query("UPDATE asaasWebhookInbox SET nextAttemptAt=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE eventId=?", [body.id]);
      await query(`CREATE TRIGGER reject_provider_preflight_alert BEFORE INSERT ON notificationOutbox FOR EACH ROW
        BEGIN IF NEW.type='financial-reconciliation-alert-v1' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic P1 alert failure'; END IF; END`);
      try {
        expect((await send(body)).status).toBeGreaterThanOrEqual(500);
        expect((await query("SELECT state,attempts,errorCode FROM asaasWebhookInbox WHERE eventId=?", [body.id]))[0])
          .toMatchObject({ state: "failed", attempts: 2, errorCode: "PAYMENT_CURRENCY_PROVIDER_READ_FAILED" });
        expect(await query("SELECT * FROM auditLogs WHERE action='payment.provider_preflight_failure.v1'")).toHaveLength(2);
        expect(await query("SELECT * FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1'")).toHaveLength(0);
      } finally { await query("DROP TRIGGER IF EXISTS reject_provider_preflight_alert"); }
      await query("UPDATE asaasWebhookInbox SET nextAttemptAt=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE eventId=?", [body.id]);
      expect(await send(body)).toMatchObject({ status: 200, data: { reconciliationRequired: true } });
      expect((await query("SELECT state,attempts FROM asaasWebhookInbox WHERE eventId=?", [body.id]))[0])
        .toMatchObject({ state: "processed", attempts: 3 });
      expect(await query("SELECT * FROM auditLogs WHERE action='payment.provider_preflight_failure.v1'")).toHaveLength(3);
      expect(await query("SELECT * FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1'")).toHaveLength(1);
      expect((await query("SELECT paymentStatus FROM orders WHERE id=1"))[0].paymentStatus).toBe("unconfirmed");
    });
    it("P1-B definitive provider 404 escalates immediately with a durable P1 alert", async () => {
      const accountId = "sandbox-account-synthetic-legacy";
      vi.stubEnv("ASAAS_WEBHOOK_ACCOUNT_ID", accountId);
      const { body } = await prepareLegacyPaidReceipt("PAYMENT_RECEIVED", randomUUID(), accountId);
      injected.provider.mockRejectedValueOnce(Object.assign(Error("HTTP_404_NOT_FOUND"), { providerStatus: 404 }));
      expect(await send(body)).toMatchObject({ status: 200, data: { reconciliationRequired: true } });
      expect((await query("SELECT state,attempts FROM asaasWebhookInbox WHERE eventId=?", [body.id]))[0]).toMatchObject({ state: "processed", attempts: 1 });
      expect(await query("SELECT * FROM auditLogs WHERE action='payment.provider_preflight_failure.v1'")).toHaveLength(1);
      expect(await query("SELECT * FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1'")).toHaveLength(1);
      expect((await query("SELECT paymentStatus FROM orders WHERE id=1"))[0].paymentStatus).toBe("unconfirmed");
    });
    it("P1-C PAYMENT_RECEIVED without an order or status creates a P1 alert without confirming anything", async () => {
      const body = { id: randomUUID(), event: "PAYMENT_RECEIVED", payment: {
        id: "pay_missing_local_order", externalReference: "UNKNOWN-REF-ORPHAN-14B", value: 99, currency: "BRL",
      } };
      const before = await financialSnapshot();
      expect(await send(body)).toMatchObject({ status: 200, data: { reconciliationRequired: true, financialMutation: false, stockMutation: false } });
      const [audit] = await query("SELECT metadata FROM auditLogs WHERE action='payment.webhook_reconciliation_required.v1'");
      expect(JSON.parse(audit.metadata)).toMatchObject({ eventId: body.id, event: "PAYMENT_RECEIVED", paymentId: "pay_missing_local_order", observedOrderReference: "UNKNOWN-REF-ORPHAN-14B", observedStatus: null, observedAmountCents: 9900, financialMutation: false, stockMutation: false });
      const [alert] = await query("SELECT orderId,payload FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1'");
      expect(alert.orderId).toBeNull();
      const alertPayload = JSON.parse(alert.payload);
      expect(alertPayload).toMatchObject({ category: "order_attempt_payment_inconsistent", providerEventId: body.id, paymentId: "pay_missing_local_order", observedStatus: null, observedAmountCents: 9900, referenceHint: "UNKNOWN-…-14B", financialMutation: false, stockMutation: false });
      expect(RECONCILIATION_PRIORITY_BY_CATEGORY[alertPayload.category]).toBe("P1");
      expect(JSON.parse(alert.payload).referenceHash).toMatch(/^[a-f0-9]{64}$/);
      expect(await query("SELECT * FROM orders WHERE id=14")).toHaveLength(0);
      expect(await financialSnapshot()).toEqual(before);
      expect(injected.provider).not.toHaveBeenCalled();
    });
    it.each([401, 403])("P1-B provider credential rejection %s is durably identifiable and never confirms", async providerStatus => {
      const accountId = "sandbox-account-synthetic-credentials";
      vi.stubEnv("ASAAS_WEBHOOK_ACCOUNT_ID", accountId);
      vi.stubEnv("ASAAS_WEBHOOK_ACCOUNT_CURRENCY", "BRL");
      const { body } = await prepareLegacyPaidReceipt("PAYMENT_RECEIVED", `evt-provider-credentials-${providerStatus}`, accountId);
      injected.provider.mockRejectedValueOnce(Object.assign(Error(`HTTP_${providerStatus}`), { providerStatus }));
      const response = await send(body);
      expect(response).toMatchObject({ status: 200, data: { handled: false, reason: "payment_reconciliation_required", reconciliationRequired: true } });
      const [inboxRow] = await query("SELECT state,attempts,errorCode,payloadHash FROM asaasWebhookInbox WHERE eventId=?", [body.id]);
      expect(inboxRow).toMatchObject({ state: "processed", attempts: 1, errorCode: null });
      const [audit] = await query("SELECT metadata FROM auditLogs WHERE action='payment.provider_preflight_failure.v1' AND entityId=SHA2(?,256)", [body.id]);
      expect(JSON.parse(audit.metadata)).toMatchObject({ eventId: body.id, providerStatus, attempts: 1, retryable: false,
        reason: `PROVIDER_HTTP_${providerStatus}`, reconciliationRequired: true, financialMutation: false, stockMutation: false });
      const [alert] = await query("SELECT id,payload FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1'");
      const alertPayload = JSON.parse(alert.payload);
      expect(alertPayload).toMatchObject({ category: "order_attempt_payment_inconsistent", providerEventId: body.id,
        paymentId: PAYMENT1, reason: `PROVIDER_HTTP_${providerStatus}`, financialMutation: false, stockMutation: false });
      expect(RECONCILIATION_PRIORITY_BY_CATEGORY[alertPayload.category]).toBe("P1");
      const [operatorCase] = await query(`SELECT id,JSON_UNQUOTE(JSON_EXTRACT(payload,'$.providerEventId')) providerEventId,
        JSON_UNQUOTE(JSON_EXTRACT(payload,'$.paymentId')) paymentId,JSON_UNQUOTE(JSON_EXTRACT(payload,'$.reason')) reason,
        JSON_UNQUOTE(JSON_EXTRACT(payload,'$.category')) category FROM notificationOutbox
        WHERE type='financial-reconciliation-alert-v1' AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.reason'))=?`, [`PROVIDER_HTTP_${providerStatus}`]);
      expect(operatorCase).toMatchObject({ id: alert.id, providerEventId: body.id, paymentId: PAYMENT1,
        reason: `PROVIDER_HTTP_${providerStatus}`, category: "order_attempt_payment_inconsistent" });
      expect((await query("SELECT status,paymentStatus FROM orders WHERE id=1"))[0]).toMatchObject({ status: "pending", paymentStatus: "unconfirmed" });
      expect((await query("SELECT status FROM payments WHERE orderId=1"))[0].status).toBe("pending");
      expect((await query("SELECT status FROM stockReservations WHERE orderId=1"))[0].status).toBe("active");
      expect(await query("SELECT stock FROM products WHERE id=1")).toMatchObject([{ stock: 97 }]);
      expect((await send(body)).data).toMatchObject({ reason: "duplicate_event" });
      expect(injected.provider).toHaveBeenCalledTimes(1);
      expect(await query("SELECT * FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1'")).toHaveLength(1);
    });
    it("legacy payment without currency confirms only with an exact preflight account/payment/reference/value/currency/customer binding", async () => {
      const previousAccountId = process.env.ASAAS_WEBHOOK_ACCOUNT_ID;
      process.env.ASAAS_WEBHOOK_ACCOUNT_ID = "sandbox-account-synthetic-legacy";
      const customerId = "cus_synthetic_legacy_1";
      try {
        await query("UPDATE users SET asaasCustomerId=? WHERE id=999901", [customerId]);
        await query("UPDATE orders SET status='pending',paymentStatus='unconfirmed',paymentConfirmationSource=NULL,paymentConfirmedAt=NULL,paymentConfirmedBy=NULL,fulfillmentStatus='awaiting_payment' WHERE id=1");
        await query("UPDATE payments SET status='pending',creationStatus='created',statusSource='provider',externalReference='1',paidAmount=0,netAmount=0 WHERE orderId=1");
        await query("UPDATE stockReservations SET status='active',expiresAt=DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR) WHERE orderId=1");
        const id = randomUUID();
        const body: any = { ...envelope("PAYMENT_RECEIVED", id, 1), account: { id: "sandbox-account-synthetic-legacy", ownerId: null } };
        body.payment.externalReference = "1";
        let openTransactionsAtProviderRead = -1;
        injected.provider.mockImplementationOnce(async paymentId => {
          const [rows] = await root.query<any[]>("SELECT COUNT(*) n FROM information_schema.innodb_trx trx JOIN performance_schema.threads th ON th.PROCESSLIST_ID=trx.trx_mysql_thread_id WHERE th.PROCESSLIST_DB=? AND trx.trx_mysql_thread_id<>CONNECTION_ID()", [database]);
          openTransactionsAtProviderRead = Number(rows[0].n);
          return { id: paymentId, externalReference: "1", status: "RECEIVED", deleted: false,
            value: 99, currency: "BRL", customer: customerId, billingType: "PIX" };
        });
        const response = await send(body);
        expect(response).toMatchObject({ status: 200 });
        expect((await query("SELECT status,paymentStatus FROM orders WHERE id=1"))[0]).toMatchObject({ status: "paid", paymentStatus: "confirmed" });
        expect((await query("SELECT status,paidAmount FROM payments WHERE orderId=1"))[0]).toMatchObject({ status: "received", paidAmount: 9900 });
        expect(openTransactionsAtProviderRead).toBe(0);
        expect(await query("SELECT * FROM auditLogs WHERE action='payment.webhook_reconciliation_required.v1'")).toHaveLength(0);
      } finally {
        if (previousAccountId === undefined) delete process.env.ASAAS_WEBHOOK_ACCOUNT_ID;
        else process.env.ASAAS_WEBHOOK_ACCOUNT_ID = previousAccountId;
      }
    });
    it("RECEIVED then CONFIRMED without currency/account proof is durably quarantined and does not notify", async () => {
      const before = await financialSnapshot(),
        received = envelope("PAYMENT_RECEIVED"),
        confirmed = envelope("PAYMENT_CONFIRMED");
      expect((await send(received)).status).toBe(200);
      expect((await send(confirmed)).status).toBe(200);
      expect((await send(received)).status).toBe(200);
      expect(await financialSnapshot()).toEqual(before);
      expect(await query("SELECT * FROM asaasWebhookEvents")).toHaveLength(0);
      expect(await query("SELECT * FROM auditLogs WHERE action='payment.webhook_reconciliation_required.v1'")).toHaveLength(2);
      expect(await query("SELECT * FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1'")).toHaveLength(2);
      expect(await query("SELECT state FROM asaasWebhookInbox ORDER BY eventId")).toEqual([{ state: "processed" }, { state: "processed" }]);
      expect(injected.provider).not.toHaveBeenCalled();
      expect(injected.mail).not.toHaveBeenCalled();
    });
    it("audit write failure rolls back and never acknowledges review as durable", async () => {
      const before = await financialSnapshot();
      await query(
        "CREATE TRIGGER reject_observation_audit BEFORE INSERT ON auditLogs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic audit failure'"
      );
      expect((await send(deleted())).status).toBeGreaterThanOrEqual(500);
      expect(await financialSnapshot()).toEqual(before);
      expect(await businessAudits()).toHaveLength(0);
      expect(await query("SELECT * FROM asaasWebhookEvents")).toHaveLength(0);
    });
    it("does not ACK a provider-unavailable deletion unless the reconciliation audit commits", async () => {
      const before = await financialSnapshot();
      await query(`CREATE TRIGGER reject_deleted_preflight_audit BEFORE INSERT ON auditLogs FOR EACH ROW
        BEGIN IF NEW.action='payment.deleted_preflight_reconciliation_required.v1' THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic preflight audit failure';
        END IF; END`);
      injected.provider.mockRejectedValueOnce(Object.assign(Error("HTTP_404_NOT_FOUND"), { providerStatus: 404 }));
      try {
        expect((await send(deleted())).status).toBeGreaterThanOrEqual(500);
        expect((await query("SELECT state,attempts,nextAttemptAt FROM asaasWebhookInbox"))[0])
          .toMatchObject({ state: "received", attempts: 0, nextAttemptAt: null });
        expect(await query("SELECT * FROM auditLogs WHERE action='payment.deleted_preflight_reconciliation_required.v1'")).toHaveLength(0);
        expect(await financialSnapshot()).toEqual(before);
      } finally {
        await query("DROP TRIGGER IF EXISTS reject_deleted_preflight_audit");
      }
      injected.provider.mockRejectedValueOnce(Object.assign(Error("HTTP_404_NOT_FOUND"), { providerStatus: 404 }));
      expect((await send(deleted())).status).toBe(200);
      expect((await query("SELECT state,attempts FROM asaasWebhookInbox"))[0]).toMatchObject({ state: "rejected", attempts: 1 });
      expect(await query("SELECT * FROM auditLogs WHERE action='payment.deleted_preflight_reconciliation_required.v1'")).toHaveLength(1);
    });
    it("wrong token never persists; authenticated unknown events are durably quarantined and ACKed once", async () => {
      expect((await send(deleted(), "wrong")).status).toBe(401);
      expect(await query("SELECT * FROM asaasWebhookInbox")).toHaveLength(0);
      const unknown = envelope("PAYMENT_UNKNOWN");
      expect((await send(unknown)).status).toBe(200);
      expect(
        (await query("SELECT state FROM asaasWebhookInbox"))[0].state
      ).toBe("processed");
      expect(await query("SELECT * FROM auditLogs WHERE action='payment.webhook_reconciliation_required.v1'")).toHaveLength(1);
      expect(await query("SELECT * FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1'")).toHaveLength(1);
      expect((await send(unknown)).status).toBe(200);
      expect(await query("SELECT * FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1'")).toHaveLength(1);
      expect(injected.mail).not.toHaveBeenCalled();
    });
    it("an authenticated financial event for a missing local order is durably quarantined instead of retried forever", async () => {
      const before = await financialSnapshot();
      const missingOrder = {
        id: randomUUID(), event: "PAYMENT_RECEIVED",
        payment: { id: "pay_missing_local_order", externalReference: "999999", status: "RECEIVED", value: 99, currency: "BRL" },
      };
      expect(await send(missingOrder)).toMatchObject({ status: 200,
        data: { reason: "payment_reconciliation_required", reconciliationRequired: true, financialMutation: false, stockMutation: false } });
      expect(await financialSnapshot()).toEqual(before);
      expect(await query("SELECT action FROM auditLogs WHERE action='payment.webhook_reconciliation_required.v1'")).toHaveLength(1);
      expect(await query("SELECT * FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1'")).toHaveLength(1);
      expect(injected.provider).not.toHaveBeenCalled();
      expect((await send(missingOrder)).status).toBe(200);
      expect(await query("SELECT * FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1'")).toHaveLength(1);
    });
  }
);

// Input compatibility/security contract; no provider/database access.
import { parseAsaasOrderReference } from "../../shared/asaasWebhookSemantics";
const officialAsaasReceipt = {
  id: "evt_05b708f961d739ea7eba7e4db318f621&368604920",
  event: "PAYMENT_RECEIVED",
  dateCreated: "2024-06-12 16:45:03",
  account: { id: "47ed0d25-f9fb-4b35-b23a-d8895caf92b7", ownerId: null },
  payment: {
    object: "payment", id: "pay_080225913252", dateCreated: "2021-01-01", customer: "cus_G7Dvo4iphUNk",
    value: 100, netValue: 94.51, externalReference: "056984", billingType: "CREDIT_CARD", status: "RECEIVED",
    creditCard: { creditCardToken: "must-not-be-retained" }, futureProviderField: "ignored",
  },
};
it("normalizes the documented Asaas shape without assuming currency and keeps only account identity", () => {
  const normalized = financialEnvelope(officialAsaasReceipt);
  expect(normalized.account).toEqual({ id: officialAsaasReceipt.account.id });
  expect(normalized.payment).toMatchObject({ id: "pay_080225913252", value: 100, externalReference: "056984", status: "RECEIVED" });
  expect(normalized.payment).not.toHaveProperty("currency");
  expect(normalized.payment).not.toHaveProperty("creditCard");
  expect(normalized.payment).not.toHaveProperty("futureProviderField");
  const reordered = {
    payment: { status: "RECEIVED", billingType: "CREDIT_CARD", externalReference: "056984", netValue: 94.51,
      value: 100, customer: "cus_G7Dvo4iphUNk", dateCreated: "2021-01-01", id: "pay_080225913252", object: "payment" },
    account: { ownerId: null, id: officialAsaasReceipt.account.id },
    dateCreated: officialAsaasReceipt.dateCreated, event: "PAYMENT_RECEIVED", id: officialAsaasReceipt.id,
  };
  expect(digest(JSON.stringify(financialEnvelope(reordered)))).toBe(digest(JSON.stringify(normalized)));
});
it.each([
  ["13", 13],
  [13, 13],
  ["L4CKOS-ORDER-1", 1],
  ["Pedido #1", null],
  ["L4CKOS-ORDER-1-other", null],
  ["L4CKOS-ORDER-0", null],
  ["1e1", null],
  ["-1", null],
  ["2147483648", null],
])(
  "only exact supported order reference %s resolves to %s",
  (input, expected) => {
    expect(parseAsaasOrderReference(input)).toBe(expected);
  }
);
