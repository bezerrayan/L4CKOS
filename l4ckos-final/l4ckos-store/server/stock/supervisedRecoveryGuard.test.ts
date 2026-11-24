import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assessRecoveryEvidence, recoveryEvidenceHash, type RecoveryEvidence, type TrustedRecoveryContext } from "./supervisedRecoveryGuard";
import { generateStockPaymentReference, parseStockPaymentReference } from "./stockPaymentReference";
import { buildReconciliationAlert } from "../payments/reconciliationAlerts";

const REF = "L4CKOS-STOCK-ATTEMPT:v1:" + "a".repeat(32);
const base = (): RecoveryEvidence => ({
  attempt: { attemptId: "att-1", ownerUserId: 7, orderId: 41, status: "reserved", providerState: "ambiguous", paymentId: null, amountCents: 12900, currency: "BRL",
    createdAt: "2026-11-15T10:00:00.000Z", providerAttemptStartedAt: "2026-11-15T10:00:03.000Z", paymentReference: REF, expectedCustomerId: "cus_1",
    expectedBuyerIdentityDigest: "d".repeat(64), expectedProviderAccount: "acct-1", reservationExpiresAt: "2026-11-15T10:30:00.000Z" },
  payment: { id: "pay-1", customerId: "cus_1", externalReference: REF, valueCents: 12900, currency: "BRL", status: "RECEIVED",
    dateCreated: "2026-11-15T10:00:04.000Z", paidAt: "2026-11-15T10:01:00.000Z", providerAccount: "acct-1" },
  providerReadAt: "2026-11-15T10:02:00.000Z", buyerIdentityDigestFromCurrentCustomer: "d".repeat(64), paymentMappedToOtherAttempt: false,
  localProjection: { orderOwnerUserId: 7, orderStatus: "pending", reservation: "active", amountCents: 12900 },
  event: { eventId: "evt-1", payloadHash: "b".repeat(64), paymentId: "pay-1", externalReference: REF, amountCents: 12900, type: "PAYMENT_RECEIVED", persisted: true },
  divergence: { open: true, kind: "PAYMENT_WITHOUT_CORRELATION", eventId: "evt-1" },
  approval: { approvalReference: "FIN-2026-0001", justification: "Conciliação aprovada pelo financeiro." },
});
const admins = new Set([1, 2]);
const ctx = (over: Partial<TrustedRecoveryContext> = {}): TrustedRecoveryContext => ({ requestedByUserId: 1, approvedByUserId: 2, isConfiguredAdmin: id => admins.has(id), ...over });
const run = (f: (e: RecoveryEvidence) => void = () => {}, c: TrustedRecoveryContext = ctx()) => { const e = base(); f(e); return assessRecoveryEvidence(e, c); };

describe("strong STOCK payment reference", () => {
  it("is server-random, well-formed, unique and exact-parsed", () => {
    const refs = new Set(Array.from({ length: 2000 }, () => generateStockPaymentReference()));
    expect(refs.size).toBe(2000);
    for (const r of refs) { expect(parseStockPaymentReference(r)).toEqual({ kind: "strong", reference: r, paymentMethod: "PIX" }); expect(r.length).toBeLessThan(191); }
  });
  it("binds hosted card references to CARD while preserving the legacy PIX version", () => {
    const reference = generateStockPaymentReference(undefined, "CARD");
    expect(parseStockPaymentReference(reference)).toEqual({ kind: "strong", reference, paymentMethod: "CARD" });
    expect(reference).toMatch(/^L4CKOS-STOCK-ATTEMPT:v2:CARD:/);
    expect(reference.length).toBeLessThan(191);
  });
  it.each(["12", "1"])("keeps the legacy numeric reference parseable as legacy only (%s)", v => expect(parseStockPaymentReference(v)).toEqual({ kind: "legacy-numeric", orderId: v }));
  it.each([" L4CKOS-STOCK-ATTEMPT:v1:" + "a".repeat(32), "L4CKOS-STOCK-ATTEMPT:v1:" + "a".repeat(31), "L4CKOS-STOCK-ATTEMPT:v2:" + "a".repeat(32),
    "L4CKOS-STOCK-ATTEMPT:v2:" + "a".repeat(32), "L4CKOS-STOCK-ATTEMPT:v2:PIX:" + "a".repeat(32), "l4ckos-stock-attempt:v1:" + "a".repeat(32), "L4CKOS-STOCK-ATTEMPT:v1:" + "a".repeat(32) + "x", "L4CKOS-ORDER-12", "012", "", null, 12, ["12"]])("rejects %j", v =>
    expect(parseStockPaymentReference(v).kind).toBe("invalid"));
});

