import { describe, expect, it, vi } from "vitest";
import { ASAAS_SANDBOX_API_URL, createSandboxAsaasStockPaymentProvider } from "./asaasStockPaymentProvider";

const sandbox = {
  STOCK_ASAAS_MODE: "sandbox",
  ASAAS_API_URL: ASAAS_SANDBOX_API_URL,
  ASAAS_API_KEY: "synthetic-sandbox-key-not-real",
};

describe("STOCK Asaas sandbox provider", () => {
  it("fails closed unless mode, endpoint and key explicitly identify sandbox", () => {
    expect(() => createSandboxAsaasStockPaymentProvider({
      environment: { ...sandbox, ASAAS_API_URL: "https://api.asaas.com/v3" },
      loadBuyer: vi.fn(), createCharge: vi.fn(),
    })).toThrow("STOCK_ASAAS_SANDBOX_REQUIRED");
    expect(() => createSandboxAsaasStockPaymentProvider({
      environment: { ...sandbox, STOCK_ASAAS_MODE: "" },
      loadBuyer: vi.fn(), createCharge: vi.fn(),
    })).toThrow("STOCK_ASAAS_SANDBOX_REQUIRED");
    expect(() => createSandboxAsaasStockPaymentProvider({
      environment: { ...sandbox, ASAAS_API_KEY: " " },
      loadBuyer: vi.fn(), createCharge: vi.fn(),
    })).toThrow("STOCK_ASAAS_SANDBOX_KEY_REQUIRED");
  });

  it("uses the stable STOCK order reference and never advertises provider idempotency it cannot guarantee", async () => {
    const loadBuyer = vi.fn(async () => ({ name: "Cliente Sintético", email: "buyer@example.invalid", cpfCnpj: "11111111111" }));
    const createCharge = vi.fn(async () => ({ paymentId: "pay-sandbox-fixture", checkoutUrl: "https://sandbox.asaas.com/checkout" }));
    const provider = createSandboxAsaasStockPaymentProvider({ environment: sandbox, loadBuyer, createCharge });
    expect(provider.supportsIdempotencyKey).toBe(false);
    await expect(provider.createPayment({ orderId: "12345", amountCents: 12900, idempotencyKey: "stock:12345" })).resolves.toEqual({
      paymentId: "pay-sandbox-fixture", checkoutUrl: "https://sandbox.asaas.com/checkout",
    });
    expect(createCharge).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 12345, value: 129, method: "PIX", description: "Pedido STOCK #12345",
      customer: expect.objectContaining({ email: "buyer@example.invalid" }),
    }));
    await expect(provider.createPayment({ orderId: "12345", amountCents: 12900, idempotencyKey: "wrong-key" })).rejects.toThrow("STOCK_PAYMENT_KEY_MISMATCH");
    expect(createCharge).toHaveBeenCalledOnce();
  });

  it("does not retry or hide an ambiguous/incomplete charge result", async () => {
    const createCharge = vi.fn(async () => ({ paymentId: "pay-maybe-created", checkoutUrl: null }));
    const provider = createSandboxAsaasStockPaymentProvider({
      environment: sandbox,
      loadBuyer: vi.fn(async () => ({ name: "A", email: "a@example.invalid", cpfCnpj: "11111111111" })),
      createCharge,
    });
    await expect(provider.createPayment({ orderId: "12345", amountCents: 12900, idempotencyKey: "stock:12345" })).rejects.toThrow("STOCK_PAYMENT_RESPONSE_INCOMPLETE");
    expect(createCharge).toHaveBeenCalledOnce();
  });

  it("rejects a returned production checkout URL", async () => {
    const createCharge = vi.fn(async () => ({ paymentId: "pay-maybe-created", checkoutUrl: "https://www.asaas.com/checkout" }));
    const provider = createSandboxAsaasStockPaymentProvider({
      environment: sandbox,
      loadBuyer: vi.fn(async () => ({ name: "A", email: "a@example.invalid", cpfCnpj: "11111111111" })),
      createCharge,
    });
    await expect(provider.createPayment({ orderId: "12345", amountCents: 12900, idempotencyKey: "stock:12345" })).rejects.toThrow("STOCK_PAYMENT_RESPONSE_INCOMPLETE");
    expect(createCharge).toHaveBeenCalledOnce();
  });
});
