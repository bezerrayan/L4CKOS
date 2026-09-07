import { describe, expect, it } from "vitest";
import { getFavoritesStorageKey, readFavorites, writeFavorites } from "../client/src/lib/favoritesStorage";
import type { Product } from "../client/src/types/product";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const product = (id: number): Product => ({ id, name: `Produto ${id}`, price: 100, image: "/produto.webp", stock: 1 });

describe("favorites browser persistence", () => {
  it("hydrates a valid saved list without duplicates", () => {
    const storage = new MemoryStorage();
    const key = getFavoritesStorageKey("user-a");
    storage.setItem(key, JSON.stringify([product(1), product(1), product(2)]));

    expect(readFavorites(storage, key).map(item => item.id)).toEqual([1, 2]);
  });

  it("persists additions and isolates authenticated users", () => {
    const storage = new MemoryStorage();
    const keyA = getFavoritesStorageKey("user-a");
    const keyB = getFavoritesStorageKey("user-b");
    writeFavorites(storage, keyA, [product(1)]);

    expect(readFavorites(storage, keyA).map(item => item.id)).toEqual([1]);
    expect(readFavorites(storage, keyB)).toEqual([]);
  });

  it("never persists duplicate product ids", () => {
    const storage = new MemoryStorage();
    const key = getFavoritesStorageKey("user-a");
    writeFavorites(storage, key, [product(1), product(1)]);

    expect(readFavorites(storage, key).map(item => item.id)).toEqual([1]);
  });

  it("keeps visitor, user A and user B lists isolated and restores user A after relogin", () => {
    const storage = new MemoryStorage();
    const visitor = getFavoritesStorageKey();
    const userA = getFavoritesStorageKey("user-a");
    const userB = getFavoritesStorageKey("user-b");
    writeFavorites(storage, visitor, [product(9)]);
    writeFavorites(storage, userA, [product(1)]);

    expect(readFavorites(storage, userB)).toEqual([]);
    expect(readFavorites(storage, visitor).map(item => item.id)).toEqual([9]);
    expect(readFavorites(storage, userA).map(item => item.id)).toEqual([1]);
  });

  it("removes the key when favorites are removed or cleared", () => {
    const storage = new MemoryStorage();
    const key = getFavoritesStorageKey("user-a");
    writeFavorites(storage, key, [product(1)]);
    writeFavorites(storage, key, []);

    expect(storage.getItem(key)).toBeNull();
  });

  it("tolerates invalid local storage data", () => {
    const storage = new MemoryStorage();
    const key = getFavoritesStorageKey("user-a");
    storage.setItem(key, "{not-json");

    expect(readFavorites(storage, key)).toEqual([]);
  });
});
