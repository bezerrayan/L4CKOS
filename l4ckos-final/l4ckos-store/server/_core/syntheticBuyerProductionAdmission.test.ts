import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "mysql2/promise";
import { assertPublicOrSyntheticSandboxCheckoutEnabled } from "./publicStore";
import { PRODUCTION_RAILWAY_IDENTITY } from "./productionFinancialPolicy";
import { createStockCheckoutRuntime } from "../stock/stockCheckoutRuntime";

/** Every homologation-only switch turned on, on the REAL production Railway identity, with public checkout closed. */
const hostileProduction = {
  NODE_ENV: "production", APP_ENV: "production",
  RAILWAY_PROJECT_ID: PRODUCTION_RAILWAY_IDENTITY.projectId,
  RAILWAY_ENVIRONMENT_ID: PRODUCTION_RAILWAY_IDENTITY.environmentId,
  RAILWAY_SERVICE_ID: PRODUCTION_RAILWAY_IDENTITY.serviceId,
  PUBLIC_SITE_MODE: "coming-soon", PUBLIC_CHECKOUT_ENABLED: "false",
  STAGING_SYNTHETIC_BUYER_GATE_ENABLED: "true", STAGING_SYNTHETIC_BUYER_IDS: "2",
  G4_FINANCIAL_PHASE: "SANDBOX_CHECKOUT",
  G4_SANDBOX_WEBHOOK_APPROVED: "true", G4_SANDBOX_WEBHOOK_VALIDATED: "true", G4_SANDBOX_CHECKOUT_APPROVED: "true",
  STOCK_RUNTIME_ENABLED: "true", STOCK_CHECKOUT_ENABLED: "true", STOCK_CARD_CHECKOUT_ENABLED: "true",
  ASAAS_WEBHOOK_RECOVERY_MODE: "off",
} as NodeJS.ProcessEnv;

describe("synthetic buyers are never admitted in production while public checkout is closed", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["real production identity", hostileProduction],
    ["unknown identity", { ...hostileProduction, RAILWAY_PROJECT_ID: "unknown", RAILWAY_ENVIRONMENT_ID: "unknown", RAILWAY_SERVICE_ID: "unknown" } as NodeJS.ProcessEnv],
    ["no Railway identity at all", { ...hostileProduction, RAILWAY_PROJECT_ID: undefined, RAILWAY_ENVIRONMENT_ID: undefined, RAILWAY_SERVICE_ID: undefined } as NodeJS.ProcessEnv],
  ])("rejects the allow-listed synthetic buyer: %s", (_label, env) => {
    expect(() => assertPublicOrSyntheticSandboxCheckoutEnabled(2, env)).toThrow();
  });

  it("keeps public behavior unchanged when public checkout is genuinely open", () => {
    expect(() => assertPublicOrSyntheticSandboxCheckoutEnabled(99, { ...hostileProduction, PUBLIC_SITE_MODE: "store", PUBLIC_CHECKOUT_ENABLED: "true" })).not.toThrow();
  });

  it("the STOCK runtime also refuses before any database or provider IO", async () => {
    for (const [key, value] of Object.entries(hostileProduction)) vi.stubEnv(key, value ?? "");
    const getConnection = vi.fn(() => { throw new Error("database IO must not occur"); });
    const createPayment = vi.fn();
    const runtime = createStockCheckoutRuntime({
      pool: { getConnection } as unknown as Pool,
      provider: { supportsIdempotencyKey: true, createPayment },
      checkoutEnabled: true, cardCheckoutEnabled: true,
    });
    await expect(runtime.checkout({ attemptId: "production-synthetic-0001", paymentMethod: "CARD", items: [{ productId: 1, variantId: 1, quantity: 1 }] }, 2))
      .rejects.toMatchObject({ code: "PUBLIC_CHECKOUT_DISABLED" });
    expect(getConnection).not.toHaveBeenCalled();
    expect(createPayment).not.toHaveBeenCalled();
  });
});
