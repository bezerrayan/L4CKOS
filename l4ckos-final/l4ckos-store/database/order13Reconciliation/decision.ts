/** Durable operational decision from the user's 2026-10-16 instruction. No execution receipt. */
export const DECISION = Object.freeze({
  version: 1,
  operation: "order13-asaas-received-reconciliation-v1",
  date: "2026-10-16",
  source: "user_instruction_prepare_supervised_staging",
  orderId: 13,
  paymentId: "pay_dog6ppexq4gyw3k6",
  amountCents: 9900,
  reservationId: 10,
  productId: 1,
  quantity: 1,
  decision: "FULFILL_WITH_CURRENT_AVAILABLE_STOCK",
  expiredReservationException: true,
  conditions: [
    "fresh_RECEIVED_and_zero_refunds",
    "exact_reference_and_amount",
    "current_available_stock_under_lock",
    "supervised_operational_authorization",
  ],
  timestampPolicy:
    "administrative_confirmation_now; never_invent_financial_receipt_time",
  preparationAuthorized: true,
  commitAuthority: "requires_separate_fresh_explicit_approval",
  transactionExecuted: false,
  webhookResumeAuthorized: false,
  notificationDispatchAuthorized: false,
});
