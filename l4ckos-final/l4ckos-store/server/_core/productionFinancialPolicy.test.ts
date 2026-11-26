import { describe, expect, it } from "vitest";
import { MYSQL_TLS_HOST } from "../database/mysqlTls.mjs";
import { FINANCIAL_PHASE_APPROVALS, HOMOLOGATION_DATABASE_HOST, resolveFinancialPhasePolicy } from "./financialPhasePolicy";
import { ISOLATED_HOMOLOGATION_IDENTITY, LEGACY_STAGING_IDENTITY } from "./railwayEnvironment";
import { assertPublicCheckoutEnabled, assertPublicOrSyntheticSandboxCheckoutEnabled, isPublicCheckoutEnabled } from "./publicStore";
import {
  assertProductionDatabaseIdentity, assertStockRuntimeDatabaseIdentity, assertStockRuntimeStartupEnvironment,
  isProductionStockRuntimeIdentity, PRODUCTION_RAILWAY_IDENTITY, resolveProductionStockPolicy,
} from "./productionFinancialPolicy";

type Env = Record<string, string | undefined>;
/** Synthetic, non-secret values only. */
function production(overrides: Env = {}): Env {
  return {
    NODE_ENV: "production", APP_ENV: "production",
    RAILWAY_PROJECT_ID: PRODUCTION_RAILWAY_IDENTITY.projectId, RAILWAY_ENVIRONMENT_ID: PRODUCTION_RAILWAY_IDENTITY.environmentId,
    RAILWAY_SERVICE_ID: PRODUCTION_RAILWAY_IDENTITY.serviceId,
    PUBLIC_SITE_MODE: "coming-soon", PUBLIC_CHECKOUT_ENABLED: "false",
    STOCK_RUNTIME_ENABLED: "true", STOCK_CHECKOUT_ENABLED: "false",
    STOCK_DATABASE_ENV: "production", STOCK_EXPECTED_DATABASE: "railway",
    DATABASE_URL: `mysql://app_synthetic:synthetic-pw@${MYSQL_TLS_HOST}/railway`,
    ASAAS_ENV: "production", STOCK_ASAAS_MODE: "production", ASAAS_API_URL: "https://api.asaas.com/v3",
    ASAAS_CHECKOUT_BASE_URL: "https://www.asaas.com", ASAAS_API_KEY: "$aact_prod_synthetic_not_a_real_key",
    ASAAS_WEBHOOK_TOKEN: "synthetic-production-webhook-token-0123456789",
    ASAAS_WEBHOOK_ACCOUNT_ID: "synthetic-production-account", ASAAS_WEBHOOK_ACCOUNT_CURRENCY: "BRL",
    ASAAS_WEBHOOK_INBOUND_ENABLED: "true", ASAAS_WEBHOOK_RECOVERY_MODE: "off",
    ...overrides,
  };
}
const issues = (env: Env) => resolveProductionStockPolicy(env).issues;

