export type ApiDeploymentTarget = "staging" | "production";

export type ApiConfigInput = {
  apiUrl?: string;
  stagingApiAllowedOrigins?: string;
  legacyBackendUrl?: string;
  target?: string;
  isDevelopment?: boolean;
  currentOrigin?: string;
};

export class ApiConfigError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ApiConfigError";
  }
}

const PRODUCTION_API_HOSTS = new Set(["api.l4ckos.com.br"]);
const LEGACY_STAGING_API_HOSTS = new Set(["api-staging.l4ckos.com.br"]);
const LOCAL_API_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isLocalApiUrl(url: URL): boolean {
  return LOCAL_API_HOSTS.has(url.hostname.toLowerCase());
}

function parseTarget(value?: string): ApiDeploymentTarget | undefined {
  const target = value?.trim().toLowerCase();
  if (!target) return undefined;
  if (target === "staging" || target === "production") return target;
  throw new ApiConfigError("API_TARGET_INVALID", "VITE_DEPLOY_TARGET must be staging or production.");
}

function parseRemoteUrl(value: string, allowLocalHttp = false): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiConfigError("API_URL_INVALID", "VITE_API_URL must be an absolute HTTPS URL, same-origin, or a root-relative path.");
  }
  const localHttp = allowLocalHttp && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !localHttp) || url.username || url.password || url.search || url.hash) {
    throw new ApiConfigError("API_URL_INVALID", "VITE_API_URL must use HTTPS and cannot contain credentials, a query, or a fragment.");
  }
  return url;
}

function isSameOriginConfig(value: string): boolean {
  if (value === "same-origin") return true;
  if (!value.startsWith("/")) return false;
  const base = "https://api-config.invalid";
  const url = new URL(value, base);
  if (url.origin !== base || url.search || url.hash || value.includes("\\")) {
    throw new ApiConfigError("API_URL_INVALID", "A relative API URL must stay on the configured browser origin.");
  }
  return true;
}

export function validateBuildApiConfig(input: Pick<ApiConfigInput, "apiUrl" | "target" | "stagingApiAllowedOrigins">): void {
  const target = parseTarget(input.target);
  if (!target) throw new ApiConfigError("API_TARGET_REQUIRED", "Set VITE_DEPLOY_TARGET=staging or production for a release build.");
  const value = input.apiUrl?.trim();
  if (!value) throw new ApiConfigError("API_URL_REQUIRED", "VITE_API_URL is required for a release build.");

  if (target === "staging") {
    validateStagingApiConfig(value, input.stagingApiAllowedOrigins);
    return;
  }

  if (isSameOriginConfig(value)) return;
  const hostname = parseRemoteUrl(value).hostname.toLowerCase();
  if (hostname === "api-staging.l4ckos.com.br") {
    throw new ApiConfigError("PRODUCTION_API_TARGET_MISMATCH", "Production builds cannot target the staging API.");
  }
}

function validateStagingApiConfig(apiUrl: string, allowedOriginsCsv?: string): URL {
  const allowedOrigins = (allowedOriginsCsv ?? "").split(",").map(value => value.trim()).filter(Boolean);
  if (allowedOrigins.length === 0) {
    throw new ApiConfigError("STAGING_API_ALLOWLIST_REQUIRED", "Staging builds require an explicit VITE_STAGING_API_ALLOWED_ORIGINS allowlist.");
  }

  const parsedAllowed = new Set<string>();
  for (const allowedOrigin of allowedOrigins) {
    let allowed: URL;
    try {
      allowed = new URL(allowedOrigin);
    } catch {
      throw new ApiConfigError("STAGING_API_ALLOWLIST_INVALID", "The staging API allowlist must contain HTTPS origins only.");
    }
    if (allowed.protocol !== "https:" || allowed.username || allowed.password || allowed.pathname !== "/" || allowed.search || allowed.hash) {
      throw new ApiConfigError("STAGING_API_ALLOWLIST_INVALID", "The staging API allowlist must contain HTTPS origins only.");
    }
    const hostname = allowed.hostname.toLowerCase();
    if (PRODUCTION_API_HOSTS.has(hostname)) {
      throw new ApiConfigError("STAGING_API_PRODUCTION_FORBIDDEN", "Staging cannot authorize the production API host.");
    }
    if (LEGACY_STAGING_API_HOSTS.has(hostname)) {
      throw new ApiConfigError("STAGING_API_LEGACY_FORBIDDEN", "The existing staging API host cannot be used by the isolated preview.");
    }
    parsedAllowed.add(allowed.origin);
  }

  let api: URL;
  try {
    api = new URL(apiUrl.trim());
  } catch {
    throw new ApiConfigError("STAGING_API_ORIGIN_INVALID", "Staging requires an explicit HTTPS API origin.");
  }
  if (api.protocol !== "https:" || api.username || api.password || api.pathname !== "/" || api.search || api.hash) {
    throw new ApiConfigError("STAGING_API_ORIGIN_INVALID", "Staging requires an HTTPS API origin without credentials, path, query, or fragment.");
  }
  const hostname = api.hostname.toLowerCase();
  if (PRODUCTION_API_HOSTS.has(hostname)) {
    throw new ApiConfigError("STAGING_API_PRODUCTION_FORBIDDEN", "Staging cannot target the production API.");
  }
  if (LEGACY_STAGING_API_HOSTS.has(hostname)) {
    throw new ApiConfigError("STAGING_API_LEGACY_FORBIDDEN", "Staging cannot fall back to the existing API service.");
  }
  if (!parsedAllowed.has(api.origin)) {
    throw new ApiConfigError("STAGING_API_ORIGIN_UNAUTHORIZED", "The staging API origin is not in the explicit staging allowlist.");
  }
  return api;
}

