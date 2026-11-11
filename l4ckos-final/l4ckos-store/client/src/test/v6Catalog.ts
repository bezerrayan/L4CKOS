import { setTrpc } from "./fakeTrpc";

type CatalogVariant = { variantId: number; color: string; size: string; price: number; availableUnits: number | null };
type CatalogOptions = {
  productIds?: number[];
  variants?: CatalogVariant[];
  publicPurchaseAllowed?: boolean;
  /** Extra product fields served by `products.list` (stock, price, salesMode...). */
  product?: Record<string, unknown>;
};

export const catalogVariant = (over: Partial<CatalogVariant> = {}): CatalogVariant => ({ variantId: 11, color: "Preto", size: "M", price: 9990, availableUnits: 5, ...over });

/**
 * Serves what the V6 CartProvider reads from the backend: the live product list and each product's sellable-variant catalog.
 * Deterministic and offline: no network, no payment.
 */
export function serveCatalog(options: CatalogOptions = {}) {
  const ids = options.productIds ?? [1];
  const variants = options.variants ?? [catalogVariant()];
  const products = ids.map(id => ({ id, price: 9990, stock: 10, salesMode: "STOCK", productionBatch: null, ...options.product }));
  setTrpc("products.list.useQuery", () => ({ data: products, isSuccess: true, isFetching: false, isLoading: false, refetch: async () => ({ isSuccess: true, data: products }) }));
  setTrpc("utils.products.sellableVariants.fetch", async (productId: number) => ({
    productId, hasVariants: true, publicPurchaseAllowed: options.publicPurchaseAllowed ?? true,
    variants: variants.map(variant => ({ ...variant, available: true })),
  }));
}
