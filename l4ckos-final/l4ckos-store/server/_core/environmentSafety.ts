import { getOperationalConfig } from "./operationalConfig";
import { getAppEnvironment } from "./runtime";

function read(name: string) {
  return String(process.env[name] ?? "").trim();
}

function parseUrl(name: string, issues: string[], required = true) {
  const value = read(name);
  if (!value) {
    if (required) issues.push(`${name} ausente.`);
    return null;
  }
  try {
    return new URL(value);
  } catch {
    issues.push(`${name} invalida.`);
    return null;
  }
}

function requireBoolean(name: string, issues: string[]) {
  if (!/^(true|false)$/i.test(read(name))) issues.push(`${name} precisa ser true ou false.`);
}

function requireEnvironmentMarker(name: string, expected: "staging" | "production", issues: string[]) {
  if (read(name).toLowerCase() !== expected) issues.push(`${name} precisa ser ${expected}.`);
}

function validateDatabase(expectedEnvironment: "staging" | "production", issues: string[]) {
  const database = parseUrl("DATABASE_URL", issues);
  const expectedHost = read("EXPECTED_DATABASE_HOST").toLowerCase();
  const expectedName = read("EXPECTED_DATABASE_NAME").replace(/^\//, "");
  if (!expectedHost) issues.push("EXPECTED_DATABASE_HOST ausente.");
  if (!expectedName) issues.push("EXPECTED_DATABASE_NAME ausente.");
  if (database && expectedHost && database.hostname.toLowerCase() !== expectedHost) issues.push("DATABASE_URL nao corresponde a EXPECTED_DATABASE_HOST.");
  if (database && expectedName && database.pathname.replace(/^\//, "") !== expectedName) issues.push("DATABASE_URL nao corresponde a EXPECTED_DATABASE_NAME.");

  const forbiddenPrefix = expectedEnvironment === "staging" ? "PRODUCTION" : "STAGING";
  const forbiddenHost = read(`${forbiddenPrefix}_DATABASE_HOST`).toLowerCase();
  const forbiddenName = read(`${forbiddenPrefix}_DATABASE_NAME`).replace(/^\//, "");
  if (!forbiddenHost) issues.push(`${forbiddenPrefix}_DATABASE_HOST ausente.`);
  if (database && forbiddenHost && database.hostname.toLowerCase() === forbiddenHost) issues.push(`DATABASE_URL aponta para o host de ${expectedEnvironment === "staging" ? "producao" : "staging"}.`);
  if (database && forbiddenName && database.pathname.replace(/^\//, "") === forbiddenName) issues.push(`DATABASE_URL aponta para o banco de ${expectedEnvironment === "staging" ? "producao" : "staging"}.`);
}

function validateOrigins(expectedEnvironment: "staging" | "production", issues: string[]) {
  const frontend = parseUrl("FRONTEND_URL", issues);
  const appUrl = parseUrl("APP_URL", issues);
  const apiUrl = parseUrl("API_PUBLIC_URL", issues);
  const expectedFrontend = parseUrl("EXPECTED_FRONTEND_ORIGIN", issues);
  const expectedApi = parseUrl("EXPECTED_API_ORIGIN", issues);
  const forbiddenPrefix = expectedEnvironment === "staging" ? "PRODUCTION" : "STAGING";
  const forbiddenFrontend = parseUrl(`${forbiddenPrefix}_FRONTEND_ORIGIN`, issues);
  const forbiddenApi = parseUrl(`${forbiddenPrefix}_API_ORIGIN`, issues);

  if (frontend && expectedFrontend && frontend.origin !== expectedFrontend.origin) issues.push("FRONTEND_URL nao corresponde a EXPECTED_FRONTEND_ORIGIN.");
  if (appUrl && expectedFrontend && appUrl.origin !== expectedFrontend.origin) issues.push("APP_URL nao corresponde a EXPECTED_FRONTEND_ORIGIN.");
  if (apiUrl && expectedApi && apiUrl.origin !== expectedApi.origin) issues.push("API_PUBLIC_URL nao corresponde a EXPECTED_API_ORIGIN.");
  if (frontend && forbiddenFrontend && frontend.origin === forbiddenFrontend.origin) issues.push("FRONTEND_URL aponta para o ambiente proibido.");
  if (apiUrl && forbiddenApi && apiUrl.origin === forbiddenApi.origin) issues.push("API_PUBLIC_URL aponta para o ambiente proibido.");

  const corsValues = read("CORS_ORIGINS").split(",").map(item => item.trim()).filter(Boolean);
  if (!corsValues.length) issues.push("CORS_ORIGINS ausente.");
  for (const value of corsValues) {
    if (value === "*") {
      issues.push("CORS_ORIGINS nao pode conter wildcard.");
      continue;
    }
    try {
      const origin = new URL(value).origin;
      if (forbiddenFrontend && origin === forbiddenFrontend.origin) issues.push("CORS_ORIGINS contem origem do ambiente proibido.");
    } catch {
      issues.push("CORS_ORIGINS contem URL invalida.");
    }
  }
  if (expectedFrontend && !corsValues.some(value => {
    try { return new URL(value).origin === expectedFrontend.origin; } catch { return false; }
  })) issues.push("CORS_ORIGINS nao contem EXPECTED_FRONTEND_ORIGIN.");

  const redirect = parseUrl("GOOGLE_REDIRECT_URI", issues);
  if (redirect && expectedApi && (redirect.origin !== expectedApi.origin || redirect.pathname !== "/api/oauth/callback")) {
    issues.push("GOOGLE_REDIRECT_URI precisa usar EXPECTED_API_ORIGIN e /api/oauth/callback.");
  }

  const googleClientId = read("GOOGLE_CLIENT_ID");
  const googleClientSecret = read("GOOGLE_CLIENT_SECRET");
  if (googleClientId || googleClientSecret) {
    if (!googleClientId || !googleClientSecret) issues.push("Google OAuth exige GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET juntos.");
    requireEnvironmentMarker("GOOGLE_OAUTH_ENV", expectedEnvironment, issues);
  }
}

function validateProviderIsolation(expectedEnvironment: "staging" | "production", issues: string[]) {
  const asaas = parseUrl("ASAAS_API_URL", issues);
  const checkout = parseUrl("ASAAS_CHECKOUT_BASE_URL", issues);
  const expectedAsaasHost = expectedEnvironment === "staging" ? "api-sandbox.asaas.com" : "api.asaas.com";
  const expectedCheckoutHost = expectedEnvironment === "staging" ? "sandbox.asaas.com" : "www.asaas.com";
  if (asaas?.hostname.toLowerCase() !== expectedAsaasHost) issues.push(`ASAAS_API_URL precisa apontar para ${expectedAsaasHost}.`);
  if (checkout?.hostname.toLowerCase() !== expectedCheckoutHost) issues.push(`ASAAS_CHECKOUT_BASE_URL precisa apontar para ${expectedCheckoutHost}.`);

  const apiKey = read("ASAAS_API_KEY");
  if (!apiKey) issues.push("ASAAS_API_KEY ausente.");
  if (expectedEnvironment === "staging" && !apiKey.startsWith("$aact_hmlg_")) issues.push("ASAAS_API_KEY nao possui o prefixo de homologacao esperado.");
  if (expectedEnvironment === "production" && apiKey.startsWith("$aact_hmlg_")) issues.push("ASAAS_API_KEY de sandbox nao pode ser usada em producao.");
  if (read("ASAAS_WEBHOOK_TOKEN").length < 24) issues.push("ASAAS_WEBHOOK_TOKEN precisa ter ao menos 24 caracteres.");
  requireEnvironmentMarker("ASAAS_WEBHOOK_ENV", expectedEnvironment, issues);
  if (read("CRON_SECRET").length < 32) issues.push("CRON_SECRET precisa ter ao menos 32 caracteres.");
  requireEnvironmentMarker("CRON_SECRET_ENV", expectedEnvironment, issues);

  if (read("MELHOR_ENVIO_TOKEN")) {
    const melhorEnvioUrl = parseUrl("MELHOR_ENVIO_API_URL", issues);
    if (expectedEnvironment === "staging" && melhorEnvioUrl?.hostname.toLowerCase() !== "sandbox.melhorenvio.com.br") issues.push("MELHOR_ENVIO_API_URL precisa apontar para sandbox em staging.");
    requireEnvironmentMarker("MELHOR_ENVIO_ENV", expectedEnvironment, issues);
  }
}

function validateStorage(expectedEnvironment: "staging" | "production", issues: string[]) {
  const config = getOperationalConfig();
  requireEnvironmentMarker("STORAGE_ENV", expectedEnvironment, issues);
  if (config.storageMode === "disabled") {
    issues.push("STORAGE_MODE nao pode ser disabled em ambiente implantado.");
    return;
  }
  if (config.storageMode === "local") {
    if (read("ALLOW_EPHEMERAL_STAGING_STORAGE").toLowerCase() !== "true" || expectedEnvironment !== "staging") issues.push("Storage local exige staging e ALLOW_EPHEMERAL_STAGING_STORAGE=true.");
    return;
  }
  parseUrl("BUILT_IN_FORGE_API_URL", issues);
  if (!read("BUILT_IN_FORGE_API_KEY")) issues.push("BUILT_IN_FORGE_API_KEY ausente.");
  const namespace = read("STORAGE_NAMESPACE");
  const forbiddenNamespace = read(expectedEnvironment === "staging" ? "PRODUCTION_STORAGE_NAMESPACE" : "STAGING_STORAGE_NAMESPACE");
  if (!namespace) issues.push("STORAGE_NAMESPACE ausente.");
  if (namespace && forbiddenNamespace && namespace === forbiddenNamespace) issues.push("STORAGE_NAMESPACE coincide com o ambiente proibido.");
}

export function getDeploymentEnvironment() {
  return getAppEnvironment();
}

export function validateEnvironmentIsolation() {
  const environment = getAppEnvironment();
  if (environment !== "staging" && environment !== "production") return [];
  const issues: string[] = [];
  if (read("APP_ENV").toLowerCase() !== environment) issues.push(`APP_ENV precisa ser explicitamente ${environment}.`);
  if (process.env.NODE_ENV !== "production") issues.push("NODE_ENV precisa ser production em ambiente implantado.");

  validateDatabase(environment, issues);
  validateOrigins(environment, issues);
  validateProviderIsolation(environment, issues);
  validateStorage(environment, issues);

  const sessionCookieName = read("SESSION_COOKIE_NAME");
  const forbiddenCookieName = read(environment === "staging" ? "PRODUCTION_SESSION_COOKIE_NAME" : "STAGING_SESSION_COOKIE_NAME");
  if (sessionCookieName.length < 8) issues.push("SESSION_COOKIE_NAME ausente ou muito curto.");
  if (!forbiddenCookieName) issues.push(`${environment === "staging" ? "PRODUCTION" : "STAGING"}_SESSION_COOKIE_NAME ausente.`);
  if (sessionCookieName && forbiddenCookieName && sessionCookieName === forbiddenCookieName) issues.push("SESSION_COOKIE_NAME coincide com o ambiente proibido.");
  if (read("SESSION_COOKIE_DOMAIN")) issues.push("SESSION_COOKIE_DOMAIN deve ficar vazio para cookie host-only.");
  if (read("COOKIE_SECURE").toLowerCase() !== "true") issues.push("COOKIE_SECURE precisa ser true.");
  if (read("COOKIE_SAME_SITE").toLowerCase() !== "lax") issues.push("COOKIE_SAME_SITE precisa ser lax.");
  requireEnvironmentMarker("SESSION_SECRET_ENV", environment, issues);
  if (read("JWT_SECRET").length < 32) issues.push("JWT_SECRET precisa ter ao menos 32 caracteres.");

  if (environment === "staging") {
    if (read("EMAIL_MODE").toLowerCase() !== "restricted") issues.push("EMAIL_MODE precisa ser restricted em staging.");
    if (!read("STAGING_EMAIL_ALLOWLIST")) issues.push("STAGING_EMAIL_ALLOWLIST ausente.");
  }
  requireEnvironmentMarker("EMAIL_ENV", environment, issues);

  for (const name of ["CHECKOUT_ENABLED", "MAINTENANCE_MODE", "OPERATIONAL_JOBS_ENABLED", "JOB_ENDPOINTS_ENABLED", "AUTOMATIC_BACKUPS_ENABLED"]) requireBoolean(name, issues);
  const config = getOperationalConfig();
  if (config.schedulerMode === "disabled" && config.operationalJobsEnabled) issues.push("JOB_SCHEDULER_MODE disabled e OPERATIONAL_JOBS_ENABLED=true sao incompatíveis.");
  if (config.schedulerMode === "internal" && config.jobEndpointsEnabled) issues.push("Scheduler interno e endpoints externos nao podem ficar ativos juntos.");
  if (config.schedulerMode === "external" && !config.jobEndpointsEnabled) issues.push("JOB_SCHEDULER_MODE=external exige JOB_ENDPOINTS_ENABLED=true.");

  for (const name of ["RELEASE_VERSION", "GIT_COMMIT_SHA", "DEPLOYED_AT"]) if (!read(name)) issues.push(`${name} ausente.`);
  return [...new Set(issues)];
}

export function validateStagingIsolation() {
  return getAppEnvironment() === "staging" ? validateEnvironmentIsolation() : [];
}

export function assertEnvironmentIsolation() {
  const issues = validateEnvironmentIsolation();
  if (issues.length > 0) throw new Error(`Environment isolation check failed: ${issues.join(" ")}`);
}
