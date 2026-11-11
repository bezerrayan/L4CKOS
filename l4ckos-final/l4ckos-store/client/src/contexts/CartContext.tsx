import { trpc } from "../lib/trpc";
/**
 * CartContext - Gerencia o carrinho de compras global
 * Fornece: items, addToCart, removeFromCart, clearCart, updateQuantity, total
 */

import React, { createContext, useContext, useState, ReactNode, useCallback, useEffect, useMemo,
  useRef,
} from "react";
import type { CartItem, Cart, SelectedOptions, CartVariant, SellableVariantCatalog } from "../types/cart";
import type { Product } from "../types/product";
import { calculateCartTotal, calculateItemCount } from "../types/cart";
import { trackStoreEvent } from "../lib/analytics";
import { resolveCartVariant } from "../utils/cartVariantIdentity";
import { productPriceFromCents } from "../utils/money";
import { additionalUnitsAllowed, computeDropQuota, type DropGroup, type DropViewInput } from "../utils/dropQuota";
import {
  batchAcceptsSales,
  batchRemainingCapacity,
} from "../../../shared/preorder";

// ============= TIPOS =============

type CartContextType = {
  cart: Cart;
  isCatalogReady: boolean;
  addToCart: (product: Product, quantity: number, selectedOptions?: SelectedOptions, variant?: CartVariant
  ) => boolean;
  removeFromCart: (productId: number, selectedOptions?: SelectedOptions, variantId?: number) => void;
  updateQuantity: (productId: number, quantity: number, selectedOptions?: SelectedOptions, variantId?: number) => void;
  clearCart: () => void;
  isCartDrawerOpen: boolean;
  openCartDrawer: () => void;
  closeCartDrawer: () => void;
  preorderAdditionalLimit: (product: Product) => number | null;
  hasUnavailableItems: boolean;
  revalidateCart: () => Promise<boolean>;
  /** Exclusive-drop limits derived from the server view; empty when unknown. The checkout remains the definitive gate. */
  dropQuota: { groups: DropGroup[]; byProduct: Record<number, DropGroup> };
  /** True only when the server data already proves checkout would refuse (over limit, no access, window closed). */
  dropQuotaBlocked: boolean;
  /** False when a KNOWN drop limit leaves no room for one more unit of this line's product. */
  canIncreaseQuantity: (productId: number) => boolean;
};

