import { createHash } from "node:crypto";
import { createMysqlConnectionOptionsForEnvironment } from "../database/mysqlConnection.mjs";
import {
  hasIsolatedHomologationIdentityMarker,
  isIsolatedHomologationIdentity,
} from "./railwayEnvironment";

export const FINANCIAL_PHASE_ENV = "G4_FINANCIAL_PHASE";
export const FINANCIAL_PHASE_APPROVALS = {
  webhook: "G4_SANDBOX_WEBHOOK_APPROVED",
  checkout: "G4_SANDBOX_CHECKOUT_APPROVED",
  recovery: "G4_SANDBOX_RECOVERY_APPROVED",
  webhookValidated: "G4_SANDBOX_WEBHOOK_VALIDATED",
  checkoutValidated: "G4_SANDBOX_CHECKOUT_VALIDATED",
} as const;

export const HOMOLOGATION_DATABASE_HOST = "mysql-stock-homologation.railway.internal";
export const HOMOLOGATION_DATABASE_NAME = "railway";
export const HOMOLOGATION_DATABASE_VERSION_PREFIX = "9.7.2";
export const ASAAS_SANDBOX_API_URL = "https://api-sandbox.asaas.com/v3";
export const ASAAS_SANDBOX_CHECKOUT_URL = "https://sandbox.asaas.com";

export type FinancialPhase = "CLOSED" | "SANDBOX_WEBHOOK" | "SANDBOX_CHECKOUT" | "SANDBOX_RECOVERY";
export type FinancialPhasePolicy = {
  phase: FinancialPhase;
  allowed: boolean;
  issues: string[];
  checkoutEnabled: boolean;
  webhookEnabled: boolean;
  recoveryEnabled: boolean;
};

type RuntimeEnvironment = Record<string, string | undefined>;

const CLOSED_FLAGS = [
  "PUBLIC_CHECKOUT_ENABLED",
  "STOCK_RUNTIME_ENABLED",
  "STOCK_CHECKOUT_ENABLED",
  "ASAAS_WEBHOOK_INBOUND_ENABLED",
  "ASAAS_WEBHOOK_RECOVERY_WORKER_ENABLED",
  "PAYMENT_NOTIFICATION_RECOVERY_WORKER_ENABLED",
] as const;

function phaseValue(env: RuntimeEnvironment): FinancialPhase | null {
  const raw = env[FINANCIAL_PHASE_ENV];
  if (raw === undefined) return "CLOSED";
  if (raw === "CLOSED" || raw === "SANDBOX_WEBHOOK" || raw === "SANDBOX_CHECKOUT" || raw === "SANDBOX_RECOVERY") return raw;
  return null;
}

export function isFinancialSandboxPhase(phase: string | undefined): boolean {
  return phase === "SANDBOX_WEBHOOK" || phase === "SANDBOX_CHECKOUT" || phase === "SANDBOX_RECOVERY";
}

function bool(env: RuntimeEnvironment, name: string, expected: boolean, issues: string[]) {
  if (env[name] !== String(expected)) issues.push(`${name}_MISMATCH`);
}

function validDatabaseTarget(env: RuntimeEnvironment, issues: string[]) {
  const expected = env.STOCK_EXPECTED_DATABASE?.trim();
  let databaseUrl: URL | null = null;
  try { databaseUrl = new URL(env.DATABASE_URL ?? ""); } catch { /* fail closed below */ }
  const validName = expected === HOMOLOGATION_DATABASE_NAME;
  const validUrl = Boolean(databaseUrl && databaseUrl.protocol === "mysql:" &&
    databaseUrl.hostname.toLowerCase() === HOMOLOGATION_DATABASE_HOST &&
    databaseUrl.pathname === `/${HOMOLOGATION_DATABASE_NAME}` &&
    Boolean(databaseUrl.username) && Boolean(databaseUrl.password));
  if (env.STOCK_DATABASE_ENV !== "staging" || !validName || !validUrl ||
      env.STAGING_DB_TLS_HOST?.trim().toLowerCase() !== HOMOLOGATION_DATABASE_HOST) {
    issues.push("HOMOLOGATION_DATABASE_IDENTITY_INVALID");
    return;
  }
  const pem = env.STAGING_DB_TLS_CA_PEM ?? "";
  const configuredHash = env.STAGING_DB_TLS_CA_SHA256?.trim().toLowerCase() ?? "";
  const actualHash = createHash("sha256").update(pem.replace(/\\n/g, "\n").trim() + "\n", "utf8").digest("hex");
  if (!pem.includes("BEGIN CERTIFICATE") || !/^[a-f0-9]{64}$/.test(configuredHash) || configuredHash !== actualHash) {
    issues.push("HOMOLOGATION_DATABASE_TLS_IDENTITY_INVALID");
    return;
  }
  try {
    createMysqlConnectionOptionsForEnvironment(env.DATABASE_URL!, env);
  } catch {
    issues.push("HOMOLOGATION_DATABASE_TLS_IDENTITY_INVALID");
  }
}

