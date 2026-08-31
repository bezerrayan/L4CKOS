export const PAYMENT_STATUSES = [
  "pending",
  "confirmed",
  "received",
  "failed",
  "overdue",
  "cancelled",
  "partially_refunded",
  "refunded",
  "chargeback",
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export type TransitionDecision = "allowed" | "ignored" | "invalid" | "manual";
export type TransitionSource = "webhook" | "reconciliation" | "manual" | "system";

export type PaymentTransition = {
  decision: TransitionDecision;
  current: PaymentStatus;
  next: PaymentStatus;
  reason: string;
};

const allowedPaymentTransitions: Record<PaymentStatus, ReadonlySet<PaymentStatus>> = {
  pending: new Set(["confirmed", "received", "failed", "overdue", "cancelled"]),
  overdue: new Set(["confirmed", "received", "failed", "cancelled"]),
  failed: new Set(["confirmed", "received", "overdue", "cancelled"]),
  confirmed: new Set(["received", "partially_refunded", "refunded", "chargeback"]),
  received: new Set(["partially_refunded", "refunded", "chargeback"]),
  partially_refunded: new Set(["partially_refunded", "refunded", "chargeback"]),
  refunded: new Set(),
  chargeback: new Set(["confirmed", "received", "refunded"]),
  cancelled: new Set(),
};

const stalePaymentTransitions = new Set([
  "confirmed:pending",
  "received:pending",
  "received:confirmed",
  "partially_refunded:pending",
  "partially_refunded:confirmed",
  "partially_refunded:received",
  "refunded:pending",
  "refunded:confirmed",
  "refunded:received",
  "refunded:partially_refunded",
  "chargeback:pending",
  "chargeback:confirmed",
  "chargeback:received",
]);

export function transitionPaymentStatus(
  current: PaymentStatus,
  next: PaymentStatus,
  context: { source: TransitionSource; chargebackReversal?: boolean } = { source: "system" },
): PaymentTransition {
  if (current === next) {
    if (current === "partially_refunded" || current === "chargeback") {
      return { decision: "allowed", current, next, reason: "CUMULATIVE_OR_PHASE_UPDATE" };
    }
    return { decision: "ignored", current, next, reason: "DUPLICATE_STATE" };
  }

  if (current === "chargeback" && (next === "confirmed" || next === "received")) {
    if (context.chargebackReversal && (context.source === "webhook" || context.source === "reconciliation")) {
      return { decision: "allowed", current, next, reason: "CHARGEBACK_REVERSED_BY_PROVIDER" };
    }
    return { decision: "manual", current, next, reason: "CHARGEBACK_REVERSAL_EVIDENCE_REQUIRED" };
  }

  if (allowedPaymentTransitions[current].has(next)) {
    return { decision: "allowed", current, next, reason: "VALID_TRANSITION" };
  }

  if (stalePaymentTransitions.has(`${current}:${next}`)) {
    return { decision: "ignored", current, next, reason: "STALE_EVENT" };
  }

  return { decision: "invalid", current, next, reason: "INVALID_PAYMENT_TRANSITION" };
}

export const FULFILLMENT_STATUSES = [
  "awaiting_payment",
  "ready",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
  "on_hold",
  "inventory_exception",
] as const;

export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

const fulfillmentTransitions: Record<FulfillmentStatus, ReadonlySet<FulfillmentStatus>> = {
  awaiting_payment: new Set(["ready", "cancelled", "on_hold", "inventory_exception"]),
  ready: new Set(["processing", "cancelled", "on_hold", "inventory_exception"]),
  processing: new Set(["shipped", "on_hold", "inventory_exception"]),
  shipped: new Set(["delivered", "on_hold"]),
  delivered: new Set(),
  cancelled: new Set(),
  on_hold: new Set(["ready", "processing", "cancelled", "inventory_exception"]),
  inventory_exception: new Set(["ready", "cancelled", "on_hold"]),
};

export function transitionFulfillmentStatus(current: FulfillmentStatus, next: FulfillmentStatus) {
  if (current === next) return { decision: "ignored" as const, current, next, reason: "DUPLICATE_STATE" };
  if (fulfillmentTransitions[current].has(next)) {
    return { decision: "allowed" as const, current, next, reason: "VALID_TRANSITION" };
  }
  return { decision: "invalid" as const, current, next, reason: "INVALID_FULFILLMENT_TRANSITION" };
}

export type LegacyOrderStatus = "pending" | "processing" | "paid" | "shipped" | "delivered" | "cancelled";

export function projectLegacyOrderStatus(
  paymentStatus: PaymentStatus | null | undefined,
  fulfillmentStatus: FulfillmentStatus,
): LegacyOrderStatus {
  if (fulfillmentStatus === "cancelled") return "cancelled";
  if (fulfillmentStatus === "delivered") return "delivered";
  if (fulfillmentStatus === "shipped") return "shipped";
  if (fulfillmentStatus === "processing") return "processing";
  if (paymentStatus === "confirmed" || paymentStatus === "received" || paymentStatus === "partially_refunded") return "paid";
  return "pending";
}

export function isFinanciallyPaid(status: PaymentStatus | null | undefined) {
  return status === "confirmed" || status === "received" || status === "partially_refunded";
}

export const ASAAS_EVENT_TO_PAYMENT_STATUS: Readonly<Record<string, PaymentStatus | undefined>> = {
  PAYMENT_CONFIRMED: "confirmed",
  PAYMENT_RECEIVED: "received",
  PAYMENT_OVERDUE_RECEIVED: "received",
  PAYMENT_OVERDUE: "overdue",
  PAYMENT_CREDIT_CARD_CAPTURE_REFUSED: "failed",
  PAYMENT_REFUSED: "failed",
  PAYMENT_REPROVED: "failed",
  PAYMENT_FAILED: "failed",
  PAYMENT_REPROVED_BY_RISK_ANALYSIS: "failed",
  PAYMENT_DELETED: "cancelled",
  PAYMENT_PARTIALLY_REFUNDED: "partially_refunded",
  PAYMENT_REFUNDED: "refunded",
  PAYMENT_RECEIVED_IN_CASH_UNDONE: "refunded",
  PAYMENT_CHARGEBACK_REQUESTED: "chargeback",
  PAYMENT_CHARGEBACK_DISPUTE: "chargeback",
  PAYMENT_AWAITING_CHARGEBACK_REVERSAL: "chargeback",
};
