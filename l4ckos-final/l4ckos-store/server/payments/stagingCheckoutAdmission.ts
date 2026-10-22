/** Staging-only grants. Original holds are immutable; releases add exact event audit records. */
import { assertSelectiveFinancialBuyer } from "./stagingFinancialBuyer";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { canonical } from "../../database/schema/fingerprint";
import { parseAsaasOrderReference } from "../../shared/asaasWebhookSemantics";
import {
  captureRecoveryFence,
  assertRecoveryFence,
  RECOVERY_HOLD_ACTION,
} from "./webhookRecovery";
import { getAsaasPayment } from "../services/asaasService";
import { ENV } from "../_core/env";
import { assertRestrictedEmailRecipientsAllowed } from "../services/email/recipientPolicy.js";

export const CANDIDATE = "staging.checkout_candidate.v1";
export const GRANT = "staging.checkout_admission.v1";
export const ADMIT = "staging.checkout_event_admitted.v1";
export const BLOCK = "staging.checkout_event_blocked.v1";
export const RELEASE = "staging.checkout_event_released.v1";
export const POSITIVE_EVENTS = [
  "PAYMENT_CREATED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_RECEIVED",
] as const;
export const CARD_OBSERVATION_EVENTS = [
  "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED", "PAYMENT_AWAITING_RISK_ANALYSIS",
  "PAYMENT_REPROVED_BY_RISK_ANALYSIS",
] as const;
export const ELIGIBLE_EVENTS = [...POSITIVE_EVENTS, ...CARD_OBSERVATION_EVENTS] as const;
export const BOLETO_REVIEW = "BOLETO_RESERVATION_REVIEW_REQUIRED";
export function selectedMethodPolicy(method: string) {
  const s = scope.getStore();
  return selectiveEffectsAllowed() && s?.policyVersion === 2 && s.method === method;
}
export function selectedBoletoReview(orderId: number) {
  return selectiveOrderAllowed(orderId) && selectedMethodPolicy("BOLETO");
}
const HISTORICAL_IDS = new Set([
  "evt_05b708f961d739ea7eba7e4db318f621&21683762",
  "evt_d26e303b238e509335ac9ba210e51b0f&21684231",
]);
export type Executor = { execute: (q: SQL) => Promise<unknown> };
export type InboxRecord = {
  eventId: string;
  payloadHash: string;
  payload: string | null;
};
type Row = Record<string, any>;
export const admissionHash = (x: unknown) =>
  createHash("sha256").update(canonical(x)).digest("hex");
export const eventKey = (id: string) =>
  createHash("sha256").update(id).digest("hex");
export const recipientHash = (email: string) =>
  eventKey(email.trim().toLowerCase());
export const admissionRows = async (db: Executor, q: SQL) =>
  ((await db.execute(q)) as [Row[]])[0];
export const json = (value: any) =>
  typeof value === "string" ? JSON.parse(value) : value;
