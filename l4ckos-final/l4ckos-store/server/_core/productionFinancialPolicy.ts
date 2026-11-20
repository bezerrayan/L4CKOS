import { isApprovedMysqlTlsHost } from "../database/mysqlTls.mjs";
import { FINANCIAL_PHASE_APPROVALS, FINANCIAL_PHASE_ENV } from "./financialPhasePolicy";
import { hasApprovedStagingIdentityMarker } from "./railwayEnvironment";

/**
 * Explicit PRODUCTION contract for the STOCK runtime. It is deliberately separate from the homologation phase policy:
 * nothing here relaxes a homologation check, and a staging/sandbox marker can never satisfy it.
 * Opening the public store stays a separate decision (PUBLIC_SITE_MODE + PUBLIC_CHECKOUT_ENABLED, both closed by default).
 */
export const PRODUCTION_RAILWAY_IDENTITY = Object.freeze({
  projectId: "5937dcf3-18ae-4df8-83f0-5bb60ec9b8db",
  environmentId: "7d065409-7cc2-44ba-9fff-5524653b0484",
  /** API service "Github L4ckos-" (P15 preflight, same project/environment). NOT the MySQL-W5FK service (24fd928a-…). */
  serviceId: "743f3f4e-af1b-44f7-95c8-bb152e3c2f4b",
});
export const PRODUCTION_DATABASE_NAME = "railway";
/** Exact MySQL versions with recorded compatibility evidence. A new version is added only together with that evidence. */
export const PRODUCTION_TESTED_MYSQL_VERSIONS: readonly string[] = Object.freeze(["9.7.2", "9.7.4"]);
export const ASAAS_PRODUCTION_API_URL = "https://api.asaas.com/v3";
export const ASAAS_PRODUCTION_CHECKOUT_BASE_URL = "https://www.asaas.com";
export const ASAAS_PRODUCTION_CHECKOUT_HOST = "www.asaas.com";
export const ASAAS_PRODUCTION_KEY_PREFIX = "$aact_prod_";

type RuntimeEnvironment = Record<string, string | undefined>;
export type ProductionStockPolicy = {
  allowed: boolean;
  issues: string[];
  stockRuntimeEnabled: boolean;
  stockCheckoutEnabled: boolean;
};

const STAGING_ONLY_VARIABLES = [
  "STAGING_API_ACCESS_TOKEN", "STAGING_SYNTHETIC_BUYER_GATE_ENABLED", "STAGING_SYNTHETIC_BUYER_IDS",
  "STAGING_DB_TLS_HOST", "STAGING_DB_TLS_CA_PEM", "STAGING_DB_TLS_CA_SHA256", "STAGING_EMAIL_ALLOWLIST",
] as const;

/** True only for the exact approved production tuple project + environment + API service. Never true for staging/homologation. */
export function isProductionStockRuntimeIdentity(env: RuntimeEnvironment): boolean {
  return env.RAILWAY_PROJECT_ID === PRODUCTION_RAILWAY_IDENTITY.projectId &&
    env.RAILWAY_ENVIRONMENT_ID === PRODUCTION_RAILWAY_IDENTITY.environmentId &&
    env.RAILWAY_SERVICE_ID === PRODUCTION_RAILWAY_IDENTITY.serviceId &&
    env.NODE_ENV === "production" && env.APP_ENV === "production" &&
    !hasApprovedStagingIdentityMarker(env);
}

function booleanFlag(env: RuntimeEnvironment, name: string, issues: string[]) {
  const value = env[name];
  if (value !== undefined && value !== "true" && value !== "false") issues.push(`${name}_INVALID`);
}

