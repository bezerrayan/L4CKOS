export type PaymentConfirmationView = {
  paymentStatus?: string | null;
  paymentConfirmedAt?: Date | string | null;
  paymentConfirmationSource?: string | null;
  paymentConfirmedBy?: number | null;
  paymentConfirmationReference?: string | null;
  status?: string | null;
};

export function isConfirmedPayment(order: PaymentConfirmationView) {
  return order.paymentStatus === "confirmed" && Boolean(order.paymentConfirmedAt)
    && ((order.paymentConfirmationSource === "manual" && Number(order.paymentConfirmedBy) > 0)
      || (order.paymentConfirmationSource === "asaas_webhook" && Boolean(order.paymentConfirmationReference?.trim())))
    && ["paid", "processing", "shipped", "delivered"].includes(order.status ?? "");
}

export const preorderSizeOrder = ["PP", "P", "M", "G", "GG"] as const;
export function confirmedSizesBySize(groups: Array<{ size: string | null; quantity: number }>) {
  const totals = new Map<string, number>();
  for (const group of groups) {
    const size = String(group.size || "Sem tamanho").toUpperCase();
    totals.set(size, (totals.get(size) ?? 0) + Number(group.quantity));
  }
  return [...totals.entries()].sort(([a], [b]) => {
    const ai = preorderSizeOrder.indexOf(a as typeof preorderSizeOrder[number]), bi = preorderSizeOrder.indexOf(b as typeof preorderSizeOrder[number]);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.localeCompare(b, "pt-BR");
  });
}
