import { afterEach, describe, expect, it } from "vitest";
import type { Request, Response } from "express";
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  createCsrfToken,
  csrfEndpoint,
  csrfMiddleware,
  isAsaasWebhookPath,
  shouldRequireCsrf,
} from "./_core/csrf";
import { isOriginAllowed } from "./_core/httpPolicy";

const originalEnv = { ...process.env };
afterEach(() => { process.env = { ...originalEnv }; });

function request(overrides: Partial<Request> = {}) {
  return {
    method: "POST",
    path: "/api/protected",
    ip: "127.0.0.1",
    protocol: "https",
    headers: {},
    ...overrides,
  } as Request;
}

function response() {
  const state: { status?: number; body?: unknown; headers: Record<string, string>; cookie?: { name: string; value: string; options: Record<string, unknown> } } = { headers: {} };
  const res = {
    cookie(name: string, value: string, options: Record<string, unknown>) { state.cookie = { name, value, options }; return res; },
    setHeader(name: string, value: string) { state.headers[name] = value; return res; },
    status(status: number) { state.status = status; return res; },
    json(body: unknown) { state.body = body; return res; },
  } as unknown as Response;
  return { res, state };
}

describe("CSRF hardened staging contract", () => {
  it("GET /api/csrf returns a signed token with a host-only readable CSRF cookie", () => {
    Object.assign(process.env, { JWT_SECRET: "x".repeat(32), SESSION_COOKIE_NAME: "l4ckos_staging_session", COOKIE_SECURE: "true", COOKIE_SAME_SITE: "lax", SESSION_COOKIE_DOMAIN: "" });
    const { res, state } = response();
    csrfEndpoint(request({ method: "GET", path: "/api/csrf" }), res, () => undefined);
    expect(state.status).toBe(200);
    expect((state.body as { csrfToken?: string }).csrfToken).toBe(state.cookie?.value);
    expect(state.headers["Cache-Control"]).toBe("no-store, private");
    expect(state.cookie).toMatchObject({ name: CSRF_COOKIE_NAME, options: { secure: true, sameSite: "lax", httpOnly: false, path: "/" } });
    expect(state.cookie?.options.domain).toBeUndefined();
  });

  it("blocks a mutable authenticated request without a token", () => {
    Object.assign(process.env, { JWT_SECRET: "x".repeat(32), SESSION_COOKIE_NAME: "l4ckos_staging_session" });
    const { res, state } = response();
    csrfMiddleware(request({ headers: { cookie: "l4ckos_staging_session=session" } }), res, () => { throw new Error("must not continue"); });
    expect(state.status).toBe(403);
    expect(state.body).toMatchObject({ code: "CSRF_TOKEN_INVALID" });
  });

  it("blocks an invalid token and permits the matching valid token", () => {
    Object.assign(process.env, { JWT_SECRET: "x".repeat(32), SESSION_COOKIE_NAME: "l4ckos_staging_session" });
    const invalid = response();
    csrfMiddleware(request({ headers: { cookie: `l4ckos_staging_session=session; ${CSRF_COOKIE_NAME}=bad`, [CSRF_HEADER_NAME]: "bad" } }), invalid.res, () => { throw new Error("must not continue"); });
    expect(invalid.state.status).toBe(403);

    const token = createCsrfToken();
    const valid = response();
    let continued = false;
    csrfMiddleware(request({ headers: { cookie: `l4ckos_staging_session=session; ${CSRF_COOKIE_NAME}=${token}`, [CSRF_HEADER_NAME]: token } }), valid.res, () => { continued = true; });
    expect(continued).toBe(true);
    expect(valid.state.status).toBeUndefined();
  });

  it("uses the custom session cookie name and excludes only the Asaas webhook", () => {
    Object.assign(process.env, { JWT_SECRET: "x".repeat(32), SESSION_COOKIE_NAME: "l4ckos_staging_session" });
    expect(shouldRequireCsrf(request({ headers: { cookie: "app_session_id=session" } }))).toBe(false);
    expect(shouldRequireCsrf(request({ headers: { cookie: "l4ckos_staging_session=session" } }))).toBe(true);
    expect(isAsaasWebhookPath("/api/webhooks/asaas")).toBe(true);
    expect(isAsaasWebhookPath("/api/webhooks/other")).toBe(false);
    expect(shouldRequireCsrf(request({ path: "/api/webhooks/asaas", headers: { cookie: "l4ckos_staging_session=session" } }))).toBe(false);
  });

  it("does not require CSRF for public GET requests", () => {
    Object.assign(process.env, { JWT_SECRET: "x".repeat(32), SESSION_COOKIE_NAME: "l4ckos_staging_session" });
    expect(shouldRequireCsrf(request({ method: "GET", headers: { cookie: "l4ckos_staging_session=session" } }))).toBe(false);
  });

  it("keeps a production origin outside the staging origin gate", () => {
    Object.assign(process.env, { APP_ENV: "staging", CORS_ORIGINS: "https://staging.l4ckos.com.br" });
    expect(isOriginAllowed("https://staging.l4ckos.com.br")).toBe(true);
    expect(isOriginAllowed("https://l4ckos.com.br")).toBe(false);
  });
});