describe("production STOCK financial contract", () => {
  it("accepts one complete, explicit production configuration", () => {
    expect(resolveProductionStockPolicy(production())).toEqual({ allowed: true, issues: [], stockRuntimeEnabled: true, stockCheckoutEnabled: false });
    expect(assertStockRuntimeStartupEnvironment(production())).toBe("production");
  });

  it("is pure policy: validity does not open the store or the public checkout", () => {
    const env = production();
    expect(isPublicCheckoutEnabled(env)).toBe(false);
    expect(() => assertPublicCheckoutEnabled(env)).toThrow();
    expect(() => assertPublicOrSyntheticSandboxCheckoutEnabled(1, env)).toThrow();   // production never uses the synthetic-buyer path
    expect(resolveProductionStockPolicy(production({ PUBLIC_CHECKOUT_ENABLED: undefined, PUBLIC_SITE_MODE: undefined })).allowed).toBe(true);
    // opening remains the existing, separate decision
    expect(isPublicCheckoutEnabled(production({ PUBLIC_SITE_MODE: "store", PUBLIC_CHECKOUT_ENABLED: "true" }))).toBe(true);
    expect(() => assertPublicOrSyntheticSandboxCheckoutEnabled(undefined, production({ PUBLIC_SITE_MODE: "store", PUBLIC_CHECKOUT_ENABLED: "true" }))).not.toThrow();
  });

  describe("identity", () => {
    const cases: Array<[string, Env, string]> = [
      ["wrong Railway project", { RAILWAY_PROJECT_ID: "00000000-0000-0000-0000-000000000000" }, "PRODUCTION_RAILWAY_IDENTITY_REQUIRED"],
      ["wrong Railway environment", { RAILWAY_ENVIRONMENT_ID: "00000000-0000-0000-0000-000000000000" }, "PRODUCTION_RAILWAY_IDENTITY_REQUIRED"],
      ["missing service id", { RAILWAY_SERVICE_ID: undefined }, "PRODUCTION_RAILWAY_IDENTITY_REQUIRED"],
      ["NODE_ENV not production", { NODE_ENV: "development" }, "PRODUCTION_RAILWAY_IDENTITY_REQUIRED"],
      ["APP_ENV not production", { APP_ENV: undefined }, "PRODUCTION_RAILWAY_IDENTITY_REQUIRED"],
      ["APP_ENV staging", { APP_ENV: "staging" }, "PRODUCTION_RAILWAY_IDENTITY_REQUIRED"],
    ];
    it.each(cases)("rejects %s", (_n, over, code) => {
      expect(issues(production(over))).toContain(code);
      expect(() => assertStockRuntimeStartupEnvironment(production(over))).toThrow();
    });
    it("pins the exact API service: any other service of the same project+environment is refused", () => {
      expect(PRODUCTION_RAILWAY_IDENTITY.serviceId).toBe("743f3f4e-af1b-44f7-95c8-bb152e3c2f4b");
      expect(isProductionStockRuntimeIdentity(production())).toBe(true);
      const others = [
        "24fd928a-dfc3-4757-8a89-1e7e92b98a7d", // MySQL-W5FK in the same project/environment
        "00000000-0000-4000-8000-000000000000", // unknown service
        "service-synthetic-production-api", "", " ", `${PRODUCTION_RAILWAY_IDENTITY.serviceId} `, PRODUCTION_RAILWAY_IDENTITY.serviceId.toUpperCase(),
        ISOLATED_HOMOLOGATION_IDENTITY.serviceId, LEGACY_STAGING_IDENTITY.serviceId,
      ];
      for (const id of others) {
        const env = production({ RAILWAY_SERVICE_ID: id });
        expect(isProductionStockRuntimeIdentity(env), id).toBe(false);
        expect(issues(env), id).toContain("PRODUCTION_RAILWAY_IDENTITY_REQUIRED");
        expect(() => assertStockRuntimeStartupEnvironment(env), id).toThrow();
      }
      // correct service in a different project or environment is refused as well
      expect(isProductionStockRuntimeIdentity(production({ RAILWAY_PROJECT_ID: LEGACY_STAGING_IDENTITY.projectId }))).toBe(false);
      expect(isProductionStockRuntimeIdentity(production({ RAILWAY_ENVIRONMENT_ID: LEGACY_STAGING_IDENTITY.environmentId }))).toBe(false);
    });
    it("never recognizes the homologation or legacy staging Railway identities as production", () => {
      for (const id of [ISOLATED_HOMOLOGATION_IDENTITY, LEGACY_STAGING_IDENTITY]) {
        const env = production({ RAILWAY_PROJECT_ID: id.projectId, RAILWAY_ENVIRONMENT_ID: id.environmentId, RAILWAY_SERVICE_ID: id.serviceId });
        expect(isProductionStockRuntimeIdentity(env)).toBe(false);
        expect(resolveProductionStockPolicy(env).allowed).toBe(false);
      }
      // a mixed identity (production project, staging service marker) is also refused
      expect(isProductionStockRuntimeIdentity(production({ RAILWAY_SERVICE_ID: ISOLATED_HOMOLOGATION_IDENTITY.serviceId }))).toBe(false);
    });
  });

  describe("sandbox / staging isolation", () => {
    const cases: Array<[string, Env, string]> = [
      ["sandbox financial phase", { G4_FINANCIAL_PHASE: "SANDBOX_CHECKOUT" }, "SANDBOX_FINANCIAL_PHASE_FORBIDDEN"],
      ["sandbox webhook phase", { G4_FINANCIAL_PHASE: "SANDBOX_WEBHOOK" }, "SANDBOX_FINANCIAL_PHASE_FORBIDDEN"],
      ["unknown phase value", { G4_FINANCIAL_PHASE: "PRODUCTION" }, "SANDBOX_FINANCIAL_PHASE_FORBIDDEN"],
      ["sandbox approval flag", { [FINANCIAL_PHASE_APPROVALS.checkout]: "true" }, "SANDBOX_PHASE_APPROVALS_FORBIDDEN"],
      ["sandbox validation flag", { [FINANCIAL_PHASE_APPROVALS.webhookValidated]: "false" }, "SANDBOX_PHASE_APPROVALS_FORBIDDEN"],
      ["staging API access token", { STAGING_API_ACCESS_TOKEN: "synthetic-staging-token-0123456789abcdef" }, "STAGING_VARIABLES_FORBIDDEN"],
      ["synthetic buyer gate", { STAGING_SYNTHETIC_BUYER_GATE_ENABLED: "true" }, "STAGING_VARIABLES_FORBIDDEN"],
      ["synthetic buyer ids", { STAGING_SYNTHETIC_BUYER_IDS: "1" }, "STAGING_VARIABLES_FORBIDDEN"],
      ["staging DB TLS host", { STAGING_DB_TLS_HOST: HOMOLOGATION_DATABASE_HOST }, "STAGING_VARIABLES_FORBIDDEN"],
      ["staging DB TLS CA", { STAGING_DB_TLS_CA_PEM: "x" }, "STAGING_VARIABLES_FORBIDDEN"],
      ["staging e-mail allowlist", { STAGING_EMAIL_ALLOWLIST: "a@example.invalid" }, "STAGING_VARIABLES_FORBIDDEN"],
      ["EMAIL_ENV=staging", { EMAIL_ENV: "staging" }, "STAGING_ENVIRONMENT_MARKER_FORBIDDEN"],
      ["Asaas sandbox credential present", { ASAAS_SANDBOX_API_KEY: "$aact_hmlg_synthetic" }, "ASAAS_PRODUCTION_CREDENTIAL_OR_ENDPOINT_INVALID"],
      ["sandbox key in the production variable", { ASAAS_API_KEY: "$aact_hmlg_synthetic" }, "ASAAS_PRODUCTION_CREDENTIAL_OR_ENDPOINT_INVALID"],
      ["key without production prefix", { ASAAS_API_KEY: "synthetic-key" }, "ASAAS_PRODUCTION_CREDENTIAL_OR_ENDPOINT_INVALID"],
      ["missing key", { ASAAS_API_KEY: undefined }, "ASAAS_PRODUCTION_CREDENTIAL_OR_ENDPOINT_INVALID"],
      ["sandbox API URL", { ASAAS_API_URL: "https://api-sandbox.asaas.com/v3" }, "ASAAS_PRODUCTION_CREDENTIAL_OR_ENDPOINT_INVALID"],
      ["sandbox checkout base", { ASAAS_CHECKOUT_BASE_URL: "https://sandbox.asaas.com" }, "ASAAS_PRODUCTION_CREDENTIAL_OR_ENDPOINT_INVALID"],
      ["ASAAS_ENV sandbox", { ASAAS_ENV: "sandbox" }, "ASAAS_PRODUCTION_CREDENTIAL_OR_ENDPOINT_INVALID"],
      ["STOCK_ASAAS_MODE sandbox", { STOCK_ASAAS_MODE: "sandbox" }, "ASAAS_PRODUCTION_CREDENTIAL_OR_ENDPOINT_INVALID"],
      ["look-alike API host", { ASAAS_API_URL: "https://api.asaas.com.evil.example/v3" }, "ASAAS_PRODUCTION_CREDENTIAL_OR_ENDPOINT_INVALID"],
    ];
    it.each(cases)("rejects %s", (_n, over, code) => {
      const env = production(over);
      expect(issues(env)).toContain(code);
      expect(() => assertStockRuntimeStartupEnvironment(env)).toThrow(/^PRODUCTION_STOCK_CONFIGURATION_INVALID:/);
    });
    it("the homologation phase policy still refuses production identity and still accepts nothing new", () => {
      expect(resolveFinancialPhasePolicy(production({ G4_FINANCIAL_PHASE: "SANDBOX_CHECKOUT" })).allowed).toBe(false);
      expect(resolveFinancialPhasePolicy(production({ G4_FINANCIAL_PHASE: "SANDBOX_CHECKOUT" })).issues).toContain("ISOLATED_HOMOLOGATION_RUNTIME_REQUIRED");
      expect(resolveFinancialPhasePolicy(production()).allowed).toBe(true);     // CLOSED outside homologation: unchanged behavior
    });
  });

  describe("database", () => {
    const cases: Array<[string, Env]> = [
      ["STOCK_DATABASE_ENV=staging", { STOCK_DATABASE_ENV: "staging" }],
      ["STOCK_DATABASE_ENV missing", { STOCK_DATABASE_ENV: undefined }],
      ["wrong expected database", { STOCK_EXPECTED_DATABASE: "other" }],
      ["homologation DB host", { DATABASE_URL: `mysql://u:p@${HOMOLOGATION_DATABASE_HOST}/railway` }],
      ["public proxy host", { DATABASE_URL: "mysql://u:p@nozomi.proxy.rlwy.net:24169/railway" }],
      ["wrong schema in URL", { DATABASE_URL: `mysql://u:p@${MYSQL_TLS_HOST}/other` }],
      ["URL without credentials", { DATABASE_URL: `mysql://${MYSQL_TLS_HOST}/railway` }],
      ["non-mysql protocol", { DATABASE_URL: `postgres://u:p@${MYSQL_TLS_HOST}/railway` }],
      ["malformed URL", { DATABASE_URL: "not a url" }],
    ];
    it.each(cases)("rejects %s", (_n, over) => expect(issues(production(over))).toContain("PRODUCTION_DATABASE_IDENTITY_INVALID"));
    it("requires an exact, evidence-backed MySQL version (no prefix match, version check not removed)", () => {
      const ok = { databaseName: "railway", version: "9.7.2" };
      expect(() => assertProductionDatabaseIdentity(ok, "railway")).not.toThrow();
      // 9.7.4 = the live production server version; accepted only with recorded 9.7.4 evidence (P2-MYSQL-974-EVIDENCE.md)
      expect(() => assertProductionDatabaseIdentity({ databaseName: "railway", version: "9.7.4" }, "railway")).not.toThrow();
      for (const version of ["9.7.3", "9.7.5", "9.7.40", "9.7.4-extra", "9.7.4 ", "9.7.20", "9.7.2-extra", "9.7", "9.6.0", "8.4.11", "", null]) {
        expect(() => assertProductionDatabaseIdentity({ databaseName: "railway", version }, "railway"), String(version)).toThrow("PRODUCTION_DATABASE_IDENTITY_MISMATCH");
      }
      expect(() => assertProductionDatabaseIdentity({ databaseName: "other", version: "9.7.2" }, "railway")).toThrow();
      expect(() => assertProductionDatabaseIdentity(ok, "other")).toThrow();
      expect(() => assertStockRuntimeDatabaseIdentity("production", undefined, "railway")).toThrow("PRODUCTION_DATABASE_IDENTITY_MISMATCH");
    });
  });

  describe("webhook, account and currency binding", () => {
    const cases: Array<[string, Env, string]> = [
      ["missing webhook token", { ASAAS_WEBHOOK_TOKEN: undefined }, "ASAAS_WEBHOOK_ACCOUNT_BINDING_REQUIRED"],
      ["short webhook token", { ASAAS_WEBHOOK_TOKEN: "short" }, "ASAAS_WEBHOOK_ACCOUNT_BINDING_REQUIRED"],
      ["missing account id", { ASAAS_WEBHOOK_ACCOUNT_ID: " " }, "ASAAS_WEBHOOK_ACCOUNT_BINDING_REQUIRED"],
      ["currency not BRL", { ASAAS_WEBHOOK_ACCOUNT_CURRENCY: "USD" }, "ASAAS_WEBHOOK_ACCOUNT_BINDING_REQUIRED"],
      ["currency missing", { ASAAS_WEBHOOK_ACCOUNT_CURRENCY: undefined }, "ASAAS_WEBHOOK_ACCOUNT_BINDING_REQUIRED"],
      ["inbound disabled", { ASAAS_WEBHOOK_INBOUND_ENABLED: "false" }, "ASAAS_WEBHOOK_INBOUND_REQUIRED"],
      ["inbound unset", { ASAAS_WEBHOOK_INBOUND_ENABLED: undefined }, "ASAAS_WEBHOOK_INBOUND_REQUIRED"],
      ["review_only recovery", { ASAAS_WEBHOOK_RECOVERY_MODE: "review_only" }, "WEBHOOK_RECOVERY_MODE_FORBIDDEN"],
      ["invalid recovery mode", { ASAAS_WEBHOOK_RECOVERY_MODE: "on" }, "WEBHOOK_RECOVERY_MODE_FORBIDDEN"],
      ["invalid boolean flag", { STOCK_CHECKOUT_ENABLED: "yes" }, "STOCK_CHECKOUT_ENABLED_INVALID"],
      ["invalid public flag", { PUBLIC_CHECKOUT_ENABLED: "1" }, "PUBLIC_CHECKOUT_ENABLED_INVALID"],
      ["invalid card switch", { STOCK_CARD_CHECKOUT_ENABLED: "yes" }, "STOCK_CARD_CHECKOUT_ENABLED_INVALID"],
    ];
    it.each(cases)("rejects %s", (_n, over, code) => expect(issues(production(over))).toContain(code));
    it.each([undefined, "false", "true"])("accepts the card switch as %s (dormant by default when unset)", value =>
      expect(resolveProductionStockPolicy(production({ STOCK_CARD_CHECKOUT_ENABLED: value })).allowed).toBe(true));
    it("accepts an unset recovery mode (default off)", () => expect(resolveProductionStockPolicy(production({ ASAAS_WEBHOOK_RECOVERY_MODE: undefined })).allowed).toBe(true));
    it("never leaks a secret value in the error", () => {
      let message = "";
      try { assertStockRuntimeStartupEnvironment(production({ ASAAS_API_KEY: "$aact_hmlg_SECRET_VALUE_XYZ", ASAAS_WEBHOOK_TOKEN: "TOKEN_VALUE_XYZ" })); } catch (e) { message = String((e as Error).message); }
      expect(message).toContain("PRODUCTION_STOCK_CONFIGURATION_INVALID");
      expect(message).not.toMatch(/SECRET_VALUE_XYZ|TOKEN_VALUE_XYZ|synthetic-pw/);
    });
  });
});

