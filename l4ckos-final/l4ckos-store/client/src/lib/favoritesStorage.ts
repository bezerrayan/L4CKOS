import type { Product } from "../types/product";

const FAVORITES_STORAGE_PREFIX = "l4ckos:favorites:";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function getFavoritesStorageKey(userId?: string | number | null) {
  return `${FAVORITES_STORAGE_PREFIX}${userId ? `user:${userId}` : "anonymous"}`;
}

function normalizeFavorites(value: unknown): Product[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  return value.flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const product = item as Product;
    if (!Number.isInteger(product.id) || product.id <= 0 || seen.has(product.id)) return [];
    seen.add(product.id);
    return [product];
  });
}

export function readFavorites(storage: StorageLike | null, key: string): Product[] {
  if (!storage) return [];

  try {
    const parsed = JSON.parse(storage.getItem(key) || "[]") as unknown;
    return normalizeFavorites(parsed);
  } catch {
    return [];
  }
}

export function writeFavorites(storage: StorageLike | null, key: string, favorites: Product[]) {
  if (!storage) return;

  try {
    const normalized = normalizeFavorites(favorites);
    if (normalized.length === 0) {
      storage.removeItem(key);
      return;
    }
    storage.setItem(key, JSON.stringify(normalized));
  } catch {
    // Local storage is an optional UX cache and must never break the storefront.
  }
}
