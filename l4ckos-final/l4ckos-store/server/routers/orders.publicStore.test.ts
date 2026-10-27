import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createOrderWithId: vi.fn(),
  getProductsByIds: vi.fn(),
  getOrderByIdAndUser: vi.fn(),
  getOrderReservationItems: vi.fn(),
  getOrderByTrackingCodeAndUser: vi.fn(),
  getOrdersByUserId: vi.fn(),
  getApplicableCouponByCode: vi.fn(),
  incrementCouponUsage: vi.fn(),
  reserveStockForOrder: vi.fn(),
  updateOrderShippingAddress: vi.fn(),
  createAsaasChargeForOrder: vi.fn(),
  quoteShippingDetailed: vi.fn(),
  sendOrderCreatedEmail: vi.fn(),
  sendPaymentPendingEmail: vi.fn(),
}));

vi.mock("../db", () => ({
  createOrderWithId: mocks.createOrderWithId,
  getProductsByIds: mocks.getProductsByIds,
  getOrderByIdAndUser: mocks.getOrderByIdAndUser,
  getOrderReservationItems: mocks.getOrderReservationItems,
  getOrderByTrackingCodeAndUser: mocks.getOrderByTrackingCodeAndUser,
  getOrdersByUserId: mocks.getOrdersByUserId,
  getApplicableCouponByCode: mocks.getApplicableCouponByCode,
  incrementCouponUsage: mocks.incrementCouponUsage,
  reserveStockForOrder: mocks.reserveStockForOrder,
  updateOrderShippingAddress: mocks.updateOrderShippingAddress,
}));

vi.mock("../services/asaas", () => ({ createAsaasChargeForOrder: mocks.createAsaasChargeForOrder }));
vi.mock("../services/shippingService", () => ({ quoteShippingDetailed: mocks.quoteShippingDetailed }));
vi.mock("../services/emailService.js", () => ({
  sendOrderCreatedEmail: mocks.sendOrderCreatedEmail,
  sendPaymentPendingEmail: mocks.sendPaymentPendingEmail,
}));

import { TRPCError } from "@trpc/server";
import { ordersRouter } from "./orders";

const authenticatedUser = {
  id: 41,
  openId: "test-user-41",
  email: "buyer@example.test",
  role: "user",
} as any;

const checkoutInput = {
  method: "PIX",
  items: [{ productId: 12, quantity: 1 }],
  shipping: { cep: "70000000", optionId: "standard" },
  shippingAddress: {
    recipient: "Test Buyer",
    zipCode: "70000000",
    street: "Rua de Teste",
    number: "1",
    neighborhood: "Centro",
    city: "Brasília",
    state: "DF",
  },
  customer: { name: "Test Buyer", cpfCnpj: "52998224725" },
};

function caller() {
  return ordersRouter.createCaller({
    user: authenticatedUser,
    req: {} as any,
    res: {} as any,
  });
}

describe("orders.createAsaasCharge checkout gate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it.each([
    [{}, "both flags absent"],
    [{ PUBLIC_SITE_MODE: "store" }, "checkout flag absent"],
    [{ PUBLIC_CHECKOUT_ENABLED: "true" }, "site mode absent"],
    [{ PUBLIC_SITE_MODE: "coming-soon", PUBLIC_CHECKOUT_ENABLED: "true" }, "site not in store mode"],
    [{ PUBLIC_SITE_MODE: "store", PUBLIC_CHECKOUT_ENABLED: "false" }, "checkout explicitly disabled"],
  ])("denies an authenticated order/payment attempt when %s", async (env) => {
    vi.stubEnv("PUBLIC_SITE_MODE", env.PUBLIC_SITE_MODE ?? "");
    vi.stubEnv("PUBLIC_CHECKOUT_ENABLED", env.PUBLIC_CHECKOUT_ENABLED ?? "");

    await expect(caller().createAsaasCharge(checkoutInput as any)).rejects.toMatchObject({
      code: "FORBIDDEN",
      appCode: "PUBLIC_CHECKOUT_DISABLED",
    });

    expect(mocks.createOrderWithId).not.toHaveBeenCalled();
    expect(mocks.reserveStockForOrder).not.toHaveBeenCalled();
    expect(mocks.createAsaasChargeForOrder).not.toHaveBeenCalled();
    expect(mocks.sendOrderCreatedEmail).not.toHaveBeenCalled();
    expect(mocks.sendPaymentPendingEmail).not.toHaveBeenCalled();
  });

  it("keeps the rejection represented as a forbidden tRPC error", async () => {
    vi.stubEnv("PUBLIC_SITE_MODE", "store");
    vi.stubEnv("PUBLIC_CHECKOUT_ENABLED", "");

    try {
      await caller().createAsaasCharge(checkoutInput as any);
      throw new Error("expected checkout gate to deny");
    } catch (error) {
      expect(error).toBeInstanceOf(TRPCError);
      expect((error as TRPCError).code).toBe("FORBIDDEN");
    }
  });
});
