import { describe, expect, it } from "vitest";
import { productPriceFromCents } from "../../client/src/utils/money";
import { generateMissingVariantOptions } from "../../client/src/utils/productVariantDrafts";
import { calculateCartTotal, type CartItem } from "../../client/src/types/cart";

describe("product catalog UI contracts", () => {
  it("converts API cents into the BRL unit used for cart math", () => {
    expect(productPriceFromCents(9900)).toBe(99);
    expect(productPriceFromCents(12950)).toBe(129.5);
    expect(productPriceFromCents(0)).toBe(0);
    expect(() => productPriceFromCents(99.5)).toThrow("PRODUCT_PRICE_CENTS_INVALID");
    expect(() => productPriceFromCents(-1)).toThrow("PRODUCT_PRICE_CENTS_INVALID");
    const cart = [{ product: { price: productPriceFromCents(9900) }, quantity: 2 } as CartItem];
    expect(calculateCartTotal(cart)).toBe(198);
  });

  it("generates only missing pairs and blocks an excessive matrix", () => {
    expect(generateMissingVariantOptions(
      ["Preto", "Verde"], ["M", "G"],
      [{ color: " preto ", size: "M" }, { color: "", size: "G" }],
    )).toEqual([
      { color: "Preto", size: "G" },
      { color: "Verde", size: "M" },
      { color: "Verde", size: "G" },
    ]);
    expect(() => generateMissingVariantOptions(["a", "b"], ["1", "2"], [], 3))
      .toThrow("VARIANT_COMBINATION_LIMIT");
  });
});
