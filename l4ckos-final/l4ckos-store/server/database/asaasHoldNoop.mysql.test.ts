import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import { createPool, type Pool, type Connection } from "mysql2/promise";
import type * as mysqlOrm from "drizzle-orm/mysql2";
const injected = vi.hoisted(() => {
  process.env.JWT_SECRET =
    "synthetic-local-noop-secret-with-at-least-48-characters";
  process.env.OWNER_OPEN_ID = "noop-admin1";
  process.env.ADMIN_EMAILS = "noop-admin2@example.invalid";
  return { orm: null as unknown, provider: vi.fn(), mail: vi.fn() };
});
vi.mock("drizzle-orm/mysql2", async original => ({
  ...(await original<typeof mysqlOrm>()),
  drizzle: () => injected.orm,
}));
vi.mock("../admin/asaasHoldNoopEvidence", async original => ({
  ...(await original<typeof import("../admin/asaasHoldNoopEvidence")>()),
  readSandboxNoopEvidence: injected.provider,
}));
vi.mock("../services/emailService.js", () => ({
  sendPaymentApprovedEmail: injected.mail,
  sendOrderCreatedEmail: injected.mail,
  sendPaymentPendingEmail: injected.mail,
  sendOrderDeliveredEmail: injected.mail,
  sendReviewRequestEmail: injected.mail,
  sendInternalNewSaleAlertEmail: injected.mail,
  sendInternalLowStockAlertEmail: injected.mail,
  sendPaymentFailedEmail: injected.mail,
  sendInternalPaymentFailedAlertEmail: injected.mail,
}));
import { openBackupConnection } from "./backupRestore";
import { bootstrapReleaseDatabase } from "../../database/bootstrap/bootstrap";
import { readReleaseContract } from "../../database/schema/artifacts";
import { structuralHash as hash } from "../../database/schema/fingerprint";
import { sdk } from "../_core/sdk";
import { ENV } from "../_core/env";
import {
  reviewAsaasHoldsNoop,
  NOOP_ACTION,
  NOOP_SCOPE,
  NOOP_OPERATION,
} from "../admin/asaasHoldNoop";
import {
  financialEnvelope,
  processStoredWebhook,
  recoverWebhooks,
} from "../payments/webhookInbox";
import { deliverPaymentNotifications } from "../payments/paymentNotificationOutbox";
const socket = process.env.L4CKOS_LOCAL_MYSQL_SOCKET ?? "";
const database =
  "l4ckos_test_noop_" + randomUUID().replaceAll("-", "").slice(0, 10);
const request = {
  classification: "ALREADY_RECONCILED_NOOP",
  holdIds: [74, 76],
  eventIds: NOOP_SCOPE.map(x => x.eventId),
  reason: "Observacoes ja representadas na conciliacao manual validada.",
  authorizationReference: "owner-local-fixture-approval",
};
const evidenceDetails = [
  {
    dateCreated: "2026-10-11 12:49:13",
    payment: {
      billingType: "PIX",
      paymentDate: null,
      clientPaymentDate: null,
      creditDate: null,
      estimatedCreditDate: null,
      refunds: null,
    },
  },
  {
    dateCreated: "2026-10-11 12:56:34",
    payment: {
      billingType: "PIX",
      paymentDate: "2026-10-11",
      clientPaymentDate: "2026-10-11",
      confirmedDate: "2026-10-11",
      creditDate: "2026-10-11",
      estimatedCreditDate: "2026-10-11",
      refunds: null,
    },
  },
];
let root: Connection, c: Connection, pool: Pool, token: string, token2: string;
const q = async (sql: string, values: unknown[] = []) =>
  (await c.query<any[]>(sql, values))[0];
