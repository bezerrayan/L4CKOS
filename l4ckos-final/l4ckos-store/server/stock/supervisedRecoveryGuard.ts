import { createHash } from "node:crypto";
import { isStrongStockPaymentReference } from "./stockPaymentReference";

/**
 * SUPERVISED RECOVERY GUARD V2 (assessment only).
 *
 * Decides whether the collected evidence would be SUFFICIENT for a human-approved recovery of a STOCK attempt whose paid event was
 * held as PAYMENT_WITHOUT_CORRELATION. It is a pure function: it reads nothing, writes nothing, calls no provider and is imported by
 * no route, worker or webhook path. There is deliberately NO function here (or anywhere) that marks an order paid, consumes stock,
 * cancels or refunds a charge. A positive assessment is not a confirmation.
 *
 * Trust model (V2):
 *  - `RecoveryEvidence` must be assembled ONLY by a server-side collector from (a) an authoritative provider read performed outside any
 *    lock-holding transaction and (b) the local database. Nothing in it is taken from a client.
 *  - Operator identity and authority are NEVER part of the evidence. They come from `TrustedRecoveryContext`, built by the server from
 *    the authenticated session; `isConfiguredAdmin` is the server's own authority check. A role/userId smuggled inside the evidence is
 *    ignored (and does not even enter the hash as a claim).
 *  - Two distinct, authorized administrators are required (requester and approver: four eyes).
 *  - Provider fields that the Asaas read does not demonstrably return (customer, dateCreated, account) are typed as nullable and an
 *    absent value is `insufficient_evidence`; the guard never presumes them.
 */
export type RecoveryAttemptEvidence = {
  attemptId: string; ownerUserId: number; orderId: number;
  status: "reserved" | "paid" | "released";
  providerState: "not_started" | "creating" | "ambiguous" | "created" | "definitive_failure";
  paymentId: string | null;
  amountCents: number; currency: string;
  createdAt: string; providerAttemptStartedAt: string | null;
  reservationExpiresAt: string | null;
  /** Strong reference persisted BEFORE the provider call (null for historical attempts). */
  paymentReference: string | null;
  /** Durable provider-customer link, recorded from the charge-creation response only (usually absent when persistence failed). */
  expectedCustomerId: string | null;
  /** Digest of the buyer identity verified for the OWNER (never the raw document). */
  expectedBuyerIdentityDigest: string;
  expectedProviderAccount: string;
};
export type RecoveryProviderPayment = {
  id: string;
  /** NOT guaranteed by the typed provider read today; null/absent means "unavailable", never "matches". */
  customerId: string | null;
  externalReference: string; valueCents: number; currency: string; status: string;
  dateCreated: string | null; paidAt: string | null; providerAccount: string | null; deleted?: boolean;
};
export type RecoveryEvidence = {
  attempt: RecoveryAttemptEvidence;
  payment: RecoveryProviderPayment;
  providerReadAt: string;
  buyerIdentityDigestFromCurrentCustomer: string;
  paymentMappedToOtherAttempt: boolean;
  localProjection: { orderOwnerUserId: number; orderStatus: "pending" | "processing" | "paid" | "shipped" | "delivered" | "cancelled"; reservation: "active" | "released" | "consumed" | "none"; amountCents: number };
  event: { eventId: string; payloadHash: string; paymentId: string; externalReference: string; amountCents: number; type: string; persisted: boolean };
  divergence: { open: boolean; kind: string; eventId: string };
  /** Free-form approval metadata only. Identity/authority is NOT here. */
  approval: { approvalReference: string; justification: string };
};

/** Built by the server from the authenticated session. `isConfiguredAdmin` is the server's own authorization check. */
export type TrustedRecoveryContext = {
  requestedByUserId: number;
  approvedByUserId: number | null;
  isConfiguredAdmin(userId: number): boolean;
};

export type RecoveryAssessment = {
  decision: "eligible_for_supervised_review" | "insufficient_evidence" | "conflict";
  reasons: string[];
  /** Always false: this guard never performs, schedules or authorizes a financial action. */
  automaticAction: false;
  evidenceHash: string;
  /** Deterministic idempotency key for a FUTURE authorized procedure (attempt + payment + full proof). */
  operationKey: string;
};

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Canonical JSON: sorted keys, no undefined; stable across property order. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value === undefined ? null : value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

