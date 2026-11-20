import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCartItems: vi.fn(),
  addToCart: vi.fn(),
  removeFromCartByUser: vi.fn(),
  clearCart: vi.fn(),
  getProductByIdWithDetails: vi.fn(),
  assertCanAddToServerCart: vi.fn(),
}));

vi.mock("../db", async importOriginal => ({
  ...await importOriginal<typeof import("../db")>(),
  getCartItems: mocks.getCartItems,
  addToCart: mocks.addToCart,
  removeFromCartByUser: mocks.removeFromCartByUser,
  clearCart: mocks.clearCart,
  getProductByIdWithDetails: mocks.getProductByIdWithDetails,
}));
vi.mock("../exclusive/checkoutGuard", () => ({ assertCanAddToServerCart: mocks.assertCanAddToServerCart }));

import { cartRouter } from "./cart";

const caller = () => cartRouter.createCaller({ user: { id: 17 }, req: {} as any, res: {} as any } as any);
const product = (name: string, sku = "REAL-PT-M") => ({
  id: 5, name, price: 8990, stock: 3,
  variants: [{ id: 51, sku, price: 8990, stock: 3, isActive: 1 }],
});

afterEach(() => vi.clearAllMocks());

describe("server cart public catalog gate", () => {
  it("preserves cart entry for an ordinary product", async () => {
    mocks.getProductByIdWithDetails.mockResolvedValue(product("Produto comercial legítimo"));
    await expect(caller().add({ productId: 5, quantity: 1 })).resolves.toEqual({ success: true });
    expect(mocks.assertCanAddToServerCart).toHaveBeenCalledWith({ userId: 17, productId: 5, quantity: 1 });
    expect(mocks.addToCart).toHaveBeenCalledWith(17, 5, 1);
  });

  it.each([
    ["QA label", "[QA-STAGING] Fixture", "REAL-PT-M"],
    ["Clã name", "Clã XIV Bis", "REAL-PT-M"],
    ["exclusive SKU", "Produto legítimo aparente", "CLA-XIV-BIS-P"],
  ])("rejects direct-ID cart entry for %s without revealing catalog details", async (_case, name, sku) => {
    mocks.getProductByIdWithDetails.mockResolvedValue(product(name, sku));
    await expect(caller().add({ productId: 5, quantity: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.assertCanAddToServerCart).not.toHaveBeenCalled();
    expect(mocks.addToCart).not.toHaveBeenCalled();
  });

  it("omits pre-existing restricted and QA entries from the cart projection", async () => {
    mocks.getCartItems.mockResolvedValue([
      { id: 1, productId: 5, quantity: 1 },
      { id: 2, productId: 6, quantity: 1 },
      { id: 3, productId: 7, quantity: 1 },
    ]);
    mocks.getProductByIdWithDetails.mockImplementation(async id => id === 5
      ? product("Produto comercial legítimo")
      : id === 6 ? product("[QA-STAGING] Fixture") : product("Clã XIV Bis"));

    const result = await caller().list();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 1, product: { name: "Produto comercial legítimo" } });
    expect(JSON.stringify(result)).not.toMatch(/QA-STAGING|Clã XIV Bis|CLA-XIV/);
  });
});
