export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { apiEndpoint, resolveApiUrl } from "@shared/apiConfig";

const browserOrigin = typeof window !== "undefined" ? window.location.origin : undefined;
export const API_URL = resolveApiUrl({
  apiUrl: import.meta.env.VITE_API_URL,
  legacyBackendUrl: import.meta.env.VITE_BACKEND_URL,
  target: import.meta.env.VITE_DEPLOY_TARGET,
  isDevelopment: import.meta.env.DEV,
  currentOrigin: browserOrigin,
});
export const API_ORIGIN = API_URL.origin;

export function apiUrl(pathname: string) {
  return apiEndpoint(API_URL, pathname);
}

export const getLoginUrl = (nextPath?: string) => {
  if (typeof window === "undefined") return "/login";

  try {
    const url = new URL("/api/oauth/login", API_URL);
    const returnTo = nextPath || `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (returnTo && returnTo.startsWith("/") && returnTo !== "/login") {
      url.searchParams.set("returnTo", returnTo);
    }
    return url.toString();
  } catch {
    return "/login";
  }
};