export function resolveProductionStockPolicy(env: RuntimeEnvironment): ProductionStockPolicy {
  const issues: string[] = [];
  if (!isProductionStockRuntimeIdentity(env)) issues.push("PRODUCTION_RAILWAY_IDENTITY_REQUIRED");

  // Staging / sandbox leftovers are never accepted in production.
  const phase = env[FINANCIAL_PHASE_ENV];
  if (phase !== undefined && phase !== "CLOSED") issues.push("SANDBOX_FINANCIAL_PHASE_FORBIDDEN");
  if (Object.values(FINANCIAL_PHASE_APPROVALS).some(name => env[name] !== undefined)) issues.push("SANDBOX_PHASE_APPROVALS_FORBIDDEN");
  if (STAGING_ONLY_VARIABLES.some(name => Boolean(env[name]?.trim()))) issues.push("STAGING_VARIABLES_FORBIDDEN");
  if (env.EMAIL_ENV === "staging" || env.APP_ENV === "staging") issues.push("STAGING_ENVIRONMENT_MARKER_FORBIDDEN");

  // Database identity (host/TLS are the already-approved production pins; version is checked against the live server at startup).
  let databaseUrl: URL | null = null;
  try { databaseUrl = new URL(env.DATABASE_URL ?? ""); } catch { /* fail closed below */ }
  if (env.STOCK_DATABASE_ENV !== "production" || env.STOCK_EXPECTED_DATABASE?.trim() !== PRODUCTION_DATABASE_NAME ||
      !databaseUrl || databaseUrl.protocol !== "mysql:" || !isApprovedMysqlTlsHost(databaseUrl.hostname) ||
      databaseUrl.pathname !== `/${PRODUCTION_DATABASE_NAME}` || !databaseUrl.username || !databaseUrl.password) {
    issues.push("PRODUCTION_DATABASE_IDENTITY_INVALID");
  }

  // Asaas: production endpoint and production credential only; sandbox credential must be absent.
  const apiKey = env.ASAAS_API_KEY?.trim() ?? "";
  const apiUrl = env.ASAAS_API_URL?.trim().replace(/\/+$/, "");
  const checkoutBase = env.ASAAS_CHECKOUT_BASE_URL?.trim().replace(/\/+$/, "");
  if (env.ASAAS_ENV !== "production" || env.STOCK_ASAAS_MODE !== "production" || apiUrl !== ASAAS_PRODUCTION_API_URL ||
      (checkoutBase !== undefined && checkoutBase !== "" && checkoutBase !== ASAAS_PRODUCTION_CHECKOUT_BASE_URL) ||
      !apiKey.startsWith(ASAAS_PRODUCTION_KEY_PREFIX) || env.ASAAS_SANDBOX_API_KEY?.trim()) {
    issues.push("ASAAS_PRODUCTION_CREDENTIAL_OR_ENDPOINT_INVALID");
  }

  // Webhook authentication, account and currency binding are mandatory for STOCK settlement.
  if (!env.ASAAS_WEBHOOK_TOKEN?.trim() || Buffer.byteLength(env.ASAAS_WEBHOOK_TOKEN.trim(), "utf8") < 32 ||
      !env.ASAAS_WEBHOOK_ACCOUNT_ID?.trim() || env.ASAAS_WEBHOOK_ACCOUNT_CURRENCY !== "BRL") {
    issues.push("ASAAS_WEBHOOK_ACCOUNT_BINDING_REQUIRED");
  }
  if (env.ASAAS_WEBHOOK_INBOUND_ENABLED !== "true") issues.push("ASAAS_WEBHOOK_INBOUND_REQUIRED");
  if ((env.ASAAS_WEBHOOK_RECOVERY_MODE ?? "") !== "" && env.ASAAS_WEBHOOK_RECOVERY_MODE !== "off") issues.push("WEBHOOK_RECOVERY_MODE_FORBIDDEN");

  for (const name of ["PUBLIC_CHECKOUT_ENABLED", "STOCK_RUNTIME_ENABLED", "STOCK_CHECKOUT_ENABLED"]) booleanFlag(env, name, issues);
  return {
    allowed: issues.length === 0,
    issues,
    stockRuntimeEnabled: env.STOCK_RUNTIME_ENABLED === "true",
    stockCheckoutEnabled: env.STOCK_CHECKOUT_ENABLED === "true",
  };
}

export function assertProductionStockPolicy(env: RuntimeEnvironment): void {
  const policy = resolveProductionStockPolicy(env);
  if (!policy.allowed) throw new Error(`PRODUCTION_STOCK_CONFIGURATION_INVALID:${policy.issues.join(",")}`);
}

/** Live-server check: schema name and an exact, evidence-backed MySQL version (not a prefix, not removed). */
export function assertProductionDatabaseIdentity(
  identity: { databaseName: string | null; version: string | null },
  expectedDatabase: string,
): void {
  if (expectedDatabase !== PRODUCTION_DATABASE_NAME || identity.databaseName !== PRODUCTION_DATABASE_NAME ||
      !identity.version || !PRODUCTION_TESTED_MYSQL_VERSIONS.includes(identity.version)) {
    throw new Error("PRODUCTION_DATABASE_IDENTITY_MISMATCH");
  }
}

export type StockRuntimeKind = "production" | "staging";

/** Startup contract for STOCK_RUNTIME_ENABLED=true. Production has its own explicit contract; every other runtime keeps the unchanged staging requirement. */
export function assertStockRuntimeStartupEnvironment(env: RuntimeEnvironment): StockRuntimeKind {
  if (isProductionStockRuntimeIdentity(env)) {
    assertProductionStockPolicy(env);
    return "production";
  }
  if (env.STOCK_DATABASE_ENV !== "staging" || !env.STOCK_EXPECTED_DATABASE?.trim()) {
    throw new Error("STOCK_STAGING_DATABASE_IDENTITY_REQUIRED");
  }
  return "staging";
}

/** Live database identity for the STOCK runtime. The staging branch is byte-for-byte the previous behavior (prefix 9.7.2). */
export function assertStockRuntimeDatabaseIdentity(
  kind: StockRuntimeKind,
  identity: { databaseName: string | null; version: string } | undefined,
  expectedDatabase: string | undefined,
): void {
  if (kind === "production") {
    assertProductionDatabaseIdentity(identity ?? { databaseName: null, version: null }, expectedDatabase ?? "");
    return;
  }
  if (!identity || identity.databaseName !== expectedDatabase || !identity.version.startsWith("9.7.2")) {
    throw new Error("STOCK_STAGING_DATABASE_IDENTITY_MISMATCH");
  }
}
