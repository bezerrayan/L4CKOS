import { createHash } from "node:crypto";
import { getPaymentsForReconciliation, processAsaasPaymentEvent } from "../db";
import { getAsaasPayment, type AsaasPaymentResponse } from "../services/asaasService";
import { securityLog } from "../_core/security";

const statusEvents: Record<string, string | undefined> = {
  CONFIRMED: "PAYMENT_CONFIRMED",
  RECEIVED: "PAYMENT_RECEIVED",
  OVERDUE: "PAYMENT_OVERDUE",
  REFUNDED: "PAYMENT_REFUNDED",
};

export async function runPaymentReconciliation(options: {
  limit?: number;
  fetchPayment?: (providerPaymentId: string) => Promise<AsaasPaymentResponse>;
} = {}) {
  const candidates = await getPaymentsForReconciliation(options.limit ?? 100);
  const fetchPayment = options.fetchPayment ?? getAsaasPayment;
  const result = { scanned: candidates.length, updated: 0, ignored: 0, conflicts: 0, failed: 0 };

  for (const payment of candidates) {
    if (!payment.providerPaymentId) {
      result.ignored += 1;
      continue;
    }
    try {
      const provider = await fetchPayment(payment.providerPaymentId);
      let eventType = statusEvents[String(provider.status || "").toUpperCase()];
      const refundedAmountCents = Number.isFinite(Number(provider.refundedValue)) ? Math.round(Number(provider.refundedValue) * 100) : null;
      if (eventType === "PAYMENT_REFUNDED" && refundedAmountCents !== null && refundedAmountCents < payment.amount) {
        eventType = "PAYMENT_PARTIALLY_REFUNDED";
      }
      if (!eventType) {
        result.ignored += 1;
        continue;
      }
      const fingerprint = `${payment.id}:${provider.id}:${provider.status}:${provider.value}:${provider.refundedValue ?? 0}`;
      const providerEventId = `reconciliation:${createHash("sha256").update(fingerprint).digest("hex").slice(0, 48)}`;
      const processed = await processAsaasPaymentEvent({
        providerEventId,
        eventType,
        providerPaymentId: provider.id,
        externalReference: provider.externalReference ?? null,
        amountCents: Number.isFinite(Number(provider.value)) ? Math.round(Number(provider.value) * 100) : null,
        refundedAmountCents,
        sanitizedPayload: JSON.stringify({ id: provider.id, status: provider.status, externalReference: provider.externalReference, value: provider.value, refundedValue: provider.refundedValue }),
        source: "reconciliation",
        correlationId: payment.externalReference,
      });
      if ("conflict" in processed && processed.conflict) result.conflicts += 1;
      else if (processed.duplicate || processed.ignored) result.ignored += 1;
      else result.updated += 1;
    } catch (error) {
      result.failed += 1;
      securityLog("error", "jobs.payment_reconciliation_failed", { paymentId: payment.id, orderId: payment.orderId, correlationId: payment.externalReference, errorType: error instanceof Error ? error.name : "unknown" });
    }
  }
  return result;
}
