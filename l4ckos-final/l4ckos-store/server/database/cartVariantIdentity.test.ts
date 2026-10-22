import { describe, expect, it } from "vitest";
import { resolveCartVariant } from "../../client/src/utils/cartVariantIdentity";
import type { SellableVariantCatalog } from "../../client/src/types/cart";

const catalog: SellableVariantCatalog = {
  productId: 42,
  hasVariants: true,
  variants: [
    { variantId: 501, color: "Preto", size: "M", price: 8900, available: true, availableUnits: 2 },
    { variantId: 502, color: "Branco", size: "M", price: 9200, available: true, availableUnits: 1 },
  ],
};

describe("cart variant identity", () => {
  it("recovers a legacy cart line only from its exact color and size", () => {
    expect(resolveCartVariant(catalog, { selectedOptions: { cor: "Preto", tamanho: "M" } })).toEqual({
      variantId: 501,
      color: "Preto",
      size: "M",
      priceCents: 8900,
      availableUnits: 2,
    });
  });

  it("does not choose a replacement when a legacy combination is missing", () => {
    expect(resolveCartVariant(catalog, { selectedOptions: { cor: "Azul", tamanho: "M" } })).toBeNull();
    expect(resolveCartVariant(catalog, { selectedOptions: { cor: "Preto" } })).toBeNull();
  });

  it("does not remap a stored variant ID to another variant with matching labels", () => {
    expect(resolveCartVariant(catalog, {
      variant: { variantId: 999, color: "Preto", size: "M", priceCents: 8900, availableUnits: 2 },
      selectedOptions: { cor: "Preto", tamanho: "M" },
    })).toBeNull();
  });

  it("fails closed if legacy labels resolve to more than one variant", () => {
    const ambiguous = {
      ...catalog,
      variants: [...catalog.variants, { ...catalog.variants[0], variantId: 503 }],
    };
    expect(resolveCartVariant(ambiguous, { selectedOptions: { cor: "Preto", tamanho: "M" } })).toBeNull();
  });
});
