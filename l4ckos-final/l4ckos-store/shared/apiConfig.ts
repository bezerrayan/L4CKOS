export type ApiDeploymentTarget = "staging" | "production";

export type ApiConfigInput = {
  apiUrl?: string;
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

const STAGING_API_ORIGIN = "https://api-staging.l4ckos.com.br";

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

export function validateBuildApiConfig(input: Pick<ApiConfigInput, "apiUrl" | "target">): void {
  const target = parseTarget(input.target);
  if (!target) throw new ApiConfigError("API_TARGET_REQUIRED", "Set VITE_DEPLOY_TARGET=staging or production for a release build.");
  const value = input.apiUrl?.trim();
  if (!value) throw new ApiConfigError("API_URL_REQUIRED", "VITE_API_URL is required for a release build.");

  if (target === "staging") {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new ApiConfigError("STAGING_API_ORIGIN_MISMATCH", `Staging builds must set VITE_API_URL to ${STAGING_API_ORIGIN}.`);
    }
    if (url.origin !== STAGING_API_ORIGIN || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
      throw new ApiConfigError("STAGING_API_ORIGIN_MISMATCH", `Staging builds must set VITE_API_URL to ${STAGING_API_ORIGIN}.`);
    }
    return;
  }

  if (isSameOriginConfig(value)) return;
  const hostname = parseRemoteUrl(value).hostname.toLowerCase();
  if (hostname === "api-staging.l4ckos.com.br") {
    throw new ApiConfigError("PRODUCTION_API_TARGET_MISMATCH", "Production builds cannot target the staging API.");
  }
}

export function resolveApiUrl(input: ApiConfigInput): URL {
  const target = parseTarget(input.target);
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

  if (target === "staging" && resolved.origin !== STAGING_API_ORIGIN) {
    throw new ApiConfigError("STAGING_API_ORIGIN_MISMATCH", `Staging runtime must target ${STAGING_API_ORIGIN}.`);
  }
  if (target === "production" && resolved.hostname.toLowerCase() === "api-staging.l4ckos.com.br") {
    throw new ApiConfigError("PRODUCTION_API_TARGET_MISMATCH", "Production runtime cannot target the staging API.");
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
