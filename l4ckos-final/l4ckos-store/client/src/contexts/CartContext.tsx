import { trpc } from "../lib/trpc";
/**
 * CartContext - Gerencia o carrinho de compras global
 * Fornece: items, addToCart, removeFromCart, clearCart, updateQuantity, total
 */

import React, { createContext, useContext, useState, ReactNode, useCallback, useEffect,
  useRef,
} from "react";
import type { CartItem, Cart, SelectedOptions } from "../types/cart";
import type { Product } from "../types/product";
import { calculateCartTotal, calculateItemCount } from "../types/cart";
import { trackStoreEvent } from "../lib/analytics";
import {
  batchAcceptsSales,
  batchRemainingCapacity,
} from "../../../shared/preorder";

// ============= TIPOS =============

type CartContextType = {
  cart: Cart;
  isCatalogReady: boolean;
  addToCart: (product: Product, quantity: number, selectedOptions?: SelectedOptions
  ) => boolean;
  removeFromCart: (productId: number, selectedOptions?: SelectedOptions) => void;
  updateQuantity: (productId: number, quantity: number, selectedOptions?: SelectedOptions) => void;
  clearCart: () => void;
  isCartDrawerOpen: boolean;
  openCartDrawer: () => void;
  closeCartDrawer: () => void;
  preorderAdditionalLimit: (product: Product) => number | null;
  hasUnavailableItems: boolean;
  revalidateCart: () => Promise<boolean>;
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

  const catalog =trpc.products.list.useQuery({limit:10000},
    {enabled:items.length>0,
      staleTime: 0,
      refetchOnMount: "always",refetchOnWindowFocus:true,
      refetchInterval: 15000,
    }
  );
  const refreshItems = (source: CartItem[], data = catalog.data) =>
    source.map(item => {
      const live = data?.find(p => p.id === item.product.id);
      return live
        ? {
            ...item,
            product: {
              ...item.product,
              salesMode: live.salesMode,
              productionBatch: live.productionBatch,
              stock: Number(live.stock ?? 0),
            },
          }
        : data
          ? {
              ...item,
              product: { ...item.product, stock: 0, productionBatch: null },
            }
          : item;
    });
  const currentItems = refreshItems(items);
  // Keep repeated actions in the same render from claiming the same free pieces.
  const itemsRef = useRef(currentItems);
  itemsRef.current = currentItems;
  const cart: Cart = {
    items:currentItems,
    total: calculateCartTotal(items),
    itemCount: calculateItemCount(items),
  };
  const preorderRequested = (source: CartItem[], batchId: number) =>
    source
      .filter(
        item =>
          item.product.salesMode === "PREORDER" &&
          item.product.productionBatch?.id === batchId
      )
      .reduce((sum, item) => sum + item.quantity, 0);
  const preorderAdditionalLimit = useCallback(
    (product: Product) => {
      const live =
        currentItems.length > 0
          ? catalog.data?.find(p => p.id === product.id)
          : undefined;
      if ((live?.salesMode ?? product.salesMode) !== "PREORDER") return null;
      const batch = live ? live.productionBatch : product.productionBatch;
      if (!batchAcceptsSales(batch)) return 0;
      const remaining = batchRemainingCapacity(batch);
      return remaining === null
        ? null
        : Math.max(
            0,
            remaining - preorderRequested(itemsRef.current, batch!.id)
          );
    },
    [currentItems, catalog.data]
  );
  const unavailable = (source: CartItem[], data = catalog.data) =>
    source.some(item => {
      if (
        !Number.isInteger(item.quantity) ||
        item.quantity <= 0 ||
        item.quantity > 99
      )
        return true;
      if (data && !data.some(p => p.id === item.product.id)) return true;
      const batch = item.product.productionBatch,
        remaining = batchRemainingCapacity(batch);
      return (
        item.product.salesMode === "PREORDER" &&
        (!batchAcceptsSales(batch) ||
          (remaining !== null &&
            preorderRequested(source, batch!.id) > remaining))
      );
    });
  const hasUnavailableItems = unavailable(currentItems);
  const revalidateCart = async () => {
    const result = await catalog.refetch();
    return (
      result.isSuccess &&
      !unavailable(refreshItems(itemsRef.current, result.data), result.data)
    );
  };

  // 📌 Adicionar produto ao carrinho
  const addToCart = useCallback(
    (
      product: Product,
      quantity: number = 1,
      selectedOptions?: SelectedOptions
    ) => {
      if (!Number.isInteger(quantity) || quantity <= 0) return false;
      if (
        itemsRef.current.length > 0 &&
        (!catalog.isSuccess || catalog.isFetching)
      )
        return false;
      const live =
        currentItems.length > 0
          ? catalog.data?.find(p => p.id === product.id)
          : undefined;
      if (currentItems.length > 0 && catalog.data && !live) return false;
      if (live)
        product = {
          ...product,
          salesMode: live.salesMode,
          productionBatch: live.productionBatch,
        };
      if (product.salesMode === "PREORDER") {
        if (!batchAcceptsSales(product.productionBatch)) return false;
        const remaining = batchRemainingCapacity(product.productionBatch);
        if (
          remaining !== null &&
          preorderRequested(itemsRef.current, product.productionBatch!.id) +
            quantity >
            remaining
        )
          return false;
      }
      const next = ((prev: CartItem[]) => {
        const currentOptionsKey = normalizeOptions(selectedOptions);
        const existing = prev.find(
          item =>
            item.product.id === product.id &&
            normalizeOptions(item.selectedOptions) === currentOptionsKey
        );

        if (existing) {
          // checkoutItemSchema already limits each checkout line to 99 (all sales modes).
          if (
            product.salesMode === "PREORDER" &&
            existing.quantity + quantity > 99
          )
            return prev;
          // Se já existe, aumenta a quantidade
          return prev.map(item =>
            item.product.id === product.id &&
            normalizeOptions(item.selectedOptions) === currentOptionsKey
              ? { ...item, quantity: item.quantity + quantity }
              : item
          );
        }

        // Senão, adiciona novo
        return [
          ...prev,
          { product, quantity, selectedOptions, addedAt: new Date() },
        ];
      })(itemsRef.current);
      if (
        next === itemsRef.current ||
        (product.salesMode === "PREORDER" && quantity > 99)
      )
        return false;
      itemsRef.current = next;
      setItems(next);
      trackStoreEvent("cart_item_added", { product_id: product.id, quantity });
      setIsCartDrawerOpen(true);
      return true;
    },
    [currentItems, catalog.data, catalog.isSuccess, catalog.isFetching]
  );

  // 📌 Remover produto do carrinho
  const removeFromCart = useCallback(
    (productId: number, selectedOptions?: SelectedOptions) => {
      const currentOptionsKey = normalizeOptions(selectedOptions);
      const next = itemsRef.current.filter(item => {
        if (item.product.id !== productId) return true;
        if (!selectedOptions) return false;
        return normalizeOptions(item.selectedOptions) !== currentOptionsKey;
      });
      itemsRef.current = next;
      setItems(next);
      trackStoreEvent("cart_item_removed", { product_id: productId });
    },
    []
  );

  // 📌 Atualizar quantidade
  const updateQuantity = useCallback(
    (
      productId: number,
      quantity: number,
      selectedOptions?: SelectedOptions
    ) => {
      if (!Number.isInteger(quantity)) return;
      if (quantity <= 0) {
        removeFromCart(productId, selectedOptions);
        return;
      }
      const currentOptionsKey = normalizeOptions(selectedOptions);
      const targets = itemsRef.current.filter(
        item =>
          item.product.id === productId &&
          (!selectedOptions ||
            normalizeOptions(item.selectedOptions) === currentOptionsKey)
      );
      const target = targets[0];
      const additional = target
        ? preorderAdditionalLimit(target.product)
        : null;
      const maximum =
        target?.product.salesMode === "PREORDER" && additional !== null
          ? Math.floor(
              (additional +
                targets.reduce((sum, item) => sum + item.quantity, 0)) /
                targets.length
            )
          : quantity;

      const next = itemsRef.current.map(item =>
        item.product.id === productId &&
        (!selectedOptions ||
          normalizeOptions(item.selectedOptions) === currentOptionsKey)
          ? {
              ...item,
              quantity: Math.min(
                quantity,
                maximum,
                item.product.salesMode === "PREORDER" ? 99 : quantity
              ),
            }
          : item
      );
      itemsRef.current = next;
      setItems(next);
    },
    [removeFromCart, currentItems, preorderAdditionalLimit]
  );

  // 📌 Limpar carrinho
  const clearCart = useCallback(() => {
    itemsRef.current = [];
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
    isCatalogReady: items.length===0 || (catalog.isSuccess && !catalog.isFetching),
    addToCart,
    removeFromCart,
    updateQuantity,
    clearCart,
    isCartDrawerOpen,
    openCartDrawer,
    closeCartDrawer,
    preorderAdditionalLimit,
    hasUnavailableItems,
    revalidateCart,
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
