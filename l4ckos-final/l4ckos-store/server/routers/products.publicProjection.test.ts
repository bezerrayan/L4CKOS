import { afterEach, describe, expect, it, vi } from "vitest";

const catalog = vi.hoisted(() => ({ getProductByIdWithDetails: vi.fn() }));

vi.mock("../db", async importOriginal => ({
  ...await importOriginal<typeof import("../db")>(),
  getProductByIdWithDetails: catalog.getProductByIdWithDetails,
}));

import { productsRouter } from "./products";

afterEach(() => vi.clearAllMocks());

describe("public product detail projection", () => {
  it("does not expose internal variant SKUs, stock, activation, or identifiers", async () => {
    catalog.getProductByIdWithDetails.mockResolvedValue({
      id: 7,
      name: "Produto sintético",
      price: 8999,
      variants: [{ id: 71, sku: "SYNTH-PRIVATE", stock: 5, isActive: 0, color: "Preto", size: "M" }],
    });
    const caller = productsRouter.createCaller({ user: null, req: {} as any, res: {} as any } as any);

    await expect(caller.getById(7)).resolves.toEqual({ id: 7, name: "Produto sintético", price: 8999 });
  });
});
