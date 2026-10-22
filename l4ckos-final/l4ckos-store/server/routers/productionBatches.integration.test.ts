import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIRMED_DEMAND_SQL } from "../database/productionBatches";

const mocks = vi.hoisted(() => ({
  createConnection: vi.fn(),
  connectionEnd: vi.fn(),
  listBatches: vi.fn(),
  productionSummary: vi.fn(),
  saveBatch: vi.fn(),
  assignBatchProducts: vi.fn(),
  transitionBatch: vi.fn(),
}));

vi.mock("mysql2/promise", async importOriginal => ({
  ...await importOriginal<typeof import("mysql2/promise")>(),
  createConnection: mocks.createConnection,
}));

vi.mock("../database/productionBatches", async importOriginal => ({
  ...await importOriginal<typeof import("../database/productionBatches")>(),
  listBatches: mocks.listBatches,
  productionSummary: mocks.productionSummary,
  saveBatch: mocks.saveBatch,
  assignBatchProducts: mocks.assignBatchProducts,
  transitionBatch: mocks.transitionBatch,
}));

const admin = { id: 61, openId: "synthetic-admin", email: "admin@local.dev", role: "admin" };
const regular = { id: 62, openId: "batch-user", email: "user@local.invalid", role: "user" };
const fakeConnection = { end: mocks.connectionEnd };

async function caller(user: typeof admin | typeof regular | null) {
  const { productionBatchesRouter } = await import("./productionBatches");
  return productionBatchesRouter.createCaller({ user, req: {} as any, res: {} as any } as any);
}

describe("production batch router integration contract (mock-only connection)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DATABASE_URL", "mysql://local-mock.invalid/test");
    mocks.createConnection.mockResolvedValue(fakeConnection);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("keeps production demand tied to trusted payment evidence, not order status alone", () => {
    expect(CONFIRMED_DEMAND_SQL).toContain("paymentStatus='confirmed'");
    expect(CONFIRMED_DEMAND_SQL).toContain("paymentConfirmedAt IS NOT NULL");
    expect(CONFIRMED_DEMAND_SQL).toContain("paymentConfirmationSource='manual'");
    expect(CONFIRMED_DEMAND_SQL).toContain("paymentConfirmedBy>0");
    expect(CONFIRMED_DEMAND_SQL).toContain("paymentConfirmationSource='asaas_webhook'");
    expect(CONFIRMED_DEMAND_SQL).toContain("paymentConfirmationReference");
    expect(CONFIRMED_DEMAND_SQL).toContain("o.status IN ('paid','processing','shipped','delivered')");
  });

  it("denies unauthorized batch reads before opening a connection", async () => {
    await expect((await caller(regular)).list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect((await caller(null)).list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.createConnection).not.toHaveBeenCalled();
    expect(mocks.listBatches).not.toHaveBeenCalled();
  });

  it("uses the existing admin list/detail contracts and closes the mocked connection", async () => {
    const rows = [{ id: 4, name: "Lote sintético", status: "OPEN" }];
    const summary = { batch: rows[0], paidOrders: 2, confirmedQuantity: 3, pendingQuantity: 1, products: [], groups: [] };
    mocks.listBatches.mockResolvedValue(rows);
    mocks.productionSummary.mockResolvedValue(summary);
    const adminCaller = await caller(admin);

    await expect(adminCaller.list()).resolves.toEqual(rows);
    await expect(adminCaller.detail(4)).resolves.toEqual(summary);
    expect(mocks.listBatches).toHaveBeenCalledWith(fakeConnection);
    expect(mocks.productionSummary).toHaveBeenCalledWith(fakeConnection, 4);
    expect(mocks.connectionEnd).toHaveBeenCalledTimes(2);
  });

  it("keeps empty and failed list states tied to the existing query", async () => {
    mocks.listBatches.mockResolvedValueOnce([]);
    await expect((await caller(admin)).list()).resolves.toEqual([]);
    mocks.listBatches.mockRejectedValueOnce(new Error("Falha local simulada."));
    await expect((await caller(admin)).list()).rejects.toThrow("Falha local simulada.");
    expect(mocks.connectionEnd).toHaveBeenCalledTimes(2);
  });

  it("routes authorized transitions through the existing handler without direct SQL or external effects", async () => {
    mocks.transitionBatch.mockResolvedValue({ success: true });
    await expect((await caller(admin)).transition({ id: 4, status: "IN_PRODUCTION" }))
      .resolves.toEqual({ success: true });
    expect(mocks.transitionBatch).toHaveBeenCalledWith(fakeConnection, {
      id: 4,
      status: "IN_PRODUCTION",
      acknowledgePaidOrders: false,
    }, admin.id);
    expect(mocks.createConnection).toHaveBeenCalledTimes(1);
    expect(mocks.connectionEnd).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid batch form values before opening a database connection", async () => {
    await expect((await caller(admin)).save({
      name: "Lote inválido",
      salesOpenAt: "2026-10-22T15:00:00Z",
      salesCloseAt: "2026-10-22T14:00:00Z",
      estimatedShippingStart: null,
      estimatedShippingEnd: null,
      estimatedManufacturingStart: null,
      estimatedManufacturingEnd: null,
      minimumQuantity: 10,
      maximumQuantity: 5,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.createConnection).not.toHaveBeenCalled();
    expect(mocks.saveBatch).not.toHaveBeenCalled();
  });

  it("surfaces server transition rejection without bypassing the domain handler", async () => {
    const { BatchError } = await import("../database/productionBatches");
    mocks.transitionBatch.mockRejectedValue(new BatchError("Transição de lote não permitida."));
    await expect((await caller(admin)).transition({ id: 4, status: "COMPLETED" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: "Transição de lote não permitida." });
    expect(mocks.transitionBatch).toHaveBeenCalledTimes(1);
    expect(mocks.connectionEnd).toHaveBeenCalledTimes(1);
  });
});
