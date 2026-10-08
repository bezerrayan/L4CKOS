import type { BatchPreview } from "../../../shared/preorder";
import {
  batchAcceptsSales,
  shippingEstimate,
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
      {!compact && (
        <p>
          Produzido especialmente para este lançamento. Pagamento integral no
          checkout.
        </p>
      )}
      {batch?.salesCloseAt && (
        <p>
          Pedidos até{" "}
          {new Date(batch.salesCloseAt).toLocaleDateString("pt-BR", {
            timeZone: "UTC",
          })}
          .
        </p>
      )}
      <p>
        {shippingEstimate(
          batch?.estimatedShippingStart,
          batch?.estimatedShippingEnd
        )}
      </p>
      {!compact && (
        <p>
          Este item é produzido sob pré-venda e possui prazo de envio diferente
          de produtos à pronta entrega.
        </p>
      )}
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
    <p className="l4-preorder" role="note">
      {MIXED_SHIPPING_NOTICE}
    </p>
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
