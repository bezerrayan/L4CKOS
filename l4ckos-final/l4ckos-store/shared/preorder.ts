export const BATCH_STATUSES = [
  "DRAFT",
  "OPEN",
  "CLOSED",
  "IN_PRODUCTION",
  "RECEIVED",
  "SHIPPING",
  "COMPLETED",
  "CANCELLED",
] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];
export type BatchPreview = {
  id: number;
  name: string;
  status: BatchStatus;
  salesOpenAt: Date | string | null;
  salesCloseAt: Date | string | null;
  estimatedShippingStart: Date | string | null;
  estimatedShippingEnd: Date | string | null;
};
export const BATCH_TRANSITIONS: Record<BatchStatus, readonly BatchStatus[]> = {
  DRAFT: ["OPEN", "CANCELLED"],
  OPEN: ["CLOSED", "CANCELLED"],
  CLOSED: ["IN_PRODUCTION", "CANCELLED"],
  IN_PRODUCTION: ["RECEIVED", "CANCELLED"],
  RECEIVED: ["SHIPPING", "CANCELLED"],
  SHIPPING: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};
export function utcMillis(value: Date | string) {
  return value instanceof Date
    ? value.getTime()
    : Date.parse(
        value.replace(" ", "T") + (/Z$|[+-]\d\d:\d\d$/.test(value) ? "" : "Z")
      );
}
export function batchAcceptsSales(
  batch: BatchPreview | null | undefined,
  now = Date.now()
) {
  return Boolean(
    batch &&
      batch.status === "OPEN" &&
      (!batch.salesOpenAt || utcMillis(batch.salesOpenAt) <= now) &&
      (!batch.salesCloseAt || utcMillis(batch.salesCloseAt) > now)
  );
}
export function productionLabel(status: string | null | undefined) {
  switch (status) {
    case "OPEN":
    case "CLOSED":
      return "Pagamento confirmado — aguardando produção";
    case "IN_PRODUCTION":
      return "Em produção";
    case "RECEIVED":
      return "Produção concluída — preparando seu pedido";
    case "SHIPPING":
      return "Preparando envios";
    case "COMPLETED":
      return "Produção concluída";
    case "CANCELLED":
      return "Lote cancelado — entre em contato para resolver seu pedido";
    default:
      return "Acompanhamento de produção";
  }
}
export function shippingEstimate(
  start?: Date | string | null,
  end?: Date | string | null
) {
  const date = (value: Date | string) =>
    new Date(utcMillis(value)).toLocaleDateString("pt-BR", { timeZone: "UTC" });
  return start && end
    ? `Envio estimado entre ${date(start)} e ${date(end)}.`
    : start
      ? `Envio estimado a partir de ${date(start)}.`
      : end
        ? `Envio estimado até ${date(end)}.`
        : "Previsão de envio a confirmar.";
}
export const MIXED_SHIPPING_NOTICE =
  "Seu pedido contém itens com prazos de envio diferentes. O envio será feito quando todos os itens estiverem disponíveis.";
