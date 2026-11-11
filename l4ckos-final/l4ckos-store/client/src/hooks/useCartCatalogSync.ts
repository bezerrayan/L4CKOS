import { useEffect, useMemo, useState } from "react";
import { useCart } from "../contexts/CartContext";
import { trpc } from "../lib/trpc";
import { mapCatalogVariants } from "../stock/catalogVariants";

const REFRESH_EVENT = "l4ckos:cart-catalog-refresh";

/** Asks the mounted cart/catalog sync to re-read stock from the backend now (e.g. after STOCK_UNAVAILABLE). */
export function requestCartCatalogRefresh() {
  window.dispatchEvent(new Event(REFRESH_EVENT));
}

export type CartCatalogSyncState = "idle" | "syncing" | "synced" | "error";

/**
 * Refreshes price/stock/variant snapshots of the cart from `products.getById` (the backend catalog).
 * The cart is persisted in localStorage, so its snapshot can be days old. This never changes
 * quantities or selections: it only updates what the customer is shown, so availability and totals
 * shown before payment follow the backend. The server still revalidates everything at checkout.
 */
export function useCartCatalogSync(): CartCatalogSyncState {
  const { cart, syncCatalog } = useCart();
  const utils = trpc.useUtils();
  const [state, setState] = useState<CartCatalogSyncState>("idle");
  const idsKey = useMemo(
    () => [...new Set(cart.items.map(item => item.product.id))].sort((a, b) => a - b).join(","),
    [cart.items],
  );

  useEffect(() => {
    if (!idsKey) {
      setState("idle");
      return;
    }
    let cancelled = false;
    const ids = idsKey.split(",").map(Number);

    const run = async () => {
      setState(current => (current === "synced" ? current : "syncing"));
      const results = await Promise.allSettled(ids.map(id => utils.products.getById.fetch(id, { staleTime: 0 })));
      if (cancelled) return;
      const fresh: Parameters<typeof syncCatalog>[0] = [];
      let failed = false;
      results.forEach(result => {
        if (result.status !== "fulfilled" || !result.value) {
          failed = true;
          return;
        }
        const data = result.value as Record<string, unknown> & { id: number };
        const variants = mapCatalogVariants(data.variants, data.id);
        fresh.push({
          id: data.id,
          price: Number(data.price) / 100,
          stock: Number(data.stock ?? 0),
          variantCatalogPresent: Array.isArray(data.variants) && data.variants.length > 0,
          variants,
        });
      });
      if (fresh.length) syncCatalog(fresh);
      setState(failed ? "error" : "synced");
    };

    void run();
    const onFocus = () => { void run(); };
    window.addEventListener("focus", onFocus);
    window.addEventListener(REFRESH_EVENT, onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(REFRESH_EVENT, onFocus);
    };
  }, [idsKey, syncCatalog, utils]);

  return state;
}
