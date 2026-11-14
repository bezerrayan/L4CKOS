import { afterEach, describe, expect, it, vi } from "vitest";

const catalog = vi.hoisted(() => ({
  getProducts: vi.fn(async () => [] as any[]),
}));

vi.mock("../db", async importOriginal => ({
  ...await importOriginal<typeof import("../db")>(),
  getProducts: catalog.getProducts,
}));

import { productsRouter } from "./products";

afterEach(() => vi.clearAllMocks());

describe("local catalog tRPC procedure", () => {
  it("serves catalog queries through the local database adapter without a staging transport", async () => {
    catalog.getProducts.mockResolvedValue([
      { id: 1, name: "Camiseta local", description: "Fixture do banco local", category: "Camisetas", price: 8990, stock: 3, salesMode: "STOCK" },
    ]);
    const caller = productsRouter.createCaller({ user: null, req: {} as any, res: {} as any } as any);

    await expect(caller.list({ search: "camiseta" })).resolves.toMatchObject([
      { id: 1, name: "Camiseta local", category: "Camisetas" },
    ]);
    expect(catalog.getProducts).toHaveBeenCalledOnce();
  });

  it("does not announce name-restricted or SKU-restricted products in inStockOnly", async () => {
    catalog.getProducts.mockResolvedValue([
      { id: 2, name: "Clã 14 Bis", category: "Camisetas", price: 8990, stock: 8, salesMode: "STOCK", hasVariants: false, hasSellableVariants: false },
      { id: 3, name: "Camiseta comum", category: "Camisetas", price: 8990, stock: 8, salesMode: "STOCK", hasVariants: false, hasSellableVariants: false },
      { id: 4, name: "Outro produto comum", category: "Camisetas", price: 8990, stock: 0, salesMode: "STOCK", hasVariants: true, hasSellableVariants: false },
      { id: 5, name: "Clã 14 Bis Pré-venda", category: "Camisetas", price: 8990, stock: 0, salesMode: "PREORDER", hasVariants: false, hasSellableVariants: false, productionBatch: { id: 1, name: "Lote", status: "OPEN", salesOpenAt: null, salesCloseAt: null, capacity: { maximumQuantity: 10, claimedQuantity: 2, remainingQuantity: 8 } } },
    ]);
    const caller = productsRouter.createCaller({ user: null, req: {} as any, res: {} as any } as any);

    await expect(caller.list({ inStockOnly: true })).resolves.toEqual([
      expect.objectContaining({ id: 3, hasVariants: false }),
    ]);
    await expect(caller.list({})).resolves.toHaveLength(4);
  });

  it("keeps an in-stock SKU-restricted product listed but excludes it from inStockOnly", async () => {
    catalog.getProducts.mockResolvedValue([
      { id: 6, name: "Camiseta comum", category: "Camisetas", price: 8990, stock: 12, salesMode: "STOCK", hasVariants: true, hasSellableVariants: false },
      { id: 7, name: "Camiseta livre", category: "Camisetas", price: 8990, stock: 4, salesMode: "STOCK", hasVariants: false, hasSellableVariants: true },
    ]);
    const caller = productsRouter.createCaller({ user: null, req: {} as any, res: {} as any } as any);

    await expect(caller.list({ inStockOnly: true })).resolves.toEqual([
      expect.objectContaining({ id: 7 }),
    ]);
    await expect(caller.list({})).resolves.toEqual([
      expect.objectContaining({ id: 6, stock: 12, hasVariants: true, hasSellableVariants: false }),
      expect.objectContaining({ id: 7 }),
    ]);
  });
});
