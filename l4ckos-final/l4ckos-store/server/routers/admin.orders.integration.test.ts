import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOrdersByFilters: vi.fn(),
  getOrderById: vi.fn(),
  updateOrderAndReserveDeliveredEmailEvents: vi.fn(),
  markOrderPaid: vi.fn(),
  getUserById: vi.fn(),
  getOrderReservationItems: vi.fn(),
  createAuditLog: vi.fn(),
  isTrustedPaymentConfirmation: vi.fn(),
  sendPaymentApprovedEmail: vi.fn(),
}));

vi.mock("../db", async importOriginal => ({
  ...await importOriginal<typeof import("../db")>(),
  getOrdersByFilters: mocks.getOrdersByFilters,
  getOrderById: mocks.getOrderById,
  updateOrderAndReserveDeliveredEmailEvents: mocks.updateOrderAndReserveDeliveredEmailEvents,
  markOrderPaid: mocks.markOrderPaid,
  getUserById: mocks.getUserById,
  getOrderReservationItems: mocks.getOrderReservationItems,
  createAuditLog: mocks.createAuditLog,
}));

vi.mock("../payments/confirmation", async importOriginal => ({
  ...await importOriginal<typeof import("../payments/confirmation")>(),
  isTrustedPaymentConfirmation: mocks.isTrustedPaymentConfirmation,
}));

vi.mock("../services/emailService.js", async importOriginal => ({
  ...await importOriginal<typeof import("../services/emailService.js")>(),
  sendPaymentApprovedEmail: mocks.sendPaymentApprovedEmail,
}));

const admin = { id: 51, openId: "synthetic-admin", email: "admin@local.dev", role: "admin" };
const customer = { id: 52, openId: "mock-user", email: "user@local.invalid", role: "user" };
const order = { id: 7001, userId: 52, status: "pending", paymentStatus: "unconfirmed", totalPrice: 1900 };

async function caller(user: typeof admin | typeof customer | null) {
  const { adminRouter } = await import("./admin");
  return adminRouter.createCaller({ user, req: {} as any, res: {} as any } as any);
}

describe("admin order integration contract (mock-only; no database or provider IO)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTrustedPaymentConfirmation.mockReturnValue(false);
    mocks.sendPaymentApprovedEmail.mockResolvedValue(undefined);
  });

  it("lists API-returned orders for an admin and denies non-admin callers before reading", async () => {
    const rows = [{ ...order, customerName: "Cliente sintético", items: [] }];
    mocks.getOrdersByFilters.mockResolvedValue(rows);
    await expect((await caller(admin)).ordersList()).resolves.toEqual(rows);
    expect(mocks.getOrdersByFilters).toHaveBeenCalledWith(undefined);
    await expect((await caller(customer)).ordersList()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect((await caller(null)).ordersList()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.getOrdersByFilters).toHaveBeenCalledTimes(1);
  });

  it("preserves empty and failed list responses for the UI to render as empty/error states", async () => {
    mocks.getOrdersByFilters.mockResolvedValueOnce([]);
    await expect((await caller(admin)).ordersList()).resolves.toEqual([]);
    mocks.getOrdersByFilters.mockRejectedValueOnce(new Error("Falha local simulada."));
    await expect((await caller(admin)).ordersList()).rejects.toThrow("Falha local simulada.");
  });

  it("does not allow an operational transition to stand in for trusted payment confirmation", async () => {
    mocks.getOrderById.mockResolvedValue(order);
    await expect((await caller(admin)).orderUpdate({ orderId: order.id, status: "processing" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.updateOrderAndReserveDeliveredEmailEvents).not.toHaveBeenCalled();
    expect(mocks.markOrderPaid).not.toHaveBeenCalled();
    expect(mocks.sendPaymentApprovedEmail).not.toHaveBeenCalled();
  });

  it("preserves the existing tracking update handler and actor audit using only mocked persistence", async () => {
    const updatedOrder = { ...order, trackingCode: "MOCK-TRACKING" };
    mocks.getOrderById.mockResolvedValue(order);
    mocks.updateOrderAndReserveDeliveredEmailEvents.mockResolvedValue({ previousOrder: order, updatedOrder });
    mocks.createAuditLog.mockResolvedValue(undefined);

    await expect((await caller(admin)).orderUpdate({ orderId: order.id, trackingCode: "MOCK-TRACKING" }))
      .resolves.toEqual({ success: true });
    expect(mocks.updateOrderAndReserveDeliveredEmailEvents).toHaveBeenCalledWith(order.id, {
      status: undefined,
      trackingCode: "MOCK-TRACKING",
    }, admin.id);
    expect(mocks.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: admin.id,
      action: "order.update",
      entityId: String(order.id),
    }));
  });

  it("surfaces order mutation failures without treating them as successful updates", async () => {
    mocks.getOrderById.mockResolvedValue(order);
    mocks.updateOrderAndReserveDeliveredEmailEvents.mockRejectedValue(new Error("Transição recusada pelo domínio."));
    await expect((await caller(admin)).orderUpdate({ orderId: order.id, trackingCode: "MOCK-TRACKING" }))
      .rejects.toThrow("Transição recusada pelo domínio.");
    expect(mocks.createAuditLog).not.toHaveBeenCalled();
    expect(mocks.sendPaymentApprovedEmail).not.toHaveBeenCalled();
  });

  it("keeps manual confirmation behind admin authorization and mocks the email adapter", async () => {
    mocks.getOrderById.mockResolvedValue(order);
    mocks.markOrderPaid.mockResolvedValue({ updated: true, paymentConfirmedAt: new Date("2026-10-21T12:00:00Z") });
    mocks.getUserById.mockResolvedValue({ name: "Cliente sintético", email: "user@local.invalid" });
    mocks.getOrderReservationItems.mockResolvedValue([]);

    await expect((await caller(customer)).orderConfirmPayment({ orderId: order.id }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.markOrderPaid).not.toHaveBeenCalled();

    await expect((await caller(admin)).orderConfirmPayment({ orderId: order.id }))
      .resolves.toMatchObject({ success: true, updated: true });
    expect(mocks.markOrderPaid).toHaveBeenCalledWith(order.id, { source: "manual", actorUserId: admin.id });
    expect(mocks.sendPaymentApprovedEmail).toHaveBeenCalledTimes(1);
  });
});