export class AdmissionDenied extends Error {}
export function requireAdmission(ok: unknown): asserts ok {
  if (!ok) throw new AdmissionDenied("SELECTIVE_ADMISSION_REQUIRED");
}
const scope = new AsyncLocalStorage<{
  orderId: number;
  eventId: string;
  paymentId: string;
  expiresAt: number;
  method: string;
  policyVersion: number;
}>();
export function assertSelectedLedgerBinding(input: {
  eventId: string;
  orderId?: number | null;
  paymentId?: string | null;
}) {
  if (!captureRecoveryFence().reviewOnly) return;
  const s = scope.getStore();
  requireAdmission(
    s &&
      selectiveEffectsAllowed() &&
      input.eventId === s.eventId &&
      input.orderId === s.orderId &&
      input.paymentId === s.paymentId
  );
}
export function selectiveEffectsAllowed() {
  const s = scope.getStore();
  return !!s && Date.now() < s.expiresAt;
}
export function selectiveEventAllowed(eventId: string) {
  return selectiveEffectsAllowed() && scope.getStore()!.eventId === eventId;
}
export function selectiveOrderAllowed(orderId: number) {
  return selectiveEffectsAllowed() && scope.getStore()!.orderId === orderId;
}
export function assertSelectiveStage() {
  requireAdmission(
    captureRecoveryFence().reviewOnly &&
      process.env.EMAIL_MODE === "restricted" &&
      process.env.ASAAS_API_URL?.replace(/\/+$/, "") ===
        "https://api-sandbox.asaas.com/v3"
  );
}
export async function auditRecord(
  db: Executor,
  action: string,
  entity: string,
  identity: string,
  lock = true
) {
  const records = await admissionRows(
    db,
    sql`SELECT * FROM auditLogs WHERE action=${action} AND entity=${entity} AND entityId=${identity} ${lock ? sql`FOR UPDATE` : sql``}`
  );
  requireAdmission(records.length <= 1);
  return records[0] ?? null;
}
export async function insertAdmissionAudit(
  db: Executor,
  action: string,
  entity: string,
  identity: string,
  metadata: unknown,
  actor: number | null = null
) {
  await db.execute(sql`INSERT INTO auditLogs(actorUserId,actorType,action,entity,entityId,metadata)
 VALUES(${actor},${actor === null ? "system" : "admin"},${action},${entity},${identity},${JSON.stringify(metadata)})`);
}
/** Only called with the newly INSERTed order inside the checkout creation transaction. */
export function candidateMetadata(input: {
  orderId: number;
  userId: number;
  attempt: string;
  fingerprint: string;
  method: string;
}) {
  assertSelectiveStage();
  requireAdmission(input.orderId > 13);
  return {
    version: 1,
    ...input,
    stageProject: process.env.RAILWAY_PROJECT_ID,
    financialProcessingAllowed: false,
  };
}
export async function loadSelectedGrant(
  db: Executor,
  orderId: number,
  lock = true
) {
  requireAdmission(Number.isSafeInteger(orderId) && orderId > 13); // Explicit permanent floor for known historical orders.
  const [order] = await admissionRows(
    db,
    sql`SELECT * FROM orders WHERE id=${orderId} ${lock ? sql`FOR UPDATE` : sql``}`
  );
  requireAdmission(order);
  const grant = await auditRecord(db, GRANT, "order", String(orderId), lock);
  requireAdmission(grant);
  assertSelectiveStage();
  const g = json(grant.metadata);
  requireAdmission(
    g.version === 1 &&
      g.orderId === orderId &&
      g.actorUserId === grant.actorUserId &&
      grant.actorType === "admin"
  );
  requireAdmission(g.decisionDigest === admissionHash(g.decision));
  const d = g.decision;
  requireAdmission(
    d.request.orderId === orderId &&
      Date.parse(d.request.expiresAt) > Date.now()
  );
  const [actor] = await admissionRows(
    db,
    sql`SELECT id,role,email,openId,isBlocked FROM users WHERE id=${grant.actorUserId} ${lock ? sql`FOR UPDATE` : sql``}`
  );
  requireAdmission(
    actor &&
      actor.role === "admin" &&
      actor.isBlocked === 0 &&
      ((!!ENV.ownerOpenId && actor.openId === ENV.ownerOpenId) ||
        ENV.adminEmails.includes(
          String(actor.email || "")
            .trim()
            .toLowerCase()
        ))
  );
  const candidate = await auditRecord(
    db,
    CANDIDATE,
    "order",
    String(orderId),
    lock
  );
  requireAdmission(candidate);
  const c = json(candidate.metadata);
  requireAdmission(
    c.version === 1 &&
      c.orderId === orderId &&
      c.userId === order.userId &&
      c.attempt === order.checkoutAttemptId &&
      c.fingerprint === order.checkoutFingerprint &&
      c.method === d.request.method &&
      d.candidateHash === admissionHash(c) &&
      c.stageProject === "2bb90c8e-eb65-43ee-826b-f93750f0499c" &&
      candidate.id < grant.id
  );
  const payments = await admissionRows(
    db,
    sql`SELECT * FROM payments WHERE orderId=${orderId} ${lock ? sql`FOR UPDATE` : sql``}`
  );
  requireAdmission(payments.length === 1);
  const payment = payments[0];
  const lateBoleto = d.policyVersion === 2 && d.request.method === "BOLETO" &&
    payment.financialIssue === BOLETO_REVIEW;

  requireAdmission(
    payment.id === d.paymentRowId &&
      payment.provider === "asaas" &&
      payment.providerPaymentId === d.request.paymentId &&
      payment.externalReference === String(orderId) &&
      Number(payment.amount) === Number(order.totalPrice) &&
      Number(payment.amount) === d.amount &&
      payment.creationStatus === "created" &&
      payment.statusSource === "provider" &&
      (payment.financialIssue === null || lateBoleto) &&
      ["pending", "confirmed", "received"].includes(payment.status) &&
      Number(payment.paidAmount) ===
        (payment.status === "pending" ? 0 : Number(payment.amount)) &&
      (payment.status === "pending" || lateBoleto
        ? order.paymentStatus === "unconfirmed" &&
          order.paymentConfirmationSource === null
        : order.paymentStatus === "confirmed" &&
          order.paymentConfirmationSource === "asaas_webhook") &&
      Number(payment.refundedAmount) === 0 &&
      payment.billingType ===
        (d.request.method === "CARD" ? (d.policyVersion === 2 ? "CREDIT_CARD" : "UNDEFINED") : d.request.method)
  );
  requireAdmission(
    order.status !== "cancelled" && order.paymentConfirmationSource !== "manual"
  );
  const [user] = await admissionRows(
    db,
    sql`SELECT email FROM users WHERE id=${order.userId} ${lock ? sql`FOR UPDATE` : sql``}`
  );
  requireAdmission(
    user?.email && recipientHash(user.email) === d.request.recipientHash
  );
  assertSelectiveFinancialBuyer(user.email, d.request.notifications, d.request.method);
  // Unknown/reversal holds on this exact order block financial effects and notifications.
  const holds = await admissionRows(
    db,
    sql`SELECT metadata FROM auditLogs WHERE action=${RECOVERY_HOLD_ACTION}
 AND entity='asaasWebhookInbox' AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.orderId'))=${String(orderId)}`
  );
  requireAdmission(
    holds.every(h => {
      const m = json(h.metadata);
      return (
        m.paymentId === d.request.paymentId &&
        (POSITIVE_EVENTS.includes(m.eventType) ||
          (d.policyVersion === 2 && d.request.method === "CARD" &&
           d.request.events.includes(m.eventType) && CARD_OBSERVATION_EVENTS.includes(m.eventType)))
      );
    })
  );
  const cardReviewHeld = holds.some(h => ["PAYMENT_CREDIT_CARD_CAPTURE_REFUSED", "PAYMENT_REPROVED_BY_RISK_ANALYSIS"].includes(json(h.metadata).eventType));
  return { grant, g, d, order, payment, email: user.email, cardReviewHeld };
}
export async function verifySelectedProvider(d: any, event?: string) {
  let p: Awaited<ReturnType<typeof getAsaasPayment>>;
  try {
    p = await getAsaasPayment(d.request.paymentId);
  } catch {
    throw new AdmissionDenied("SELECTIVE_PROVIDER_READ_REQUIRED");
  }
  requireAdmission(
    p.id === d.request.paymentId &&
      parseAsaasOrderReference(p.externalReference) === d.request.orderId &&
      p.value === d.amount / 100 &&
      p.deleted === false &&
      (p.refunds == null ||
        (Array.isArray(p.refunds) && p.refunds.length === 0)) &&
      !p.chargeback &&
      !p.chargebackStatus
  );
  const billing =
    d.request.method === "CARD"
      ? d.policyVersion !== 2 && (!event || event === "PAYMENT_CREATED")
        ? ["UNDEFINED", "CREDIT_CARD"]
        : ["CREDIT_CARD"]
      : [d.request.method];
  requireAdmission(billing.includes(String(p.billingType)));
  const cardObservation = d.policyVersion === 2 && d.request.method === "CARD" &&
    (CARD_OBSERVATION_EVENTS.includes(event as any) || !event);
  requireAdmission(
    cardObservation
      ? ["PENDING", "AWAITING_RISK_ANALYSIS", "RISK_ANALYSIS", "REPROVED_BY_RISK_ANALYSIS", "CONFIRMED", "RECEIVED"].includes(String(p.status))
      : event === "PAYMENT_CREATED"
      ? ["PENDING", "CONFIRMED", "RECEIVED"].includes(String(p.status))
      : event
        ? ["CONFIRMED", "RECEIVED"].includes(String(p.status))
        : ["PENDING", "CONFIRMED", "RECEIVED"].includes(String(p.status))
  );
  return p;
}
export function checkedEnvelope(record: InboxRecord) {
  requireAdmission(record.payload && !HISTORICAL_IDS.has(record.eventId));
  const p = json(record.payload),
    body = { ...p };
  delete body.sourcePayloadHash;
  requireAdmission(
    p.id === record.eventId && admissionHash(body) === record.payloadHash
  );
  return p;
}
export async function validateSelectedEvent(db: Executor, record: InboxRecord) {
  const p = checkedEnvelope(record),
    orderId = parseAsaasOrderReference(
      p.payment?.externalReference ?? p.externalReference
    );
  requireAdmission(
    orderId && ELIGIBLE_EVENTS.includes(p.event) && p.payment?.id
  );
  const selected = await loadSelectedGrant(db, orderId);
  const cardObservation = CARD_OBSERVATION_EVENTS.includes(p.event);
  requireAdmission(!cardObservation || (selected.d.policyVersion === 2 && selected.d.request.method === "CARD"));
  // A terminal adverse observation never authorizes a subsequent financial transition.
  requireAdmission(cardObservation || !selected.cardReviewHeld);
  requireAdmission(
    selected.d.request.events.includes(p.event) &&
      p.payment.id === selected.d.request.paymentId &&
      Number(p.payment.value) === selected.d.amount / 100 &&
      (!p.payment.currency || p.payment.currency === "BRL") &&
      (!p.currency || p.currency === "BRL")
  );
  requireAdmission(
    cardObservation
      ? ["PENDING", "AWAITING_RISK_ANALYSIS", "RISK_ANALYSIS", "REPROVED_BY_RISK_ANALYSIS", "CONFIRMED", "RECEIVED"].includes(p.payment.status)
      : p.event === "PAYMENT_CREATED"
      ? p.payment.status === "PENDING"
      : ["CONFIRMED", "RECEIVED"].includes(p.payment.status)
  );
  await verifySelectedProvider(selected.d, p.event);
  return { p, ...selected };
}
/** First receipt only. A grant never releases an existing hold or an unmarked worker backlog. */
export async function admitFirstReceipt(db: Executor, record: InboxRecord) {
  try {
    if (
      await auditRecord(
        db,
        RECOVERY_HOLD_ACTION,
        "asaasWebhookInbox",
        eventKey(record.eventId)
      )
    )
      return false;
    const prior = await auditRecord(
      db,
      ADMIT,
      "asaasWebhookInbox",
      eventKey(record.eventId)
    );
    if (prior) {
      requireAdmission(json(prior.metadata).payloadHash === record.payloadHash);
      return true;
    }
    const s = await validateSelectedEvent(db, record);
    await insertAdmissionAudit(
      db,
      ADMIT,
      "asaasWebhookInbox",
      eventKey(record.eventId),
      {
        version: 1,
        eventId: record.eventId,
        payloadHash: record.payloadHash,
        grantId: s.grant.id,
        orderId: s.order.id,
        paymentId: s.payment.providerPaymentId,
      }
    );
    return true;
  } catch (e) {
    if (e instanceof AdmissionDenied) return false;
    throw e;
  }
}
export async function runSelectedEvent<T>(
  db: Executor,
  record: InboxRecord,
  action: () => Promise<T>
) {
  let s: Awaited<ReturnType<typeof validateSelectedEvent>>;
  try {
    requireAdmission(
      !(await auditRecord(
        db,
        BLOCK,
        "asaasWebhookInbox",
        eventKey(record.eventId)
      ))
    );
    const held = await auditRecord(
      db,
      RECOVERY_HOLD_ACTION,
      "asaasWebhookInbox",
      eventKey(record.eventId)
    );
    const marker = await auditRecord(
      db,
      held ? RELEASE : ADMIT,
      "asaasWebhookInbox",
      eventKey(record.eventId)
    );
    requireAdmission(marker);
    const m = json(marker.metadata);
    requireAdmission(
      m.eventId === record.eventId && m.payloadHash === record.payloadHash
    );
    if (held)
      requireAdmission(
        m.holdId === held.id &&
          m.holdHash === admissionHash(json(held.metadata))
      );
    s = await validateSelectedEvent(db, record);
    requireAdmission(m.grantId === s.grant.id);
  } catch (e) {
    if (e instanceof AdmissionDenied) return { admitted: false } as const;
    throw e;
  }
  const fence = captureRecoveryFence(),
    expiresAt = Date.parse(s.d.request.expiresAt);
  const value = await scope.run(
    {
      orderId: s.order.id,
      eventId: record.eventId,
      paymentId: s.payment.providerPaymentId,
      expiresAt,
      method: s.d.request.method,
      policyVersion: s.d.policyVersion ?? 1,
    },
    async () => {
      const value = await action();
      requireAdmission(Date.now() < expiresAt);
      assertRecoveryFence(fence);
      return value;
    }
  );
  return { admitted: true, value } as const;
}
export async function assertSelectedNotification(
  db: Executor,
  orderId: number,
  email?: string
) {
  const s = await loadSelectedGrant(db, orderId, false);
  requireAdmission(s.d.request.notifications === true);
  if (email)
    requireAdmission(recipientHash(email) === s.d.request.recipientHash);
  return s;
}