const HASH_VERSION = "stock-p5-recovery-evidence-v2";

/** Covers EVERY field that participates in the decision, plus the server-verified identities of requester and approver. */
export function recoveryEvidenceHash(e: RecoveryEvidence, ctx: Pick<TrustedRecoveryContext, "requestedByUserId" | "approvedByUserId">): string {
  const a = e.attempt, p = e.payment, ev = e.event, l = e.localProjection, d = e.divergence;
  return sha256(canonical({
    v: HASH_VERSION,
    attempt: { attemptId: a.attemptId, ownerUserId: a.ownerUserId, orderId: a.orderId, status: a.status, providerState: a.providerState, paymentId: a.paymentId,
      amountCents: a.amountCents, currency: a.currency, createdAt: a.createdAt, providerAttemptStartedAt: a.providerAttemptStartedAt,
      reservationExpiresAt: a.reservationExpiresAt, paymentReference: a.paymentReference, expectedCustomerId: a.expectedCustomerId,
      expectedBuyerIdentityDigest: a.expectedBuyerIdentityDigest, expectedProviderAccount: a.expectedProviderAccount },
    payment: { id: p.id, customerId: p.customerId, externalReference: p.externalReference, valueCents: p.valueCents, currency: p.currency, status: p.status,
      dateCreated: p.dateCreated, paidAt: p.paidAt, providerAccount: p.providerAccount, deleted: p.deleted === true },
    providerReadAt: e.providerReadAt, buyerDigestNow: e.buyerIdentityDigestFromCurrentCustomer, mappedElsewhere: e.paymentMappedToOtherAttempt,
    local: { orderOwnerUserId: l.orderOwnerUserId, orderStatus: l.orderStatus, reservation: l.reservation, amountCents: l.amountCents },
    event: { eventId: ev.eventId, payloadHash: ev.payloadHash, paymentId: ev.paymentId, externalReference: ev.externalReference, amountCents: ev.amountCents, type: ev.type, persisted: ev.persisted },
    divergence: { open: d.open, kind: d.kind, eventId: d.eventId },
    approval: { approvalReference: e.approval.approvalReference, justificationDigest: sha256(e.approval.justification.trim()) },
    requestedByUserId: ctx.requestedByUserId, approvedByUserId: ctx.approvedByUserId,
  }));
}
export const recoveryOperationKey = (e: RecoveryEvidence, ctx: Pick<TrustedRecoveryContext, "requestedByUserId" | "approvedByUserId">) =>
  sha256(`stock-p5-recovery-v2\0${e.attempt.attemptId}\0${e.payment.id}\0${recoveryEvidenceHash(e, ctx)}`);

const CONFLICT_REASONS = new Set([
  "payment_already_bound_elsewhere", "reference_belongs_to_other_attempt", "buyer_customer_binding_mismatch", "event_payment_identity_mismatch",
  "owner_mismatch", "provider_account_mismatch", "payment_deleted_at_provider",
]);
const validUserId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

