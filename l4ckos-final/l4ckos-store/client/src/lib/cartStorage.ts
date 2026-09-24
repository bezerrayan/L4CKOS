import { reconcileCartItems } from "./cartStock";
import type { CartItem } from "../types/cart";

const CART_STORAGE_PREFIX = "l4ckos:cart:";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function getCartStorageKey(userId?: string | number | null) {
  const normalizedUserId = String(userId ?? "").trim();
  return `${CART_STORAGE_PREFIX}${normalizedUserId ? `user:${normalizedUserId}` : "anonymous"}`;
}

export function readCart(storage: StorageLike | null, key: string): CartItem[] {
  if (!storage) return [];

  try {
    const parsed = JSON.parse(storage.getItem(key) || "[]") as unknown;
    return Array.isArray(parsed) ? reconcileCartItems(parsed as CartItem[]) : [];
  } catch {
    return [];
  }
}

export function writeCart(storage: StorageLike | null, key: string, items: CartItem[]) {
  if (!storage) return;

  try {
    const normalized = reconcileCartItems(items);
    if (normalized.length === 0) {
      storage.removeItem(key);
      return;
    }
    storage.setItem(key, JSON.stringify(normalized));
  } catch {
    // Local storage is an optional UX cache and must never break checkout.
  }
}
