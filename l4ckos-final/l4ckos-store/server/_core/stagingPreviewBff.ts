import { parse as parseCookies } from "cookie";

/** Fixed to the isolated Railway homologation service. Never derive this from request input or environment. */
export const STAGING_API_ORIGIN = "https://api-stock-homologation-homologation.up.railway.app";
/** Stable Vercel Preview branch alias. The function refuses every other host and origin. */
export const STAGING_PREVIEW_ORIGIN = "https://l4ckos-git-feature-stock-asaas-cred-4911fc-bezerrayans-projects.vercel.app";
export const STAGING_API_ACCESS_HEADER = "x-l4ckos-staging-token";
export const STAGING_BFF_BODY_LIMIT = 64 * 1024;
export const STAGING_BFF_RESPONSE_LIMIT = 2 * 1024 * 1024;

const SESSION_COOKIE = "app_session_id";
const CSRF_COOKIE = "l4ckos_csrf";
const TPRC_QUERY_PROCEDURES = new Set([
  "auth.me",
  "products.list",
  "products.getById",
  "products.sellableVariants",
  "products.homeHighlights",
  "products.reviews",
  "products.reviewEligibility",
  "exclusiveDrops.forProduct",
  "cart.list",
  "favorites.list",
  "stockCheckout.resume",
  "stockCheckout.resumeLatest",
  "profile.get",
  "orders.detail",
]);
const TRPC_MUTATION_PROCEDURES = new Set([
  "auth.localLogin",
  "auth.logout",
  "cart.add",
  "cart.remove",
  "cart.clear",
  "favorites.add",
  "favorites.remove",
  "orders.validateCoupon",
  "stockCheckout.quoteShipping",
  "stockCheckout.create",
]);

export type StagingBffEnvironment = Record<string, string | undefined> & {
  VERCEL_ENV?: string;
  STAGING_BFF_ALLOWED_ORIGIN?: string;
  STAGING_API_ACCESS_TOKEN?: string;
};

export type StagingBffRequest = {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: Uint8Array;
};

export type StagingBffResponse = {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: Uint8Array;
};

type AllowedRequest = {
  method: "GET" | "POST";
  pathname: string;
  search: string;
  body: Uint8Array;
  cookieHeader: string;
  csrfHeader: string;
  contentType: string;
};

function headerValue(headers: StagingBffRequest["headers"], name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined;
  return value;
}

function response(statusCode: number, body: string): StagingBffResponse {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, private",
      "x-content-type-options": "nosniff",
    },
    body: new TextEncoder().encode(body),
  };
}

function reject(statusCode: number, code: string): StagingBffResponse {
  return response(statusCode, JSON.stringify({ error: code }));
}

function readOnlyCookies(header: string | undefined): string | null {
  if (!header) return "";
  const allowedNames = new Set([SESSION_COOKIE, CSRF_COOKIE]);
  const seen = new Set<string>();
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    if (!allowedNames.has(name)) continue;
    if (seen.has(name)) return null;
    seen.add(name);
  }
  const parsed = parseCookies(header);
  const selected = [SESSION_COOKIE, CSRF_COOKIE]
    .filter(name => typeof parsed[name] === "string" && parsed[name].length > 0)
    .map(name => `${name}=${parsed[name]}`);
  return selected.join("; ");
}

function validateOriginAndHost(request: StagingBffRequest, env: StagingBffEnvironment): boolean {
  if (env.VERCEL_ENV !== "preview" || env.STAGING_BFF_ALLOWED_ORIGIN !== STAGING_PREVIEW_ORIGIN) return false;

  const host = headerValue(request.headers, "host")?.toLowerCase();
  if (host !== new URL(STAGING_PREVIEW_ORIGIN).host) return false;

  const forwardedProto = headerValue(request.headers, "x-forwarded-proto")
    ?.split(",", 1)[0]
    .trim()
    .toLowerCase();
  if (forwardedProto !== "https") return false;

  const origin = headerValue(request.headers, "origin");
  if (origin && origin !== STAGING_PREVIEW_ORIGIN) return false;

  const referer = headerValue(request.headers, "referer");
  if (referer) {
    try {
      if (new URL(referer).origin !== STAGING_PREVIEW_ORIGIN) return false;
    } catch {
      return false;
    }
  }

  const fetchSite = headerValue(request.headers, "sec-fetch-site");
  if (!origin && !referer && fetchSite && fetchSite !== "same-origin") return false;
  return true;
}

