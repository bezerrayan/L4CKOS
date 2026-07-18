/**
 * CartContext - Gerencia o carrinho de compras global
 * Fornece: items, addToCart, removeFromCart, clearCart, updateQuantity, total
 */

import React, { createContext, useContext, useState, ReactNode, useCallback, useEffect } from "react";
import type { CartItem, Cart, SelectedOptions } from "../types/cart";
import type { Product } from "../types/product";
import { calculateCartTotal, calculateItemCount } from "../types/cart";

// ============= TIPOS =============

type CartContextType = {
  cart: Cart;
  addToCart: (product: Product, quantity: number, selectedOptions?: SelectedOptions) => void;
  removeFromCart: (productId: number, selectedOptions?: SelectedOptions) => void;
  updateQuantity: (productId: number, quantity: number, selectedOptions?: SelectedOptions) => void;
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
      return Array.isArray(parsed) ? parsed : [];
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
  const addToCart = useCallback((product: Product, quantity: number = 1, selectedOptions?: SelectedOptions) => {
    setItems((prev) => {
      const currentOptionsKey = normalizeOptions(selectedOptions);
      const existing = prev.find(
        (item) => item.product.id === product.id && normalizeOptions(item.selectedOptions) === currentOptionsKey
      );
      
      if (existing) {
        // Se já existe, aumenta a quantidade
        return prev.map((item) =>
          item.product.id === product.id && normalizeOptions(item.selectedOptions) === currentOptionsKey
            ? { ...item, quantity: item.quantity + quantity }
            : item
        );
      }
      
      // Senão, adiciona novo
      return [...prev, { product, quantity, selectedOptions, addedAt: new Date() }];
    });
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
          ? { ...item, quantity }
          : item
      )
    );
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
