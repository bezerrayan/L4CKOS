import type { BatchPreview } from "../../../shared/preorder";
import {
  batchAcceptsSales,
  shippingEstimate,
  compactShippingEstimate,
  purchasedSalesMode,
  MIXED_SHIPPING_NOTICE,
  productionLabel,
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
      {batch?.salesCloseAt && (
        <p>
          Pedidos até{" "}
          {new Date(batch.salesCloseAt).toLocaleDateString("pt-BR", {
            timeZone: "UTC",
          })}

        </p>
      )}
      <p>
        {compactShippingEstimate(
          batch?.estimatedShippingStart,
          batch?.estimatedShippingEnd
        )}
      </p>
      {!batchAcceptsSales(batch) && (
        <p>Pré-venda indisponível para novas compras.</p>
      )}
    </div>
  );
}
export function MixedShippingNotice({
  items,
}: {
  items: { product: Pick<Product, "salesMode"> }[];
}) {
  return items.some(i => i.product.salesMode === "PREORDER") &&
    items.some(i => i.product.salesMode !== "PREORDER") ? (
    <div className="l4-preorder" role="note"><strong>Envio conjunto</strong><p>{MIXED_SHIPPING_NOTICE}</p></div>
  ) : null;
}
export type PurchasedPreorder = {
  salesModeAtPurchase?: string;
  productionBatchNameAtPurchase?: string | null;
  productionStatus?: BatchPreview["status"] | null;
  estimatedShippingStartAtPurchase?: Date | string | null;
  estimatedShippingEndAtPurchase?: Date | string | null;
};
export function PurchasedPreorderInfo({
  item,
  status,
}: {
  item: PurchasedPreorder;
  status: string;
}) {
  if (item.salesModeAtPurchase !== "PREORDER") return null;
  return (
    <div className="l4-preorder l4-preorder--compact">
      <strong>PRÉ-VENDA — {item.productionBatchNameAtPurchase}</strong>
      <p>
        {shippingEstimate(
          item.estimatedShippingStartAtPurchase,
          item.estimatedShippingEndAtPurchase
        )}
      </p>
      {["paid", "processing"].includes(status) && (
        <p>{productionLabel(item.productionStatus)}</p>
      )}
    </div>
  );
}

export function PurchasedMixedShippingNotice({ items }: { items: PurchasedPreorder[] }) {
  return purchasedSalesMode(items) === "MIXED" ? <div className="l4-preorder" role="note"><strong>Envio conjunto</strong><p>{MIXED_SHIPPING_NOTICE}</p></div> : null;
}
export function CheckoutPreorderNotice({ items }: { items: { product: Pick<Product, "salesMode"> }[] }) {
  if (!items.some(i => i.product.salesMode === "PREORDER")) return null;
  return <section className="l4-preorder l4-preorder-checkout" aria-label="Importante sobre este pedido">
    <h3>IMPORTANTE SOBRE ESTE PEDIDO</h3>
    <strong>Item em pré-venda</strong>
    <p>Este produto será produzido após a confirmação do pagamento. O valor é cobrado integralmente no checkout.</p>
    {items.some(i => i.product.salesMode !== "PREORDER") && <><strong>Envio conjunto</strong><p>{MIXED_SHIPPING_NOTICE}</p></>}
  </section>;
}
