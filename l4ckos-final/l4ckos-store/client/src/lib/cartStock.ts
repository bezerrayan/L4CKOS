import type { CartItem } from "../types/cart";
import type { SelectedOptions } from "../types/cart";
import type { Product } from "../types/product";

function asAvailableStock(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function getKnownStock(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : null;
}

export function getItemAvailableStock(product: Product, variantId?: number | null) {
  if (variantId !== null && variantId !== undefined) {
    const variant = product.variants?.find(item => item.id === variantId);
    const variantStock = getKnownStock(variant?.stock);
    if (variantStock !== null) {
      // A concrete variant is the inventory unit. product.stock is only its
      // synchronized aggregate and must never act as a second sales gate.
      return variantStock;
    }
  }

  const productStock = getKnownStock(product.stock);
  return productStock ?? asAvailableStock(product.stock);
}

export function clampCartQuantity(product: Product, variantId: number | null | undefined, quantity: number) {
  return Math.min(getItemAvailableStock(product, variantId), Math.max(0, Math.floor(Number(quantity) || 0)));
}

export function getCartItemIdentity(productId: number, variantId?: number | null, selectedOptions?: SelectedOptions) {
  const options = selectedOptions
    ? JSON.stringify(Object.keys(selectedOptions).sort().reduce((result, key) => {
      result[key] = selectedOptions[key];
      return result;
    }, {} as SelectedOptions))
    : "";
  return `${productId}:${variantId ?? "base"}:${options}`;
}

export function reconcileCartItems(items: CartItem[]) {
  return items.flatMap(item => {
    const quantity = clampCartQuantity(item.product, item.variantId, item.quantity);
    return quantity > 0 ? [{ ...item, quantity }] : [];
  });
}
