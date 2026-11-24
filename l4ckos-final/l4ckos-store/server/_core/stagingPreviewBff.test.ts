import { describe, expect, it, vi } from "vitest";
import {
  handleStagingPreviewBff,
  STAGING_API_ACCESS_HEADER,
  STAGING_API_ORIGIN,
  STAGING_PREVIEW_ORIGIN,
  type StagingBffRequest,
} from "./stagingPreviewBff";

const token = "sandbox-only-staging-access-token-at-least-32-bytes";
const env = {
  VERCEL_ENV: "preview",
  STAGING_BFF_ALLOWED_ORIGIN: STAGING_PREVIEW_ORIGIN,
  STAGING_API_ACCESS_TOKEN: token,
};

function request(overrides: Partial<StagingBffRequest> = {}): StagingBffRequest {
  return {
    method: "GET",
    url: "/api/trpc/auth.me?batch=1&input=%7B%7D",
    headers: {
      host: new URL(STAGING_PREVIEW_ORIGIN).host,
      "x-forwarded-proto": "https",
      origin: STAGING_PREVIEW_ORIGIN,
      cookie: "app_session_id=session-value; l4ckos_csrf=csrf-value; vercel-sso=must-not-forward",
      authorization: "Bearer user-controlled",
      [STAGING_API_ACCESS_HEADER]: "attacker-supplied-token",
    },
    ...overrides,
  };
}

function jsonResponse(body: string, init: ResponseInit = {}) {
  return new Response(body, { status: 200, headers: { "content-type": "application/json", ...init.headers }, ...init });
}

