export const orderLogisticsAccents = {
  pending: "#F59E0B",
  paid: "#A855F7",
  processing: "#0EA5E9",
  shipped: "#6366F1",
  delivered: "#16A34A",
  cancelled: "#EF4444",
} as const;

export const paymentStatusAccents = {
  confirmed: "#16A34A",
  pending: "#F59E0B",
} as const;

export type LogisticsStatusKey = keyof typeof orderLogisticsAccents;
export type PaymentStatusKey = keyof typeof paymentStatusAccents;

export function getOrderLogisticsAccent(status: string) {
  return orderLogisticsAccents[status as LogisticsStatusKey] ?? "#A3A3A3";
}

export function getPaymentStatusAccent(status: string) {
  return paymentStatusAccents[status === "confirmed" ? "confirmed" : "pending"];
}
