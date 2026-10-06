import { describe, it, expect, vi, afterEach } from "vitest";
import { registerOAuthRoutes, validateOAuthReturnTo } from "./oauth";
vi.mock("./env", () => ({ ENV: { frontendUrl: "https://frontend.example", isProduction: true, googleClientId: "synthetic-client", googleClientSecret: "synthetic-secret", googleRedirectUri: "https://api.example/api/oauth/callback", adminEmails: [], sessionTtlMs: 1000 } }));
vi.mock("../db", () => ({ getUserByOpenId: vi.fn(async () => ({ id: 1 })), upsertUser: vi.fn(), rotateUserSessionVersion: vi.fn(async () => 2) }));
vi.mock("./sdk", () => ({ sdk: { createSessionToken: vi.fn(async () => "synthetic-session") } }));
vi.mock("../services/emailService.js", () => ({ sendWelcomeAccountEmail: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());
const base = "https://frontend.example";
const rejected = ["/a/..//evil.invalid", "/a/%2e%2e//evil.invalid", "//evil.invalid", "\\\\evil.invalid", "/\\evil.invalid", "https://evil.invalid", "http://frontend.example/", "//user@evil.invalid", "https://frontend.example@evil.invalid/", "/%2f%2fevil.invalid", "/%5cevil.invalid", "/%0d%0aevil", " /gestao", "/\nevil"];
function routes() { const map = new Map<string, any>(); registerOAuthRoutes({ get: (path: string, cb: any) => map.set(path, cb) } as any); return map; }
function res() { return { cookie: vi.fn(), clearCookie: vi.fn(), redirect: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() }; }
function req(query: any, cookie?: string) { return { query, headers: { cookie }, protocol: "https", get: () => "api.example" }; }
describe("OAuth same-origin returnTo", () => {
  it.each(["/gestao", "/", "/path?x=1#y"])("preserves %s", path => expect(validateOAuthReturnTo(path, base)).toBe(path));
  it.each(rejected)("rejects %s", path => expect(validateOAuthReturnTo(path, base)).toBeNull());
  it("keeps nonce/state and sanitizes returnTo at login", async () => {
    for (const path of ["/gestao", ...rejected]) {
      const r = res(); await routes().get("/api/oauth/login")(req({ returnTo: path }), r);
      const state = new URL(r.redirect.mock.calls[0][1]).searchParams.get("state")!;
      const payload = JSON.parse(Buffer.from(state, "base64url").toString());
      expect(payload.returnTo).toBe(path === "/gestao" ? path : "/"); expect(payload.nonce).toMatch(/^[a-f0-9]{32}$/);
      expect(r.cookie.mock.calls[0][1]).toBe(state); expect(r.cookie.mock.calls[0][2].httpOnly).toBe(true);
    }
  });
  it("rejects mismatched state before provider calls", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); const r = res();
    await routes().get("/api/oauth/callback")(req({ code: "synthetic", state: "wrong" }, "oauth_state=expected"), r);
    expect(r.status).toHaveBeenCalledWith(400); expect(fetch).not.toHaveBeenCalled();
  });
  it("revalidates callback state without changing session flow", async () => {
    for (const path of ["/path?x=1#y", ...rejected]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "synthetic-access" }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ sub: "synthetic-user", email_verified: true }) }));
      const state = Buffer.from(JSON.stringify({ returnTo: path, nonce: "synthetic-nonce" })).toString("base64url"); const r = res();
      await routes().get("/api/oauth/callback")(req({ code: "synthetic", state }, `oauth_state=${state}`), r);
      expect(r.redirect).toHaveBeenCalledWith(302, `${base}${path === "/path?x=1#y" ? path : "/"}`);
      expect(r.clearCookie).toHaveBeenCalledWith("oauth_state", expect.any(Object)); expect(r.cookie).toHaveBeenCalled();
    }
  });
});
