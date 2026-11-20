import {
  hasApprovedStagingIdentityMarker,
  hasIsolatedHomologationIdentityMarker,
  isApprovedStagingIdentity,
  isIsolatedHomologationIdentity,
} from "../_core/railwayEnvironment";
import { PRODUCTION_RAILWAY_IDENTITY } from "../_core/productionFinancialPolicy";
import { isFinancialSandboxPhase, resolveFinancialPhasePolicy } from "../_core/financialPhasePolicy";

export type AsaasRuntimeMode = "sandbox" | "production" | "unconfigured" | "invalid";
export type AsaasRuntimeClassification = {
  mode: AsaasRuntimeMode;
  consistent: boolean;
  credentialsPresent: boolean;
  issue: string | null;
};

type RuntimeEnvironment = Record<string, string | undefined>;

/** Credential type is bound to the environment by its documented prefix. A key of the other environment is never sent, never aliased, never a fallback. */
export const ASAAS_PRODUCTION_KEY_PREFIX = "$aact_prod_";
export const ASAAS_SANDBOX_KEY_PREFIX = "$aact_hmlg_";
const CANONICAL_API_URL = { sandbox: "https://api-sandbox.asaas.com/v3", production: "https://api.asaas.com/v3" } as const;

/** Shared resolver used by both provider calls and the startup attestation. */
export function classifyAsaasRuntime(env: RuntimeEnvironment = process.env): AsaasRuntimeClassification {
  const sandboxPhase = isFinancialSandboxPhase(env.G4_FINANCIAL_PHASE);
  const sandboxKey = env.ASAAS_SANDBOX_API_KEY?.trim();
  const genericKey = env.ASAAS_API_KEY?.trim();
  const apiKey = sandboxKey || genericKey;
  if ((sandboxPhase && genericKey) || (sandboxKey && genericKey)) {
    return { mode: "invalid", consistent: false, credentialsPresent: Boolean(apiKey), issue: "ASAAS_PRODUCTION_CREDENTIAL_ALIAS_FORBIDDEN" };
  }
  const raw = env.ASAAS_API_URL?.trim();
  if (!raw) return { mode: "unconfigured", consistent: true, credentialsPresent: Boolean(apiKey), issue: "ASAAS_API_URL_REQUIRED" };

  let url: URL;
  try { url = new URL(raw); }
  catch { return { mode: "invalid", consistent: false, credentialsPresent: Boolean(apiKey), issue: "ASAAS_API_URL_INVALID" }; }

  // Exact string match (modulo trailing slashes): no explicit port, no look-alike, no case/escape variants that merely normalise to an allowed origin.
  const canonicalRaw = raw.replace(/\/+$/, "");
  if (canonicalRaw !== CANONICAL_API_URL.sandbox && canonicalRaw !== CANONICAL_API_URL.production) {
    return { mode: "invalid", consistent: false, credentialsPresent: Boolean(apiKey), issue: "ASAAS_API_URL_INVALID" };
  }
  const sandbox = url.origin === "https://api-sandbox.asaas.com";
  if (![
    "https://api-sandbox.asaas.com",
    "https://api.asaas.com",
  ].includes(url.origin) || url.pathname.replace(/\/+$/, "") !== "/v3" ||
      url.search || url.hash || url.username || url.password) {
    return { mode: "invalid", consistent: false, credentialsPresent: Boolean(apiKey), issue: "ASAAS_API_URL_INVALID" };
  }

  const mode: AsaasRuntimeMode = sandbox ? "sandbox" : "production";
  if (hasIsolatedHomologationIdentityMarker(env) && !isIsolatedHomologationIdentity(env)) {
    return { mode, consistent: false, credentialsPresent: Boolean(apiKey), issue: "ASAAS_RAILWAY_IDENTITY_INVALID" };
  }
  // ---- P2.2: the Railway IDENTITY decides which Asaas environment is allowed. APP_ENV/EMAIL_ENV=staging are labels, never proof of identity. ----
  // P2.3: ANY production identifier (project, environment OR service) marks a production claim; a claim is honoured only with the COMPLETE, EXACT tuple.
  const productionMarker = env.RAILWAY_PROJECT_ID === PRODUCTION_RAILWAY_IDENTITY.projectId || env.RAILWAY_ENVIRONMENT_ID === PRODUCTION_RAILWAY_IDENTITY.environmentId || env.RAILWAY_SERVICE_ID === PRODUCTION_RAILWAY_IDENTITY.serviceId;
  const productionTupleExact = env.RAILWAY_PROJECT_ID === PRODUCTION_RAILWAY_IDENTITY.projectId && env.RAILWAY_ENVIRONMENT_ID === PRODUCTION_RAILWAY_IDENTITY.environmentId && env.RAILWAY_SERVICE_ID === PRODUCTION_RAILWAY_IDENTITY.serviceId;
  const approvedMarker = hasApprovedStagingIdentityMarker(env);
  const anyRailwayMarker = Boolean(env.RAILWAY_PROJECT_ID?.trim() || env.RAILWAY_ENVIRONMENT_ID?.trim() || env.RAILWAY_SERVICE_ID?.trim());
  if (productionMarker && approvedMarker) {
    return { mode, consistent: false, credentialsPresent: Boolean(apiKey), issue: "ASAAS_RAILWAY_IDENTITY_CONTRADICTION" };
  }
  if (productionMarker && !productionTupleExact) {
    return { mode, consistent: false, credentialsPresent: Boolean(apiKey), issue: "ASAAS_PRODUCTION_IDENTITY_INCOMPLETE" };
  }
  if (approvedMarker && !isApprovedStagingIdentity(env)) {
    return { mode, consistent: false, credentialsPresent: Boolean(apiKey), issue: "ASAAS_RAILWAY_IDENTITY_INVALID" };
  }
  const declared = env.ASAAS_ENV?.trim();
  if (declared !== undefined && declared !== "" && declared !== "sandbox" && declared !== "production") {
    return { mode, consistent: false, credentialsPresent: Boolean(apiKey), issue: "ASAAS_ENV_INVALID" };
  }
  const labelledStaging = env.APP_ENV === "staging" || env.EMAIL_ENV === "staging";
  if (productionMarker) {
    // Production identity: ONLY production Asaas, declared explicitly. No sandbox endpoint, key or declaration can coexist with it.
    if (sandbox || declared === "sandbox" || sandboxKey || sandboxPhase || labelledStaging) {
      return { mode, consistent: false, credentialsPresent: Boolean(apiKey), issue: "ASAAS_PRODUCTION_IDENTITY_REQUIRES_PRODUCTION" };
    }
    if (declared !== "production") {
      return { mode, consistent: false, credentialsPresent: Boolean(apiKey), issue: "ASAAS_ENV_REQUIRED" };
    }
  } else if (sandbox) {
    // Sandbox only under an explicitly approved homologation/staging identity; the only other case is a local, non-production process with no Railway identity at all.
    const localDev = !anyRailwayMarker && env.NODE_ENV !== "production";
    if (!(isApprovedStagingIdentity(env) || localDev)) {
      return { mode, consistent: false, credentialsPresent: Boolean(apiKey), issue: "ASAAS_SANDBOX_IDENTITY_NOT_APPROVED" };
    }
    if (declared === "production") {
      return { mode, consistent: false, credentialsPresent: Boolean(apiKey), issue: "ASAAS_ENVIRONMENT_MISMATCH" };
    }
    if (!declared && !(approvedMarker || sandboxPhase)) {
      return { mode, consistent: false, credentialsPresent: Boolean(apiKey), issue: "ASAAS_ENV_REQUIRED" };
    }
  } else {
    // Production endpoint without a production identity (staging, homologation, unknown Railway project, or a bare process): refused.
    return { mode, consistent: false, credentialsPresent: Boolean(apiKey), issue: approvedMarker || labelledStaging || declared === "sandbox" ? "ASAAS_ENVIRONMENT_MISMATCH" : "ASAAS_PRODUCTION_REQUIRES_PRODUCTION_IDENTITY" };
  }
  if (declared === "sandbox" && !sandbox) return { mode, consistent: false, credentialsPresent: Boolean(apiKey), issue: "ASAAS_ENVIRONMENT_MISMATCH" };
  if (declared === "production" && sandbox) return { mode, consistent: false, credentialsPresent: Boolean(apiKey), issue: "ASAAS_ENVIRONMENT_MISMATCH" };
  // Credential type bound to the environment (checked before any request is built).
  if (sandbox) {
    if (apiKey && !apiKey.startsWith(ASAAS_SANDBOX_KEY_PREFIX)) {
      return { mode, consistent: false, credentialsPresent: true, issue: "ASAAS_CREDENTIAL_ENVIRONMENT_MISMATCH" };
    }
  } else if (sandboxKey || (genericKey && !genericKey.startsWith(ASAAS_PRODUCTION_KEY_PREFIX))) {
    return { mode, consistent: false, credentialsPresent: true, issue: "ASAAS_CREDENTIAL_ENVIRONMENT_MISMATCH" };
  }
  const checkoutBaseUrl = sandbox ? "https://sandbox.asaas.com" : "https://www.asaas.com";
  const configuredCheckout = env.ASAAS_CHECKOUT_BASE_URL?.trim().replace(/\/+$/, "");
  if (configuredCheckout && configuredCheckout !== checkoutBaseUrl) {
    return { mode, consistent: false, credentialsPresent: Boolean(apiKey), issue: "ASAAS_CHECKOUT_ENVIRONMENT_MISMATCH" };
  }
  return { mode, consistent: true, credentialsPresent: Boolean(apiKey), issue: null };
}

