import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertPublicOrSyntheticSandboxCheckoutEnabled, PublicCheckoutDisabledError, PublicStoreClosedError } from "./publicStore";
import { inspectFinancialBootstrap } from "./financialRuntimeBootstrap";
import { ISOLATED_HOMOLOGATION_IDENTITY } from "./railwayEnvironment";
import { resolveAsaasConfig } from "../services/asaasConfig";
import {
  assertIsolatedHomologationDatabaseIdentity,
  FINANCIAL_PHASE_APPROVALS,
  HOMOLOGATION_DATABASE_HOST,
  HOMOLOGATION_DATABASE_NAME,
  resolveFinancialPhasePolicy,
} from "./financialPhasePolicy";

const testCa = "-----BEGIN CERTIFICATE-----\nU1lOVEhFVElDLUNB\n-----END CERTIFICATE-----";
const caHash = createHash("sha256").update(`${testCa}\n`, "utf8").digest("hex");

function base(phase: "SANDBOX_WEBHOOK" | "SANDBOX_CHECKOUT" | "SANDBOX_RECOVERY") {
  const checkout = phase !== "SANDBOX_WEBHOOK";
  const recovery = phase === "SANDBOX_RECOVERY";
  return {
    NODE_ENV: "production",
    APP_ENV: "staging",
    RAILWAY_PROJECT_ID: ISOLATED_HOMOLOGATION_IDENTITY.projectId,
    RAILWAY_ENVIRONMENT_ID: ISOLATED_HOMOLOGATION_IDENTITY.environmentId,
    RAILWAY_SERVICE_ID: ISOLATED_HOMOLOGATION_IDENTITY.serviceId,
    RAILWAY_DEPLOYMENT_ID: "dpl-synthetic-phase-policy-01",
    RAILWAY_REPLICA_ID: "replica-synthetic-phase-01",
    RAILWAY_GIT_COMMIT_SHA: "a".repeat(40),
    G4_FINANCIAL_PHASE: phase,
    [FINANCIAL_PHASE_APPROVALS.webhook]: "true",
    [FINANCIAL_PHASE_APPROVALS.webhookValidated]: checkout ? "true" : "false",
    [FINANCIAL_PHASE_APPROVALS.checkout]: checkout ? "true" : "false",
    [FINANCIAL_PHASE_APPROVALS.checkoutValidated]: recovery ? "true" : "false",
    [FINANCIAL_PHASE_APPROVALS.recovery]: recovery ? "true" : "false",
    PUBLIC_SITE_MODE: "coming-soon",
    PUBLIC_CHECKOUT_ENABLED: "false",
    STOCK_RUNTIME_ENABLED: String(checkout),
    STOCK_CHECKOUT_ENABLED: String(checkout),
    ASAAS_WEBHOOK_INBOUND_ENABLED: "true",
    ASAAS_WEBHOOK_RECOVERY_WORKER_ENABLED: String(recovery),
    PAYMENT_NOTIFICATION_RECOVERY_WORKER_ENABLED: "false",
    ASAAS_ENV: "sandbox",
    STOCK_ASAAS_MODE: "sandbox",
    ASAAS_API_URL: "https://api-sandbox.asaas.com/v3",
    ASAAS_CHECKOUT_BASE_URL: "https://sandbox.asaas.com",
    ASAAS_SANDBOX_API_KEY: "$aact_hmlg_synthetic",
    ASAAS_API_KEY: undefined,
    ASAAS_WEBHOOK_TOKEN: "synthetic-webhook-token-not-a-secret",
    ASAAS_WEBHOOK_ACCOUNT_ID: "synthetic-sandbox-account",
    ASAAS_WEBHOOK_ACCOUNT_CURRENCY: "BRL",
    ASAAS_WEBHOOK_RECOVERY_MODE: phase === "SANDBOX_WEBHOOK" ? "review_only" : "off",
    EMAIL_ENV: "staging",
    EMAIL_MODE: "restricted",
    RESEND_API_KEY: undefined,
    STAGING_API_ACCESS_TOKEN: "synthetic-private-proxy-token-at-least-32-bytes",
    DATABASE_URL: `mysql://phase_test:synthetic@${HOMOLOGATION_DATABASE_HOST}/${HOMOLOGATION_DATABASE_NAME}`,
    STOCK_DATABASE_ENV: "staging",
    STOCK_EXPECTED_DATABASE: HOMOLOGATION_DATABASE_NAME,
    STAGING_DB_TLS_HOST: HOMOLOGATION_DATABASE_HOST,
    STAGING_DB_TLS_CA_PEM: testCa,
    STAGING_DB_TLS_CA_SHA256: caHash,
    ...(checkout ? {
      STAGING_SYNTHETIC_BUYER_GATE_ENABLED: "true",
      STAGING_SYNTHETIC_BUYER_IDS: "81",
    } : {}),
  };
}