describe("homologation/staging behavior is preserved", () => {
  const homologation: Env = {
    NODE_ENV: "production", APP_ENV: "staging", STOCK_DATABASE_ENV: "staging", STOCK_EXPECTED_DATABASE: "railway",
    RAILWAY_PROJECT_ID: ISOLATED_HOMOLOGATION_IDENTITY.projectId, RAILWAY_ENVIRONMENT_ID: ISOLATED_HOMOLOGATION_IDENTITY.environmentId, RAILWAY_SERVICE_ID: ISOLATED_HOMOLOGATION_IDENTITY.serviceId,
  };
  it("keeps the unchanged staging requirement and the 9.7.2 prefix", () => {
    expect(assertStockRuntimeStartupEnvironment(homologation)).toBe("staging");
    expect(() => assertStockRuntimeStartupEnvironment({ ...homologation, STOCK_DATABASE_ENV: "production" })).toThrow("STOCK_STAGING_DATABASE_IDENTITY_REQUIRED");
    expect(() => assertStockRuntimeStartupEnvironment({ ...homologation, STOCK_DATABASE_ENV: undefined })).toThrow("STOCK_STAGING_DATABASE_IDENTITY_REQUIRED");
    expect(() => assertStockRuntimeStartupEnvironment({ ...homologation, STOCK_EXPECTED_DATABASE: " " })).toThrow("STOCK_STAGING_DATABASE_IDENTITY_REQUIRED");
    expect(() => assertStockRuntimeDatabaseIdentity("staging", { databaseName: "railway", version: "9.7.2" }, "railway")).not.toThrow();
    expect(() => assertStockRuntimeDatabaseIdentity("staging", { databaseName: "railway", version: "9.7.4" }, "railway")).toThrow("STOCK_STAGING_DATABASE_IDENTITY_MISMATCH");
    expect(() => assertStockRuntimeDatabaseIdentity("staging", { databaseName: "other", version: "9.7.2" }, "railway")).toThrow("STOCK_STAGING_DATABASE_IDENTITY_MISMATCH");
    expect(() => assertStockRuntimeDatabaseIdentity("staging", undefined, "railway")).toThrow("STOCK_STAGING_DATABASE_IDENTITY_MISMATCH");
  });
  it("production flags/credentials never make a homologation or staging runtime take the production path", () => {
    for (const id of [ISOLATED_HOMOLOGATION_IDENTITY, LEGACY_STAGING_IDENTITY]) {
      const env = production({ RAILWAY_PROJECT_ID: id.projectId, RAILWAY_ENVIRONMENT_ID: id.environmentId, RAILWAY_SERVICE_ID: id.serviceId });
      expect(() => assertStockRuntimeStartupEnvironment(env)).toThrow("STOCK_STAGING_DATABASE_IDENTITY_REQUIRED");   // STOCK_DATABASE_ENV=production is not accepted outside production
    }
  });
  it("a non-Railway/local environment cannot opt into production by setting flags", () => {
    expect(() => assertStockRuntimeStartupEnvironment({ ...production(), RAILWAY_PROJECT_ID: undefined, RAILWAY_ENVIRONMENT_ID: undefined })).toThrow("STOCK_STAGING_DATABASE_IDENTITY_REQUIRED");
  });
});
