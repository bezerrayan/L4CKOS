import { afterEach, describe, expect, it, vi } from "vitest";

const catalog = vi.hoisted(() => ({
  getProducts: vi.fn(),
  getProductByIdWithDetails: vi.fn(),
  getPublicProductVariants: vi.fn(),
}));

vi.mock("../db", async importOriginal => ({
  ...await importOriginal<typeof import("../db")>(),
  getProducts: catalog.getProducts,
  getProductByIdWithDetails: catalog.getProductByIdWithDetails,
  getPublicProductVariants: catalog.getPublicProductVariants,
}));

import { productsRouter } from "./products";

const caller = () => productsRouter.createCaller({ user: null, req: {} as any, res: {} as any } as any);

afterEach(() => vi.clearAllMocks());

describe("public catalog routes hide the exclusive Clã XIV Bis product", () => {
  it("filters restricted names from list even without availability filters", async () => {
    catalog.getProducts.mockResolvedValue([
      { id: 1, name: "Clã XIV Bis", description: "exclusive", category: "Camisetas", price: 8000 },
      { id: 2, name: "Clã 14 Bis — edição", description: "exclusive alias", category: "Camisetas", price: 8000 },
      { id: 3, name: "City Noise", description: "ordinary", category: "Camisetas", price: 11900 },
      { id: 4, name: "Camiseta com SKU legado restrito", description: "restricted SKU", category: "Camisetas", price: 8000, publicPurchaseAllowed: false },
    ]);

    await expect(caller().list({})).resolves.toEqual([
      { id: 3, name: "City Noise", description: "ordinary", category: "Camisetas", price: 11900 },
    ]);
  });

  it.each(["Clã XIV Bis", "CLAN XIV-BIS", "Clã 14 Bis"])("returns NOT_FOUND for direct getById of %s", async name => {
    catalog.getProductByIdWithDetails.mockResolvedValue({
      id: 51, name, variants: [{ sku: "COMMON-BLACK-M" }],
    });
    await expect(caller().getById(51)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it.each(["CLA-XIV-BIS-P", "XIV-BIS-DROP-M", "14B-DROP-PT-M"])("returns NOT_FOUND for direct detail lookup with restricted SKU %s", async sku => {
    catalog.getProductByIdWithDetails.mockResolvedValue({
      id: 54, name: "Camiseta legítima aparente", price: 8000, stock: 3,
      variants: [{ sku, price: 8000, stock: 3, isActive: 1 }],
    });
    await expect(caller().getById(54)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it.each(["REAL-PT-M", "??"])("returns NOT_FOUND for direct QA product lookup even with SKU %s", async sku => {
    catalog.getProductByIdWithDetails.mockResolvedValue({
      id: 55, name: "[QA-STAGING] Fixture", price: 7990, stock: 3,
      variants: [{ sku, price: 7990, stock: 3, isActive: 1 }],
    });
    await expect(caller().getById(55)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns NOT_FOUND without variant, price, or stock data for direct availability lookup", async () => {
    catalog.getPublicProductVariants.mockResolvedValue({
      product: { id: 52, name: "Clã XIV Bis", salesMode: "STOCK", variants: [{ sku: "COMMON-BLACK-M" }] },
      hasVariants: true,
      variants: [{ variantId: 901, color: "Azul-marinho", size: "M", price: 8000, availableUnits: 4 }],
    });
    await expect(caller().sellableVariants(52)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("blocks a direct availability lookup when an exclusive SKU is hidden among ordinary variants", async () => {
    catalog.getPublicProductVariants.mockResolvedValue({
      product: { id: 53, name: "Camiseta comum", salesMode: "STOCK", variants: [{ sku: "XIV-BIS-DROP-M" }] },
      hasVariants: true,
      variants: [{ variantId: 902, color: "Azul-marinho", size: "M", price: 8000, availableUnits: 4 }],
    });
    await expect(caller().sellableVariants(53)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
