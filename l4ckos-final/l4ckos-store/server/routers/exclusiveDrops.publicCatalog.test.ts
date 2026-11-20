import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAuditLog: vi.fn(),
  getProductByIdWithDetails: vi.fn(),
  productDrop: vi.fn(),
  getExclusiveStore: vi.fn(),
}));

vi.mock("../db", () => ({
  createAuditLog: mocks.createAuditLog,
  getProductByIdWithDetails: mocks.getProductByIdWithDetails,
}));
vi.mock("../exclusive/runtime", () => ({
  getExclusiveStore: mocks.getExclusiveStore,
}));

import { exclusiveDropsRouter } from "./exclusiveDrops";

const caller = () => exclusiveDropsRouter.createCaller({ user: null, req: {} as any, res: {} as any } as any);
const publicProduct = (name: string, sku = "REAL-PT-M") => ({
  id: 8,
  name,
  variants: [{ id: 81, sku, isActive: 1, color: "Preto", size: "M", price: 8990, stock: 3 }],
});
const publicDrop = {
  exclusive: true as const,
  drop: {
    id: 12,
    slug: "colecao-publica",
    name: "Drop público aprovado",
    description: "Informações públicas do drop.",
    state: "active" as const,
    timezone: "America/Sao_Paulo",
    requiresAuthorization: true,
    requestWindow: { startsAt: null, endsAt: null, open: true },
    purchaseWindow: { startsAt: "2026-11-17T00:00:00.000Z", endsAt: "2026-11-18T00:00:00.000Z", open: true },
  },
  viewer: { status: "login_required" as const },
};

afterEach(() => vi.clearAllMocks());

describe("exclusiveDrops.forProduct public catalog gate", () => {
  it("preserves public metadata for a public product with a public drop", async () => {
    mocks.getProductByIdWithDetails.mockResolvedValue(publicProduct("City Noise"));
    mocks.productDrop.mockResolvedValue(publicDrop);
    mocks.getExclusiveStore.mockResolvedValue({ productDrop: mocks.productDrop });

    await expect(caller().forProduct({ productId: 8 })).resolves.toEqual(publicDrop);
    expect(mocks.productDrop).toHaveBeenCalledOnce();
    expect(mocks.productDrop).toHaveBeenCalledWith(8, null);
  });

  it.each([
    ["Clã XIV Bis", publicProduct("Clã XIV Bis")],
    ["Clã 14 Bis alias", publicProduct("Camiseta Clã 14 Bis — edição")],
    ["exclusive SKU", publicProduct("Produto comercial aparente", "XIV-BIS-DROP-M")],
    ["QA-STAGING with normal SKU", publicProduct("[QA-STAGING] Fixture", "REAL-PT-M")],
  ])("returns NOT_FOUND before reading drop metadata for restricted product (%s)", async (_case, product) => {
    mocks.getProductByIdWithDetails.mockResolvedValue(product);
    mocks.productDrop.mockResolvedValue(publicDrop);
    mocks.getExclusiveStore.mockResolvedValue({ productDrop: mocks.productDrop });

    await expect(caller().forProduct({ productId: 8 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.getExclusiveStore).not.toHaveBeenCalled();
    expect(mocks.productDrop).not.toHaveBeenCalled();
  });

  it("blocks a public drop when any inactive or unselected variant carries a restricted SKU", async () => {
    mocks.getProductByIdWithDetails.mockResolvedValue({
      ...publicProduct("City Noise"),
      variants: [
        { id: 81, sku: "REAL-PT-M", isActive: 1 },
        { id: 82, sku: "14B-DROP-BR-G", isActive: 0 },
      ],
    });
    mocks.getExclusiveStore.mockResolvedValue({ productDrop: mocks.productDrop });

    await expect(caller().forProduct({ productId: 8 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.getExclusiveStore).not.toHaveBeenCalled();
  });

  it("returns the same NOT_FOUND for a nonexistent direct product ID", async () => {
    mocks.getProductByIdWithDetails.mockResolvedValue(null);

    await expect(caller().forProduct({ productId: 987654 })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Produto não encontrado.",
    });
    expect(mocks.getExclusiveStore).not.toHaveBeenCalled();
  });
});
