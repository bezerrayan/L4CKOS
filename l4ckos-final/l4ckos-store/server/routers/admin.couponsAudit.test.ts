import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getCoupons: vi.fn(),
  createCoupon: vi.fn(),
  updateCoupon: vi.fn(),
  deleteCoupon: vi.fn(),
  getAuditLogs: vi.fn(),
  createAuditLog: vi.fn(),
}));

vi.mock("../db", async importOriginal => ({
  ...await importOriginal<typeof import("../db")>(),
  getCoupons: dbMocks.getCoupons,
  createCoupon: dbMocks.createCoupon,
  updateCoupon: dbMocks.updateCoupon,
  deleteCoupon: dbMocks.deleteCoupon,
  getAuditLogs: dbMocks.getAuditLogs,
  createAuditLog: dbMocks.createAuditLog,
}));

const adminUser = { id: 81, openId: "synthetic-admin", email: "admin@local.dev", role: "admin" };
const regularUser = { id: 82, openId: "synthetic-customer", email: "customer@example.invalid", role: "user" };

async function caller(user: typeof adminUser | typeof regularUser | null) {
  const { adminRouter } = await import("./admin");
  return adminRouter.createCaller({ user, req: {} as any, res: {} as any } as any);
}

describe("admin coupon and audit contracts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists coupons only for an admin", async () => {
    dbMocks.getCoupons.mockResolvedValue([{ id: 3, code: "LOCAL10", type: "percent", value: 10, maxUses: 5, usedCount: 2, isActive: true }]);
    await expect((await caller(adminUser)).couponsList()).resolves.toHaveLength(1);
    await expect((await caller(regularUser)).couponsList()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(dbMocks.getCoupons).toHaveBeenCalledTimes(1);
  });

  it("creates a coupon with UTC dates and records its actor after persistence", async () => {
    dbMocks.createCoupon.mockResolvedValue(undefined);
    dbMocks.createAuditLog.mockResolvedValue(undefined);
    const startsAt = "2026-10-21T02:59:00.000Z";
    await expect((await caller(adminUser)).couponCreate({ code: "local10", type: "percent", value: 10, maxUses: 25, startsAt, expiresAt: null, isActive: true }))
      .resolves.toEqual({ success: true });
    expect(dbMocks.createCoupon).toHaveBeenCalledWith({ code: "local10", type: "percent", value: 10, maxUses: 25, startsAt: new Date(startsAt), expiresAt: null, isActive: true });
    expect(dbMocks.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: adminUser.id, action: "coupon.create", entityId: "LOCAL10" }));
  });

  it("updates a coupon and supports active-state changes through the existing mutation", async () => {
    dbMocks.updateCoupon.mockResolvedValue(undefined);
    dbMocks.createAuditLog.mockResolvedValue(undefined);
    await expect((await caller(adminUser)).couponUpdate({ id: 7, isActive: false, expiresAt: "2026-10-22T02:59:00.000Z" }))
      .resolves.toEqual({ success: true });
    expect(dbMocks.updateCoupon).toHaveBeenCalledWith(7, expect.objectContaining({ isActive: false, expiresAt: new Date("2026-10-22T02:59:00.000Z") }));
  });

  it("deletes only through the existing admin procedure and records the action", async () => {
    dbMocks.deleteCoupon.mockResolvedValue(undefined);
    dbMocks.createAuditLog.mockResolvedValue(undefined);
    await expect((await caller(adminUser)).couponDelete({ id: 7 })).resolves.toEqual({ success: true });
    await expect((await caller(regularUser)).couponDelete({ id: 7 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(dbMocks.deleteCoupon).toHaveBeenCalledTimes(1);
  });

  it("limits audit reads to the existing contract and requires admin authorization", async () => {
    dbMocks.getAuditLogs.mockResolvedValue([{ id: 9, action: "coupon.update", metadata: null }]);
    await expect((await caller(adminUser)).auditList({ limit: 200 })).resolves.toHaveLength(1);
    expect(dbMocks.getAuditLogs).toHaveBeenCalledWith(200);
    await expect((await caller(adminUser)).auditList({ limit: 1001 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect((await caller(regularUser)).auditList({ limit: 20 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(dbMocks.getAuditLogs).toHaveBeenCalledTimes(1);
  });

  it("does not report a successful mutation or write an audit record when persistence fails", async () => {
    dbMocks.updateCoupon.mockRejectedValue(new Error("local mocked persistence failure"));
    await expect((await caller(adminUser)).couponUpdate({ id: 7, isActive: true })).rejects.toThrow("local mocked persistence failure");
    expect(dbMocks.createAuditLog).not.toHaveBeenCalled();
  });
});
