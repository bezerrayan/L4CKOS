export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

const isDev = Boolean((import.meta as any).env?.DEV);
const PRODUCTION_API_ORIGIN = "https://api.l4ckos.com.br";
const STAGING_API_ORIGIN = "https://api-staging.l4ckos.com.br";
const appEnvironment = String((import.meta as any).env?.VITE_APP_ENV || (isDev ? "local" : "")).trim().toLowerCase();

function getDefaultApiUrl() {
  if (isDev) return "http://localhost:3010";

  if (typeof window !== "undefined" && window.location?.origin) {
    const host = window.location.host.toLowerCase();

    if (appEnvironment === "staging" || host === "staging.l4ckos.com.br") {
      return STAGING_API_ORIGIN;
    }

    // While the app is being validated on Railway's temporary domain,
    // frontend and backend share the same origin.
    if (host.endsWith(".up.railway.app")) {
      return window.location.origin;
    }

    return PRODUCTION_API_ORIGIN;
  }

  return PRODUCTION_API_ORIGIN;
}

const envApiUrl =
  (import.meta as any).env?.VITE_API_URL ||
  (import.meta as any).env?.VITE_BACKEND_URL ||
  getDefaultApiUrl();

function resolveApiUrl() {
  try {
    if (typeof window !== "undefined" && window.location?.origin) {
      if (envApiUrl === "same-origin") {
        return new URL(window.location.origin);
      }

      if (envApiUrl.startsWith("/")) {
        return new URL(envApiUrl, window.location.origin);
      }
    }

    const resolved = new URL(envApiUrl);
    if (appEnvironment === "staging" && resolved.hostname === "api.l4ckos.com.br") {
      throw new Error("Staging frontend cannot use the production API");
    }
    if (appEnvironment === "production" && resolved.hostname === "api-staging.l4ckos.com.br") {
      throw new Error("Production frontend cannot use the staging API");
    }
    return resolved;
  } catch {
    if (appEnvironment === "staging" || appEnvironment === "production") {
      throw new Error("Invalid or unsafe VITE_API_URL for the selected VITE_APP_ENV");
    }
    if (typeof window !== "undefined" && window.location?.origin) {
      return new URL(window.location.origin);
    }

    return new URL("http://localhost:3010");
  }
}

export const API_URL = resolveApiUrl();
export const API_ORIGIN = API_URL.origin;
export const APP_ENVIRONMENT = appEnvironment || "unknown";

export function apiUrl(pathname: string) {
  return new URL(pathname, API_URL).toString();
}

export const getLoginUrl = () => {
  if (typeof window === "undefined") return "/login";

  try {
    const url = new URL("/api/oauth/login", API_URL);
    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (returnTo && returnTo.startsWith("/") && returnTo !== "/login") {
      url.searchParams.set("returnTo", returnTo);
    }
    return url.toString();
  } catch {
    return "/login";
  }
};
