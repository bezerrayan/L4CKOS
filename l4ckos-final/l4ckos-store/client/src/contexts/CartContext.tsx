/**
 * CartContext - Gerencia o carrinho de compras global
 * Fornece: items, addToCart, removeFromCart, clearCart, updateQuantity, total
 */

import React, { createContext, useContext, useState, ReactNode, useCallback, useEffect } from "react";
import type { CartItem, Cart, SelectedOptions } from "../types/cart";
import type { Product } from "../types/product";
import { calculateCartTotal, calculateItemCount } from "../types/cart";
import { clampCartQuantity, getCartItemIdentity, reconcileCartItems } from "../lib/cartStock";

// ============= TIPOS =============

type CartContextType = {
  cart: Cart;
  addToCart: (product: Product, quantity: number, selectedOptions?: SelectedOptions, variantId?: number | null) => void;
  removeFromCart: (productId: number, selectedOptions?: SelectedOptions, variantId?: number | null) => void;
  updateQuantity: (productId: number, quantity: number, selectedOptions?: SelectedOptions, variantId?: number | null) => void;
  clearCart: () => void;
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

      const parsed = JSON.parse(raw) as CartItem[];
      return Array.isArray(parsed) ? reconcileCartItems(parsed) : [];
    } catch {
      return [];
    }
  });
  const [isCartDrawerOpen, setIsCartDrawerOpen] = useState(false);

  const cart: Cart = {
    items,
    total: calculateCartTotal(items),
    itemCount: calculateItemCount(items),
  };

  // 📌 Adicionar produto ao carrinho
  const addToCart = useCallback((product: Product, quantity: number = 1, selectedOptions?: SelectedOptions, variantId?: number | null) => {
    setItems((prev) => {
      const currentIdentity = getCartItemIdentity(product.id, variantId, selectedOptions);
      const existing = prev.find(
        (item) => getCartItemIdentity(item.product.id, item.variantId, item.selectedOptions) === currentIdentity
      );
      
      const requestedQuantity = clampCartQuantity(product, variantId, quantity);
      if (requestedQuantity <= 0) return prev;

      if (existing) {
        return prev.map((item) =>
          getCartItemIdentity(item.product.id, item.variantId, item.selectedOptions) === currentIdentity
            ? { ...item, product, quantity: clampCartQuantity(product, variantId, item.quantity + requestedQuantity) }
            : item
        );
      }

      return [...prev, { product, variantId: variantId ?? null, quantity: requestedQuantity, selectedOptions, addedAt: new Date() }];
    });
    setIsCartDrawerOpen(true);
  }, []);

  // 📌 Remover produto do carrinho
  const removeFromCart = useCallback((productId: number, selectedOptions?: SelectedOptions, variantId?: number | null) => {
    const currentIdentity = getCartItemIdentity(productId, variantId, selectedOptions);
    setItems((prev) =>
      prev.filter((item) => {
        if (item.product.id !== productId) return true;
        if (variantId === undefined && !selectedOptions) return false;
        return getCartItemIdentity(item.product.id, item.variantId, item.selectedOptions) !== currentIdentity;
      })
    );
  }, []);

  // 📌 Atualizar quantidade
  const updateQuantity = useCallback((productId: number, quantity: number, selectedOptions?: SelectedOptions, variantId?: number | null) => {
    if (quantity <= 0) {
      removeFromCart(productId, selectedOptions, variantId);
      return;
    }
    const currentIdentity = getCartItemIdentity(productId, variantId, selectedOptions);
    
    setItems((prev) => prev.flatMap((item) => {
      const matches = item.product.id === productId &&
        ((variantId === undefined && !selectedOptions) || getCartItemIdentity(item.product.id, item.variantId, item.selectedOptions) === currentIdentity);
      if (!matches) return [item];
      const nextQuantity = clampCartQuantity(item.product, item.variantId, quantity);
      return nextQuantity > 0 ? [{ ...item, quantity: nextQuantity }] : [];
    }));
  }, [removeFromCart]);

  // 📌 Limpar carrinho
  const clearCart = useCallback(() => {
    setItems([]);
  }, []);

  const openCartDrawer = useCallback(() => setIsCartDrawerOpen(true), []);
  const closeCartDrawer = useCallback(() => setIsCartDrawerOpen(false), []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      if (items.length === 0) {
        window.localStorage.removeItem(CART_STORAGE_KEY);
        return;
      }

      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
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
