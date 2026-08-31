/**
 * Tipos para o Carrinho de Compras
 */
import type { Product } from "./product";

export type SelectedOptions = Record<string, string>;

export type CartItem = {
  product: Product;
  variantId?: number | null;
  quantity: number;
  selectedOptions?: SelectedOptions;
  addedAt: Date;
};

export type Cart = {
  items: CartItem[];
  total: number;
  itemCount: number;
};

// Funções auxiliares para cálculos
export function calculateCartTotal(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
}

export function calculateItemCount(items: CartItem[]): number {
  return items.reduce((count, item) => count + item.quantity, 0);
}