const DROP_VIEW_REFRESH_MS = 30_000;

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
  const trpcUtils = trpc.useUtils();
  const [variantCatalogs, setVariantCatalogs] = useState<Record<number, SellableVariantCatalog>>({});
  const [variantCatalogsLoading, setVariantCatalogsLoading] = useState(false);
  const variantProductIdsKey = Array.from(new Set(items.map(item => item.product.id))).sort((a, b) => a - b).join(",");
  // Exclusive-drop views per product (viewer-specific). Keyed by account so a login/logout/expiry never reuses another state.
  const me = trpc.auth.me.useQuery(undefined, { retry: false, staleTime: 30_000 });
  const viewerKey = String((me?.data as { id?: number } | null | undefined)?.id ?? "anon");
  const [dropViews, setDropViews] = useState<Record<number, DropViewInput>>({});
  const fetchDropViews = useCallback(async (productIds: number[]) => {
    const entries = await Promise.all(productIds.map(async productId => {
      try {
        const view = await trpcUtils.exclusiveDrops.forProduct.fetch({ productId }, { staleTime: 0 });
        return [productId, (view ?? null) as DropViewInput | null] as const;
      } catch {
        return [productId, null] as const; // unknown: no cap is invented
      }
    }));
    const views: Record<number, DropViewInput> = {};
    for (const [productId, view] of entries) if (view) views[productId] = view;
    return views;
  }, [trpcUtils]);
  useEffect(() => {
    const productIds = variantProductIdsKey ? variantProductIdsKey.split(",").map(Number) : [];
    if (productIds.length === 0) { setDropViews({}); return; }
    let current = true;
    const refresh = () => { void fetchDropViews(productIds).then(views => { if (current) setDropViews(views); }); };
    refresh();
    const timer = window.setInterval(refresh, DROP_VIEW_REFRESH_MS);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => { current = false; window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [fetchDropViews, variantProductIdsKey, viewerKey]);

  useEffect(() => {
    const productIds = variantProductIdsKey ? variantProductIdsKey.split(",").map(Number) : [];
    if (productIds.length === 0) {
      setVariantCatalogs({});
      setVariantCatalogsLoading(false);
      return;
    }
    let current = true;
    setVariantCatalogsLoading(true);
    void Promise.all(productIds.map(async productId => {
      try {
        return [productId, await trpcUtils.products.sellableVariants.fetch(productId)] as const;
      } catch {
        return [productId, null] as const;
      }
    })).then(entries => {
      if (!current) return;
      const catalogs: Record<number, SellableVariantCatalog> = {};
      for (const [productId, catalog] of entries) if (catalog) catalogs[productId] = catalog;
      setVariantCatalogs(catalogs);
      setVariantCatalogsLoading(false);
    });
    return () => { current = false; };
  }, [trpcUtils, variantProductIdsKey]);

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
  const refreshItems = (source: CartItem[], data = catalog.data, variants = variantCatalogs) =>
    source.map(item => {
      const live = data?.find(p => p.id === item.product.id);
      const variantCatalog = variants[item.product.id];
      let resolvedVariant = item.variant;
      if (variantCatalog?.hasVariants) {
        resolvedVariant = resolveCartVariant(variantCatalog, item) ?? item.variant;
      } else if (variantCatalog?.hasVariants === false) {
        resolvedVariant = undefined;
      }
      if (!live) return data ? { ...item, variant: resolvedVariant, product: { ...item.product, stock: 0, productionBatch: null } } : item;
      return {
        ...item,
        variant: resolvedVariant,
        product: {
          ...item.product,
          price: resolvedVariant
            ? productPriceFromCents(resolvedVariant.priceCents)
            : productPriceFromCents(Number(live.price ?? Math.round(item.product.price * 100))),
          salesMode: live.salesMode,
          productionBatch: live.productionBatch,
          stock: Number(live.stock ?? 0),
        },
      };
    });
  const currentItems = refreshItems(items);
  // Keep repeated actions in the same render from claiming the same free pieces.
  const itemsRef = useRef(currentItems);
  itemsRef.current = currentItems;
  const cart: Cart = {
    items:currentItems,
    total: calculateCartTotal(currentItems),
    itemCount: calculateItemCount(currentItems),
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
  const unavailable = (source: CartItem[], data = catalog.data, variants = variantCatalogs) =>
    source.some(item => {
      if (
        !Number.isInteger(item.quantity) ||
        item.quantity <= 0 ||
        item.quantity > 99
      )
        return true;
      if (data && !data.some(p => p.id === item.product.id)) return true;
      const variantCatalog = variants[item.product.id];
      if (!variantCatalog) return true;
      if (!variantCatalog.publicPurchaseAllowed) return true;
      if (variantCatalog.hasVariants) {
        if (!item.variant) return true;
        const liveVariant = variantCatalog.variants.find(variant => variant.variantId === item.variant?.variantId);
        const requested = source.filter(candidate => candidate.product.id === item.product.id && candidate.variant?.variantId === item.variant?.variantId)
          .reduce((sum, candidate) => sum + candidate.quantity, 0);
        if (!liveVariant || (liveVariant.availableUnits !== null && requested > liveVariant.availableUnits)) return true;
      } else {
        if (item.variant) return true;
        const requested = source.filter(candidate => candidate.product.id === item.product.id && !candidate.variant)
          .reduce((sum, candidate) => sum + candidate.quantity, 0);
        if (item.product.salesMode !== "PREORDER" && requested > Number(item.product.stock ?? 0)) return true;
      }
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
  const dropQuota = useMemo(
    () => computeDropQuota(currentItems.map(item => ({ productId: item.product.id, quantity: item.quantity })), dropViews),
    [currentItems, dropViews],
  );
  const dropQuotaBlocked = dropQuota.groups.some(group => group.blocking);
  const canIncreaseQuantity = useCallback(
    (productId: number) => additionalUnitsAllowed(dropQuota.byProduct[productId]) !== 0,
    [dropQuota],
  );
  /** Units still allowed for a product (cart lines + a product not yet in the cart), or null when no cap is known. */
  const dropAdditionalFor = (productId: number, lines: CartItem[]): number | null => {
    const view = dropViews[productId] ?? (trpcUtils.exclusiveDrops.forProduct.getData({ productId }) as DropViewInput | undefined);
    const lineViews = { ...dropViews, ...(view ? { [productId]: view } : {}) };
    const quota = computeDropQuota(
      [...lines.map(item => ({ productId: item.product.id, quantity: item.quantity })), { productId, quantity: 0 }],
      lineViews,
    );
    return additionalUnitsAllowed(quota.byProduct[productId]);
  };
  const revalidateCart = async () => {
    const result = await catalog.refetch();
    if (!result.isSuccess) return false;
    const ids = Array.from(new Set(itemsRef.current.map(item => item.product.id)));
    const entries = await Promise.all(ids.map(async productId => {
      try { return [productId, await trpcUtils.products.sellableVariants.fetch(productId)] as const; }
      catch { return [productId, null] as const; }
    }));
    const freshVariants: Record<number, SellableVariantCatalog> = {};
    for (const [productId, variantCatalog] of entries) if (variantCatalog) freshVariants[productId] = variantCatalog;
    setVariantCatalogs(freshVariants);
    setDropViews(await fetchDropViews(ids));
    const refreshed = refreshItems(itemsRef.current, result.data, freshVariants);
    itemsRef.current = refreshed;
    setItems(refreshed);
    return !unavailable(refreshed, result.data, freshVariants);
  };

  // 📌 Adicionar produto ao carrinho
  const addToCart = useCallback(
    (
      product: Product,
      quantity: number = 1,
      selectedOptions?: SelectedOptions,
      variant?: CartVariant
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
      if (variant && (!Number.isInteger(variant.variantId) || variant.variantId <= 0 ||
        variant.color !== (selectedOptions?.cor || selectedOptions?.color) ||
        variant.size !== (selectedOptions?.tamanho || selectedOptions?.size) ||
        !Number.isSafeInteger(variant.priceCents) || variant.priceCents <= 0)) return false;
      if (!variant && variantCatalogs[product.id]?.hasVariants) return false;
      if (variantCatalogs[product.id] && !variantCatalogs[product.id].publicPurchaseAllowed) return false;
      if (variant && product.salesMode !== "PREORDER" &&
        (variant.availableUnits === null || quantity > variant.availableUnits)) return false;
      // Known exclusive-drop cap (shared by every product of the drop). Unknown cap: the server decides at checkout.
      const dropAdditional = dropAdditionalFor(product.id, itemsRef.current);
      if (dropAdditional !== null && quantity > dropAdditional) return false;
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
            (variant
              ? item.variant?.variantId === variant.variantId
              : !item.variant && normalizeOptions(item.selectedOptions) === currentOptionsKey)
        );

        if (existing) {
          if (variant && product.salesMode !== "PREORDER" &&
            (variant.availableUnits === null || existing.quantity + quantity > variant.availableUnits)) return prev;
          // checkoutItemSchema already limits each checkout line to 99 (all sales modes).
          if (
            product.salesMode === "PREORDER" &&
            existing.quantity + quantity > 99
          )
            return prev;
          // Se já existe, aumenta a quantidade
          return prev.map(item =>
            item.product.id === product.id &&
            (variant
              ? item.variant?.variantId === variant.variantId
              : !item.variant && normalizeOptions(item.selectedOptions) === currentOptionsKey)
              ? { ...item, quantity: item.quantity + quantity }
              : item
          );
        }

        // Senão, adiciona novo
        return [
          ...prev,
          {
            product: variant ? { ...product, price: productPriceFromCents(variant.priceCents) } : product,
            quantity,
            selectedOptions: variant ? { ...selectedOptions, cor: variant.color, tamanho: variant.size } : selectedOptions,
            ...(variant ? { variant } : {}),
            addedAt: new Date(),
          },
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
    [currentItems, catalog.data, catalog.isSuccess, catalog.isFetching, variantCatalogs, dropViews]
  );

  // 📌 Remover produto do carrinho
  const removeFromCart = useCallback(
    (productId: number, selectedOptions?: SelectedOptions, variantId?: number) => {
      const currentOptionsKey = normalizeOptions(selectedOptions);
      const next = itemsRef.current.filter(item => {
        if (item.product.id !== productId) return true;
        if (variantId !== undefined) return item.variant?.variantId !== variantId;
        if (!selectedOptions) return false;
        if (item.variant) return true;
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
      selectedOptions?: SelectedOptions,
      variantId?: number
    ) => {
      if (!Number.isInteger(quantity)) return;
      if (quantity <= 0) {
        removeFromCart(productId, selectedOptions, variantId);
        return;
      }
      const currentOptionsKey = normalizeOptions(selectedOptions);
      const targets = itemsRef.current.filter(
        item =>
          item.product.id === productId &&
          (variantId !== undefined
            ? item.variant?.variantId === variantId
            : selectedOptions
              ? !item.variant && normalizeOptions(item.selectedOptions) === currentOptionsKey
              : !item.variant)
      );
      const target = targets[0];
      const additional = target
        ? preorderAdditionalLimit(target.product)
        : null;
      const otherQuantity = itemsRef.current
        .filter(item => item.product.id === productId && (variantId !== undefined
          ? item.variant?.variantId === variantId
          : !item.variant))
        .filter(item => item !== target)
        .reduce((sum, item) => sum + item.quantity, 0);
      const stockMaximum = target?.variant?.availableUnits ??
        (target?.product.salesMode === "PREORDER" ? 99 : Number(target?.product.stock ?? 0));
      const maximum =
        target?.product.salesMode === "PREORDER" && additional !== null
          ? Math.floor(
              (additional +
                targets.reduce((sum, item) => sum + item.quantity, 0)) /
                targets.length
            )
          : target?.variant ? Math.max(0, Math.min(stockMaximum, stockMaximum - otherQuantity)) : Math.max(0, Math.min(stockMaximum, stockMaximum - otherQuantity));

      // Increases are clamped to the KNOWN drop cap (units may always be reduced, even while over the limit).
      const dropAdditional = target && quantity > target.quantity ? dropAdditionalFor(productId, itemsRef.current) : null;
      const dropMaximum = target && dropAdditional !== null ? target.quantity + dropAdditional : Infinity;
      const next = itemsRef.current.map(item =>
        item.product.id === productId &&
        (variantId !== undefined
          ? item.variant?.variantId === variantId
          : selectedOptions
            ? !item.variant && normalizeOptions(item.selectedOptions) === currentOptionsKey
            : !item.variant)
          ? {
              ...item,
              quantity: Math.min(
                quantity,
                maximum,
                dropMaximum,
                item.product.salesMode === "PREORDER" ? 99 : quantity
              ),
            }
          : item
      );
      itemsRef.current = next;
      setItems(next);
    },
    [removeFromCart, currentItems, preorderAdditionalLimit, dropViews]
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
    isCatalogReady: items.length === 0 || (catalog.isSuccess && !catalog.isFetching && !variantCatalogsLoading),
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
    dropQuota,
    dropQuotaBlocked,
    canIncreaseQuantity,
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
