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
  /** Civil dates in Brasilia, not UTC instants. Optional for legacy API/records. */
  estimatedManufacturingStart?: string | null;
  estimatedManufacturingEnd?: string | null;
  /** Informative snapshot; checkout recalculates this under a transaction lock. */
  capacity?: {
    maximumQuantity: number | null;
    claimedQuantity: number;
    remainingQuantity: number | null;
  };
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
export function batchRemainingCapacity(batch: BatchPreview | null | undefined) {
  return batch?.capacity?.remainingQuantity ?? null;
}
export function batchHasCapacity(batch: BatchPreview | null | undefined) {
  const remaining = batchRemainingCapacity(batch);
  return remaining === null || remaining > 0;
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
  end?: Date | string | null,
  options: { historical?: boolean; now?: number } = {}
) {
  const valid = (v?: Date | string | null) => v && Number.isFinite(utcMillis(v)) ? v : null;
  start = valid(start); end = valid(end);
  const date = (value: Date | string) => new Date(utcMillis(value)).toLocaleDateString("pt-BR", { timeZone: "UTC" });
  if (start && end && utcMillis(start) > utcMillis(end)) return "Previsão de postagem a confirmar: cronograma inconsistente.";
  const prefix = options.historical ? "Previsão de postagem registrada na compra" : "Postagem estimada";
  // Shipping windows are calendar dates in the existing UTC batch contract, not delivery dates.
  const today = new Date(options.now ?? Date.now()).toISOString().slice(0, 10);
  const past = (v: Date | string) => new Date(utcMillis(v)).toISOString().slice(0, 10) < today;
  if (!options.historical && ((end && past(end)) || (!end && start && past(start)))) {
    return `Previsão anterior de postagem: ${start ? date(start) : date(end!)}${start && end ? ` a ${date(end)}` : ""}. Cronograma aguardando atualização; nova previsão a confirmar.`;
  }
  if (!options.historical && start && end && past(start)) start = null;
  return start && end
    ? `${prefix} entre ${date(start)} e ${date(end)}.`
    : start
      ? `${prefix} a partir de ${date(start)}.`
      : end
        ? `${prefix} até ${date(end)}.`
        : "Previsão de postagem a confirmar.";
}
export const MIXED_SHIPPING_NOTICE =
  "Seu pedido contém itens com prazos diferentes. O envio será feito em uma única remessa quando todos os itens estiverem disponíveis.";

export function compactShippingEstimate(start?: Date | string | null, end?: Date | string | null) {
  return shippingEstimate(start, end);
}
export const PRODUCTION_DEADLINE_NOTICE = "A fabricação segue o cronograma estimado do lote acordado com o fornecedor. Fabricação, preparação, postagem e transporte são etapas distintas; estimativas não são garantias de entrega.";
/** mysql2 DATE values are UTC Date objects on timezone=Z connections; Drizzle returns strings. */
export function civilDate(value?: Date | string | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value ? value : null;
}
export function brasiliaCalendarDate(value: Date | string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(utcMillis(value)));
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function manufacturingEstimate(start?: Date | string | null, end?: Date | string | null, historical = false) {
  const first = civilDate(start), last = civilDate(end);
  const label = historical ? "Fabricação estimada registrada na compra" : "Fabricação estimada";
  if (!first || !last) return `${label}: período a confirmar com a loja.`;
  if (first > last) return `${label}: cronograma inconsistente, consulte a loja.`;
  const format = (date: string) => date.split("-").reverse().join("/");
  const text = `${label} entre ${format(first)} e ${format(last)} (datas de Brasília).`;
  return !historical && last < brasiliaCalendarDate(new Date()) ? `${text} Previsão anterior; cronograma aguardando atualização.` : text;
}
export const TRANSPORT_DEADLINE_NOTICE = "O prazo de transporte começa após a postagem e não inclui fabricação nem preparação do pedido. A entrega é estimada, não garantida; a data final depende da postagem. Entrega local depende de agendamento, não de prazo postal.";
export function transportEstimate(option: { id: string; minDays?: number | null; maxDays?: number | null }) {
  if (option.id.startsWith("local")) return "Entrega local por agendamento, após disponibilidade de todos os itens. Data a combinar; não há prazo de transporte postal.";
  const { minDays: min, maxDays: max } = option;
  const known = typeof min === "number" && typeof max === "number" && Number.isInteger(min) && Number.isInteger(max) && min >= 0 && max >= min;
  return known ? `Transporte estimado: ${min === max ? min : `${min} a ${max}`} dias após a postagem, conforme a cotação da transportadora. Não inclui fabricação ou preparação.` : "Prazo de transporte não informado pela transportadora. Consulte a loja; não há previsão de entrega confirmada.";
}
export function salesDeadline(value: Date | string) {
  const time = utcMillis(value);
  return Number.isFinite(time) ? new Date(time).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) + " (horário de Brasília)" : "encerramento a confirmar";
}
export function purchasedSalesMode(items: { salesModeAtPurchase?: string }[]) {
  const preorder = items.some(i => i.salesModeAtPurchase === "PREORDER");
  return preorder ? (items.some(i => i.salesModeAtPurchase !== "PREORDER") ? "MIXED" : "PREORDER") : "STOCK";
}
export function purchasedScheduleMessages(items: { salesModeAtPurchase?: string; productionBatchNameAtPurchase?: string | null; estimatedManufacturingStartAtPurchase?: string | null; estimatedManufacturingEndAtPurchase?: string | null; estimatedShippingStartAtPurchase?: Date | string | null; estimatedShippingEndAtPurchase?: Date | string | null }[]) {
  return items.filter(i => i.salesModeAtPurchase === "PREORDER").map(i => `${i.productionBatchNameAtPurchase ?? "Pré-venda"}: ${manufacturingEstimate(i.estimatedManufacturingStartAtPurchase, i.estimatedManufacturingEndAtPurchase, true)} ${shippingEstimate(i.estimatedShippingStartAtPurchase, i.estimatedShippingEndAtPurchase, { historical: true })}`);
}
export function paymentApprovedMessage(mode: "STOCK" | "PREORDER" | "MIXED" = "STOCK") {
  const preorder = "Seu pagamento foi confirmado. Os itens em pré-venda estão confirmados e serão produzidos conforme o calendário dos respectivos lançamentos. Avisaremos quando o pedido avançar para preparação e envio.";
  return mode === "STOCK" ? "Seu pagamento foi confirmado. A equipe da L4CKOS já pode liberar o pedido para separação e preparação." : mode === "MIXED" ? `${preorder} ${MIXED_SHIPPING_NOTICE}` : preorder;
}
