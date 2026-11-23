import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MYSQL_TLS_HOST } from "../database/mysqlTls.mjs";
import { PRODUCTION_RAILWAY_IDENTITY } from "../_core/productionFinancialPolicy";
import { ISOLATED_HOMOLOGATION_IDENTITY } from "../_core/railwayEnvironment";
import { getOrderById, getUserById, getUserPhoneById } from "../db";
import { createAsaasStockChargeForOrder } from "../services/asaas";
import { AsaasRequestFailure } from "../services/asaasRequestFailure";
import { StockProviderError } from "./stockProviderError";
import {
  ASAAS_SANDBOX_API_URL, createProductionAsaasStockPaymentProvider, createSandboxAsaasStockPaymentProvider,
} from "./asaasStockPaymentProvider";

vi.mock("../db", () => ({ getOrderById: vi.fn(), getUserById: vi.fn(), getUserPhoneById: vi.fn() }));
vi.mock("../services/asaas", () => ({ createAsaasStockChargeForOrder: vi.fn() }));

const production: NodeJS.ProcessEnv = {
  NODE_ENV: "production", APP_ENV: "production",
  RAILWAY_PROJECT_ID: PRODUCTION_RAILWAY_IDENTITY.projectId, RAILWAY_ENVIRONMENT_ID: PRODUCTION_RAILWAY_IDENTITY.environmentId, RAILWAY_SERVICE_ID: PRODUCTION_RAILWAY_IDENTITY.serviceId,
  STOCK_RUNTIME_ENABLED: "true", STOCK_CHECKOUT_ENABLED: "false", STOCK_DATABASE_ENV: "production", STOCK_EXPECTED_DATABASE: "railway",
  DATABASE_URL: `mysql://app:synthetic-pw@${MYSQL_TLS_HOST}/railway`,
  ASAAS_ENV: "production", STOCK_ASAAS_MODE: "production", ASAAS_API_URL: "https://api.asaas.com/v3", ASAAS_API_KEY: "$aact_prod_synthetic_not_real",
  ASAAS_WEBHOOK_TOKEN: "synthetic-production-webhook-token-0123456789", ASAAS_WEBHOOK_ACCOUNT_ID: "synthetic-account", ASAAS_WEBHOOK_ACCOUNT_CURRENCY: "BRL", ASAAS_WEBHOOK_INBOUND_ENABLED: "true",
};
const sandbox: NodeJS.ProcessEnv = { STOCK_ASAAS_MODE: "sandbox", ASAAS_API_URL: ASAAS_SANDBOX_API_URL, ASAAS_API_KEY: "synthetic-sandbox-key-not-real" };
const buyer = async () => ({ name: "Cliente Sintético", email: "buyer@example.invalid", cpfCnpj: "11111111111" });
const mk = (checkoutUrl: string | null) => vi.fn(async () => ({ paymentId: "pay-fixture", checkoutUrl }));

describe("production STOCK Asaas provider", () => {
  it("is constructed only under the full production contract", () => {
    expect(() => createProductionAsaasStockPaymentProvider({ environment: production, loadBuyer: buyer, createCharge: mk("https://www.asaas.com/i/x") })).not.toThrow();
    for (const over of [{ STOCK_ASAAS_MODE: "sandbox" }, { ASAAS_API_URL: ASAAS_SANDBOX_API_URL }, { ASAAS_API_KEY: "$aact_hmlg_x" }, { ASAAS_SANDBOX_API_KEY: "$aact_hmlg_x" },
      { G4_FINANCIAL_PHASE: "SANDBOX_CHECKOUT" }, { RAILWAY_PROJECT_ID: ISOLATED_HOMOLOGATION_IDENTITY.projectId }, { ASAAS_WEBHOOK_ACCOUNT_CURRENCY: "USD" }]) {
      expect(() => createProductionAsaasStockPaymentProvider({ environment: { ...production, ...over }, loadBuyer: buyer, createCharge: mk(null) }), JSON.stringify(Object.keys(over))).toThrow("STOCK_ASAAS_PRODUCTION_CONFIGURATION_INVALID");
    }
  });

  it("creates a charge and accepts only an https www.asaas.com checkout URL", async () => {
    const ok = createProductionAsaasStockPaymentProvider({ environment: production, loadBuyer: buyer, createCharge: mk("https://www.asaas.com/i/abc123") });
    await expect(ok.createPayment({ orderId: "12345", amountCents: 12900, idempotencyKey: "stock:12345" })).resolves.toMatchObject({ paymentId: "pay-fixture", checkoutUrl: "https://www.asaas.com/i/abc123" });
    for (const url of ["https://sandbox.asaas.com/i/abc", "http://www.asaas.com/i/abc", "https://www.asaas.com.evil.example/i/abc", "https://evil.example/www.asaas.com", null, ""]) {
      const bad = createProductionAsaasStockPaymentProvider({ environment: production, loadBuyer: buyer, createCharge: mk(url) });
      await expect(bad.createPayment({ orderId: "12345", amountCents: 12900, idempotencyKey: "stock:12345" }), String(url))
        .resolves.toMatchObject({ paymentId: "pay-fixture", checkoutUrl: null });
    }
  });

  it("keeps the STOCK money/reference guards (no retry, key and amount checks)", async () => {
    const createCharge = mk("https://www.asaas.com/i/abc");
    const p = createProductionAsaasStockPaymentProvider({ environment: production, loadBuyer: buyer, createCharge });
    expect(p.supportsIdempotencyKey).toBe(false);
    await expect(p.createPayment({ orderId: "12345", amountCents: 12900, idempotencyKey: "wrong" })).rejects.toThrow("STOCK_PAYMENT_KEY_MISMATCH");
    await expect(p.createPayment({ orderId: "12345", amountCents: 0, idempotencyKey: "stock:12345" })).rejects.toThrow("STOCK_PAYMENT_AMOUNT_INVALID");
    await expect(p.createPayment({ orderId: "abc", amountCents: 100, idempotencyKey: "stock:abc" })).rejects.toThrow("STOCK_ORDER_ID_INVALID");
    expect(createCharge).not.toHaveBeenCalled();
  });

  it("re-validates the contract at every charge (runtime drift fails closed)", async () => {
    const env = { ...production };
    const p = createProductionAsaasStockPaymentProvider({ environment: env, loadBuyer: buyer, createCharge: mk("https://www.asaas.com/i/abc") });
    env.ASAAS_API_URL = ASAAS_SANDBOX_API_URL;
    await expect(p.createPayment({ orderId: "12345", amountCents: 12900, idempotencyKey: "stock:12345" })).rejects.toThrow("STOCK_ASAAS_PRODUCTION_CONFIGURATION_INVALID");
  });
});

