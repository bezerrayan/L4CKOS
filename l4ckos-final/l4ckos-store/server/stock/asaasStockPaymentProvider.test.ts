import { describe, expect, it, vi } from "vitest";
import { ASAAS_SANDBOX_API_URL, createSandboxAsaasStockPaymentProvider } from "./asaasStockPaymentProvider";
import { AsaasRequestFailure } from "../services/asaasRequestFailure";

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
      paymentId: "pay-sandbox-fixture", checkoutUrl: "https://sandbox.asaas.com/checkout", customerId: null,
    });
    expect(createCharge).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 12345, value: 129, method: "PIX", description: "Pedido STOCK #12345",
      customer: expect.objectContaining({ email: "buyer@example.invalid" }),
    }));
    await expect(provider.createPayment({ orderId: "12345", amountCents: 12900, idempotencyKey: "wrong-key" })).rejects.toThrow("STOCK_PAYMENT_KEY_MISMATCH");
    expect(createCharge).toHaveBeenCalledOnce();
  });

  it("preserves a valid payment ID when no safe checkout URL is available", async () => {
    const createCharge = vi.fn(async () => ({ paymentId: "pay-maybe-created", checkoutUrl: null }));
    const provider = createSandboxAsaasStockPaymentProvider({
      environment: sandbox,
      loadBuyer: vi.fn(async () => ({ name: "A", email: "a@example.invalid", cpfCnpj: "11111111111" })),
      createCharge,
    });
    await expect(provider.createPayment({ orderId: "12345", amountCents: 12900, idempotencyKey: "stock:12345" }))
      .resolves.toMatchObject({ paymentId: "pay-maybe-created", checkoutUrl: null });
    expect(createCharge).toHaveBeenCalledOnce();
  });

  it("preserves the payment ID but suppresses a URL from the wrong environment", async () => {
    const createCharge = vi.fn(async () => ({ paymentId: "pay-maybe-created", checkoutUrl: "https://www.asaas.com/checkout" }));
    const provider = createSandboxAsaasStockPaymentProvider({
      environment: sandbox,
      loadBuyer: vi.fn(async () => ({ name: "A", email: "a@example.invalid", cpfCnpj: "11111111111" })),
      createCharge,
    });
    await expect(provider.createPayment({ orderId: "12345", amountCents: 12900, idempotencyKey: "stock:12345" }))
      .resolves.toMatchObject({ paymentId: "pay-maybe-created", checkoutUrl: null });
    expect(createCharge).toHaveBeenCalledOnce();
  });

  it("creates a hosted credit-card invoice without card data and requires a trusted return URL", async () => {
    const createCharge = vi.fn(async () => ({ paymentId: "pay-card-sandbox-fixture", checkoutUrl: "https://sandbox.asaas.com/i/fixture" }));
    const provider = createSandboxAsaasStockPaymentProvider({
      environment: sandbox,
      loadBuyer: async () => ({ name: "Cliente Sintético", email: "buyer@example.invalid", cpfCnpj: "11111111111" }),
      getCardReturnUrl: () => "https://store.example.invalid/em-breve",
      createCharge,
    });
    const token = "A".repeat(32);
    await expect(provider.createPayment({
      orderId: "12345", amountCents: 1000, idempotencyKey: `stock:12345:${token}`,
      externalReference: `L4CKOS-STOCK-ATTEMPT:v2:CARD:${token}`, paymentMethod: "CARD",
    })).resolves.toMatchObject({ paymentId: "pay-card-sandbox-fixture", checkoutUrl: "https://sandbox.asaas.com/i/fixture", customerId: null });
    const args = createCharge.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args).toMatchObject({ method: "CARD", value: 10, successUrl: "https://store.example.invalid/em-breve" });
    expect(args).not.toHaveProperty("creditCard");
    expect(args).not.toHaveProperty("creditCardHolderInfo");
    expect(args).not.toHaveProperty("number");
    expect(args).not.toHaveProperty("ccv");
  });

  it("fails closed before provider I/O when card reference or return URL is not bound", async () => {
    const createCharge = vi.fn(async () => ({ paymentId: "pay-card-sandbox-fixture", checkoutUrl: "https://sandbox.asaas.com/i/fixture" }));
    const provider = createSandboxAsaasStockPaymentProvider({
      environment: sandbox,
      loadBuyer: async () => ({ name: "Cliente Sintético", email: "buyer@example.invalid", cpfCnpj: "11111111111" }),
      createCharge,
    });
    const token = "A".repeat(32);
    await expect(provider.createPayment({ orderId: "12345", amountCents: 1000, idempotencyKey: `stock:12345:${token}`, externalReference: `L4CKOS-STOCK-ATTEMPT:v2:CARD:${token}`, paymentMethod: "CARD" }))
      .rejects.toMatchObject({ message: "STOCK_CARD_RETURN_URL_UNAVAILABLE", definitelyNotCreated: true });
    await expect(provider.createPayment({ orderId: "12345", amountCents: 1000, idempotencyKey: `stock:12345:${token}`, externalReference: `L4CKOS-STOCK-ATTEMPT:v1:${token}`, paymentMethod: "CARD", getCardReturnUrl: "untrusted" } as any))
      .rejects.toMatchObject({ message: "STOCK_PAYMENT_METHOD_REFERENCE_MISMATCH", definitelyNotCreated: true });
    expect(createCharge).not.toHaveBeenCalled();
  });

  it("classifies buyer lookup failures as pre-payment and never calls the charge adapter", async () => {
    const createCharge = vi.fn();
    const provider = createSandboxAsaasStockPaymentProvider({ environment: sandbox, loadBuyer: vi.fn(async () => { throw Error("private lookup detail"); }), createCharge });
    await expect(provider.createPayment({ orderId: "12345", amountCents: 12900, idempotencyKey: "stock:12345" }))
      .rejects.toMatchObject({ name: "StockProviderError", definitelyNotCreated: true, phase: "buyer_lookup", category: "unknown" });
    expect(createCharge).not.toHaveBeenCalled();
  });

  it("preserves a documented structured payment validation rejection as definitive", async () => {
    const createCharge = vi.fn(async () => { throw new AsaasRequestFailure("payment_create", "provider_rejection", true, 400); });
    const provider = createSandboxAsaasStockPaymentProvider({ environment: sandbox, loadBuyer: async () => ({ name: "N", email: "b@example.invalid", cpfCnpj: "11111111111" }), createCharge });
    await expect(provider.createPayment({ orderId: "12345", amountCents: 12900, idempotencyKey: "stock:12345" }))
      .rejects.toMatchObject({ name: "StockProviderError", definitelyNotCreated: true, phase: "payment_create", category: "provider_rejection", httpStatus: 400 });
  });

  it("classifies an untyped timeout during create as uncertain", async () => {
    const createCharge = vi.fn(async () => { throw Error("synthetic timeout"); });
    const provider = createSandboxAsaasStockPaymentProvider({ environment: sandbox, loadBuyer: async () => ({ name: "N", email: "b@example.invalid", cpfCnpj: "11111111111" }), createCharge });
    await expect(provider.createPayment({ orderId: "12345", amountCents: 12900, idempotencyKey: "stock:12345" }))
      .rejects.toMatchObject({ name: "StockProviderError", definitelyNotCreated: false, phase: "payment_create", category: "unknown" });
    expect(createCharge).toHaveBeenCalledOnce();
  });

  it("fails closed if the payment ID itself is missing", async () => {
    const provider = createSandboxAsaasStockPaymentProvider({
      environment: sandbox, loadBuyer: async () => ({ name: "N", email: "b@example.invalid", cpfCnpj: "11111111111" }),
      createCharge: async () => ({ paymentId: " ", checkoutUrl: null }),
    });
    await expect(provider.createPayment({ orderId: "12345", amountCents: 12900, idempotencyKey: "stock:12345" }))
      .rejects.toMatchObject({ definitelyNotCreated: false, phase: "payment_create", category: "invalid_response" });
  });

  it("rejects a mismatch between the attempt-bound method and requested provider method", async () => {
    const createCharge = vi.fn(async () => ({ paymentId: "pay-x", checkoutUrl: "https://sandbox.asaas.com/i/x" }));
    const provider = createSandboxAsaasStockPaymentProvider({
      environment: sandbox,
      loadBuyer: async () => ({ name: "N", email: "b@example.invalid", cpfCnpj: "11111111111" }),
      getCardReturnUrl: () => "https://store.example.invalid/em-breve",
      createCharge,
    });
    const token = "A".repeat(32);
    await expect(provider.createPayment({
      orderId: "9", amountCents: 1000, idempotencyKey: `stock:9:${token}`,
      externalReference: `L4CKOS-STOCK-ATTEMPT:v1:${token}`, paymentMethod: "CARD",
    })).rejects.toMatchObject({ message: "STOCK_PAYMENT_METHOD_REFERENCE_MISMATCH", definitelyNotCreated: true });
    expect(createCharge).not.toHaveBeenCalled();
  });
});

