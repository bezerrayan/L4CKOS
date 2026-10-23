import { batchAcceptsSales, batchHasCapacity, type BatchPreview } from "../../shared/preorder";
import { createVariantOptionKey, normalizeVariantLabel } from "./productVariantIdentity";
import { isRestrictedPublicPurchase, isStagingQaCatalogProduct } from "./publicPurchasePolicy";

type ProductAvailabilityInput = {
  id: number;
  name: string;
  price: number;
  salesMode?: string | null;
  productionBatch?: BatchPreview | null;
};

type VariantAvailabilityInput = {
  id: number;
  color?: string | null;
  size?: string | null;
  sku?: string | null;
  price?: number | null;
  stock?: number | null;
  isActive?: number | boolean | string | null;
  optionKey?: string | null;
};

/** Shared read-only sellability projection used by both public and admin catalog views. */
export function getSellableVariantIds(
  product: ProductAvailabilityInput,
  variants: VariantAvailabilityInput[],
  reservedByVariant: ReadonlyMap<number, number>,
) {
  if (!variants.length || isRestrictedPublicPurchase(product.name) || isStagingQaCatalogProduct(product.name, variants)) return [];

  const skuCounts = new Map<string, number>();
  for (const variant of variants) {
    const sku = String(variant.sku ?? "").normalize("NFKC").trim().toLowerCase();
    if (sku) skuCounts.set(sku, (skuCounts.get(sku) ?? 0) + 1);
  }

  const preorderAvailable = product.salesMode === "PREORDER"
    && batchAcceptsSales(product.productionBatch)
    && batchHasCapacity(product.productionBatch);

  return variants.flatMap(variant => {
    const color = typeof variant.color === "string" ? normalizeVariantLabel(variant.color) : "";
    const size = typeof variant.size === "string" ? normalizeVariantLabel(variant.size) : "";
    const sku = String(variant.sku ?? "").normalize("NFKC").trim().toLowerCase();
    if (Number(variant.isActive) !== 1 || !color || !size || !sku || !variant.optionKey || skuCounts.get(sku) !== 1) return [];
    try {
      if (createVariantOptionKey(color, size) !== variant.optionKey) return [];
    } catch {
      return [];
    }
    const effectivePrice = variant.price == null ? Number(product.price) : Number(variant.price);
    if (!Number.isSafeInteger(effectivePrice) || effectivePrice <= 0) return [];
    if (product.salesMode === "PREORDER") return preorderAvailable ? [variant.id] : [];
    return Number(variant.stock ?? 0) - (reservedByVariant.get(variant.id) ?? 0) > 0 ? [variant.id] : [];
  });
}
