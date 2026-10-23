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

  it("does not expose a QA fixture through direct public product lookup", async () => {
    const publicCaller = productsRouter.createCaller({ user: null, req: {} as any, res: {} as any } as any);
    catalog.getProductByIdWithDetails.mockResolvedValue({
      id: 9,
      name: "[QA-STAGING] Teste de Variantes",
      price: 7990,
      variants: ["QA-PRE-M-01", "QA-PRE-G-01", "QA-BRA-M-01", "QA-BRA-G-01"].map((sku, index) => ({ id: 17 + index, sku, isActive: 0 })),
    });
    await expect(publicCaller.getById(9)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
