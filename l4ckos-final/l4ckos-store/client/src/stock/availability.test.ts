import { describe, expect, it } from "vitest";
import type { CartItem } from "../types/cart";
import { cartBlockingIssues, clampQuantity, evaluateCartLine, isColorPurchasable, isSizePurchasable, MAX_LINE_QUANTITY, maxQuantityFor } from "./availability";
import { mapCatalogVariants } from "./catalogVariants";

const variants = [
  { id: 1, productId: 7, size: "M", color: "Preto", active: true, stock: 3 },
  { id: 2, productId: 7, size: "G", color: "Preto", active: true, stock: 0 },
  { id: 3, productId: 7, size: "G", color: "Branco", active: true, stock: 5 },
  { id: 4, productId: 7, size: "P", color: "Branco", active: false, stock: 9 },
];
const product = { id: 7, name: "Camiseta", price: 99.9, image: "x", stock: 17, variantCatalogPresent: true, variants };
const line = (overrides: Partial<CartItem> = {}): CartItem => ({ product, quantity: 1, variantId: 1, addedAt: new Date(0), ...overrides });

describe("variant availability", () => {
  it("marks sold-out and inactive combinations", () => {
    expect(isSizePurchasable(variants, "G", "Preto")).toBe(false);
    expect(isSizePurchasable(variants, "G", "Branco")).toBe(true);
    expect(isSizePurchasable(variants, "P", null)).toBe(false); // inactive
    expect(isSizePurchasable(variants, "G", null)).toBe(true);
    expect(isColorPurchasable(variants, "Preto", "G")).toBe(false);
    expect(isColorPurchasable(variants, "Preto", "M")).toBe(true);
  });
  it("normalizes case and unicode", () => {
    expect(isSizePurchasable(variants, " m ", "preto")).toBe(true);
  });
});

describe("quantity limits", () => {
  it("uses the variant stock, not the product total", () => {
    expect(maxQuantityFor(product, 1)).toBe(3);
    expect(maxQuantityFor(product, 2)).toBe(0);
    expect(maxQuantityFor(product, 999)).toBe(0);
    expect(maxQuantityFor(product, undefined)).toBe(0);
  });
  it("caps at the backend limit and tolerates unknown stock", () => {
    expect(maxQuantityFor({ ...product, variants: [{ ...variants[0], stock: 500 }] }, 1)).toBe(MAX_LINE_QUANTITY);
    expect(maxQuantityFor({ id: 1, stock: undefined })).toBe(MAX_LINE_QUANTITY);
    expect(maxQuantityFor({ id: 1, stock: 4 })).toBe(4);
  });
  it("clamps to [1, max]", () => {
    expect(clampQuantity(0, 5)).toBe(1);
    expect(clampQuantity(9, 5)).toBe(5);
    expect(clampQuantity(Number.NaN, 5)).toBe(1);
    expect(clampQuantity(3.9, 5)).toBe(3);
    expect(clampQuantity(2, 0)).toBe(1);
  });
});

describe("evaluateCartLine", () => {
  it("accepts a valid line", () => {
    expect(evaluateCartLine(line({ quantity: 3 }))).toEqual({ state: "ok", maxQuantity: 3 });
  });
  it("flags quantity above stock as limited", () => {
    expect(evaluateCartLine(line({ quantity: 4 }))).toMatchObject({ state: "limited", maxQuantity: 3, message: expect.stringContaining("3 unidades") });
  });
  it("flags sold out, inactive and unknown variants as unavailable", () => {
    expect(evaluateCartLine(line({ variantId: 2 }))).toMatchObject({ state: "unavailable", message: "Item esgotado." });
    expect(evaluateCartLine(line({ variantId: 4 }))).toMatchObject({ state: "unavailable" });
    expect(evaluateCartLine(line({ variantId: 99 }))).toMatchObject({ state: "unavailable" });
  });
  it("rejects legacy lines without variantId when the catalog has variants", () => {
    expect(evaluateCartLine(line({ variantId: undefined }))).toMatchObject({ state: "unavailable", message: expect.stringContaining("Selecione novamente") });
  });
  it("does not require variants for legacy catalog products", () => {
    const legacy = { ...product, variantCatalogPresent: false, variants: undefined, stock: 2 };
    expect(evaluateCartLine(line({ product: legacy, variantId: undefined, quantity: 2 }))).toEqual({ state: "ok", maxQuantity: 2 });
    expect(evaluateCartLine(line({ product: { ...legacy, stock: 0 }, variantId: undefined }))).toMatchObject({ state: "unavailable" });
  });
  it("lists blocking issues by product", () => {
    expect(cartBlockingIssues([line(), line({ variantId: 2 })])).toEqual(["Camiseta: Item esgotado."]);
  });
});

describe("mapCatalogVariants", () => {
  it("trusts only `active`, never `isActive`", () => {
    const rows = [
      { id: 1, productId: 7, size: " M ", color: "Preto", active: true, isActive: 1, stock: "4" },
      { id: 2, productId: 7, size: "G", color: "Preto", active: false, isActive: 1, stock: 3 }, // disagree: inactive wins
      { id: 3, productId: 7, size: "P", color: "Preto", isActive: 1, stock: 3 }, // legacy column only: not sellable
      { id: 4, productId: 7, size: "GG", color: "Preto", active: "true", isActive: 1, stock: 3 }, // not a boolean
    ];
    expect(mapCatalogVariants(rows, 7).map(v => [v.id, v.active])).toEqual([[1, true], [2, false], [3, false], [4, false]]);
  });

  it("keeps only rows with real id, parent and attributes", () => {
    const rows = [
      { id: 1, productId: 7, size: " M ", color: "Preto", active: true, stock: "4" },
      { id: 0, productId: 7, size: "M", color: "Preto", active: true },
      { id: 2, productId: 8, size: "M", color: "Preto", active: true },
      { id: 3, productId: 7, size: "", color: "Preto", active: true },
      { id: 4, productId: 7, size: "G", color: "Preto", active: false, stock: -3 },
      null,
    ];
    expect(mapCatalogVariants(rows, 7)).toEqual([
      { id: 1, productId: 7, size: "M", color: "Preto", active: true, stock: 4 },
      { id: 4, productId: 7, size: "G", color: "Preto", active: false, stock: 0 },
    ]);
    expect(mapCatalogVariants(undefined, 7)).toEqual([]);
  });
});
