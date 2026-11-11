import type { CartItem } from "../types/cart";

export interface CartStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function readCartItems(storage: CartStorage, key: string): CartItem[] {
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter(item =>
      Boolean(item) && typeof item === "object" &&
      Number.isSafeInteger(item.quantity) && item.quantity > 0 &&
      Boolean(item.product) && Number.isSafeInteger(item.product.id) && item.product.id > 0,
    ) as CartItem[];
  } catch {
    return [];
  }
}

export function writeCartItems(storage: CartStorage, key: string, items: CartItem[]) {
  try {
    if (items.length === 0) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(items));
  } catch {
    // Storage failure must not break browsing; checkout request still validates required variant identity.
  }
}
