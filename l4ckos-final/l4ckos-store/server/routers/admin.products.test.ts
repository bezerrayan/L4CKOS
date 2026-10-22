import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getProductsAdmin: vi.fn(),
  createProductWithCatalog: vi.fn(),
  updateProductWithCatalog: vi.fn(),
  deleteProduct: vi.fn(),
  createAuditLog: vi.fn(),
}));

vi.mock("../db", async importOriginal => ({
  ...await importOriginal<typeof import("../db")>(),
  getProductsAdmin: dbMocks.getProductsAdmin,
  createProductWithCatalog: dbMocks.createProductWithCatalog,
  updateProductWithCatalog: dbMocks.updateProductWithCatalog,
  deleteProduct: dbMocks.deleteProduct,
  createAuditLog: dbMocks.createAuditLog,
}));

const adminUser = { id: 81, openId: "synthetic-admin", email: "admin@local.dev", role: "admin" };
const regularUser = { id: 82, openId: "synthetic-customer", email: "customer@example.invalid", role: "user" };

async function caller(user: typeof adminUser | typeof regularUser | null) {
  const { adminRouter } = await import("./admin");
  return adminRouter.createCaller({ user, req: {} as any, res: {} as any } as any);
}

describe("admin product catalog integration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists persisted products only to an administrator", async () => {
    dbMocks.getProductsAdmin.mockResolvedValue([{ id: 7, name: "Produto de teste", variants: [], images: [] }]);
    await expect((await caller(adminUser)).productsList()).resolves.toHaveLength(1);
    await expect((await caller(regularUser)).productsList()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(dbMocks.getProductsAdmin).toHaveBeenCalledTimes(1);
  });

  it("creates product, images and variants through the atomic catalog helper", async () => {
    dbMocks.createProductWithCatalog.mockResolvedValue(71);
    dbMocks.createAuditLog.mockResolvedValue(undefined);
    const admin = await caller(adminUser);
    await expect(admin.productCreate({
      name: "Camiseta local", category: "camisas", price: 8990, stock: 4,
      optionColors: ["preto"], optionSizes: ["M"],
      images: [{ imageUrl: "https://cdn.example.test/front.webp", color: "preto", alt: "Frente" }],
      variants: [{ color: "Preto", size: "M", name: "Camiseta local preto M", sku: "LOC-PT-M", price: 8990, stock: 4, isActive: false }],
    })).resolves.toEqual({ success: true });
    expect(dbMocks.createProductWithCatalog).toHaveBeenCalledWith(expect.objectContaining({
      product: expect.objectContaining({ name: "Camiseta local", price: 8990, stock: 4, optionColors: '["preto"]' }),
      images: expect.arrayContaining([expect.objectContaining({ imageUrl: "https://cdn.example.test/front.webp", alt: "Frente" })]),
      variants: [{ color: "Preto", size: "M", name: "Camiseta local preto M", sku: "LOC-PT-M", price: 8990, stock: 4, isActive: false }],
    }));
    expect(dbMocks.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "product.create", entityId: "71" }));
  });

  it("updates only submitted fields while retaining variant identity and reports persistence conflicts", async () => {
    dbMocks.updateProductWithCatalog.mockResolvedValue({ success: true });
    dbMocks.createAuditLog.mockResolvedValue(undefined);
    const admin = await caller(adminUser);
    await expect(admin.productUpdate({
      id: 7,
      variants: [{ id: 18, name: "Nome legado revisado", color: "Azul", size: "G", sku: "SKU-18", price: 9500, stock: 3, isActive: true }],
    })).resolves.toEqual({ success: true });
    expect(dbMocks.updateProductWithCatalog).toHaveBeenCalledWith({
      id: 7,
      product: {},
      variants: [{ id: 18, name: "Nome legado revisado", color: "Azul", size: "G", sku: "SKU-18", price: 9500, stock: 3, isActive: true }],
    });

    const { ProductCatalogConflictError } = await import("../db");
    dbMocks.updateProductWithCatalog.mockRejectedValue(new ProductCatalogConflictError("Estoque reservado."));
    await expect(admin.productUpdate({ id: 7, stock: 0 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "Estoque reservado." });
  });

  it("does not report failed persistence as a successful create or write an audit entry", async () => {
    dbMocks.createProductWithCatalog.mockRejectedValue(new Error("local storage failure"));
    await expect((await caller(adminUser)).productCreate({ name: "Camiseta", category: "camisas", price: 8900, stock: 1 }))
      .rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(dbMocks.createAuditLog).not.toHaveBeenCalled();
  });

  it("does not report failed product updates as successful or write an audit entry", async () => {
    dbMocks.updateProductWithCatalog.mockRejectedValue(new Error("local storage failure"));
    const admin = await caller(adminUser);
    await expect(admin.productUpdate({ id: 7, name: "Alteração não persistida" }))
      .rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(dbMocks.createAuditLog).not.toHaveBeenCalled();
  });

  it("denies product mutations to non-admin callers before persistence", async () => {
    await expect((await caller(regularUser)).productCreate({ name: "Camiseta", category: "camisas", price: 8900, stock: 1 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(dbMocks.createProductWithCatalog).not.toHaveBeenCalled();
  });

  it("rejects client supplied optionKey and incomplete new variants before persistence", async () => {
    const admin = await caller(adminUser);
    await expect(admin.productUpdate({ id: 7, variants: [{ id: 18, optionKey: "client-controlled" } as any] }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(admin.productUpdate({ id: 7, variants: [{ color: "Preto" } as any] }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(dbMocks.updateProductWithCatalog).not.toHaveBeenCalled();
  });
});