describe("staging Preview BFF", () => {
  it("forwards only allowlisted same-origin query with fixed upstream and server token", async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => jsonResponse("{\"result\":true}"));
    const result = await handleStagingPreviewBff(request(), env, fetcher as typeof fetch);

    expect(result.statusCode).toBe(200);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe(`${STAGING_API_ORIGIN}/api/trpc/auth.me?batch=1&input=%7B%7D`);
    const headers = new Headers(init?.headers);
    expect(headers.get(STAGING_API_ACCESS_HEADER)).toBe(token);
    expect(headers.get("origin")).toBe(STAGING_PREVIEW_ORIGIN);
    expect(headers.get("cookie")).toBe("app_session_id=session-value; l4ckos_csrf=csrf-value");
    expect(headers.has("authorization")).toBe(false);
    expect(headers.get("cookie")).not.toContain("vercel-sso");
    expect(headers.get(STAGING_API_ACCESS_HEADER)).not.toBe(request().headers[STAGING_API_ACCESS_HEADER]);
  });

  it("resolves the Vercel static-function rewrite before applying the allowlist", async () => {
    const fetcher = vi.fn(async () => jsonResponse("{\"result\":true}"));
    const result = await handleStagingPreviewBff(request({
      url: "/api/staging-bff?bffpath=%2Fapi%2Ftrpc%2Fauth.me&batch=1&input=%7B%7D",
    }), env, fetcher as typeof fetch);

    expect(result.statusCode).toBe(200);
    expect(String(fetcher.mock.calls[0][0])).toBe(`${STAGING_API_ORIGIN}/api/trpc/auth.me?batch=1&input=%7B%7D`);
  });

  it("resolves a Vercel named rewrite parameter passed through the query string", async () => {
    const fetcher = vi.fn(async () => jsonResponse("{\"result\":true}"));
    const result = await handleStagingPreviewBff(request({
      url: "/api/staging-bff?bffpath=trpc%2Fauth.me&batch=1&input=%7B%7D",
    }), env, fetcher as typeof fetch);

    expect(result.statusCode).toBe(200);
    expect(String(fetcher.mock.calls[0][0])).toBe(`${STAGING_API_ORIGIN}/api/trpc/auth.me?batch=1&input=%7B%7D`);
  });

  it("rejects duplicate internal rewrite markers and still checks the rewritten path", async () => {
    const fetcher = vi.fn();
    for (const url of [
      "/api/staging-bff?bffpath=csrf&bffpath=trpc%2Fauth.me",
      "/api/staging-bff?bffpath=trpc%2Fadmin.dashboard",
    ]) {
      const result = await handleStagingPreviewBff(request({ url }), env, fetcher as typeof fetch);
      expect(result.statusCode).toBe(404);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { url: "/api/trpc/admin.dashboard", method: "GET" },
    { url: "/api/trpc/stockCheckout.create", method: "GET" },
    { url: "/api/trpc/auth.localSignup", method: "POST", body: new TextEncoder().encode("{}"), headers: { "content-type": "application/json" } },
    { url: "/api/trpc/stockCheckout.create?target=https://example.com", method: "POST", body: new TextEncoder().encode("{}"), headers: { "content-type": "application/json" } },
    { url: "/api/trpc/stockCheckout.create%2fadmin", method: "POST", body: new TextEncoder().encode("{}"), headers: { "content-type": "application/json" } },
    { url: "/api/trpc/stockCheckout.create,stockCheckout.create", method: "POST", body: new TextEncoder().encode("{}"), headers: { "content-type": "application/json" } },
    { url: "/api/payments/create-checkout", method: "POST", body: new TextEncoder().encode("{}"), headers: { "content-type": "application/json" } },
  ])("rejects non-allowlisted or malformed route $url", async override => {
    const fetcher = vi.fn();
    const base = request();
    const result = await handleStagingPreviewBff({ ...base, ...override, headers: { ...base.headers, ...override.headers } }, env, fetcher as typeof fetch);
    expect(result.statusCode).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("fails closed outside Vercel Preview or if origin, host, or TLS do not match", async () => {
    const fetcher = vi.fn();
    for (const [overrideEnv, overrideRequest] of [
      [{ VERCEL_ENV: "production" }, {}],
      [{}, { headers: { ...request().headers, origin: "https://attacker.example" } }],
      [{}, { headers: { ...request().headers, host: "attacker.example" } }],
      [{}, { headers: { ...request().headers, "x-forwarded-proto": "http" } }],
    ] as const) {
      const result = await handleStagingPreviewBff({ ...request(), ...overrideRequest }, { ...env, ...overrideEnv }, fetcher as typeof fetch);
      expect(result.statusCode).toBe(404);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("fails closed if the server-only token is missing or short", async () => {
    const fetcher = vi.fn();
    for (const tokenValue of [undefined, "too-short"]) {
      const result = await handleStagingPreviewBff(request(), { ...env, STAGING_API_ACCESS_TOKEN: tokenValue }, fetcher as typeof fetch);
      expect(result.statusCode).toBe(503);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects ambiguous duplicate application cookies", async () => {
    const fetcher = vi.fn();
    const result = await handleStagingPreviewBff(request({
      headers: { ...request().headers, cookie: "app_session_id=first; app_session_id=second" },
    }), env, fetcher as typeof fetch);
    expect(result.statusCode).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("preserves the encoded values of the two forwarded application cookies", async () => {
    const fetcher = vi.fn(async () => jsonResponse("{}"));
    await handleStagingPreviewBff(request({
      headers: { ...request().headers, cookie: "app_session_id=session%2Fvalue; l4ckos_csrf=csrf%3Dvalue" },
    }), env, fetcher as typeof fetch);
    const [, init] = fetcher.mock.calls[0];
    expect(new Headers(init?.headers).get("cookie")).toBe("app_session_id=session%2Fvalue; l4ckos_csrf=csrf%3Dvalue");
  });

  it("forwards a permitted mutation without caller-controlled headers and keeps same-origin cookies host-only", async () => {
    const body = new TextEncoder().encode("{\"json\":{\"attemptId\":\"synthetic-attempt\"}}");
    const fetcher = vi.fn(async () => new Response("{\"result\":true}", {
      status: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie": "app_session_id=new-session; Domain=railway.app; Path=/; Secure; HttpOnly; SameSite=Lax, l4ckos_csrf=new-csrf; Domain=railway.app; Path=/; Secure; SameSite=Lax",
      },
    }));
    const result = await handleStagingPreviewBff(request({
      method: "POST",
      url: "/api/trpc/stockCheckout.create",
      body,
      headers: { ...request().headers, "content-type": "application/json", "x-csrf-token": "csrf-value" },
    }), env, fetcher as typeof fetch);
    expect(result.statusCode).toBe(200);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe(`${STAGING_API_ORIGIN}/api/trpc/stockCheckout.create`);
    expect(new Headers(init?.headers).get("x-csrf-token")).toBe("csrf-value");
    expect(result.headers["set-cookie"]).toEqual([
      "app_session_id=new-session; Path=/; Secure; HttpOnly; SameSite=Lax",
      "l4ckos_csrf=new-csrf; Path=/; Secure; SameSite=Lax",
    ]);
  });

  it("does not follow upstream redirects or expose a response that reflects the server token", async () => {
    const redirect = await handleStagingPreviewBff(request(), env, vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://attacker.example" } })) as typeof fetch);
    expect(redirect.statusCode).toBe(502);
    expect(redirect.headers.location).toBeUndefined();

    const reflected = await handleStagingPreviewBff(request(), env, vi.fn(async () => jsonResponse(JSON.stringify({ error: token }))) as typeof fetch);
    expect(reflected.statusCode).toBe(502);
    expect(new TextDecoder().decode(reflected.body)).not.toContain(token);
  });
});
