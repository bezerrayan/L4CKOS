import { describe, expect, it } from "vitest";
import { clampCartQuantity, getCartItemIdentity, getItemAvailableStock, reconcileCartItems } from "../client/src/lib/cartStock";
import type { CartItem } from "../client/src/types/cart";
import type { Product } from "../client/src/types/product";

const product = (stock: number, variants?: Product["variants"]): Product => ({ id: 1, name: "Camiseta", price: 100, image: "/camiseta.webp", stock, variants });
const cartItem = (itemProduct: Product, quantity: number, variantId: number | null = null): CartItem => ({ product: itemProduct, quantity, variantId, selectedOptions: {}, addedAt: new Date() });

describe("cart stock boundaries", () => {
  it("keeps stock zero out of the cart and caps stock one", () => {
    expect(clampCartQuantity(product(0), null, 1)).toBe(0);
    expect(clampCartQuantity(product(1), null, 1)).toBe(1);
    expect(clampCartQuantity(product(1), null, 2)).toBe(1);
  });

  it("caps repeated additions and direct quantity updates at available stock", () => {
    const itemProduct = product(5);
    expect(clampCartQuantity(itemProduct, null, 4 + 3)).toBe(5);
    expect(clampCartQuantity(itemProduct, null, 6)).toBe(5);
  });

  it("uses each variant stock independently", () => {
    const itemProduct = product(10, [{ id: 11, stock: 1 }, { id: 12, stock: 3 }]);
    expect(getItemAvailableStock(itemProduct, 11)).toBe(1);
    expect(getItemAvailableStock(itemProduct, 12)).toBe(3);
    expect(clampCartQuantity(itemProduct, 11, 2)).toBe(1);
    expect(clampCartQuantity(itemProduct, 12, 2)).toBe(2);
  });

  it("uses the selected variant even when a stale aggregate is lower", () => {
    const itemProduct = product(1, [{ id: 11, stock: 5 }]);

    expect(getItemAvailableStock(itemProduct, 11)).toBe(5);
    expect(clampCartQuantity(itemProduct, 11, 2)).toBe(2);
  });

  it("keeps same-product variants distinct for cart mutations", () => {
    expect(getCartItemIdentity(1, 11, { cor: "Preto", tamanho: "M" }))
      .not.toBe(getCartItemIdentity(1, 12, { cor: "Preto", tamanho: "M" }));
  });

  it("reconciles persisted snapshots that exceed their known current stock", () => {
    const itemProduct = product(1);
    expect(reconcileCartItems([cartItem(itemProduct, 4)])).toMatchObject([{ quantity: 1 }]);
    expect(reconcileCartItems([cartItem(product(0), 1)])).toEqual([]);
  });
});
