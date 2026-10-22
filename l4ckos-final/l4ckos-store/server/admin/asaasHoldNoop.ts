import { z } from "zod";
import { createHash } from "node:crypto";
import { ENV } from "../_core/env";
import type { Connection, RowDataPacket } from "mysql2/promise";
import { sdk } from "../_core/sdk";
import { isConfiguredAdmin } from "../_core/authz";
import type { User } from "../../drizzle/schema";
import { structuralHash } from "../../database/schema/fingerprint";
import {
  captureRecoveryFence,
  assertRecoveryFence,
} from "../payments/webhookRecovery";
import { readSandboxNoopEvidence, PAYMENT13 } from "./asaasHoldNoopEvidence";
export const NOOP_ACTION = "webhook.recovery_review_closed.v1";
export const NOOP_OPERATION = "order13-asaas-received-reconciliation-v1";
export const NOOP_SCOPE = [
  {
    holdId: 74,
    eventId: "evt_05b708f961d739ea7eba7e4db318f621&21683762",
    event: "PAYMENT_CREATED",
    payloadHash:
      "de2c741317cfa80116652027ff2e5ac385d27c972b90ec13eff6018821e89130",
    evidenceHash:
      "b80ff621ed84c81901e1b54af0fda5f2690345e0c6c9bcea77f6a7bb4eee9fa0",
  },
  {
    holdId: 76,
    eventId: "evt_d26e303b238e509335ac9ba210e51b0f&21684231",
    event: "PAYMENT_RECEIVED",
    payloadHash:
      "32f035937828d26e05265ecd56c97c6a73801372b3c75e3858fb4155ee566d7b",
    evidenceHash:
      "f019bbcf3322612483ebcd144b71878ead39b190a841492bcda0d49856740cc1",
  },
] as const;
export const noopRequestSchema = z
  .object({
    classification: z.literal("ALREADY_RECONCILED_NOOP"),
    holdIds: z.tuple([z.literal(74), z.literal(76)]),
    eventIds: z.tuple([
      z.literal(NOOP_SCOPE[0].eventId),
      z.literal(NOOP_SCOPE[1].eventId),
    ]),
    reason: z.string().trim().min(20).max(500),
    authorizationReference: z.string().trim().min(8).max(191),
  })
  .strict();
export type NoopRequest = z.infer<typeof noopRequestSchema>;
type Row = RowDataPacket & Record<string, any>;
function need(ok: unknown, code: string): asserts ok {
  if (!ok) throw Error("NOOP_" + code);
}
const hash = (v: unknown) => structuralHash(JSON.parse(JSON.stringify(v)));
const parse = (s: unknown) => (typeof s === "string" ? JSON.parse(s) : s);
const key = (id: string) => createHash("sha256").update(id).digest("hex");
const rows = async (c: Connection, s: string, args: unknown[] = []) =>
  (await c.query<Row[]>(s, args))[0];