export function assessRecoveryEvidence(e: RecoveryEvidence, ctx: TrustedRecoveryContext): RecoveryAssessment {
  const reasons: string[] = [];
  const a = e.attempt, p = e.payment, ev = e.event, local = e.localProjection;

  // --- identity of the attempt / reference -------------------------------------------------------------------------------
  if (!a.paymentReference || !isStrongStockPaymentReference(a.paymentReference)) reasons.push("attempt_has_no_strong_reference");
  if (!isStrongStockPaymentReference(p.externalReference)) reasons.push("reference_not_attempt_bound"); // numeric/legacy/foreign
  else if (a.paymentReference && p.externalReference !== a.paymentReference) reasons.push("reference_belongs_to_other_attempt");
  if (ev.externalReference !== p.externalReference) reasons.push("event_reference_mismatch");
  if (a.status !== "reserved" || a.providerState !== "ambiguous" || a.paymentId !== null) reasons.push("attempt_state_not_recoverable");
  if (e.paymentMappedToOtherAttempt) reasons.push("payment_already_bound_elsewhere");
  if (!p.id.trim() || p.id !== ev.paymentId) reasons.push("event_payment_identity_mismatch");
  if (local.orderOwnerUserId !== a.ownerUserId) reasons.push("owner_mismatch");
  if (local.orderStatus !== "pending" || local.reservation !== "active" || local.amountCents !== a.amountCents) reasons.push("local_projection_not_recoverable");

  // --- buyer / customer (never presumed) ---------------------------------------------------------------------------------
  if (!a.expectedBuyerIdentityDigest || e.buyerIdentityDigestFromCurrentCustomer !== a.expectedBuyerIdentityDigest ||
      (p.customerId !== null && a.expectedCustomerId !== null && p.customerId !== a.expectedCustomerId)) reasons.push("buyer_customer_binding_mismatch");
  if (p.customerId === null || !p.customerId.trim()) reasons.push("provider_customer_unavailable");

  // --- money -------------------------------------------------------------------------------------------------------------
  if (p.valueCents !== a.amountCents || ev.amountCents !== a.amountCents) reasons.push("amount_mismatch");
  if (p.currency !== "BRL" || a.currency !== "BRL") reasons.push("currency_mismatch");

  // --- provider account / environment ------------------------------------------------------------------------------------
  if (p.providerAccount === null) reasons.push("provider_account_unavailable");
  else if (!a.expectedProviderAccount || p.providerAccount !== a.expectedProviderAccount) reasons.push("provider_account_mismatch");

  // --- state and time ----------------------------------------------------------------------------------------------------
  if (p.deleted === true) reasons.push("payment_deleted_at_provider");
  if (!["RECEIVED", "CONFIRMED"].includes(p.status) || !["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED"].includes(ev.type)) reasons.push("payment_not_authoritatively_paid");
  const created = p.dateCreated ? Date.parse(p.dateCreated) : NaN, attemptCreated = Date.parse(a.createdAt), observed = Date.parse(e.providerReadAt);
  const started = a.providerAttemptStartedAt ? Date.parse(a.providerAttemptStartedAt) : NaN;
  if (![created, attemptCreated, started, observed].every(Number.isFinite) || created < attemptCreated || created < started || created > observed)
    reasons.push("provider_creation_time_not_proven");
  const paidAt = p.paidAt ? Date.parse(p.paidAt) : NaN;
  if (!Number.isFinite(paidAt) || paidAt < created || paidAt > observed) reasons.push("provider_receipt_time_not_proven");

  // --- preserved evidence ------------------------------------------------------------------------------------------------
  if (!ev.eventId.trim() || !/^[a-f0-9]{64}$/.test(ev.payloadHash) || !ev.persisted) reasons.push("event_evidence_missing");
  if (!e.divergence.open || e.divergence.kind !== "PAYMENT_WITHOUT_CORRELATION" || e.divergence.eventId !== ev.eventId) reasons.push("divergence_not_preserved");

  // --- approval: identities come ONLY from the server context --------------------------------------------------------------
  if (!validUserId(ctx.requestedByUserId) || !ctx.isConfiguredAdmin(ctx.requestedByUserId)) reasons.push("requester_not_authorized");
  if (ctx.approvedByUserId === null) reasons.push("approver_missing");
  else if (!validUserId(ctx.approvedByUserId) || !ctx.isConfiguredAdmin(ctx.approvedByUserId)) reasons.push("approver_not_authorized");
  else if (ctx.approvedByUserId === ctx.requestedByUserId) reasons.push("approver_same_as_requester");
  if (!/^[A-Z0-9_-]{6,80}$/.test(e.approval.approvalReference) || e.approval.justification.trim().length < 10) reasons.push("approval_incomplete");

  const unique = [...new Set(reasons)];
  const decision = unique.length === 0 ? "eligible_for_supervised_review"
    : unique.some(r => CONFLICT_REASONS.has(r)) ? "conflict" : "insufficient_evidence";
  return { decision, reasons: unique, automaticAction: false, evidenceHash: recoveryEvidenceHash(e, ctx), operationKey: recoveryOperationKey(e, ctx) };
}
