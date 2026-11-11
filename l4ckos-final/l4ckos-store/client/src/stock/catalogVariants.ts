import type { StockCatalogVariant } from "./stockCheckoutClient";

/**
 * Normalizes the `variants` array returned by `products.getById`.
 * The API sends both `active: boolean` and `isActive: 0|1`; only `active` is trusted.
 * A row is only kept when it carries a real positive ID, belongs to the product and has
 * real size/color attributes: the frontend never infers a variant from names/options.
 */
export function mapCatalogVariants(raw: unknown, productId: number): StockCatalogVariant[] {
  if (!Array.isArray(raw)) return [];
  const result: StockCatalogVariant[] = [];
  for (const row of raw) {
    if (typeof row !== "object" || row === null) continue;
    const variant = row as Record<string, unknown>;
    const id = Number(variant.id);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    if (Number(variant.productId) !== productId) continue;
    if (typeof variant.size !== "string" || !variant.size.trim()) continue;
    if (typeof variant.color !== "string" || !variant.color.trim()) continue;
    const stock = Number(variant.stock ?? 0);
    result.push({
      id,
      productId,
      size: variant.size.trim(),
      color: variant.color.trim(),
      // `active` (boolean) is the contract field. `isActive` (0|1) is the raw column and is NOT
      // used here: a row without `active === true` is never treated as sellable.
      active: variant.active === true,
      stock: Number.isFinite(stock) ? Math.max(0, Math.floor(stock)) : 0,
    });
  }
  return result;
}
