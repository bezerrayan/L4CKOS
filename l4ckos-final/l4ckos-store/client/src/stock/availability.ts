import type { CartItem } from "../types/cart";
import type { Product } from "../types/product";
import type { StockCatalogVariant } from "./stockCheckoutClient";

/** Backend limit per line (shared/stockCheckoutV1.ts: quantity 1–99). */
export const MAX_LINE_QUANTITY = 99;

const norm = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase();

function purchasable(variant: StockCatalogVariant): boolean {
  return variant.active && (variant.stock ?? 0) > 0;
}

/** Whether the size can be bought (optionally in the given color). */
export function isSizePurchasable(variants: readonly StockCatalogVariant[], size: string, color: string | null): boolean {
  return variants.some(variant => purchasable(variant) && norm(variant.size) === norm(size) && (!color || norm(variant.color) === norm(color)));
}

/** Whether the color can be bought (optionally in the given size). */
export function isColorPurchasable(variants: readonly StockCatalogVariant[], color: string, size: string | null): boolean {
  return variants.some(variant => purchasable(variant) && norm(variant.color) === norm(color) && (!size || norm(variant.size) === norm(size)));
}

export function clampQuantity(quantity: number, max: number): number {
  const safe = Number.isFinite(quantity) ? Math.floor(quantity) : 1;
  return Math.max(1, Math.min(safe, Math.max(1, max)));
}

/** Highest quantity the customer may put in a line, from the freshest catalog snapshot. */
export function maxQuantityFor(product: Pick<Product, "stock" | "variants" | "variantCatalogPresent" | "id">, variantId?: number): number {
  let stock: number | undefined = product.stock;
  if (product.variantCatalogPresent) {
    const variant = (product.variants ?? []).find(candidate => candidate.id === variantId && candidate.productId === product.id);
    stock = variant && variant.active ? variant.stock : 0;
  }
  if (stock === undefined || !Number.isFinite(stock)) return MAX_LINE_QUANTITY;
  return Math.max(0, Math.min(MAX_LINE_QUANTITY, Math.floor(stock)));
}

export type CartLineStatus =
  | { state: "ok"; maxQuantity: number }
  | { state: "limited"; maxQuantity: number; message: string }
  | { state: "unavailable"; maxQuantity: 0; message: string };

export function evaluateCartLine(item: CartItem): CartLineStatus {
  const { product, variantId, quantity } = item;
  if (product.variantCatalogPresent) {
    if (!Number.isSafeInteger(variantId)) {
      return { state: "unavailable", maxQuantity: 0, message: "Selecione novamente tamanho e cor deste item." };
    }
    const variant = (product.variants ?? []).find(candidate => candidate.id === variantId && candidate.productId === product.id);
    if (!variant || !variant.active) {
      return { state: "unavailable", maxQuantity: 0, message: "Esta variação não está mais disponível." };
    }
  }
  const max = maxQuantityFor(product, variantId);
  if (max <= 0) return { state: "unavailable", maxQuantity: 0, message: "Item esgotado." };
  if (quantity > max) {
    return {
      state: "limited",
      maxQuantity: max,
      message: max === 1 ? "Resta apenas 1 unidade. Ajuste a quantidade." : `Restam apenas ${max} unidades. Ajuste a quantidade.`,
    };
  }
  return { state: "ok", maxQuantity: max };
}

export function cartBlockingIssues(items: readonly CartItem[]): string[] {
  return items.flatMap(item => {
    const status = evaluateCartLine(item);
    return status.state === "ok" ? [] : [`${item.product.name}: ${status.message}`];
  });
}

