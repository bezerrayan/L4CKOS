import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getUsersWithStats: vi.fn(),
  getUserOrderHistory: vi.fn(),
  setUserFlags: vi.fn(),
  getAdminProductReviews: vi.fn(),
  moderateProductReview: vi.fn(),
  createAuditLog: vi.fn(),
}));

vi.mock("../db", async importOriginal => ({
  ...await importOriginal<typeof import("../db")>(),
  getUsersWithStats: dbMocks.getUsersWithStats,
  getUserOrderHistory: dbMocks.getUserOrderHistory,
  setUserFlags: dbMocks.setUserFlags,
  getAdminProductReviews: dbMocks.getAdminProductReviews,
  moderateProductReview: dbMocks.moderateProductReview,
  createAuditLog: dbMocks.createAuditLog,
}));

const adminUser = { id: 81, openId: "synthetic-admin", email: "admin@local.dev", role: "admin" };
const regularUser = { id: 82, openId: "synthetic-customer", email: "customer@example.invalid", role: "user" };

async function caller(user: typeof adminUser | typeof regularUser | null) {
  const { adminRouter } = await import("./admin");
  return adminRouter.createCaller({ user, req: {} as any, res: {} as any } as any);
}

describe("admin customer and review contracts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns only fields needed by the customer interface", async () => {
    dbMocks.getUsersWithStats.mockResolvedValue([{
      id: 9,
      openId: "internal-id",
      name: "Cliente fictício",
      email: "customer@example.invalid",
      cpf: "00000000000",
      phone: "+5500000000000",
      asaasCustomerId: "asaas-internal",
      role: "user",
      isVip: false,
      isBlocked: false,
      ordersCount: 2,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      lastSignedIn: null,
    }]);

    await expect((await caller(adminUser)).usersList()).resolves.toEqual([{
      id: 9,
      name: "Cliente fictício",
      email: "customer@example.invalid",
      role: "user",
      isVip: false,
      isBlocked: false,
      ordersCount: 2,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      lastSignedIn: null,
    }]);
  });

  it.each([null, regularUser])("denies usersList to unauthenticated or non-admin callers", async user => {
    await expect((await caller(user)).usersList()).rejects.toMatchObject({ code: user ? "FORBIDDEN" : "UNAUTHORIZED" });
    expect(dbMocks.getUsersWithStats).not.toHaveBeenCalled();
  });

  it("returns only a customer's historical order fields for an authorized admin", async () => {
    const rows = [{
      id: 301,
      createdAt: new Date("2026-04-10T12:00:00.000Z"),
      totalPrice: 15990,
      paymentStatus: "confirmed",
      status: "delivered",
    }];
    dbMocks.getUserOrderHistory.mockResolvedValue(rows);

    await expect((await caller(adminUser)).userOrderHistory({ userId: 9 }))
      .resolves.toEqual(rows);
    expect(dbMocks.getUserOrderHistory).toHaveBeenCalledWith(9, undefined, undefined);
  });

  it.each([null, regularUser])("denies historical customer orders to unauthenticated or non-admin callers", async user => {
    await expect((await caller(user)).userOrderHistory({ userId: 9 }))
      .rejects.toMatchObject({ code: user ? "FORBIDDEN" : "UNAUTHORIZED" });
    expect(dbMocks.getUserOrderHistory).not.toHaveBeenCalled();
  });

  it("rejects an invalid customer order date range before querying", async () => {
    const adminCaller = await caller(adminUser);
    await expect(adminCaller.userOrderHistory({
      userId: 9,
      from: "2026-05-01T00:00:00.000Z",
      to: "2026-04-01T00:00:00.000Z",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(dbMocks.getUserOrderHistory).not.toHaveBeenCalled();
  });

  it("allows an authorized admin to block a user and records the actor", async () => {
    dbMocks.setUserFlags.mockResolvedValue(undefined);
    dbMocks.createAuditLog.mockResolvedValue(undefined);

    await expect((await caller(adminUser)).userSetFlags({ userId: 9, isBlocked: true }))
      .resolves.toEqual({ success: true });
    expect(dbMocks.setUserFlags).toHaveBeenCalledWith(9, { isBlocked: true });
    expect(dbMocks.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: adminUser.id,
      action: "user.setFlags",
      entityId: "9",
    }));
  });

  it.each([null, regularUser])("denies account block changes to unauthenticated or non-admin callers before mutation", async user => {
    await expect((await caller(user)).userSetFlags({ userId: 9, isBlocked: true }))
      .rejects.toMatchObject({ code: user ? "FORBIDDEN" : "UNAUTHORIZED" });
    expect(dbMocks.setUserFlags).not.toHaveBeenCalled();
    expect(dbMocks.createAuditLog).not.toHaveBeenCalled();
  });

  it.each([adminUser, regularUser, null])("does not expose the legacy role mutation to any application caller", async user => {
    const { adminRouter } = await import("./admin");
    const procedures = adminRouter._def.procedures;
    expect(procedures).not.toHaveProperty("userSetRole");
    await expect((await caller(user) as any).userSetRole({ userId: 9, role: "admin" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(dbMocks.setUserFlags).not.toHaveBeenCalled();
    expect(dbMocks.createAuditLog).not.toHaveBeenCalled();
  });

  it("rejects direct VIP mutation payloads even for an authorized administrator", async () => {
    const adminCaller = await caller(adminUser);
    await expect(adminCaller.userSetFlags({ userId: 9, isVip: true } as any))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(adminCaller.userSetFlags({ userId: 9, isBlocked: false, isVip: false } as any))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(dbMocks.setUserFlags).not.toHaveBeenCalled();
    expect(dbMocks.createAuditLog).not.toHaveBeenCalled();
  });

  it("preserves read-only role and VIP fields in the authorized customer query", async () => {
    dbMocks.getUsersWithStats.mockResolvedValue([{
      id: 10, name: "Fixture", email: "fixture@example.invalid", role: "admin", isVip: true,
      isBlocked: false, ordersCount: 0, createdAt: null, lastSignedIn: null,
    }]);
    await expect((await caller(adminUser)).usersList()).resolves.toMatchObject([
      { id: 10, role: "admin", isVip: true },
    ]);
  });

  it("returns the real review states and moderates both independent fields as the authenticated admin", async () => {
    const review = { id: 12, moderationStatus: "published", imageStatus: "pending", verifiedPurchase: 1 };
    dbMocks.getAdminProductReviews.mockResolvedValue([review]);
    dbMocks.moderateProductReview.mockResolvedValue(undefined);
    dbMocks.createAuditLog.mockResolvedValue(undefined);
    const adminCaller = await caller(adminUser);

    await expect(adminCaller.reviewsList()).resolves.toEqual([review]);
    await expect(adminCaller.reviewModerate({ reviewId: 12, imageStatus: "approved" })).resolves.toEqual({ success: true });
    expect(dbMocks.moderateProductReview).toHaveBeenCalledWith({ reviewId: 12, actorUserId: adminUser.id, imageStatus: "approved" });
    expect(dbMocks.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: adminUser.id,
      action: "review.moderate",
      entityId: "12",
      metadata: { imageStatus: "approved", moderationStatus: undefined },
    }));
  });

  it("denies review moderation to non-admin callers before invoking mutation handlers", async () => {
    await expect((await caller(regularUser)).reviewModerate({ reviewId: 12, moderationStatus: "hidden_spam" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(dbMocks.moderateProductReview).not.toHaveBeenCalled();
    expect(dbMocks.createAuditLog).not.toHaveBeenCalled();
  });

  it("does not report successful moderation when the persisted action fails", async () => {
    dbMocks.moderateProductReview.mockRejectedValue(new Error("local mocked persistence failure"));

    await expect((await caller(adminUser)).reviewModerate({ reviewId: 12, imageStatus: "rejected" }))
      .rejects.toThrow("local mocked persistence failure");
    expect(dbMocks.createAuditLog).not.toHaveBeenCalled();
  });
});
