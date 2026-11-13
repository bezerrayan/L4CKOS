import {
  hasApprovedStagingIdentityMarker,
  hasIsolatedHomologationIdentityMarker,
  isIsolatedHomologationIdentity,
} from "../_core/railwayEnvironment";

export type AsaasRuntimeMode = "sandbox" | "production" | "unconfigured" | "invalid";
export type AsaasRuntimeClassification = {
  mode: AsaasRuntimeMode;
  consistent: boolean;
  credentialsPresent: boolean;
  issue: string | null;
};

type RuntimeEnvironment = Record<string, string | undefined>;

/** Shared resolver used by both provider calls and the startup attestation. */
export function classifyAsaasRuntime(env: RuntimeEnvironment = process.env): AsaasRuntimeClassification {
  const apiKey = env.ASAAS_API_KEY?.trim();
  const raw = env.ASAAS_API_URL?.trim();
  if (!raw) return { mode: "unconfigured", consistent: true, credentialsPresent: Boolean(apiKey), issue: "ASAAS_API_URL_REQUIRED" };

  let url: URL;
  try { url = new URL(raw); }
  catch { return { mode: "invalid", consistent: false, credentialsPresent: Boolean(apiKey), issue: "ASAAS_API_URL_INVALID" }; }

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
  const staging = env.APP_ENV === "staging" || env.EMAIL_ENV === "staging" || hasApprovedStagingIdentityMarker(env);
  if ((staging || env.ASAAS_ENV === "sandbox") && !sandbox) {
    return { mode, consistent: false, credentialsPresent: Boolean(apiKey), issue: "ASAAS_ENVIRONMENT_MISMATCH" };
  }
  if (env.ASAAS_ENV === "production" && sandbox) {
    return { mode, consistent: false, credentialsPresent: Boolean(apiKey), issue: "ASAAS_ENVIRONMENT_MISMATCH" };
  }
  const checkoutBaseUrl = sandbox ? "https://sandbox.asaas.com" : "https://www.asaas.com";
  const configuredCheckout = env.ASAAS_CHECKOUT_BASE_URL?.trim().replace(/\/+$/, "");
  if (configuredCheckout && configuredCheckout !== checkoutBaseUrl) {
    return { mode, consistent: false, credentialsPresent: Boolean(apiKey), issue: "ASAAS_CHECKOUT_ENVIRONMENT_MISMATCH" };
  }
  return { mode, consistent: true, credentialsPresent: Boolean(apiKey), issue: null };
}

/** Shared fail-closed configuration. Never infer production from a missing URL. */
export function getAsaasConfig() {
  const apiKey = process.env.ASAAS_API_KEY?.trim();
  if (!apiKey) throw Error("ASAAS_API_KEY_REQUIRED");
  const classification = classifyAsaasRuntime(process.env);
  if (classification.issue) throw Error(classification.issue);
  if (!classification.consistent || classification.mode === "unconfigured" || classification.mode === "invalid") {
    throw Error("ASAAS_API_URL_INVALID");
  }
  const apiUrl = classification.mode === "sandbox" ? "https://api-sandbox.asaas.com/v3" : "https://api.asaas.com/v3";
  const checkoutBaseUrl = classification.mode === "sandbox" ? "https://sandbox.asaas.com" : "https://www.asaas.com";
  return { apiKey, apiUrl, checkoutBaseUrl };
}
