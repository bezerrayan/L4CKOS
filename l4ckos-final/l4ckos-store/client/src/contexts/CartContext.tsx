/**
 * CartContext - Gerencia o carrinho de compras global
 * Fornece: items, addToCart, removeFromCart, clearCart, updateQuantity, total
 */

import React, { createContext, useContext, useState, ReactNode, useCallback, useEffect } from "react";
import type { CartItem, Cart, SelectedOptions } from "../types/cart";
import type { Product } from "../types/product";
import { calculateCartTotal, calculateItemCount } from "../types/cart";
import { trackStoreEvent } from "../lib/analytics";
import { readCartItems, writeCartItems } from "../utils/cartPersistence";
import { clampQuantity, maxQuantityFor } from "../stock/availability";

// ============= TIPOS =============

type CartContextType = {
  cart: Cart;
  addToCart: (product: Product, quantity: number, selectedOptions?: SelectedOptions, variantId?: number) => void;
  removeFromCart: (productId: number, selectedOptions?: SelectedOptions) => void;
  updateQuantity: (productId: number, quantity: number, selectedOptions?: SelectedOptions) => void;
  clearCart: () => void;
  /** Refreshes price/stock/variant snapshots of cart lines from the backend catalog. */
  syncCatalog: (products: Array<Pick<Product, "id" | "price" | "stock" | "variants" | "variantCatalogPresent">>) => void;
  isCartDrawerOpen: boolean;
  openCartDrawer: () => void;
  closeCartDrawer: () => void;
};

// ============= CRIAR CONTEXTO =============

const CartContext = createContext<CartContextType | undefined>(undefined);
const CART_STORAGE_KEY = "loja-escoteira:cart";

// ============= PROVIDER =============

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(() => {
    if (typeof window === "undefined") {
      return [];
    }

    try {
      const raw = window.localStorage.getItem(CART_STORAGE_KEY);
      if (!raw) {
        return [];
      }

      return readCartItems(window.localStorage, CART_STORAGE_KEY);
    } catch {
      return [];
    }
  });
  const [isCartDrawerOpen, setIsCartDrawerOpen] = useState(false);

  const normalizeOptions = (selectedOptions?: SelectedOptions) => {
    if (!selectedOptions) return "";
    return JSON.stringify(
      Object.keys(selectedOptions)
        .sort()
        .reduce((acc, key) => {
          acc[key] = selectedOptions[key];
          return acc;
        }, {} as SelectedOptions)
    );
  };

  const cart: Cart = {
    items,
    total: calculateCartTotal(items),
    itemCount: calculateItemCount(items),
  };

  // 📌 Adicionar produto ao carrinho
  const addToCart = useCallback((product: Product, quantity: number = 1, selectedOptions?: SelectedOptions, variantId?: number) => {
    setItems((prev) => {
      const currentOptionsKey = normalizeOptions(selectedOptions);
      const existing = prev.find(
        (item) => item.product.id === product.id && item.variantId === variantId && normalizeOptions(item.selectedOptions) === currentOptionsKey
      );
      
      if (existing) {
        // Se já existe, aumenta a quantidade
        return prev.map((item) =>
          item.product.id === product.id && item.variantId === variantId && normalizeOptions(item.selectedOptions) === currentOptionsKey
            ? { ...item, product, quantity: clampQuantity(item.quantity + quantity, maxQuantityFor(product, variantId)) }
            : item
        );
      }
      
      // Senão, adiciona novo
      return [...prev, { product, quantity: clampQuantity(quantity, maxQuantityFor(product, variantId)), selectedOptions, variantId, addedAt: new Date() }];
    });
    trackStoreEvent("cart_item_added", { product_id: product.id, quantity });
    setIsCartDrawerOpen(true);
  }, []);

  // 📌 Remover produto do carrinho
  const removeFromCart = useCallback((productId: number, selectedOptions?: SelectedOptions) => {
    const currentOptionsKey = normalizeOptions(selectedOptions);
    setItems((prev) =>
      prev.filter((item) => {
        if (item.product.id !== productId) return true;
        if (!selectedOptions) return false;
        return normalizeOptions(item.selectedOptions) !== currentOptionsKey;
      })
    );
    trackStoreEvent("cart_item_removed", { product_id: productId });
  }, []);

  // 📌 Atualizar quantidade
  const updateQuantity = useCallback((productId: number, quantity: number, selectedOptions?: SelectedOptions) => {
    if (quantity <= 0) {
      removeFromCart(productId, selectedOptions);
      return;
    }
    const currentOptionsKey = normalizeOptions(selectedOptions);
    
    setItems((prev) =>
      prev.map((item) =>
        item.product.id === productId && (!selectedOptions || normalizeOptions(item.selectedOptions) === currentOptionsKey)
          ? { ...item, quantity: clampQuantity(quantity, maxQuantityFor(item.product, item.variantId)) }
          : item
      )
    );
  }, [removeFromCart]);

  // 📌 Limpar carrinho
  const clearCart = useCallback(() => {
    setItems([]);
  }, []);

  const syncCatalog = useCallback<CartContextType["syncCatalog"]>((products) => {
    const byId = new Map(products.map(product => [product.id, product]));
    setItems(prev => {
      let changed = false;
      const next = prev.map(item => {
        const fresh = byId.get(item.product.id);
        if (!fresh) return item;
        const sameVariants = JSON.stringify(item.product.variants ?? []) === JSON.stringify(fresh.variants ?? []);
        if (item.product.price === fresh.price && item.product.stock === fresh.stock && item.product.variantCatalogPresent === fresh.variantCatalogPresent && sameVariants) return item;
        changed = true;
        return { ...item, product: { ...item.product, price: fresh.price, stock: fresh.stock, variants: fresh.variants, variantCatalogPresent: fresh.variantCatalogPresent } };
      });
      return changed ? next : prev;
    });
  }, []);

  const openCartDrawer = useCallback(() => setIsCartDrawerOpen(true), []);
  const closeCartDrawer = useCallback(() => setIsCartDrawerOpen(false), []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      if (items.length === 0) {
        writeCartItems(window.localStorage, CART_STORAGE_KEY, []);
        return;
      }

      writeCartItems(window.localStorage, CART_STORAGE_KEY, items);
    } catch {
      // Ignore storage errors to avoid breaking checkout flow.
    }
  }, [items]);

  const value: CartContextType = {
    cart,
    addToCart,
    removeFromCart,
    updateQuantity,
    clearCart,
    syncCatalog,
    isCartDrawerOpen,
    openCartDrawer,
    closeCartDrawer,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

// ============= HOOK =============

export function useCart() {
  const context = useContext(CartContext);
  if (context === undefined) {
    throw new Error("useCart deve ser usado dentro de CartProvider");
  }
  return context;
}