describe("STOCK provider idempotency key binding (V2)", () => {
  const make = () => {
    const createCharge = vi.fn(async () => ({ paymentId: "pay-x", checkoutUrl: "https://sandbox.asaas.com/checkout" }));
    return { createCharge, provider: createSandboxAsaasStockPaymentProvider({ environment: sandbox, loadBuyer: async () => ({ name: "N", email: "b@example.invalid", cpfCnpj: "11111111111" }), createCharge }) };
  };
  const REF = "L4CKOS-STOCK-ATTEMPT:v1:" + "A".repeat(32);
  it("accepts the attempt-bound key and forwards the strong reference to the charge", async () => {
    const { provider, createCharge } = make();
    await provider.createPayment({ orderId: "9", amountCents: 12900, idempotencyKey: `stock:9:${"A".repeat(32)}`, externalReference: REF });
    expect(createCharge).toHaveBeenCalledWith(expect.objectContaining({ externalReference: REF }));
  });
  it.each([
    ["legacy key with a strong reference", { idempotencyKey: "stock:9", externalReference: REF }],
    ["another attempt's token", { idempotencyKey: `stock:9:${"B".repeat(32)}`, externalReference: REF }],
    ["attempt key without reference", { idempotencyKey: `stock:9:${"A".repeat(32)}` }],
    ["custom non-strong reference", { idempotencyKey: "stock:9", externalReference: "anything" }],
  ])("rejects %s", async (_n, extra) => {
    const { provider, createCharge } = make();
    await expect(provider.createPayment({ orderId: "9", amountCents: 12900, ...(extra as any) })).rejects.toThrow(/STOCK_PAYMENT_(KEY_MISMATCH|REFERENCE_INVALID)/);
    expect(createCharge).not.toHaveBeenCalled();
  });
});
