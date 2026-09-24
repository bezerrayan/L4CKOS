/**
 * CartContext - Gerencia o carrinho de compras global
 * Fornece: items, addToCart, removeFromCart, clearCart, updateQuantity, total
 */

import React, { createContext, useContext, useState, ReactNode, useCallback, useEffect } from "react";
import type { CartItem, Cart, SelectedOptions } from "../types/cart";
import type { Product } from "../types/product";
import { calculateCartTotal, calculateItemCount } from "../types/cart";
import { clampCartQuantity, getCartItemIdentity } from "../lib/cartStock";
import { getCartStorageKey, readCart, writeCart } from "../lib/cartStorage";
import { useUser } from "./UserContext";

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

// ============= PROVIDER =============

export function CartProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated, isLoading } = useUser();
  const userId = isAuthenticated ? user?.id : null;
  const storageKey = getCartStorageKey(userId);
  const isIdentityReady = !isLoading && (!isAuthenticated || Boolean(userId));
  const [items, setItems] = useState<CartItem[]>([]);
  const [hydratedStorageKey, setHydratedStorageKey] = useState<string | null>(null);
  const [isCartDrawerOpen, setIsCartDrawerOpen] = useState(false);
  const canUseCurrentCart = isIdentityReady && hydratedStorageKey === storageKey;
  const visibleItems = canUseCurrentCart ? items : [];

  const cart: Cart = {
    items: visibleItems,
    total: calculateCartTotal(visibleItems),
    itemCount: calculateItemCount(visibleItems),
  };

  useEffect(() => {
    if (!isIdentityReady) return;

    const storage = typeof window === "undefined" ? null : window.localStorage;
    setItems(readCart(storage, storageKey));
    setHydratedStorageKey(storageKey);
    setIsCartDrawerOpen(false);
  }, [isIdentityReady, storageKey]);

  // 📌 Adicionar produto ao carrinho
  const addToCart = useCallback((product: Product, quantity: number = 1, selectedOptions?: SelectedOptions, variantId?: number | null) => {
    if (!canUseCurrentCart) return;
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
  }, [canUseCurrentCart]);

  // 📌 Remover produto do carrinho
  const removeFromCart = useCallback((productId: number, selectedOptions?: SelectedOptions, variantId?: number | null) => {
    if (!canUseCurrentCart) return;
    const currentIdentity = getCartItemIdentity(productId, variantId, selectedOptions);
    setItems((prev) =>
      prev.filter((item) => {
        if (item.product.id !== productId) return true;
        if (variantId === undefined && !selectedOptions) return false;
        return getCartItemIdentity(item.product.id, item.variantId, item.selectedOptions) !== currentIdentity;
      })
    );
  }, [canUseCurrentCart]);

  // 📌 Atualizar quantidade
  const updateQuantity = useCallback((productId: number, quantity: number, selectedOptions?: SelectedOptions, variantId?: number | null) => {
    if (!canUseCurrentCart) return;
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
  }, [canUseCurrentCart, removeFromCart]);

  // 📌 Limpar carrinho
  const clearCart = useCallback(() => {
    if (!canUseCurrentCart) return;
    setItems([]);
  }, [canUseCurrentCart]);

  const openCartDrawer = useCallback(() => setIsCartDrawerOpen(true), []);
  const closeCartDrawer = useCallback(() => setIsCartDrawerOpen(false), []);

  useEffect(() => {
    if (!canUseCurrentCart) return;
    const storage = typeof window === "undefined" ? null : window.localStorage;
    writeCart(storage, storageKey, items);
  }, [canUseCurrentCart, items, storageKey]);

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
