import { afterEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  getOrderByAsaasCheckoutId: vi.fn(), getOrderById: vi.fn(), getOrderReservationItems: vi.fn(),
  getOrderByIdAndUser: vi.fn(), markOrderPaid: vi.fn(), getUserById: vi.fn(),
  getUserPhoneById: vi.fn(), runAsaasWebhookOnce: vi.fn(), recordPaymentException: vi.fn(),
  reserveExternalCheckoutCreation: vi.fn(), setOrderAsaasCheckoutId: vi.fn(),
  updateUserAsaasCustomerId: vi.fn(), verifyAsaasCustomerNotifications: vi.fn(),
  createAsaasCheckout: vi.fn(), createAsaasCustomer: vi.fn(), getAsaasPayment: vi.fn(),
  validateAsaasWebhookSignature: vi.fn(), receiveWebhook: vi.fn(),
}));

vi.mock("../db", () => ({
  getOrderByAsaasCheckoutId: dependencies.getOrderByAsaasCheckoutId,
  getOrderById: dependencies.getOrderById,
  getOrderReservationItems: dependencies.getOrderReservationItems,
  getOrderByIdAndUser: dependencies.getOrderByIdAndUser,
  markOrderPaid: dependencies.markOrderPaid,
  getUserById: dependencies.getUserById,
  getUserPhoneById: dependencies.getUserPhoneById,
  runAsaasWebhookOnce: dependencies.runAsaasWebhookOnce,
  recordPaymentException: dependencies.recordPaymentException,
  reserveExternalCheckoutCreation: dependencies.reserveExternalCheckoutCreation,
  setOrderAsaasCheckoutId: dependencies.setOrderAsaasCheckoutId,
  updateUserAsaasCustomerId: dependencies.updateUserAsaasCustomerId,
}));
vi.mock("../services/asaasService", () => ({
  verifyAsaasCustomerNotifications: dependencies.verifyAsaasCustomerNotifications,
  createAsaasCheckout: dependencies.createAsaasCheckout,
  createAsaasCustomer: dependencies.createAsaasCustomer,
  getAsaasPayment: dependencies.getAsaasPayment,
  validateAsaasWebhookSignature: dependencies.validateAsaasWebhookSignature,
}));
vi.mock("../payments/webhookInbox", () => ({ receiveWebhook: dependencies.receiveWebhook }));

import { asaasWebhookHandler, createCheckoutHandler, createCustomerHandler, ensureAsaasCustomerForUser } from "./paymentController";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function responseDouble() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
}

function closedStore() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("PUBLIC_SITE_MODE", "store");
  vi.stubEnv("PUBLIC_CHECKOUT_ENABLED", "false");
}

describe("payment controller checkout defense in depth", () => {
  it.each([
    ["customer", createCustomerHandler],
    ["checkout", createCheckoutHandler],
  ])("blocks direct %s handler calls before database or Asaas work", async (_name, handler) => {
    closedStore();
    const response: any = responseDouble();

    await handler({ body: {}, ip: "127.0.0.1", authUser: { id: 12 } } as any, response);

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ code: "PUBLIC_CHECKOUT_DISABLED" }));
    expect(dependencies.getUserById).not.toHaveBeenCalled();
    expect(dependencies.getOrderByIdAndUser).not.toHaveBeenCalled();
    expect(dependencies.createAsaasCustomer).not.toHaveBeenCalled();
    expect(dependencies.createAsaasCheckout).not.toHaveBeenCalled();
    expect(dependencies.reserveExternalCheckoutCreation).not.toHaveBeenCalled();
  });

  it("blocks direct calls to the internal customer helper before SQL and Asaas", async () => {
    closedStore();

    await expect(ensureAsaasCustomerForUser({ userId: 12 }))
      .rejects.toMatchObject({ name: "PublicCheckoutDisabledError", code: "PUBLIC_CHECKOUT_DISABLED" });

    expect(dependencies.getUserById).not.toHaveBeenCalled();
    expect(dependencies.getUserPhoneById).not.toHaveBeenCalled();
    expect(dependencies.verifyAsaasCustomerNotifications).not.toHaveBeenCalled();
    expect(dependencies.createAsaasCustomer).not.toHaveBeenCalled();
    expect(dependencies.updateUserAsaasCustomerId).not.toHaveBeenCalled();
  });

  it("keeps the signed webhook path available while the public store is closed", async () => {
    closedStore();
    dependencies.validateAsaasWebhookSignature.mockReturnValue(true);
    dependencies.receiveWebhook.mockResolvedValue({ status: 202, body: { accepted: true } });
    const response: any = responseDouble();

    await asaasWebhookHandler({ headers: { "asaas-access-token": "synthetic" }, body: { id: "synthetic-event" } } as any, response);

    expect(response.status).toHaveBeenCalledWith(202);
    expect(response.json).toHaveBeenCalledWith({ accepted: true });
    expect(dependencies.receiveWebhook).toHaveBeenCalledOnce();
    expect(dependencies.createAsaasCheckout).not.toHaveBeenCalled();
  });
});