export function resolveApiUrl(input: ApiConfigInput): URL {
  const target = parseTarget(input.target);
  if (input.isDevelopment && target) {
    throw new ApiConfigError("DEV_API_TARGET_DISABLED", "Local development cannot use a release API target.");
  }
  if (input.isDevelopment && input.currentOrigin && !isLocalApiUrl(new URL(input.currentOrigin))) {
    throw new ApiConfigError("DEV_API_REMOTE_DISABLED", "Local development cannot run from a remote site origin.");
  }
  // A production artifact accidentally served on the staging host must stop too.
  if (input.currentOrigin && new URL(input.currentOrigin).hostname === "staging.l4ckos.com.br") {
    if (target !== "staging") throw new ApiConfigError("STAGING_API_ORIGIN_MISMATCH", "The staging frontend requires a staging build.");
    validateBuildApiConfig(input);
  }
  if (!input.isDevelopment || target === "staging") validateBuildApiConfig(input);
  const configured = input.apiUrl?.trim() || (input.isDevelopment ? input.legacyBackendUrl?.trim() : undefined);
  if (!configured) {
    if (input.isDevelopment) return new URL("http://localhost:3010");
    throw new ApiConfigError("API_URL_REQUIRED", "API destination is not configured; no network request was made.");
  }

  let resolved: URL;
  if (configured === "same-origin") {
    if (!input.currentOrigin) throw new ApiConfigError("API_URL_INVALID", "same-origin requires a browser origin.");
    resolved = new URL(input.currentOrigin);
  } else if (isSameOriginConfig(configured)) {
    if (!input.currentOrigin) throw new ApiConfigError("API_URL_INVALID", "A relative API URL requires a browser origin.");
    resolved = new URL(configured, input.currentOrigin);
  } else {
    resolved = parseRemoteUrl(configured, input.isDevelopment);
  }

  if (target === "staging") {
    validateStagingApiConfig(configured, input.stagingApiAllowedOrigins);
  }
  if (target === "production" && resolved.hostname.toLowerCase() === "api-staging.l4ckos.com.br") {
    throw new ApiConfigError("PRODUCTION_API_TARGET_MISMATCH", "Production runtime cannot target the staging API.");
  }
  if (input.isDevelopment && !isLocalApiUrl(resolved)) {
    throw new ApiConfigError("DEV_API_REMOTE_DISABLED", "Local development may only use a loopback API destination.");
  }
  if (resolved.protocol !== "https:" && !(resolved.protocol === "http:" && input.isDevelopment && ["localhost", "127.0.0.1", "[::1]"].includes(resolved.hostname))) {
    throw new ApiConfigError("API_URL_INVALID", "Non-local API destinations must use HTTPS.");
  }
  return resolved;
}

export function apiEndpoint(base: URL, pathname: string): string {
  const url = new URL(pathname, base);
  if (url.origin !== base.origin || url.username || url.password) {
    throw new ApiConfigError("API_PATH_INVALID", "An API endpoint cannot change the configured origin.");
  }
  return url.toString();
}