const PROTECTED = [
  "users",
  "orders",
  "orderItems",
  "payments",
  "products",
  "stockReservations",
  "asaasWebhookEvents",
  "paymentEvents",
  "notificationOutbox",
  "orderEmailEvents",
  "asaasWebhookInbox",
];
async function protectedState(c: Connection) {
  const state: Record<string, unknown> = {};
  for (const t of PROTECTED)
    state[t] = await rows(
      c,
      "SELECT * FROM `" +
        t +
        "` ORDER BY " +
        (["asaasWebhookEvents", "asaasWebhookInbox"].includes(t)
          ? "eventId"
          : "id") +
        " FOR UPDATE"
    );
  state.auditLogs = await rows(
    c,
    "SELECT * FROM auditLogs WHERE action<>? ORDER BY id FOR UPDATE",
    [NOOP_ACTION]
  );
  return state;
}
function financialEligibility(state: Record<string, any>, holds: Row[]) {
  const o = state.orders.filter((x: Row) => x.id === 13),
    p = state.payments.filter(
      (x: Row) =>
        x.orderId === 13 ||
        x.providerPaymentId === PAYMENT13 ||
        x.externalReference === "13"
    ),
    r = state.stockReservations.filter((x: Row) => x.orderId === 13),
    stock = state.products.find((x: Row) => x.id === 1);
  need(
    o.length === 1 &&
      o[0].status === "paid" &&
      o[0].paymentStatus === "confirmed" &&
      o[0].fulfillmentStatus === "ready" &&
      o[0].paymentConfirmationSource === "manual" &&
      o[0].totalPrice === 9900,
    "ORDER_DIVERGED"
  );
  need(
    p.length === 1 &&
      p[0].id === 4 &&
      p[0].orderId === 13 &&
      p[0].provider === "asaas" &&
      p[0].providerPaymentId === PAYMENT13 &&
      p[0].externalReference === "13" &&
      p[0].billingType === "PIX" &&
      p[0].amount === 9900 &&
      p[0].paidAmount === 9900 &&
      p[0].refundedAmount === 0 &&
      p[0].netAmount === 9801 &&
      p[0].status === "received" &&
      p[0].statusSource === "reconciliation" &&
      p[0].receivedAt === null &&
      p[0].confirmedAt === null,
    "PAYMENT_DIVERGED"
  );
  need(
    stock?.stock === 97 &&
      r.length === 1 &&
      r[0].id === 10 &&
      r[0].productId === 1 &&
      r[0].quantity === 1 &&
      r[0].status === "consumed",
    "STOCK_RESERVATION_DIVERGED"
  );
  const audit = state.auditLogs.filter(
    (x: Row) => x.action === "order13.reconciliation_completed"
  );
  need(
    audit.length === 1 &&
      audit[0].id === 73 &&
      audit[0].correlationId === NOOP_OPERATION &&
      audit[0].entity === "order" &&
      audit[0].entityId === "13",
    "RECONCILIATION_MISSING"
  );
  const m = parse(audit[0].metadata);
  need(typeof o[0].paymentConfirmedAt === "string", "DATE_STRINGS_REQUIRED");
  need(
    hash({
      order: o,
      reserve: r,
      payment: p,
      outbox: state.notificationOutbox.filter((x: Row) => x.orderId === 13),
    }) === m.postFinancialHash,
    "RECONCILIATION_FINANCIAL_HASH_DIVERGED"
  );
  need(
    m.operation === NOOP_OPERATION &&
      m.stockAfter === 97 &&
      m.evidence?.paymentId === PAYMENT13 &&
      m.evidence.amountCents === 9900 &&
      m.evidence.netAmountCents === 9801 &&
      m.evidence.status === "RECEIVED",
    "RECONCILIATION_DIVERGED"
  );
  need(
    !state.asaasWebhookEvents.some(
      (x: Row) => x.orderId === 13 || x.paymentId === PAYMENT13
    ) &&
      !state.paymentEvents.some(
        (x: Row) => x.orderId === 13 || x.providerPaymentId === PAYMENT13
      ),
    "LEDGER_REQUIRES_REVIEW"
  );
  const related = state.asaasWebhookInbox.filter((x: Row) => {
    const p = parse(x.payload);
    return (
      p?.payment?.id === PAYMENT13 ||
      String(p?.payment?.externalReference ?? p?.externalReference) === "13"
    );
  });
  need(
    related.length === 2 &&
      related.every((x: Row) => NOOP_SCOPE.some(y => y.eventId === x.eventId)),
    "ADDITIONAL_EVENT_REQUIRES_REVIEW"
  );
  return {
    orderId: 13,
    paymentId: PAYMENT13,
    reconciliationAuditId: 73,
    operation: NOOP_OPERATION,
    financialHash: hash({
      orders: o,
      payments: p,
      reservations: r,
      stock,
      audit,
    }),
    holdHashes: holds.map(x => hash(x)),
  };
}
export type NoopOptions = {
  dryRun: boolean;
  expectedDigest?: string;
  localSocket?: string;
};
/** Trusted CLI entry, no HTTP route. The actor is derived from a verified app session, never request JSON. */
export async function reviewAsaasHoldsNoop(
  c: Connection,
  raw: unknown,
  sessionToken: string,
  options: NoopOptions
) {
  const request = noopRequestSchema.parse(raw),
    fence = captureRecoveryFence();
  need(fence.reviewOnly, "REVIEW_ONLY_REQUIRED");
  need(process.env.EMAIL_MODE === "restricted", "EMAIL_RESTRICTED_REQUIRED");
  const [identity] = await rows(
    c,
    "SELECT DATABASE() db,SHA2(@@server_uuid,256) h"
  );
  const local = !!options.localSocket;
  if (local)
    need(
      /^\/tmp\/l4ckos-[a-z0-9-]+\/mysqld\.sock$/.test(options.localSocket!) &&
        /^l4ckos_test_noop_[a-z0-9]+$/.test(identity.db) &&
        identity.h !==
          "92e96ae744d2112c5b4a430abc9a75d557a43d293652dd68369aa81786479f09",
      "LOCAL_DATABASE_REQUIRED"
    );
  else
    need(
      identity.db === "l4ckos_staging" &&
        identity.h ===
          "92e96ae744d2112c5b4a430abc9a75d557a43d293652dd68369aa81786479f09",
      "STAGING_DATABASE_REQUIRED"
    );
  const engines = await rows(
    c,
    "SELECT TABLE_NAME name,ENGINE engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()"
  );
  need(
    [...PROTECTED, "auditLogs"].every(t =>
      engines.some(x => x.name === t && x.engine === "InnoDB")
    ),
    "TRANSACTIONAL_SCHEMA_REQUIRED"
  );
  await c.query("SET time_zone='+00:00'");
  const session = await sdk.verifySession(sessionToken);
  need(session && session.appId === ENV.appId, "SESSION_REQUIRED");
  await c.beginTransaction();
  try {
    // All callers take the same ordered inbox locks before reading/writing review markers.
    for (const spec of NOOP_SCOPE)
      need(
        (
          await rows(
            c,
            "SELECT eventId FROM asaasWebhookInbox WHERE eventId=? FOR UPDATE",
            [spec.eventId]
          )
        ).length === 1,
        "INBOX_MISSING"
      );
    const state = await protectedState(c);
    const actor = (state.users as Row[]).find(x => x.openId === session.openId);
    need(
      actor &&
        actor.isBlocked === 0 &&
        actor.sessionVersion === session.sessionVersion &&
        isConfiguredAdmin(actor as User),
      "AUTHORIZED_ADMIN_REQUIRED"
    );
    const holds: Row[] = [];
    const reviewed = [];
    for (const spec of NOOP_SCOPE) {
      const inbox = (state.asaasWebhookInbox as Row[]).find(
        x => x.eventId === spec.eventId
      );
      need(inbox, "INBOX_MISSING");
      const payload = parse(inbox.payload);
      need(payload, "PAYLOAD_MISSING");
      const canonicalPayload = { ...payload };
      delete canonicalPayload.sourcePayloadHash;
      need(
        inbox.payloadHash === spec.payloadHash &&
          hash(canonicalPayload) === spec.payloadHash &&
          payload.id === spec.eventId &&
          payload.event === spec.event &&
          payload.payment?.id === PAYMENT13 &&
          payload.payment?.externalReference === "13" &&
          payload.payment.value === 99 &&
          payload.payment.netValue === 98.01,
        "EVENT_IDENTITY_DIVERGED"
      );
      need(
        spec.holdId === 74
          ? inbox.state === "rejected" &&
              inbox.attempts === 1 &&
              inbox.errorCode === "WEBHOOK_VALIDATION_REJECTED"
          : inbox.state === "received" &&
              inbox.attempts === 0 &&
              inbox.errorCode === null,
        "INBOX_STATE_DIVERGED"
      );
      const candidates = (state.auditLogs as Row[]).filter(
        x =>
          x.action === "webhook.recovery_held.v1" &&
          parse(x.metadata)?.eventId === spec.eventId
      );
      need(
        candidates.length === 1 && candidates[0].id === spec.holdId,
        "HOLD_MISSING_OR_DUPLICATE"
      );
      const hold = candidates[0],
        m = parse(hold.metadata);
      holds.push(hold);
      need(
        hold.entity === "asaasWebhookInbox" &&
          hold.entityId === key(spec.eventId) &&
          m.eventType === spec.event &&
          m.paymentId === PAYMENT13 &&
          m.orderId === 13 &&
          m.externalReference === "13" &&
          m.payloadHash === spec.payloadHash &&
          m.reviewOnly === true &&
          m.releaseRequired === true &&
          m.financialMutation === false &&
          m.notificationMutation === false,
        "HOLD_DIVERGED"
      );
      const e = (state.auditLogs as Row[]).filter(
        x =>
          x.action === "webhook.recovery_evidence.v1" &&
          parse(x.metadata)?.eventId === spec.eventId
      );
      need(e.length === 1, "EVIDENCE_MISSING");
      const em = parse(e[0].metadata);
      need(
        e[0].entity === "asaasWebhookInbox" &&
          e[0].entityId === key(spec.eventId) &&
          em.payloadHash === spec.payloadHash &&
          em.evidenceHash === spec.evidenceHash &&
          hash(em.details) === spec.evidenceHash,
        "EVIDENCE_DIVERGED"
      );
      reviewed.push({
        holdId: hold.id,
        eventId: spec.eventId,
        event: spec.event,
        paymentId: PAYMENT13,
        orderId: 13,
        payloadHash: spec.payloadHash,
        inboxHash: hash(inbox),
        holdHash: hash(hold),
        evidenceHash: spec.evidenceHash,
        evidenceRowHash: hash(e[0]),
      });
    }
    const eligibility = financialEligibility(state, holds),
      provider = await readSandboxNoopEvidence();
    need(
      hash(provider.facts) === provider.hash,
      "PROVIDER_EVIDENCE_HASH_DIVERGED"
    );
    const decision = {
      classification: request.classification,
      reason: request.reason,
      authorizationReference: request.authorizationReference,
      reviewed,
      eligibility,
      providerHash: provider.hash,
      protectedStateHash: hash(state),
    };
    const digest = hash(decision),
      existing = await rows(
        c,
        "SELECT * FROM auditLogs WHERE action=? ORDER BY id FOR UPDATE",
        [NOOP_ACTION]
      );
    // Reject unrelated/malformed markers too; this operation has exactly two possible identities.
    need(
      existing.length === 0 || existing.length === 2,
      "PARTIAL_OR_FOREIGN_CLOSURE"
    );
    if (existing.length) {
      for (const spec of NOOP_SCOPE) {
        const record = existing.find(x => x.entityId === key(spec.eventId));
        need(
          record &&
            record.entity === "asaasWebhookInbox" &&
            record.actorType === "admin",
          "CLOSURE_CORRUPT"
        );
        const m = parse(record.metadata);
        need(
          m.decisionDigest === digest &&
            m.decision &&
            hash(m.decision) === digest &&
            m.holdId === spec.holdId &&
            m.processingAllowed === false &&
            m.holdRetained === true &&
            m.notificationAllowed === false &&
            m.actorUserId === record.actorUserId &&
            m.eventId === spec.eventId &&
            m.event === spec.event &&
            m.orderId === 13 &&
            m.paymentId === PAYMENT13 &&
            m.classification === "ALREADY_RECONCILED_NOOP",
          "CLOSURE_CONFLICT"
        );
      }
    }
    if (!options.dryRun)
      need(options.expectedDigest === digest, "DRY_RUN_DIGEST_REQUIRED");
    if (!options.dryRun && !existing.length) {
      const reviewedAt = new Date().toISOString();
      for (const spec of NOOP_SCOPE) {
        const metadata = {
          version: 1,
          classification: "ALREADY_RECONCILED_NOOP",
          holdId: spec.holdId,
          eventId: spec.eventId,
          paymentId: PAYMENT13,
          orderId: 13,
          event: spec.event,
          actorUserId: actor.id,
          reviewedAt,
          providerObservedAt: provider.observedAt,
          decisionDigest: digest,
          decision,
          processingAllowed: false,
          holdRetained: true,
          notificationAllowed: false,
        };
        await c.execute(
          "INSERT INTO auditLogs(actorUserId,actorType,action,entity,entityId,metadata) VALUES(?,'admin',?,'asaasWebhookInbox',?,?)",
          [actor.id, NOOP_ACTION, key(spec.eventId), JSON.stringify(metadata)]
        );
      }
    }
    need(
      hash(await protectedState(c)) === decision.protectedStateHash,
      "STATE_CHANGED_BEFORE_COMMIT"
    );
    const finalSession = await sdk.verifySession(sessionToken);
    need(
      finalSession?.openId === session.openId &&
        finalSession.sessionVersion === session.sessionVersion,
      "SESSION_EXPIRED_BEFORE_COMMIT"
    );
    need(
      Date.now() - Date.parse(provider.observedAt) >= -5000 &&
        Date.now() - Date.parse(provider.observedAt) <= 120000,
      "PROVIDER_EVIDENCE_EXPIRED"
    );
    assertRecoveryFence(fence);
    need(process.env.EMAIL_MODE === "restricted", "EMAIL_RESTRICTED_REQUIRED");
    if (options.dryRun) await c.rollback();
    else await c.commit();
    return {
      status: options.dryRun
        ? "DRY_RUN"
        : existing.length
          ? "ALREADY_REVIEWED"
          : "REVIEW_CLOSED",
      decisionDigest: digest,
      actorUserId: existing.length ? existing[0].actorUserId : actor.id,
      holdIds: [74, 76],
      classification: "ALREADY_RECONCILED_NOOP",
      processingAllowed: false,
      holdRetained: true,
      notificationAllowed: false,
      decision,
    };
  } catch (error) {
    await c.rollback();
    throw error;
  }
}