function parseAllowedRequest(request: StagingBffRequest): AllowedRequest | null {
  const method = (request.method ?? "").toUpperCase();
  if (method !== "GET" && method !== "POST") return null;

  const rawUrl = request.url ?? "";
  if (!rawUrl.startsWith("/") || rawUrl.startsWith("//") || rawUrl.includes("\\") || rawUrl.includes("#")) return null;
  const rawPath = rawUrl.split("?", 1)[0];
  if (rawPath.includes("%") || rawPath.includes("//") || rawPath.split("/").some(segment => segment === "." || segment === "..")) return null;

  let url: URL;
  try {
    url = new URL(rawUrl, STAGING_PREVIEW_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== STAGING_PREVIEW_ORIGIN || url.pathname.includes("%") || url.pathname.includes("\\") || url.pathname.includes("//")) return null;

  const body = request.body ?? new Uint8Array();
  if (body.byteLength > STAGING_BFF_BODY_LIMIT) return null;

  const cookieHeader = readOnlyCookies(headerValue(request.headers, "cookie"));
  if (cookieHeader === null) return null;
  const csrfHeader = headerValue(request.headers, "x-csrf-token") ?? "";
  const contentType = headerValue(request.headers, "content-type") ?? "";
  const normalizedContentType = contentType.split(";", 1)[0].trim().toLowerCase();

  if (url.pathname === "/api/csrf" && method === "GET" && url.search === "") {
    return { method, pathname: url.pathname, search: "", body, cookieHeader, csrfHeader, contentType: "" };
  }

  const cepMatch = url.pathname.match(/^\/api\/cep\/([0-9]{8})$/);
  if (cepMatch && method === "GET" && url.search === "") {
    return { method, pathname: url.pathname, search: "", body, cookieHeader, csrfHeader, contentType: "" };
  }

  if (url.pathname === "/api/shipping/quote" && method === "POST" && url.search === "" &&
      normalizedContentType === "application/json" && body.byteLength > 0) {
    return { method, pathname: url.pathname, search: "", body, cookieHeader, csrfHeader, contentType: "application/json" };
  }

  if (!url.pathname.startsWith("/api/trpc/")) return null;
  const procedures = url.pathname.slice("/api/trpc/".length).split(",");
  if (procedures.length === 0 || procedures.length > 10 || new Set(procedures).size !== procedures.length ||
      procedures.includes("stockCheckout.create") && procedures.length > 1 ||
      procedures.some(path => !/^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+$/.test(path))) return null;

  const allowed = method === "GET" ? TPRC_QUERY_PROCEDURES : TRPC_MUTATION_PROCEDURES;
  if (procedures.some(path => !allowed.has(path))) return null;

  const keys = [...url.searchParams.keys()];
  if (keys.some(key => key !== "input" && key !== "batch") || new Set(keys).size !== keys.length) return null;
  if (url.searchParams.has("batch") && url.searchParams.get("batch") !== "1") return null;
  const input = url.searchParams.get("input") ?? "";
  if (input.length > STAGING_BFF_BODY_LIMIT) return null;

  if (method === "GET") {
    if (body.byteLength > 0) return null;
  } else {
    if (normalizedContentType !== "application/json" || body.byteLength === 0) return null;
    try {
      JSON.parse(new TextDecoder().decode(body));
    } catch {
      return null;
    }
  }

  return {
    method,
    pathname: url.pathname,
    search: url.search,
    body,
    cookieHeader,
    csrfHeader,
    contentType: method === "POST" ? "application/json" : "",
  };
}

function splitSetCookieHeader(value: string): string[] {
  return value.split(/,(?=\s*[^;,\s]+=)/g).map(cookie => cookie.trim()).filter(Boolean);
}

function sanitizeSetCookie(value: string): string | null {
  const [pair, ...rawAttributes] = value.split(";");
  const separator = pair.indexOf("=");
  if (separator < 1) return null;
  const name = pair.slice(0, separator).trim();
  const cookieValue = pair.slice(separator + 1).trim();
  if (![SESSION_COOKIE, CSRF_COOKIE].includes(name) || !cookieValue || /[\r\n;,]/.test(cookieValue)) return null;

  const attributes: string[] = [];
  for (const raw of rawAttributes) {
    const attribute = raw.trim();
    const equals = attribute.indexOf("=");
    const key = (equals < 0 ? attribute : attribute.slice(0, equals)).trim().toLowerCase();
    const rawValue = equals < 0 ? "" : attribute.slice(equals + 1).trim();
    if (key === "domain") continue;
    if (key === "path" && rawValue === "/") attributes.push("Path=/");
    else if (key === "secure" && equals < 0) attributes.push("Secure");
    else if (key === "httponly" && equals < 0 && name === SESSION_COOKIE) attributes.push("HttpOnly");
    else if (key === "samesite" && /^(lax|strict|none)$/i.test(rawValue)) attributes.push(`SameSite=${rawValue}`);
    else if (key === "max-age" && /^-?[0-9]+$/.test(rawValue)) attributes.push(`Max-Age=${rawValue}`);
    else if (key === "expires" && /^[A-Za-z0-9,: -]+$/.test(rawValue)) attributes.push(`Expires=${rawValue}`);
  }
  if (!attributes.some(attribute => attribute.startsWith("Path="))) attributes.push("Path=/");
  return `${name}=${cookieValue}; ${attributes.join("; ")}`;
}

async function readLimitedResponse(response: Response): Promise<Uint8Array | null> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > STAGING_BFF_RESPONSE_LIMIT) return null;
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > STAGING_BFF_RESPONSE_LIMIT) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** Narrow Preview-only BFF; the Railway token is attached here and is never accepted from the browser. */
export async function handleStagingPreviewBff(
  request: StagingBffRequest,
  env: StagingBffEnvironment,
  fetcher: typeof fetch = fetch,
): Promise<StagingBffResponse> {
  if (!validateOriginAndHost(request, env)) return reject(404, "PREVIEW_BFF_UNAVAILABLE");

  const token = env.STAGING_API_ACCESS_TOKEN;
  if (!token || Buffer.byteLength(token, "utf8") < 32 || /[\r\n]/.test(token)) {
    return reject(503, "PREVIEW_BFF_UNAVAILABLE");
  }

  const allowed = parseAllowedRequest(request);
  if (!allowed) return reject(404, "PREVIEW_BFF_ROUTE_NOT_ALLOWED");

  const upstreamUrl = new URL(`${allowed.pathname}${allowed.search}`, STAGING_API_ORIGIN);
  const headers = new Headers({
    accept: "application/json",
    origin: STAGING_PREVIEW_ORIGIN,
    [STAGING_API_ACCESS_HEADER]: token,
  });
  if (allowed.cookieHeader) headers.set("cookie", allowed.cookieHeader);
  if (allowed.csrfHeader) headers.set("x-csrf-token", allowed.csrfHeader);
  if (allowed.contentType) headers.set("content-type", allowed.contentType);

  let upstream: Response;
  try {
    upstream = await fetcher(upstreamUrl, {
      method: allowed.method,
      headers,
      body: allowed.method === "POST" ? Buffer.from(allowed.body) : undefined,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return reject(502, "PREVIEW_BFF_UPSTREAM_UNAVAILABLE");
  }

  if (upstream.status >= 300 && upstream.status < 400) return reject(502, "PREVIEW_BFF_UPSTREAM_UNAVAILABLE");
  const contentType = upstream.headers.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) return reject(502, "PREVIEW_BFF_UPSTREAM_UNAVAILABLE");

  let responseBody: Uint8Array | null;
  try {
    responseBody = await readLimitedResponse(upstream);
  } catch {
    return reject(502, "PREVIEW_BFF_UPSTREAM_UNAVAILABLE");
  }
  if (!responseBody) return reject(502, "PREVIEW_BFF_UPSTREAM_UNAVAILABLE");

  const decodedBody = new TextDecoder().decode(responseBody);
  if (decodedBody.includes(token)) return reject(502, "PREVIEW_BFF_UPSTREAM_UNAVAILABLE");

  const resultHeaders: StagingBffResponse["headers"] = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store, private",
    "x-content-type-options": "nosniff",
  };
  const responseHeaders = upstream.headers as Headers & { getSetCookie?: () => string[] };
  const rawCookies = responseHeaders.getSetCookie?.() ??
    (upstream.headers.get("set-cookie") ? [upstream.headers.get("set-cookie")!] : []);
  const safeCookies = rawCookies
    .flatMap(splitSetCookieHeader)
    .map(sanitizeSetCookie)
    .filter((value): value is string => Boolean(value));
  if (safeCookies.some(cookie => cookie.includes(token))) return reject(502, "PREVIEW_BFF_UPSTREAM_UNAVAILABLE");
  if (safeCookies.length) resultHeaders["set-cookie"] = safeCookies;

  return { statusCode: upstream.status, headers: resultHeaders, body: responseBody };
}
