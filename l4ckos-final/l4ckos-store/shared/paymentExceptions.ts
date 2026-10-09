/** Provider observations, never authorization to refund or release reservations. */
export const PAYMENT_EXCEPTION_EVENTS = new Set([
  "PAYMENT_OVERDUE", "PAYMENT_REFUNDED", "PAYMENT_PARTIALLY_REFUNDED",
  "PAYMENT_REFUND_IN_PROGRESS", "PAYMENT_REFUND_DENIED",
]);
export const CANCELLATION_NOTICE = "Pedido cancelado não significa cobrança cancelada ou reembolso concluído. A situação financeira precisa ser conferida com a loja e o provedor de pagamento.";
