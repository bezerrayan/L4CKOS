import { afterEach, describe, expect, it, vi } from "vitest";

const catalog = vi.hoisted(() => ({ getPublicProductVariants: vi.fn() }));

vi.mock("../db", async importOriginal => ({
  ...await importOriginal<typeof import("../db")>(),
  getPublicProductVariants: catalog.getPublicProductVariants,
}));

import { productsRouter } from "./products";

const caller = () => productsRouter.createCaller({ user: null, req: {} as any, res: {} as any } as any);

afterEach(() => vi.clearAllMocks());

describe("public sellable variant projection", () => {
  it("returns only the persisted saleable variant identity and server calculated price/availability", async () => {
    catalog.getPublicProductVariants.mockResolvedValue({
      product: { id: 21, salesMode: "STOCK", productionBatch: null },
      hasVariants: true,
      variants: [{ variantId: 81, color: "Preto", size: "M", price: 8990, availableUnits: 2 }],
    });
    await expect(caller().sellableVariants(21)).resolves.toEqual({
      productId: 21, hasVariants: true, publicPurchaseAllowed: true,
      variants: [{ variantId: 81, color: "Preto", size: "M", price: 8990, available: true, availableUnits: 2 }],
    });
  });

  it("does not use aggregate product stock when a variant is inactive or depleted", async () => {
    catalog.getPublicProductVariants.mockResolvedValue({
      product: { id: 22, salesMode: "STOCK", stock: 99, productionBatch: null },
      hasVariants: true,
      variants: [],
    });
    await expect(caller().sellableVariants(22)).resolves.toEqual({ productId: 22, hasVariants: true, publicPurchaseAllowed: true, variants: [] });
  });

  it("preserves the simple product distinction without fabricating a variant", async () => {
    catalog.getPublicProductVariants.mockResolvedValue({ product: { id: 23, stock: 7 }, hasVariants: false, variants: [] });
    await expect(caller().sellableVariants(23)).resolves.toEqual({ productId: 23, hasVariants: false, publicPurchaseAllowed: true, variants: [] });
  });

  it("uses global open batch capacity for preorder without treating it as physical variant stock", async () => {
    catalog.getPublicProductVariants.mockResolvedValue({
      product: { id: 25, salesMode: "PREORDER", productionBatch: { id: 5, name: "Synthetic", status: "OPEN", salesOpenAt: null, salesCloseAt: null, estimatedShippingStart: null, estimatedShippingEnd: null, capacity: { maximumQuantity: 20, claimedQuantity: 18, remainingQuantity: 2 } } },
      hasVariants: true,
      variants: [{ variantId: 85, color: "Verde", size: "G", price: 9900, availableUnits: null }],
    });
    await expect(caller().sellableVariants(25)).resolves.toMatchObject({
      hasVariants: true, variants: [{ variantId: 85, available: true, availableUnits: null }],
    });
  });

  it("hides preorder combinations when the existing global batch capacity is exhausted", async () => {
    catalog.getPublicProductVariants.mockResolvedValue({
      product: { id: 26, salesMode: "PREORDER", productionBatch: { id: 5, name: "Synthetic", status: "OPEN", salesOpenAt: null, salesCloseAt: null, estimatedShippingStart: null, estimatedShippingEnd: null, capacity: { maximumQuantity: 20, claimedQuantity: 20, remainingQuantity: 0 } } },
      hasVariants: true,
      variants: [{ variantId: 86, color: "Verde", size: "G", price: 9900, availableUnits: null }],
    });
    await expect(caller().sellableVariants(26)).resolves.toEqual({ productId: 26, hasVariants: true, publicPurchaseAllowed: true, variants: [] });
  });

  it("rejects an unknown product", async () => {
    catalog.getPublicProductVariants.mockResolvedValue({ product: null, hasVariants: false, variants: [] });
    await expect(caller().sellableVariants(24)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("does not expose QA fixtures through the public variant endpoint", async () => {
    catalog.getPublicProductVariants.mockResolvedValue({
      product: {
        id: 9, name: "[QA-STAGING] Teste de Variantes", salesMode: "STOCK",
        variants: ["QA-PRE-M-01", "QA-PRE-G-01", "QA-BRA-M-01", "QA-BRA-G-01"].map((sku, index) => ({ id: 17 + index, sku, isActive: 0 })),
      },
      hasVariants: true,
      variants: [],
    });
    await expect(caller().sellableVariants(9)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
