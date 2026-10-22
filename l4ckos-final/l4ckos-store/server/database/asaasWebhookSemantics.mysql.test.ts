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
import { financialEnvelope, receiveWebhook } from "../payments/webhookInbox";

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
    state[table] = await query("SELECT * FROM `" + table + "` ORDER BY id");
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
      await root.query("CREATE DATABASE `" + database + "`");
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
      vi.stubEnv("DATABASE_URL", "synthetic-present");
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
      expect(await query("SELECT * FROM auditLogs")).toHaveLength(1);
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
      const audits = await query("SELECT * FROM auditLogs");
      expect(audits).toHaveLength(1);
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
        JSON.parse((await query("SELECT metadata FROM auditLogs"))[0].metadata)
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
      expect(await query("SELECT * FROM auditLogs")).toHaveLength(1);
      expect(await query("SELECT * FROM asaasWebhookEvents")).toHaveLength(1);
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
        expect(await query("SELECT * FROM auditLogs")).toHaveLength(0);
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
        expect(await query("SELECT * FROM auditLogs")).toHaveLength(0);
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
      expect(await query("SELECT * FROM auditLogs")).toHaveLength(1);
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
        expect(await query("SELECT * FROM auditLogs")).toHaveLength(1);
        expect(await query("SELECT * FROM asaasWebhookEvents")).toHaveLength(1);
        expect(injected.mail).not.toHaveBeenCalled();
      });
    it("RECEIVED then CONFIRMED for reconciled order13 preserves payment/stock and does not notify", async () => {
      const before = await financialSnapshot(),
        received = envelope("PAYMENT_RECEIVED"),
        confirmed = envelope("PAYMENT_CONFIRMED");
      expect((await send(received)).status).toBe(200);
      expect((await send(confirmed)).status).toBe(200);
      expect((await send(received)).status).toBe(200);
      expect(await financialSnapshot()).toEqual(before);
      expect(await query("SELECT * FROM asaasWebhookEvents")).toHaveLength(2);
      expect(injected.mail).not.toHaveBeenCalled();
    });
    it("audit write failure rolls back and never acknowledges review as durable", async () => {
      const before = await financialSnapshot();
      await query(
        "CREATE TRIGGER reject_observation_audit BEFORE INSERT ON auditLogs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic audit failure'"
      );
      expect((await send(deleted())).status).toBeGreaterThanOrEqual(500);
      expect(await financialSnapshot()).toEqual(before);
      expect(await query("SELECT * FROM auditLogs")).toHaveLength(0);
      expect(await query("SELECT * FROM asaasWebhookEvents")).toHaveLength(0);
    });
    it("wrong token never persists/acknowledges, and unknown events remain reviewable rejections", async () => {
      expect((await send(deleted(), "wrong")).status).toBe(401);
      expect(await query("SELECT * FROM asaasWebhookInbox")).toHaveLength(0);
      expect((await send(envelope("PAYMENT_UNKNOWN"))).status).toBe(422);
      expect(
        (await query("SELECT state FROM asaasWebhookInbox"))[0].state
      ).toBe("rejected");
      expect(injected.mail).not.toHaveBeenCalled();
    });
  }
);

// Input compatibility/security contract; no provider/database access.
import { parseAsaasOrderReference } from "../../shared/asaasWebhookSemantics";
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
