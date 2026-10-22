import { afterEach, describe, expect, it, vi } from "vitest";

const catalog = vi.hoisted(() => ({
  getProducts: vi.fn(async () => [
    { id: 1, name: "Camiseta local", description: "Fixture do banco local", category: "Camisetas", price: 8990, stock: 3, salesMode: "STOCK" },
  ]),
}));

vi.mock("../db", async importOriginal => ({
  ...await importOriginal<typeof import("../db")>(),
  getProducts: catalog.getProducts,
}));

import { productsRouter } from "./products";

afterEach(() => vi.clearAllMocks());

describe("local catalog tRPC procedure", () => {
  it("serves catalog queries through the local database adapter without a staging transport", async () => {
    const caller = productsRouter.createCaller({ user: null, req: {} as any, res: {} as any } as any);

    await expect(caller.list({ search: "camiseta" })).resolves.toMatchObject([
      { id: 1, name: "Camiseta local", category: "Camisetas" },
    ]);
    expect(catalog.getProducts).toHaveBeenCalledOnce();
  });
});
