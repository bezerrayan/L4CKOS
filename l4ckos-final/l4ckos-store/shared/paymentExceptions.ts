/** Provider observations, never authorization to refund or release reservations. */
export const PAYMENT_EXCEPTION_EVENTS = new Set([
  // Configured staging events: record reconciliation, never reopen/cancel/pay an order.
  "PAYMENT_UPDATED", "PAYMENT_RESTORED",
  "PAYMENT_APPROVED_BY_RISK_ANALYSIS", "PAYMENT_REPROVED_BY_RISK_ANALYSIS",
  "PAYMENT_AUTHORIZED", "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED", "PAYMENT_ANTICIPATED",
  "PAYMENT_OVERDUE", "PAYMENT_REFUNDED", "PAYMENT_PARTIALLY_REFUNDED",
  "PAYMENT_REFUND_IN_PROGRESS", "PAYMENT_REFUND_DENIED",
  "PAYMENT_RECEIVED_IN_CASH_UNDONE", "PAYMENT_CHARGEBACK_REQUESTED",
  "PAYMENT_CHARGEBACK_DISPUTE", "PAYMENT_AWAITING_CHARGEBACK_REVERSAL",
  "PAYMENT_SPLIT_CANCELLED", "PAYMENT_SPLIT_DIVERGENCE_BLOCK", "PAYMENT_SPLIT_DIVERGENCE_BLOCK_FINISHED",
  "PAYMENT_SPLIT_DONE",
]);
export const CANCELLATION_NOTICE = "Pedido cancelado não significa cobrança cancelada ou reembolso concluído. A situação financeira precisa ser conferida com a loja e o provedor de pagamento.";