const protectedTables = [
  "users",
  "orders",
  "payments",
  "products",
  "stockReservations",
  "orderItems",
  "notificationOutbox",
  "orderEmailEvents",
  "asaasWebhookInbox",
  "asaasWebhookEvents",
  "paymentEvents",
];
async function unchangedState() {
  const out: Record<string, unknown> = {};
  for (const t of protectedTables)
    out[t] = await q(
      "SELECT * FROM " +
        t +
        " ORDER BY " +
        (["asaasWebhookInbox", "asaasWebhookEvents"].includes(t)
          ? "eventId"
          : "id")
    );
  out.audit = await q("SELECT * FROM auditLogs WHERE action<>? ORDER BY id", [
    NOOP_ACTION,
  ]);
  return out;
}
async function assertPreserved(before: unknown) {
  expect(await unchangedState()).toEqual(before);
  expect(injected.mail).not.toHaveBeenCalled();
}
async function dry(connection = c, session = token) {
  return reviewAsaasHoldsNoop(connection, request, session, {
    dryRun: true,
    localSocket: socket,
  });
}
async function apply(digest: string, connection = c, session = token) {
  return reviewAsaasHoldsNoop(connection, request, session, {
    dryRun: false,
    expectedDigest: digest,
    localSocket: socket,
  });
}
function providerEvidence() {
  const facts = {
    paymentId: "pay_dog6ppexq4gyw3k6",
    orderId: 13,
    status: "RECEIVED",
    grossCents: 9900,
    netCents: 9801,
    refundCount: 0,
    deleted: false,
    chargeback: false,
    interrupted: false,
  };
  return { observedAt: new Date().toISOString(), facts, hash: hash(facts) };
}
async function seed() {
  await q("DROP TRIGGER IF EXISTS noop_failure");
  await q("DROP TRIGGER IF EXISTS noop_drift");
  for (const t of [
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
    await q("DELETE FROM " + t);
  await q(
    "INSERT INTO users(id,openId,name,email,role) VALUES(14,'noop-admin1','Synthetic Admin','noop-admin1@example.invalid','admin'),(15,'noop-admin2','Synthetic Admin2','noop-admin2@example.invalid','admin'),(999901,'synthetic-customer','Synthetic','synthetic@example.invalid','user')"
  );
  await q(
    "INSERT INTO products(id,name,category,price,stock) VALUES(1,'Synthetic','fixture',9900,97)"
  );
  await q(
    "INSERT INTO orders(id,userId,totalPrice,status,paymentStatus,paymentConfirmationSource,paymentConfirmedAt,paymentConfirmedBy,fulfillmentStatus) VALUES(13,999901,9900,'paid','confirmed','manual','2026-10-17 06:21:35',14,'ready'),(2,999901,9900,'paid','unconfirmed',NULL,NULL,NULL,'ready'),(3,999901,9900,'paid','unconfirmed',NULL,NULL,NULL,'ready'),(6,999901,9900,'delivered','confirmed',NULL,NULL,NULL,'ready')"
  );
  await q(
    "INSERT INTO payments(id,orderId,provider,providerPaymentId,externalReference,billingType,amount,status,creationStatus,statusSource,paidAmount,refundedAmount,netAmount,manualConfirmedAt,manualConfirmedBy) VALUES(4,13,'asaas','pay_dog6ppexq4gyw3k6','13','PIX',9900,'received','created','reconciliation',9900,0,9801,'2026-10-17 06:21:35',14)"
  );
  await q(
    "INSERT INTO orderItems(id,orderId,productId,productName,unitPrice,quantity,totalPrice) VALUES(14,13,1,'Synthetic',9900,1,9900)"
  );
  await q(
    "INSERT INTO stockReservations(id,orderId,userId,productId,orderItemId,quantity,status,expiresAt) VALUES(10,13,999901,1,14,1,'consumed','2026-10-11 16:09:10')"
  );
  await q(
    "INSERT INTO notificationOutbox(dedupeKey,type,orderId,payload) VALUES('legacy-2','payment-approved',2,'{}'),('legacy-3','payment-approved',3,'{}'),('held-order13','payment-approved',13,'{}')"
  );
  await q(
    "INSERT INTO orderEmailEvents(id,orderId,eventType,status,idempotencyKey,attemptCount,processingAt,processingToken) VALUES(1,6,'order_delivered_email','processing','historical-1',1,'2026-10-01 00:00:00','held1'),(2,6,'review_request_email','processing','historical-2',1,'2026-10-01 00:00:00','held2')"
  );
  const post = {
    order: await q("SELECT * FROM orders WHERE id=13"),
    reserve: await q("SELECT * FROM stockReservations WHERE id=10"),
    payment: await q("SELECT * FROM payments WHERE orderId=13"),
    outbox: await q("SELECT * FROM notificationOutbox WHERE orderId=13"),
  };
  await q(
    "INSERT INTO auditLogs(id,actorUserId,actorType,action,entity,entityId,orderId,correlationId,metadata) VALUES(73,14,'admin','order13.reconciliation_completed','order','13',13,?,?)",
    [
      NOOP_OPERATION,
      JSON.stringify({
        operation: NOOP_OPERATION,
        stockAfter: 97,
        postFinancialHash: hash(post),
        evidence: {
          paymentId: "pay_dog6ppexq4gyw3k6",
          amountCents: 9900,
          netAmountCents: 9801,
          status: "RECEIVED",
        },
      }),
    ]
  );
  for (const [i, s] of NOOP_SCOPE.entries()) {
    const envelope = financialEnvelope({
      id: s.eventId,
      event: s.event,
      payment: {
        id: "pay_dog6ppexq4gyw3k6",
        externalReference: "13",
        status: i === 0 ? "PENDING" : "RECEIVED",
        value: 99,
        netValue: 98.01,
      },
    });
    const minimal: any = { ...envelope };
    delete minimal.sourcePayloadHash;
    expect(hash(minimal)).toBe(s.payloadHash);
    expect(hash(evidenceDetails[i])).toBe(s.evidenceHash);
    await q(
      "INSERT INTO asaasWebhookInbox(eventId,payload,payloadHash,state,attempts,errorCode) VALUES(?,?,?,?,?,?)",
      [
        s.eventId,
        JSON.stringify(envelope),
        s.payloadHash,
        i === 0 ? "rejected" : "received",
        i === 0 ? 1 : 0,
        i === 0 ? "WEBHOOK_VALIDATION_REJECTED" : null,
      ]
    );
    const meta = {
      eventId: s.eventId,
      payloadHash: s.payloadHash,
      eventType: s.event,
      paymentId: "pay_dog6ppexq4gyw3k6",
      externalReference: "13",
      orderId: 13,
      envelope,
      reviewOnly: true,
      releaseRequired: true,
      financialMutation: false,
      notificationMutation: false,
    };
    const key = (await import("node:crypto"))
      .createHash("sha256")
      .update(s.eventId)
      .digest("hex");
    await q(
      "INSERT INTO auditLogs(id,actorType,action,entity,entityId,metadata) VALUES(?,'system','webhook.recovery_held.v1','asaasWebhookInbox',?,?)",
      [s.holdId, key, JSON.stringify(meta)]
    );
    await q(
      "INSERT INTO auditLogs(id,actorType,action,entity,entityId,metadata) VALUES(?,'system','webhook.recovery_evidence.v1','asaasWebhookInbox',?,?)",
      [
        s.holdId + 1,
        key,
        JSON.stringify({
          eventId: s.eventId,
          payloadHash: s.payloadHash,
          evidenceHash: s.evidenceHash,
          details: evidenceDetails[i],
        }),
      ]
    );
  }
}
describe.skipIf(process.env.L4CKOS_MYSQL_TEST !== "1")(
  "administrative NOOP closure on local MySQL",
  () => {
    beforeAll(async () => {
      if (!/^\/tmp\/l4ckos-[a-z0-9-]+\/mysqld\.sock$/.test(socket))
        throw Error("LOCAL_SOCKET_REQUIRED");
      vi.stubEnv("L4CKOS_LOCAL_SCHEMA", "1");
      vi.stubEnv("L4CKOS_LOCAL_RESTORE", "1");
      root = await openBackupConnection("mysql://root@localhost/mysql", socket);
      const [r] = await root.query<any[]>("SELECT SHA2(@@server_uuid,256) h");
      if (
        r[0].h ===
        "92e96ae744d2112c5b4a430abc9a75d557a43d293652dd68369aa81786479f09"
      )
        throw Error("REMOTE_FORBIDDEN");
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
      pool = createPool({
        socketPath: socket,
        user: "root",
        database,
        dateStrings: true,
        connectionLimit: 5,
      });
      const actual =
        await vi.importActual<typeof mysqlOrm>("drizzle-orm/mysql2");
      injected.orm = actual.drizzle(pool);
      token = await sdk.createSessionToken("noop-admin1");
      token2 = await sdk.createSessionToken("noop-admin2");
    }, 30000);
    beforeEach(async () => {
      vi.unstubAllEnvs();
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("RAILWAY_PROJECT_ID", "2bb90c8e-eb65-43ee-826b-f93750f0499c");
      vi.stubEnv(
        "RAILWAY_ENVIRONMENT_ID",
        "15545eee-bc02-4b70-afc4-19a5db9e6f46"
      );
      vi.stubEnv("RAILWAY_SERVICE_ID", "9f1c7705-f2f9-48cf-b957-8f63a6bba4db");
      vi.stubEnv("ASAAS_WEBHOOK_RECOVERY_MODE", "review_only");
      vi.stubEnv("EMAIL_MODE", "restricted");
      vi.stubEnv("DATABASE_URL", "synthetic-present");
      injected.provider.mockReset();
      injected.provider.mockImplementation(async () => providerEvidence());
      injected.mail.mockReset();
      await seed();
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
    it("dry-run authenticates without mutating users/history and binds the approved decision", async () => {
      const before = await unchangedState();
      const x = await dry();
      expect(x.status).toBe("DRY_RUN");
      expect(x.actorUserId).toBe(14);
      expect(x.decisionDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(
        await q("SELECT * FROM auditLogs WHERE action=?", [NOOP_ACTION])
      ).toHaveLength(0);
      await assertPreserved(before);
    });
    it("valid holds74/76 add exactly two authenticated admin markers and no other effects", async () => {
      const before = await unchangedState();
      const d = await dry();
      const r = await apply(d.decisionDigest);
      expect(r.status).toBe("REVIEW_CLOSED");
      const audits = await q(
        "SELECT * FROM auditLogs WHERE action=? ORDER BY id",
        [NOOP_ACTION]
      );
      expect(audits).toHaveLength(2);
      expect(
        audits.every(x => x.actorUserId === 14 && x.actorType === "admin")
      ).toBe(true);
      expect(audits.map(x => JSON.parse(x.metadata).holdId)).toEqual([74, 76]);
      await assertPreserved(before);
    });
    it("reentry by another authenticated admin returns the original actor/receipt without duplicate or timestamp changes", async () => {
      const d = await dry();
      await apply(d.decisionDigest);
      const first = await q(
        "SELECT * FROM auditLogs WHERE action=? ORDER BY id",
        [NOOP_ACTION]
      );
      const r = await apply(d.decisionDigest, c, token2);
      expect(r.status).toBe("ALREADY_REVIEWED");
      expect(r.actorUserId).toBe(14);
      expect(
        await q("SELECT * FROM auditLogs WHERE action=? ORDER BY id", [
          NOOP_ACTION,
        ])
      ).toEqual(first);
    });
    it("two concurrent administrators serialize the same two markers", async () => {
      const d = await dry();
      const a = await pool.getConnection(),
        b = await pool.getConnection();
      try {
        const results = await Promise.all([
          apply(d.decisionDigest, a, token),
          apply(d.decisionDigest, b, token2),
        ]);
        expect(results.map(x => x.status).sort()).toEqual([
          "ALREADY_REVIEWED",
          "REVIEW_CLOSED",
        ]);
        expect(
          await q("SELECT * FROM auditLogs WHERE action=?", [NOOP_ACTION])
        ).toHaveLength(2);
      } finally {
        a.release();
        b.release();
      }
    });
    it.each([
      "forged",
      "expired",
      "user",
      "blocked",
      "revoked",
      "unconfigured",
    ])("rejects %s actor without trusting client fields", async kind => {
      let session = token;
      if (kind === "forged") session = token.slice(0, -8) + "INVALID";
      if (kind === "expired")
        session = await sdk.createSessionToken("noop-admin1", {
          expiresInMs: -1000,
        });
      if (kind === "user") await q("UPDATE users SET role='user' WHERE id=14");
      if (kind === "blocked")
        await q("UPDATE users SET isBlocked=1 WHERE id=14");
      if (kind === "revoked")
        await q("UPDATE users SET sessionVersion=2 WHERE id=14");
      if (kind === "unconfigured")
        (await q(
          "UPDATE users SET openId='not-configured',email='other@example.invalid' WHERE id=14"
        ),
          (session = await sdk.createSessionToken("not-configured")));
      const before = await unchangedState();
      await expect(dry(c, session)).rejects.toThrow(
        /NOOP_(SESSION_REQUIRED|AUTHORIZED_ADMIN_REQUIRED)/
      );
      expect(injected.provider).not.toHaveBeenCalled();
      await assertPreserved(before);
    });
    it("rejects a freely supplied actor or another set of hold/event IDs", async () => {
      await expect(
        reviewAsaasHoldsNoop(c, { ...request, actorUserId: 14 }, token, {
          dryRun: true,
          localSocket: socket,
        })
      ).rejects.toThrow();
      await expect(
        reviewAsaasHoldsNoop(c, { ...request, holdIds: [74, 78] }, token, {
          dryRun: true,
          localSocket: socket,
        })
      ).rejects.toThrow();
    });
    it.each([
      "missing",
      "wrong",
      "duplicate",
      "unknown",
      "payload",
      "evidence",
    ])("rejects %s hold/event evidence", async kind => {
      if (kind === "missing") await q("DELETE FROM auditLogs WHERE id=74");
      if (kind === "wrong")
        await q("UPDATE auditLogs SET entityId='wrong' WHERE id=74");
      if (kind === "duplicate")
        await q(
          "INSERT INTO auditLogs(actorType,action,entity,entityId,metadata) SELECT actorType,action,entity,entityId,metadata FROM auditLogs WHERE id=74"
        );
      if (kind === "unknown")
        await q(
          "UPDATE asaasWebhookInbox SET payload=JSON_SET(payload,'$.event','PAYMENT_REFUNDED') WHERE eventId=?",
          [NOOP_SCOPE[1].eventId]
        );
      if (kind === "payload")
        await q(
          "UPDATE asaasWebhookInbox SET payloadHash=REPEAT('a',64) WHERE eventId=?",
          [NOOP_SCOPE[0].eventId]
        );
      if (kind === "evidence")
        await q(
          "UPDATE auditLogs SET metadata=JSON_SET(metadata,'$.details.payment.refunds',JSON_ARRAY(JSON_OBJECT('value',99))) WHERE id=77"
        );
      const before = await unchangedState();
      await expect(dry()).rejects.toThrow(/NOOP_/);
      await assertPreserved(before);
    });
    it("blocks an event that needs real payment processing", async () => {
      await q(
        "UPDATE orders SET status='pending',paymentStatus='unconfirmed' WHERE id=13"
      );
      const before = await unchangedState();
      await expect(dry()).rejects.toThrow("NOOP_ORDER_DIVERGED");
      await assertPreserved(before);
    });
    it("blocks a newer reversal/incompatible event for the same payment", async () => {
      await q(
        "INSERT INTO asaasWebhookInbox(eventId,payload,payloadHash) VALUES('new-refund',?,REPEAT('a',64))",
        [
          JSON.stringify({
            event: "PAYMENT_REFUNDED",
            payment: { id: "pay_dog6ppexq4gyw3k6" },
          }),
        ]
      );
      await expect(dry()).rejects.toThrow(
        "NOOP_ADDITIONAL_EVENT_REQUIRES_REVIEW"
      );
    });
    it("a changed financial state invalidates a dry-run digest", async () => {
      const d = await dry();
      await q("UPDATE products SET stock=96 WHERE id=1");
      await expect(apply(d.decisionDigest)).rejects.toThrow(
        "NOOP_STOCK_RESERVATION_DIVERGED"
      );
      expect(
        await q("SELECT * FROM auditLogs WHERE action=?", [NOOP_ACTION])
      ).toHaveLength(0);
    });
    it("rolls back all markers and real stock writes caused just before commit", async () => {
      const d = await dry();
      const before = await unchangedState();
      await q(
        "CREATE TRIGGER noop_drift BEFORE INSERT ON auditLogs FOR EACH ROW BEGIN IF NEW.action='webhook.recovery_review_closed.v1' THEN UPDATE products SET stock=96 WHERE id=1; END IF; END"
      );
      await expect(apply(d.decisionDigest)).rejects.toThrow(
        "NOOP_STATE_CHANGED_BEFORE_COMMIT"
      );
      expect(
        await q("SELECT * FROM auditLogs WHERE action=?", [NOOP_ACTION])
      ).toHaveLength(0);
      await assertPreserved(before);
    });
    it("failure inserting the second marker rolls back the first", async () => {
      const d = await dry();
      const before = await unchangedState();
      await q(
        "CREATE TRIGGER noop_failure BEFORE INSERT ON auditLogs FOR EACH ROW BEGIN IF NEW.action='webhook.recovery_review_closed.v1' AND JSON_EXTRACT(NEW.metadata,'$.holdId')=76 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic audit failure'; END IF; END"
      );
      await expect(apply(d.decisionDigest)).rejects.toThrow();
      expect(
        await q("SELECT * FROM auditLogs WHERE action=?", [NOOP_ACTION])
      ).toHaveLength(0);
      await assertPreserved(before);
    });
    it("mode drift before commit rolls back both markers", async () => {
      const d = await dry();
      injected.provider.mockImplementationOnce(async () => {
        vi.stubEnv("ASAAS_WEBHOOK_RECOVERY_MODE", "off");
        return providerEvidence();
      });
      await expect(apply(d.decisionDigest)).rejects.toThrow();
      expect(
        await q("SELECT * FROM auditLogs WHERE action=?", [NOOP_ACTION])
      ).toHaveLength(0);
    });
    it("a missing or wrong approved dry-run digest cannot apply", async () => {
      await expect(apply("a".repeat(64))).rejects.toThrow(
        "NOOP_DRY_RUN_DIGEST_REQUIRED"
      );
      expect(
        await q("SELECT * FROM auditLogs WHERE action=?", [NOOP_ACTION])
      ).toHaveLength(0);
    });
    it("conflicting or partial administrative closure is rejected", async () => {
      const d = await dry();
      await apply(d.decisionDigest);
      await q("DELETE FROM auditLogs WHERE action=? ORDER BY id LIMIT 1", [
        NOOP_ACTION,
      ]);
      await expect(dry()).rejects.toThrow("NOOP_PARTIAL_OR_FOREIGN_CLOSURE");
    });
    it("changing review marker cannot release worker/dispatch even after disabling recovery mode", async () => {
      const d = await dry();
      await apply(d.decisionDigest);
      await q(
        "UPDATE auditLogs SET metadata=JSON_SET(metadata,'$.processingAllowed',true) WHERE action=?",
        [NOOP_ACTION]
      );
      await expect(dry()).rejects.toThrow("NOOP_CLOSURE_CONFLICT");
      await q(
        "INSERT INTO notificationOutbox(dedupeKey,type,orderId,payload) VALUES('eligible-held-order13','payment-approved-email-v1',13,?)",
        [
          JSON.stringify({
            orderNumber: "13",
            customerEmail: "synthetic@example.invalid",
            customerName: "Synthetic",
          }),
        ]
      );
      vi.stubEnv("STAGING_EMAIL_ALLOWLIST", "synthetic@example.invalid");
      vi.stubEnv("ASAAS_WEBHOOK_RECOVERY_MODE", "off");
      const beforeWorker = await unchangedState();
      const business = vi.fn(async () => ({ status: 200, body: {} }));
      for (const x of NOOP_SCOPE)
        expect((await processStoredWebhook(x.eventId, business)).status).toBe(
          200
        );
      await recoverWebhooks(business);
      expect(business).not.toHaveBeenCalled();
      expect(await deliverPaymentNotifications()).toMatchObject({
        sent: 0,
        blocked: true,
      });
      expect(injected.mail).not.toHaveBeenCalled();
      await assertPreserved(beforeWorker);
      expect(
        await q(
          "SELECT COUNT(*) n FROM auditLogs WHERE action='webhook.recovery_held.v1'"
        )
      ).toMatchObject([{ n: "2" }]);
    });
    it("provider read failure or corrupt evidence fails closed", async () => {
      injected.provider.mockRejectedValueOnce(Error("synthetic read failure"));
      await expect(dry()).rejects.toThrow();
      injected.provider.mockImplementationOnce(async () => ({
        ...providerEvidence(),
        hash: "a".repeat(64),
      }));
      await expect(dry()).rejects.toThrow(
        "NOOP_PROVIDER_EVIDENCE_HASH_DIVERGED"
      );
    });
  }
);