describe("isolated G4 financial phase policy", () => {
  it.each(["SANDBOX_WEBHOOK", "SANDBOX_CHECKOUT", "SANDBOX_RECOVERY"] as const)(
    "allows the fully attested %s phase and passes the pre-import bootstrap",
    phase => {
      const env = base(phase);
      expect(resolveFinancialPhasePolicy(env)).toMatchObject({ phase, allowed: true });
      expect(inspectFinancialBootstrap(env, 4312)).toMatchObject({ allowed: true, report: { verdict: "PASS", issues: [] } });
    },
  );

  it("keeps CLOSED backward-compatible without G4-specific variables", () => {
    const env = {
      NODE_ENV: "production",
      APP_ENV: "staging",
      RAILWAY_PROJECT_ID: ISOLATED_HOMOLOGATION_IDENTITY.projectId,
      RAILWAY_ENVIRONMENT_ID: ISOLATED_HOMOLOGATION_IDENTITY.environmentId,
      RAILWAY_SERVICE_ID: ISOLATED_HOMOLOGATION_IDENTITY.serviceId,
      PUBLIC_SITE_MODE: "coming-soon",
      PUBLIC_CHECKOUT_ENABLED: "false",
      STOCK_RUNTIME_ENABLED: "false",
      STOCK_CHECKOUT_ENABLED: "false",
      ASAAS_WEBHOOK_INBOUND_ENABLED: "false",
      ASAAS_WEBHOOK_RECOVERY_WORKER_ENABLED: "false",
      PAYMENT_NOTIFICATION_RECOVERY_WORKER_ENABLED: "false",
    };
    expect(resolveFinancialPhasePolicy(env)).toMatchObject({ phase: "CLOSED", allowed: true });
  });

  it("boots CLOSED with the old configuration and no G4 variables", () => {
    const env = {
      NODE_ENV: "production", APP_ENV: "staging",
      RAILWAY_PROJECT_ID: ISOLATED_HOMOLOGATION_IDENTITY.projectId,
      RAILWAY_ENVIRONMENT_ID: ISOLATED_HOMOLOGATION_IDENTITY.environmentId,
      RAILWAY_SERVICE_ID: ISOLATED_HOMOLOGATION_IDENTITY.serviceId,
      RAILWAY_DEPLOYMENT_ID: "dpl-synthetic-closed-01", RAILWAY_REPLICA_ID: "replica-synthetic-closed-01",
      RAILWAY_GIT_COMMIT_SHA: "b".repeat(40),
      PUBLIC_SITE_MODE: "coming-soon", PUBLIC_CHECKOUT_ENABLED: "false",
      STOCK_RUNTIME_ENABLED: "false", STOCK_CHECKOUT_ENABLED: "false",
      ASAAS_WEBHOOK_INBOUND_ENABLED: "false", ASAAS_WEBHOOK_RECOVERY_WORKER_ENABLED: "false",
      PAYMENT_NOTIFICATION_RECOVERY_WORKER_ENABLED: "false",
      ASAAS_ENV: "sandbox", ASAAS_API_URL: "https://api-sandbox.asaas.com/v3",
      ASAAS_CHECKOUT_BASE_URL: "https://sandbox.asaas.com", ASAAS_API_KEY: "$aact_hmlg_synthetic-legacy-sandbox-key",
    };
    expect(env.G4_FINANCIAL_PHASE).toBeUndefined();
    expect(inspectFinancialBootstrap(env, 4312).allowed).toBe(true);
  });

  it("does not turn PUBLIC_CHECKOUT_ENABLED=true into phase authorization", () => {
    const env = { ...base("SANDBOX_CHECKOUT"), PUBLIC_CHECKOUT_ENABLED: "true" };
    expect(resolveFinancialPhasePolicy(env).allowed).toBe(false);
    expect(inspectFinancialBootstrap(env, 4312).allowed).toBe(false);
  });

  it("uses only the dedicated sandbox credential for active provider requests", () => {
    const env = base("SANDBOX_CHECKOUT");
    expect(resolveAsaasConfig(env)).toEqual({
      apiKey: "$aact_hmlg_synthetic",
      apiUrl: "https://api-sandbox.asaas.com/v3",
      checkoutBaseUrl: "https://sandbox.asaas.com",
    });
    expect(() => resolveAsaasConfig({ ...env, ASAAS_API_KEY: "synthetic-production-slot" }))
      .toThrow("FINANCIAL_PHASE_CONFIGURATION_INVALID");
  });

  it.each([
    ["project", { RAILWAY_PROJECT_ID: "wrong-project" }],
    ["environment", { RAILWAY_ENVIRONMENT_ID: "wrong-environment" }],
    ["API service", { RAILWAY_SERVICE_ID: "wrong-service" }],
    ["database host", { DATABASE_URL: `mysql://u:p@mysql-production.railway.internal/${HOMOLOGATION_DATABASE_NAME}` }],
    ["database schema", { DATABASE_URL: `mysql://u:p@${HOMOLOGATION_DATABASE_HOST}/l4ckos_production`, STOCK_EXPECTED_DATABASE: "l4ckos_production" }],
    ["database TLS host", { STAGING_DB_TLS_HOST: "mysql-production.railway.internal" }],
    ["database TLS digest", { STAGING_DB_TLS_CA_SHA256: "0".repeat(64) }],
    ["Asaas environment", { ASAAS_ENV: "production" }],
    ["Asaas API endpoint", { ASAAS_API_URL: "https://api.asaas.com/v3" }],
    ["Asaas checkout endpoint", { ASAAS_CHECKOUT_BASE_URL: "https://www.asaas.com" }],
    ["generic production-key slot", { ASAAS_API_KEY: "synthetic-value" }],
    ["missing sandbox credential", { ASAAS_SANDBOX_API_KEY: undefined }],
    ["production Asaas credential", { ASAAS_SANDBOX_API_KEY: "$aact_prod_synthetic" }],
    ["unknown Asaas credential format", { ASAAS_SANDBOX_API_KEY: "synthetic-sandbox-key" }],
    ["short webhook MAC secret", { ASAAS_WEBHOOK_TOKEN: "weak" }],
    ["missing account binding", { ASAAS_WEBHOOK_ACCOUNT_ID: undefined }],
    ["wrong account currency", { ASAAS_WEBHOOK_ACCOUNT_CURRENCY: "USD" }],
    ["public mode", { PUBLIC_SITE_MODE: "store" }],
    ["email provider", { RESEND_API_KEY: "synthetic-email-key" }],
  ] as const)("fails closed for incompatible %s", (_label, overrides) => {
    expect(resolveFinancialPhasePolicy({ ...base("SANDBOX_CHECKOUT"), ...overrides }).allowed).toBe(false);
  });

  it.each([
    ["checkout without webhook validation", { [FINANCIAL_PHASE_APPROVALS.webhookValidated]: "false" }],
    ["recovery without checkout validation", { G4_FINANCIAL_PHASE: "SANDBOX_RECOVERY", [FINANCIAL_PHASE_APPROVALS.checkoutValidated]: "false" }],
    ["recovery without bounded normal processing mode", { G4_FINANCIAL_PHASE: "SANDBOX_RECOVERY", ASAAS_WEBHOOK_RECOVERY_MODE: "review_only" }],
    ["recovery with notification worker", { G4_FINANCIAL_PHASE: "SANDBOX_RECOVERY", PAYMENT_NOTIFICATION_RECOVERY_WORKER_ENABLED: "true" }],
    ["webhook phase with stock runtime", { G4_FINANCIAL_PHASE: "SANDBOX_WEBHOOK", STOCK_RUNTIME_ENABLED: "true" }],
    ["checkout without explicit approval", { [FINANCIAL_PHASE_APPROVALS.checkout]: "false" }],
    ["recovery without explicit approval", { G4_FINANCIAL_PHASE: "SANDBOX_RECOVERY", [FINANCIAL_PHASE_APPROVALS.recovery]: "false" }],
  ] as const)("rejects %s", (_label, overrides) => {
    const phase = overrides.G4_FINANCIAL_PHASE ?? "SANDBOX_CHECKOUT";
    expect(resolveFinancialPhasePolicy({ ...base(phase as any), ...overrides }).allowed).toBe(false);
  });

  it("allows checkout only for authenticated IDs on the configured synthetic allowlist", () => {
    const env = base("SANDBOX_CHECKOUT");
    expect(() => assertPublicOrSyntheticSandboxCheckoutEnabled(81, env)).not.toThrow();
    expect(() => assertPublicOrSyntheticSandboxCheckoutEnabled(82, env)).toThrow(PublicStoreClosedError);
    expect(() => assertPublicOrSyntheticSandboxCheckoutEnabled(undefined, env)).toThrow(PublicStoreClosedError);
    expect(() => assertPublicOrSyntheticSandboxCheckoutEnabled(81, {
      ...env, PUBLIC_SITE_MODE: "store", PUBLIC_CHECKOUT_ENABLED: "true",
    })).toThrow(PublicCheckoutDisabledError);
  });

  it("keeps public checkout closed and validates the actual database name and version", () => {
    const closedEnv = {
      NODE_ENV: "production", PUBLIC_SITE_MODE: "coming-soon", PUBLIC_CHECKOUT_ENABLED: "false",
      STOCK_RUNTIME_ENABLED: "false", STOCK_CHECKOUT_ENABLED: "false", ASAAS_WEBHOOK_INBOUND_ENABLED: "false",
      ASAAS_WEBHOOK_RECOVERY_WORKER_ENABLED: "false", PAYMENT_NOTIFICATION_RECOVERY_WORKER_ENABLED: "false",
    };
    expect(() => assertPublicOrSyntheticSandboxCheckoutEnabled(81, closedEnv)).toThrow(PublicStoreClosedError);
    expect(() => assertIsolatedHomologationDatabaseIdentity({ databaseName: HOMOLOGATION_DATABASE_NAME, version: "9.7.2-test" }, HOMOLOGATION_DATABASE_NAME)).not.toThrow();
    expect(() => assertIsolatedHomologationDatabaseIdentity({ databaseName: "l4ckos_production", version: "9.7.2-test" }, HOMOLOGATION_DATABASE_NAME)).toThrow("HOMOLOGATION_DATABASE_IDENTITY_MISMATCH");
    expect(() => assertIsolatedHomologationDatabaseIdentity({ databaseName: HOMOLOGATION_DATABASE_NAME, version: "8.4.11" }, HOMOLOGATION_DATABASE_NAME)).toThrow("HOMOLOGATION_DATABASE_IDENTITY_MISMATCH");
  });
});