function validSyntheticBuyerConfiguration(env: RuntimeEnvironment, issues: string[]) {
  if (env.STAGING_SYNTHETIC_BUYER_GATE_ENABLED !== "true") {
    issues.push("SYNTHETIC_BUYER_GATE_REQUIRED");
    return;
  }
  const raw = env.STAGING_SYNTHETIC_BUYER_IDS?.trim() ?? "";
  const ids = raw.split(",").map(value => value.trim());
  if (!raw || ids.length > 32 || ids.some(id => !/^[1-9]\d{0,9}$/.test(id)) || new Set(ids).size !== ids.length) {
    issues.push("SYNTHETIC_BUYER_ALLOWLIST_INVALID");
  }
}

/**
 * Fail-closed gate for explicit, isolated financial rehearsal phases.
 * CLOSED preserves the pre-G4 contract and does not require any G4-specific env.
 */
export function resolveFinancialPhasePolicy(env: RuntimeEnvironment): FinancialPhasePolicy {
  const phase = phaseValue(env);
  const issues: string[] = [];
  if (!phase) {
    issues.push("FINANCIAL_PHASE_INVALID");
    return { phase: "CLOSED", allowed: false, issues, checkoutEnabled: false, webhookEnabled: false, recoveryEnabled: false };
  }

  if (phase === "CLOSED") {
    if (!hasIsolatedHomologationIdentityMarker(env)) {
      return { phase, allowed: true, issues, checkoutEnabled: false, webhookEnabled: false, recoveryEnabled: false };
    }
    if (env.PUBLIC_SITE_MODE?.trim().toLowerCase() !== "coming-soon") issues.push("PUBLIC_SITE_MUST_REMAIN_CLOSED");
    for (const name of CLOSED_FLAGS) bool(env, name, false, issues);
    return { phase, allowed: issues.length === 0, issues, checkoutEnabled: false, webhookEnabled: false, recoveryEnabled: false };
  }

  if (!isIsolatedHomologationIdentity(env) || env.NODE_ENV !== "production" || env.APP_ENV !== "staging") {
    issues.push("ISOLATED_HOMOLOGATION_RUNTIME_REQUIRED");
  }
  if (env.PUBLIC_SITE_MODE?.trim().toLowerCase() !== "coming-soon") issues.push("PUBLIC_SITE_MUST_REMAIN_CLOSED");
  bool(env, "PUBLIC_CHECKOUT_ENABLED", false, issues);
  const checkoutEnabled = phase === "SANDBOX_CHECKOUT" || phase === "SANDBOX_RECOVERY";
  const recoveryEnabled = phase === "SANDBOX_RECOVERY";
  bool(env, "STOCK_RUNTIME_ENABLED", checkoutEnabled, issues);
  bool(env, "STOCK_CHECKOUT_ENABLED", checkoutEnabled, issues);
  bool(env, "ASAAS_WEBHOOK_INBOUND_ENABLED", true, issues);
  bool(env, "ASAAS_WEBHOOK_RECOVERY_WORKER_ENABLED", recoveryEnabled, issues);
  bool(env, "PAYMENT_NOTIFICATION_RECOVERY_WORKER_ENABLED", false, issues);

  for (const name of Object.values(FINANCIAL_PHASE_APPROVALS)) {
    const value = env[name];
    if (value !== undefined && value !== "true" && value !== "false") issues.push(`${name}_INVALID`);
  }
  const webhookApproved = env[FINANCIAL_PHASE_APPROVALS.webhook] === "true";
  const checkoutApproved = env[FINANCIAL_PHASE_APPROVALS.checkout] === "true";
  const recoveryApproved = env[FINANCIAL_PHASE_APPROVALS.recovery] === "true";
  if (!webhookApproved) issues.push("SANDBOX_WEBHOOK_APPROVAL_REQUIRED");
  if (phase === "SANDBOX_WEBHOOK" && (checkoutApproved || recoveryApproved)) issues.push("PHASE_APPROVAL_ORDER_INVALID");
  if (checkoutEnabled && (!checkoutApproved || env[FINANCIAL_PHASE_APPROVALS.webhookValidated] !== "true")) {
    issues.push("SANDBOX_CHECKOUT_APPROVAL_OR_WEBHOOK_VALIDATION_REQUIRED");
  }
  if (phase !== "SANDBOX_RECOVERY" && recoveryApproved) issues.push("PHASE_APPROVAL_ORDER_INVALID");
  if (recoveryEnabled && (!recoveryApproved || env[FINANCIAL_PHASE_APPROVALS.checkoutValidated] !== "true")) {
    issues.push("SANDBOX_RECOVERY_APPROVAL_OR_CHECKOUT_VALIDATION_REQUIRED");
  }
  if (env[FINANCIAL_PHASE_APPROVALS.webhookValidated] === "true" && !webhookApproved) issues.push("PHASE_VALIDATION_WITHOUT_APPROVAL");
  if (env[FINANCIAL_PHASE_APPROVALS.checkoutValidated] === "true" && !checkoutApproved) issues.push("PHASE_VALIDATION_WITHOUT_APPROVAL");

  if (env.ASAAS_ENV !== "sandbox" || env.STOCK_ASAAS_MODE !== "sandbox" ||
      env.ASAAS_API_URL !== ASAAS_SANDBOX_API_URL || env.ASAAS_CHECKOUT_BASE_URL !== ASAAS_SANDBOX_CHECKOUT_URL ||
      !env.ASAAS_SANDBOX_API_KEY?.trim().startsWith("$aact_hmlg_") || env.ASAAS_API_KEY?.trim()) {
    issues.push("ASAAS_SANDBOX_CREDENTIAL_OR_ENDPOINT_INVALID");
  }
  if (!env.ASAAS_WEBHOOK_TOKEN?.trim() || Buffer.byteLength(env.ASAAS_WEBHOOK_TOKEN.trim(), "utf8") < 32 ||
      !env.ASAAS_WEBHOOK_ACCOUNT_ID?.trim() || env.ASAAS_WEBHOOK_ACCOUNT_CURRENCY !== "BRL") {
    issues.push("ASAAS_WEBHOOK_ACCOUNT_BINDING_REQUIRED");
  }
  const expectedRecoveryMode = phase === "SANDBOX_WEBHOOK" ? "review_only" : "off";
  if (env.ASAAS_WEBHOOK_RECOVERY_MODE !== expectedRecoveryMode) issues.push("WEBHOOK_RECOVERY_MODE_MISMATCH");
  if (env.EMAIL_ENV !== "staging" || env.EMAIL_MODE !== "restricted" || env.RESEND_API_KEY?.trim()) {
    issues.push("EXTERNAL_EMAIL_MUST_REMAIN_CLOSED");
  }
  if (!env.STAGING_API_ACCESS_TOKEN || Buffer.byteLength(env.STAGING_API_ACCESS_TOKEN, "utf8") < 32) {
    issues.push("STAGING_API_ACCESS_TOKEN_REQUIRED");
  }

  validDatabaseTarget(env, issues);
  if (checkoutEnabled) validSyntheticBuyerConfiguration(env, issues);

  return {
    phase,
    allowed: issues.length === 0,
    issues,
    checkoutEnabled,
    webhookEnabled: true,
    recoveryEnabled,
  };
}

export function assertIsolatedHomologationDatabaseIdentity(
  identity: { databaseName: string | null; version: string | null },
  expectedDatabase: string,
): void {
  if (expectedDatabase !== HOMOLOGATION_DATABASE_NAME ||
      identity.databaseName !== HOMOLOGATION_DATABASE_NAME ||
      !identity.version?.startsWith(HOMOLOGATION_DATABASE_VERSION_PREFIX)) {
    throw new Error("HOMOLOGATION_DATABASE_IDENTITY_MISMATCH");
  }
}