describe("sandbox provider remains sandbox-only", () => {
  it("rejects production configuration and suppresses a URL from production", async () => {
    expect(() => createSandboxAsaasStockPaymentProvider({ environment: production, loadBuyer: buyer, createCharge: mk(null) })).toThrow("STOCK_ASAAS_SANDBOX_REQUIRED");
    const p = createSandboxAsaasStockPaymentProvider({ environment: sandbox, loadBuyer: buyer, createCharge: mk("https://www.asaas.com/i/abc") });
    await expect(p.createPayment({ orderId: "12345", amountCents: 12900, idempotencyKey: "stock:12345" }))
      .resolves.toMatchObject({ paymentId: "pay-fixture", checkoutUrl: null });
    const ok = createSandboxAsaasStockPaymentProvider({ environment: sandbox, loadBuyer: buyer, createCharge: mk("https://sandbox.asaas.com/i/abc") });
    await expect(ok.createPayment({ orderId: "12345", amountCents: 12900, idempotencyKey: "stock:12345" })).resolves.toMatchObject({ checkoutUrl: "https://sandbox.asaas.com/i/abc" });
  });
});

describe("configured provider selection follows the runtime identity", () => {
  const saved = { ...process.env };
  beforeEach(() => { for (const k of Object.keys(process.env)) delete process.env[k]; });
  afterEach(() => { for (const k of Object.keys(process.env)) delete process.env[k]; Object.assign(process.env, saved); });
  it("production identity uses the production adapter; anything else uses the sandbox adapter", async () => {
    const { createConfiguredStockAsaasProvider } = await import("./configuredStockAsaasProvider");
    Object.assign(process.env, production);
    expect(() => createConfiguredStockAsaasProvider()).not.toThrow();
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, sandbox);
    expect(() => createConfiguredStockAsaasProvider()).not.toThrow();                      // staging/legacy path unchanged
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, production, { RAILWAY_PROJECT_ID: ISOLATED_HOMOLOGATION_IDENTITY.projectId });
    expect(() => createConfiguredStockAsaasProvider()).toThrow("STOCK_ASAAS_SANDBOX_REQUIRED"); // never production adapter outside production
  });

  it("maps the configured production Asaas rejection into StockProviderError", async () => {
    Object.assign(process.env, production);
    vi.mocked(getOrderById).mockResolvedValueOnce({ stockAttemptId: "stock-attempt-fixture" } as any);
    vi.mocked(getUserById).mockResolvedValueOnce({ name: "Synthetic", email: "buyer@example.invalid", cpf: "11111111111" } as any);
    vi.mocked(getUserPhoneById).mockResolvedValueOnce(null as any);
    vi.mocked(createAsaasStockChargeForOrder).mockRejectedValueOnce(new AsaasRequestFailure("payment_create", "provider_rejection", true, 400));
    const { createConfiguredStockAsaasProvider } = await import("./configuredStockAsaasProvider");
    const configuredProvider = createConfiguredStockAsaasProvider();
    const reference = `L4CKOS-STOCK-ATTEMPT:v1:${"C".repeat(32)}`;

    await expect(configuredProvider.createPayment({
      orderId: "12345", amountCents: 1000, idempotencyKey: `stock:12345:${"C".repeat(32)}`, externalReference: reference,
    })).rejects.toMatchObject({
      name: "StockProviderError", definitelyNotCreated: true, phase: "payment_create", category: "provider_rejection", httpStatus: 400,
    });
    expect(createAsaasStockChargeForOrder).toHaveBeenCalledOnce();
  });
});
