import { apiUrl } from "../const";

const CSRF_HEADER_NAME = "x-csrf-token";

let csrfToken: string | null = null;
let csrfTokenPromise: Promise<string> | null = null;

function isMutatingMethod(method?: string) {
  return !method || !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

export async function getCsrfToken() {
  if (csrfToken) return csrfToken;
  if (csrfTokenPromise) return csrfTokenPromise;

  csrfTokenPromise = fetch(apiUrl("/api/csrf"), {
    credentials: "include",
    headers: { Accept: "application/json" },
  })
    .then(async response => {
      if (!response.ok) {
        throw new Error("Failed to initialize CSRF token");
      }
      const payload = (await response.json()) as { csrfToken?: string };
      if (!payload.csrfToken) {
        throw new Error("CSRF token missing from response");
      }
      csrfToken = payload.csrfToken;
      return csrfToken;
    })
    .finally(() => {
      csrfTokenPromise = null;
    });

  return csrfTokenPromise;
}

export async function csrfFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const method = init.method || "GET";
  const headers = new Headers(init.headers);

  if (isMutatingMethod(method)) {
    headers.set(CSRF_HEADER_NAME, await getCsrfToken());
  }

  return fetch(input, {
    ...init,
    headers,
    credentials: init.credentials ?? "include",
  });
}
