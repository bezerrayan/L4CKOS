import { describe, expect, it } from "vitest";
import { getCartStorageKey, readCart, writeCart } from "../client/src/lib/cartStorage";
import type { CartItem } from "../client/src/types/cart";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const item = (id: number): CartItem => ({
  product: { id, name: `Produto ${id}`, price: 100, image: "/produto.webp", stock: 10 },
  quantity: 1,
  variantId: null,
  selectedOptions: {},
  addedAt: new Date(),
});

describe("cart browser persistence by identity", () => {
  it("A. mantém itens de visitante somente na chave anonymous", () => {
    const storage = new MemoryStorage();
    const anonymousKey = getCartStorageKey();
    writeCart(storage, anonymousKey, [item(1)]);
    expect(anonymousKey).toBe("l4ckos:cart:anonymous");
    expect(readCart(storage, anonymousKey)).toMatchObject([{ product: { id: 1 } }]);
  });

  it("B. logout não expõe o carrinho do usuário na sessão anonymous", () => {
    const storage = new MemoryStorage();
    const anonymousKey = getCartStorageKey();
    const userAKey = getCartStorageKey("user-a");
    writeCart(storage, userAKey, [item(1)]);
    expect(readCart(storage, anonymousKey)).toEqual([]);
  });

  it("C. novo login restaura somente o carrinho previamente salvo do usuário", () => {
    const storage = new MemoryStorage();
    const userAKey = getCartStorageKey("user-a");
    writeCart(storage, userAKey, [item(1)]);
    expect(readCart(storage, userAKey)).toMatchObject([{ product: { id: 1 } }]);
  });

  it("D. usuários diferentes nunca compartilham a mesma chave", () => {
    const storage = new MemoryStorage();
    const userAKey = getCartStorageKey("user-a");
    const userBKey = getCartStorageKey("user-b");
    writeCart(storage, userAKey, [item(1)]);
    expect(userAKey).not.toBe(userBKey);
    expect(readCart(storage, userBKey)).toEqual([]);
  });

  it("E. não faz merge automático entre visitante e usuário autenticado", () => {
    const storage = new MemoryStorage();
    const anonymousKey = getCartStorageKey();
    const userAKey = getCartStorageKey("user-a");
    writeCart(storage, anonymousKey, [item(1)]);
    writeCart(storage, userAKey, [item(2)]);
    expect(readCart(storage, anonymousKey)).toMatchObject([{ product: { id: 1 } }]);
    expect(readCart(storage, userAKey)).toMatchObject([{ product: { id: 2 } }]);
  });

  it("F. ignora a chave legada sem apagá-la ou importá-la", () => {
    const storage = new MemoryStorage();
    storage.setItem("loja-escoteira:cart", JSON.stringify([item(1)]));
    expect(readCart(storage, getCartStorageKey())).toEqual([]);
    expect(readCart(storage, getCartStorageKey("user-a"))).toEqual([]);
    expect(storage.getItem("loja-escoteira:cart")).not.toBeNull();
  });

  it("G. trocar de identidade não sobrescreve o carrinho previamente salvo", () => {
    const storage = new MemoryStorage();
    const userAKey = getCartStorageKey("user-a");
    const userBKey = getCartStorageKey("user-b");
    writeCart(storage, userAKey, [item(1)]);
    writeCart(storage, userBKey, [item(2)]);
    expect(readCart(storage, userAKey)).toMatchObject([{ product: { id: 1 } }]);
    expect(readCart(storage, userBKey)).toMatchObject([{ product: { id: 2 } }]);
  });
});