describe("reconciliation alert model", () => {
  it("is deterministic per logical divergence, sanitized and bounded", () => {
    const a = buildReconciliationAlert({ kind: "PAYMENT_WITHOUT_CORRELATION", subject: { attemptId: "a1", orderId: 5, paymentId: "p1" }, providerEventId: "e1", orderId: 5 });
    const b = buildReconciliationAlert({ kind: "PAYMENT_WITHOUT_CORRELATION", subject: { attemptId: "a1", orderId: 5, paymentId: "p1" }, providerEventId: "e2", orderId: 5 });
    const c = buildReconciliationAlert({ kind: "PAYMENT_WITHOUT_CORRELATION", subject: { attemptId: "a1", orderId: 5, paymentId: "p2" }, orderId: 5 });
    expect(a.dedupeKey).toBe(b.dedupeKey); expect(a.dedupeKey).not.toBe(c.dedupeKey);
    const p = JSON.parse(a.payload);
    expect(p).toMatchObject({ financialMutation: false, stockMutation: false, externalNotification: false });
    expect(Object.keys(p)).not.toEqual(expect.arrayContaining(["email", "cpf", "name", "phone", "address"]));
  });
});

describe("supervised recovery guard V2 (assessment only; identities come from the SERVER context, never from the evidence)", () => {
  it("is eligible only when every binding proves the same attempt, buyer, money, account, time and preserved evidence, with two distinct server-verified admins", () => {
    expect(run()).toMatchObject({ decision: "eligible_for_supervised_review", reasons: [], automaticAction: false });
  });
  it.each<[string, (e: RecoveryEvidence) => void, string, "insufficient_evidence" | "conflict"]>([
    ["numeric reference", e => { e.payment.externalReference = "41"; e.event.externalReference = "41"; }, "reference_not_attempt_bound", "insufficient_evidence"],
    ["attempt without strong reference (historical)", e => { e.attempt.paymentReference = null; }, "attempt_has_no_strong_reference", "insufficient_evidence"],
    ["other attempt's strong reference", e => { const o = "L4CKOS-STOCK-ATTEMPT:v1:" + "b".repeat(32); e.payment.externalReference = o; e.event.externalReference = o; }, "reference_belongs_to_other_attempt", "conflict"],
    ["payment bound to another attempt", e => { e.paymentMappedToOtherAttempt = true; }, "payment_already_bound_elsewhere", "conflict"],
    ["different customer", e => { e.payment.customerId = "cus_other"; }, "buyer_customer_binding_mismatch", "conflict"],
    ["different buyer identity digest", e => { e.buyerIdentityDigestFromCurrentCustomer = "e".repeat(64); }, "buyer_customer_binding_mismatch", "conflict"],
    ["provider customer NOT available in the read (not presumed)", e => { e.payment.customerId = null; }, "provider_customer_unavailable", "insufficient_evidence"],
    ["no durable customer link AND no digest", e => { e.attempt.expectedBuyerIdentityDigest = ""; }, "buyer_customer_binding_mismatch", "conflict"],
    ["amount", e => { e.payment.valueCents += 1; }, "amount_mismatch", "insufficient_evidence"],
    ["currency", e => { e.payment.currency = "USD"; }, "currency_mismatch", "insufficient_evidence"],
    ["provider account", e => { e.payment.providerAccount = "acct-2"; }, "provider_account_mismatch", "conflict"],
    ["payment deleted at provider", e => { e.payment.deleted = true; }, "payment_deleted_at_provider", "conflict"],
    ["pending status", e => { e.payment.status = "PENDING"; }, "payment_not_authoritatively_paid", "insufficient_evidence"],
    ["created before the attempt", e => { e.payment.dateCreated = "2026-11-15T09:00:00.000Z"; }, "provider_creation_time_not_proven", "insufficient_evidence"],
    ["receipt before creation", e => { e.payment.paidAt = "2026-11-15T10:00:00.000Z"; }, "provider_receipt_time_not_proven", "insufficient_evidence"],
    ["event not persisted", e => { e.event.persisted = false; }, "event_evidence_missing", "insufficient_evidence"],
    ["divergence not preserved", e => { e.divergence.open = false; }, "divergence_not_preserved", "insufficient_evidence"],
    ["attempt already linked", e => { e.attempt.paymentId = "pay-2"; }, "attempt_state_not_recoverable", "insufficient_evidence"],
    ["reservation already released", e => { e.localProjection.reservation = "released"; }, "local_projection_not_recoverable", "insufficient_evidence"],
    ["owner differs", e => { e.localProjection.orderOwnerUserId = 8; }, "owner_mismatch", "conflict"],
    ["no approval reference", e => { e.approval.approvalReference = ""; }, "approval_incomplete", "insufficient_evidence"],
    ["justification too short", e => { e.approval.justification = "ok"; }, "approval_incomplete", "insufficient_evidence"],
  ])("blocks: %s", (_n, f, reason, decision) => {
    const r = run(f);
    expect(r.reasons).toContain(reason); expect(r.decision).toBe(decision); expect(r.automaticAction).toBe(false);
  });
  it("ignores any identity/role smuggled inside the evidence: only the server context counts", () => {
    const e: any = base(); e.operator = { userId: 99, role: "admin" }; e.approval.role = "admin"; e.approval.approvedBy = 99;
    expect(assessRecoveryEvidence(e, ctx({ requestedByUserId: 50 }))).toMatchObject({ decision: "insufficient_evidence", reasons: expect.arrayContaining(["requester_not_authorized"]) });
  });
  it.each<[string, Partial<TrustedRecoveryContext>, string]>([
    ["requester is not an admin", { requestedByUserId: 50 }, "requester_not_authorized"],
    ["no second approver (four eyes)", { approvedByUserId: null }, "approver_missing"],
    ["approver is the requester", { approvedByUserId: 1 }, "approver_same_as_requester"],
    ["approver is not an admin", { approvedByUserId: 60 }, "approver_not_authorized"],
    ["invalid ids", { requestedByUserId: 0 }, "requester_not_authorized"],
  ])("server context: %s", (_n, over, reason) => {
    const r = run(() => {}, ctx(over)); expect(r.decision).toBe("insufficient_evidence"); expect(r.reasons).toContain(reason);
  });
  it("hash and operationKey change when ANY eligibility-determining input changes", () => {
    const ref = assessRecoveryEvidence(base(), ctx());
    const mutations: Array<(e: RecoveryEvidence) => void> = [
      e => { e.attempt.attemptId = "att-2"; }, e => { e.attempt.ownerUserId = 8; }, e => { e.attempt.orderId = 42; }, e => { e.attempt.status = "released"; },
      e => { e.attempt.providerState = "created"; }, e => { e.attempt.paymentId = "pay-9"; }, e => { e.attempt.amountCents = 1; }, e => { e.attempt.currency = "USD"; },
      e => { e.attempt.createdAt = "2026-11-15T09:59:59.000Z"; }, e => { e.attempt.providerAttemptStartedAt = "2026-11-15T10:00:04.000Z"; },
      e => { e.attempt.paymentReference = "L4CKOS-STOCK-ATTEMPT:v1:" + "c".repeat(32); }, e => { e.attempt.expectedCustomerId = "cus_2"; },
      e => { e.attempt.expectedBuyerIdentityDigest = "f".repeat(64); }, e => { e.attempt.expectedProviderAccount = "acct-9"; }, e => { e.attempt.reservationExpiresAt = "2026-11-15T10:31:00.000Z"; },
      e => { e.payment.id = "pay-2"; }, e => { e.payment.customerId = "cus_2"; }, e => { e.payment.externalReference = "x"; }, e => { e.payment.valueCents = 1; },
      e => { e.payment.currency = "USD"; }, e => { e.payment.status = "CONFIRMED"; }, e => { e.payment.dateCreated = "2026-11-15T10:00:05.000Z"; },
      e => { e.payment.paidAt = "2026-11-15T10:01:01.000Z"; }, e => { e.payment.providerAccount = "acct-9"; }, e => { e.payment.deleted = true; },
      e => { e.providerReadAt = "2026-11-15T10:02:01.000Z"; }, e => { e.buyerIdentityDigestFromCurrentCustomer = "9".repeat(64); },
      e => { e.paymentMappedToOtherAttempt = true; }, e => { e.localProjection.orderOwnerUserId = 8; }, e => { e.localProjection.orderStatus = "paid"; },
      e => { e.localProjection.reservation = "consumed"; }, e => { e.localProjection.amountCents = 1; },
      e => { e.event.eventId = "evt-2"; }, e => { e.event.payloadHash = "c".repeat(64); }, e => { e.event.paymentId = "pay-2"; }, e => { e.event.externalReference = "y"; },
      e => { e.event.amountCents = 1; }, e => { e.event.type = "PAYMENT_CONFIRMED"; }, e => { e.event.persisted = false; },
      e => { e.divergence.open = false; }, e => { e.divergence.kind = "OTHER"; }, e => { e.divergence.eventId = "evt-9"; },
      e => { e.approval.approvalReference = "FIN-2026-0002"; }, e => { e.approval.justification = "Outra justificativa suficiente."; },
    ];
    for (const m of mutations) { const r = run(m); expect(r.evidenceHash).not.toBe(ref.evidenceHash); expect(r.operationKey).not.toBe(ref.operationKey); }
    expect(assessRecoveryEvidence(base(), ctx({ approvedByUserId: 1 })).evidenceHash).not.toBe(ref.evidenceHash); // identities are part of the proof
    expect(assessRecoveryEvidence(base(), ctx({ requestedByUserId: 2, approvedByUserId: 1 })).evidenceHash).not.toBe(ref.evidenceHash);
    expect(assessRecoveryEvidence(base(), ctx()).operationKey).toBe(ref.operationKey);
    expect(recoveryEvidenceHash(base(), ctx())).toBe(ref.evidenceHash);
  });
  it("the hash is canonical: property order of the evidence does not matter", () => {
    const e = base(); const shuffled: any = JSON.parse(JSON.stringify({ divergence: e.divergence, approval: e.approval, event: e.event, localProjection: e.localProjection,
      paymentMappedToOtherAttempt: e.paymentMappedToOtherAttempt, buyerIdentityDigestFromCurrentCustomer: e.buyerIdentityDigestFromCurrentCustomer, providerReadAt: e.providerReadAt,
      payment: Object.fromEntries(Object.entries(e.payment).reverse()), attempt: Object.fromEntries(Object.entries(e.attempt).reverse()) }));
    expect(assessRecoveryEvidence(shuffled, ctx()).evidenceHash).toBe(assessRecoveryEvidence(e, ctx()).evidenceHash);
  });
  it("cannot mutate anything: the module has no database, provider, HTTP or order/stock transition code", () => {
    const src = readFileSync(resolve(__dirname, "supervisedRecoveryGuard.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/from\s+["'](?:\.\.\/db|mysql2|axios|drizzle|\.\/mysqlStock|\.\.\/services|\.\.\/payments\/webhook)/);
    expect(code).not.toMatch(/\b(fetch|execute|query)\s*\(|\b(UPDATE|INSERT|DELETE)\s+(INTO\s+)?\w+\s+SET|\b(markPaid|consumeReservations|releaseReservations|recordPayment|refund\w*|cancel\w*)\s*\(/i);
  });
});
