import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getFavorites: vi.fn(),
  addFavorite: vi.fn(),
  removeFavorite: vi.fn(),
  getProductByIdWithDetails: vi.fn(),
}));

vi.mock("../db", async importOriginal => ({
  ...await importOriginal<typeof import("../db")>(),
  getFavorites: mocks.getFavorites,
  addFavorite: mocks.addFavorite,
  removeFavorite: mocks.removeFavorite,
  getProductByIdWithDetails: mocks.getProductByIdWithDetails,
}));

import { favoritesRouter } from "./favorites";

const caller = () => favoritesRouter.createCaller({ user: { id: 17 }, req: {} as any, res: {} as any } as any);
const product = (name: string, sku = "REAL-PT-M") => ({
  id: 5, name, price: 8990, stock: 3,
  variants: [{ id: 51, sku, price: 8990, stock: 3, isActive: 1 }],
});

afterEach(() => vi.clearAllMocks());

describe("favorites public catalog gate", () => {
  it("preserves favorite entry for an ordinary product", async () => {
    mocks.getProductByIdWithDetails.mockResolvedValue(product("Produto comercial legítimo"));
    await expect(caller().add(5)).resolves.toEqual({ success: true });
    expect(mocks.addFavorite).toHaveBeenCalledWith(17, 5);
  });

  it.each([["QA label", "[QA-STAGING] Fixture"], ["exclusive product", "Clã XIV Bis"]])(
    "rejects direct-ID favorite entry for %s", async (_case, name) => {
      mocks.getProductByIdWithDetails.mockResolvedValue(product(name));
      await expect(caller().add(5)).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(mocks.addFavorite).not.toHaveBeenCalled();
    },
  );

  it("does not expose restricted products in favorite list or isFavorite", async () => {
    mocks.getFavorites.mockResolvedValue([{ id: 1, productId: 5 }, { id: 2, productId: 6 }]);
    mocks.getProductByIdWithDetails.mockImplementation(async id => id === 5
      ? product("[QA-STAGING] Fixture") : product("Produto comercial legítimo"));
    await expect(caller().list()).resolves.toEqual([
      expect.objectContaining({ id: 2, product: expect.objectContaining({ name: "Produto comercial legítimo" }) }),
    ]);
    await expect(caller().isFavorite(5)).resolves.toBe(false);
    expect(JSON.stringify(await caller().list())).not.toMatch(/QA-STAGING/);
  });
});
