/**
 * Tipos para o Carrinho de Compras
 */
import type { Product } from "./product";

export type SelectedOptions = Record<string, string>;

export type CartVariant = {
  variantId: number;
  color: string;
  size: string;
  priceCents: number;
  availableUnits: number | null;
};

export type SellableVariantCatalog = {
  productId: number;
  hasVariants: boolean;
  publicPurchaseAllowed: boolean;
  variants: ReadonlyArray<{
    variantId: number;
    color: string;
    size: string;
    price: number;
    available: true;
    availableUnits: number | null;
  }>;
};

export type CartItem = {
  product: Product;
  quantity: number;
  selectedOptions?: SelectedOptions;
  /** Missing on pre-variant carts; CartContext resolves only an exact unique color/size match. */
  variant?: CartVariant;
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