/** Shared fail-closed configuration. Never infer production from a missing URL. */
export function resolveAsaasConfig(env: RuntimeEnvironment = process.env) {
  const sandboxPhase = isFinancialSandboxPhase(env.G4_FINANCIAL_PHASE);
  if (sandboxPhase) {
    const phasePolicy = resolveFinancialPhasePolicy(env);
    if (!phasePolicy.allowed) throw Error("FINANCIAL_PHASE_CONFIGURATION_INVALID");
  }
  const sandboxKey = env.ASAAS_SANDBOX_API_KEY?.trim();
  const genericKey = env.ASAAS_API_KEY?.trim();
  if ((sandboxPhase && genericKey) || (sandboxKey && genericKey)) throw Error("ASAAS_PRODUCTION_CREDENTIAL_ALIAS_FORBIDDEN");
  const classification = classifyAsaasRuntime(env);
  if (classification.issue) throw Error(classification.issue);
  if (!classification.consistent || classification.mode === "unconfigured" || classification.mode === "invalid") {
    throw Error("ASAAS_API_URL_INVALID");
  }
  // Sandbox: exactly one slot (the alias check above forbids both). Production: only the generic slot. No fallback between environments.
  const apiKey = classification.mode === "sandbox" ? (sandboxKey || genericKey) : genericKey;
  if (!apiKey) throw Error("ASAAS_API_KEY_REQUIRED");
  const apiUrl = classification.mode === "sandbox" ? "https://api-sandbox.asaas.com/v3" : "https://api.asaas.com/v3";
  const checkoutBaseUrl = classification.mode === "sandbox" ? "https://sandbox.asaas.com" : "https://www.asaas.com";
  return { apiKey, apiUrl, checkoutBaseUrl };
}

export function getAsaasConfig() {
  return resolveAsaasConfig(process.env);
}
