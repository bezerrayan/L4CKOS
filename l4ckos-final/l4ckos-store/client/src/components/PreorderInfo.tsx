import type { BatchPreview } from "../../../shared/preorder";
import {
  batchAcceptsSales,
  batchRemainingCapacity,
  shippingEstimate,
  compactShippingEstimate,
  purchasedSalesMode,
  MIXED_SHIPPING_NOTICE,
  productionLabel,
  salesDeadline,
  PRODUCTION_DEADLINE_NOTICE,
  TRANSPORT_DEADLINE_NOTICE,
  transportEstimate,
  utcMillis,
  civilDate,
  manufacturingEstimate,
} from "../../../shared/preorder";
import type { Product } from "../types/product";
import "./PreorderInfo.css";
export function PreorderInfo({
  product,
  compact = false,
}: {
  product: Pick<Product, "salesMode" | "productionBatch">;
  compact?: boolean;
}) {
  if (product.salesMode !== "PREORDER") return null;
  const batch = product.productionBatch;
  return (
    <div className={`l4-preorder ${compact ? "l4-preorder--compact" : ""}`}>
      <strong>PRÉ-VENDA{batch ? ` — ${batch.name}` : ""}</strong>
      <p>{manufacturingEstimate(batch?.estimatedManufacturingStart, batch?.estimatedManufacturingEnd)}</p>
      {batch?.salesCloseAt && (
        <p>
          Pedidos até{" "}
          {salesDeadline(batch.salesCloseAt)}

        </p>
      )}
      <p>
        {compactShippingEstimate(
          batch?.estimatedShippingStart,
          batch?.estimatedShippingEnd
        )}
      </p>
      {!compact && <><p>{PRODUCTION_DEADLINE_NOTICE}</p><p>{TRANSPORT_DEADLINE_NOTICE}</p></>}
      {!batchAcceptsSales(batch) && (
        <p>Pré-venda indisponível para novas compras.</p>
      )}
    {batchAcceptsSales(batch) && batchRemainingCapacity(batch) === 0 && (
        <p>Capacidade deste lote esgotada.</p>
      )}
    </div>
  );
}
export function MixedShippingNotice({
  items,
}: {
  items: { product: Pick<Product, "salesMode" | "productionBatch"> }[];
}) {
  return items.some(i => i.product.salesMode === "PREORDER") &&
    (items.some(i => i.product.salesMode !== "PREORDER") || new Set(items.filter(i => i.product.salesMode === "PREORDER").map(i => i.product.productionBatch?.id)).size > 1) ? (
    <div className="l4-preorder" role="note"><strong>Envio conjunto</strong><p>{MIXED_SHIPPING_NOTICE}</p></div>
  ) : null;
}
export type PurchasedPreorder = {
  salesModeAtPurchase?: string;
  productionBatchNameAtPurchase?: string | null;
  productionBatchId?: number | null;
  productionStatus?: BatchPreview["status"] | null;
  estimatedShippingStartAtPurchase?: Date | string | null;
  estimatedShippingEndAtPurchase?: Date | string | null;
  currentEstimatedShippingStart?: Date | string | null;
  currentEstimatedShippingEnd?: Date | string | null;
  estimatedManufacturingStartAtPurchase?: string | null;
  estimatedManufacturingEndAtPurchase?: string | null;
  currentEstimatedManufacturingStart?: string | null;
  currentEstimatedManufacturingEnd?: string | null;
};
export function PurchasedPreorderInfo({
  item,
  status,
}: {
  item: PurchasedPreorder;
  status: string;
}) {
  if (item.salesModeAtPurchase !== "PREORDER") return null;
  const dateValue = (value?: Date | string | null) => value ? utcMillis(value) : null;
  const changed = (item.currentEstimatedShippingStart !== undefined || item.currentEstimatedShippingEnd !== undefined) &&
    (dateValue(item.currentEstimatedShippingStart) !== dateValue(item.estimatedShippingStartAtPurchase) || dateValue(item.currentEstimatedShippingEnd) !== dateValue(item.estimatedShippingEndAtPurchase));
  const manufacturingChanged = (item.currentEstimatedManufacturingStart !== undefined || item.currentEstimatedManufacturingEnd !== undefined) &&
    (civilDate(item.currentEstimatedManufacturingStart) !== civilDate(item.estimatedManufacturingStartAtPurchase) || civilDate(item.currentEstimatedManufacturingEnd) !== civilDate(item.estimatedManufacturingEndAtPurchase));
  return (
    <div className="l4-preorder l4-preorder--compact">
      <strong>PRÉ-VENDA — {item.productionBatchNameAtPurchase}</strong>
      <p>{manufacturingEstimate(item.estimatedManufacturingStartAtPurchase, item.estimatedManufacturingEndAtPurchase, true)}</p>
      <p>
        {shippingEstimate(
          item.estimatedShippingStartAtPurchase,
          item.estimatedShippingEndAtPurchase,
          { historical: true }
        )}
      </p>
      <p>{TRANSPORT_DEADLINE_NOTICE}</p>
      {manufacturingChanged && !["shipped", "delivered", "cancelled"].includes(status) && <p>O cronograma de fabricação mudou. Previsão atual: {manufacturingEstimate(item.currentEstimatedManufacturingStart, item.currentEstimatedManufacturingEnd)} O período registrado na compra foi preservado; consulte a loja sobre a alteração.</p>}
      {changed && !["shipped", "delivered", "cancelled"].includes(status) && <p>O cronograma do lote mudou. Previsão atual: {shippingEstimate(item.currentEstimatedShippingStart, item.currentEstimatedShippingEnd)} O registro da compra acima foi preservado; consulte a loja sobre a alteração.</p>}
      {["paid", "processing"].includes(status) && (
        <p>{productionLabel(item.productionStatus)}</p>
      )}
    </div>
  );
}

