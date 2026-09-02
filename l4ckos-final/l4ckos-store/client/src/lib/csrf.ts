import { apiUrl } from "../const";

const CSRF_HEADER_NAME = "x-csrf-token";
let csrfToken: string | null = null;
let pendingToken: Promise<string> | null = null;

export async function getCsrfToken() {
  if (csrfToken) return csrfToken;
  if (pendingToken) return pendingToken;
  pendingToken = fetch(apiUrl("/api/csrf"), { credentials: "include" })
    .then(async response => {
      const payload = await response.json().catch(() => null) as { csrfToken?: string } | null;
      if (!response.ok || !payload?.csrfToken) throw new Error("Unable to obtain CSRF token");
      csrfToken = payload.csrfToken;
      return csrfToken;
    })
    .finally(() => { pendingToken = null; });
  return pendingToken;
}

export async function csrfFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const method = String(init.method || "GET").toUpperCase();
  const headers = new Headers(init.headers);
  const mutating = !["GET", "HEAD", "OPTIONS"].includes(method);
  if (mutating) headers.set(CSRF_HEADER_NAME, await getCsrfToken());
  const response = await fetch(input, { ...init, headers, credentials: "include" });
  if (!mutating || response.status !== 403) return response;

  const payload = await response.clone().json().catch(() => null) as { code?: string } | null;
  if (payload?.code !== "CSRF_TOKEN_INVALID") return response;

  // The request was rejected before reaching its handler, so a single retry
  // with a fresh signed token is safe for the supported JSON/FormData callers.
  csrfToken = null;
  headers.set(CSRF_HEADER_NAME, await getCsrfToken());
  return fetch(input, { ...init, headers, credentials: "include" });
}