export function PurchasedTransportInfo({ option, status }: { option?: { id: string; label: string; minDays: number | null; maxDays: number | null } | null; status: string }) {
  return <div className="l4-preorder" role="note">
    <strong>Condições de transporte registradas na compra</strong>
    <p>{option ? `${option.label}: ${transportEstimate(option)}` : "Prazo de transporte não registrado neste pedido histórico. Não foi recalculado a partir do catálogo atual."}</p>
    <p>{status === "delivered" ? "Pedido entregue; as condições acima são o registro histórico da compra." : status === "shipped" ? "Pedido enviado. Consulte o rastreamento para a previsão atual da transportadora." : "A data final de entrega depende da disponibilidade, preparação e postagem ou do agendamento local."}</p>
  </div>;
}

export function PurchasedMixedShippingNotice({ items }: { items: PurchasedPreorder[] }) {
  return purchasedSalesMode(items) === "MIXED" || new Set(items.filter(i => i.salesModeAtPurchase === "PREORDER").map(i => i.productionBatchId ?? i.productionBatchNameAtPurchase)).size > 1 ? <div className="l4-preorder" role="note"><strong>Envio conjunto</strong><p>{MIXED_SHIPPING_NOTICE}</p></div> : null;
}
export function CheckoutPreorderNotice({ items }: { items: { product: Pick<Product, "salesMode" | "productionBatch"> }[] }) {
  if (!items.some(i => i.product.salesMode === "PREORDER")) return null;
  return <section className="l4-preorder l4-preorder-checkout" aria-label="Importante sobre este pedido">
    <h3>IMPORTANTE SOBRE ESTE PEDIDO</h3>
    <strong>Item em pré-venda</strong>
    <p>O pagamento confirma sua participação no lote; a fabricação segue o calendário do fornecedor e não começa necessariamente na data da compra. O valor é cobrado integralmente no checkout.</p>
    <p>{PRODUCTION_DEADLINE_NOTICE}</p><p>{TRANSPORT_DEADLINE_NOTICE}</p>
    <MixedShippingNotice items={items} />
  </section>;
}
