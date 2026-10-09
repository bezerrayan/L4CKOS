import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";

// Real router, password hashing and JWT verification; persistence and delivery
// are isolated adapters. Transactional reset persistence has separate MySQL tests.
const fixture = vi.hoisted(() => ({ user: null as any, credential: null as any }));
vi.mock("./db", async importOriginal => ({
  ...await importOriginal<typeof import("./db")>(),
  getUserByOpenId: vi.fn(async (id: string) => fixture.user?.openId === id ? fixture.user : undefined),
  getUserById: vi.fn(async (id: number) => fixture.user?.id === id ? fixture.user : undefined),
  getLocalAuthCredentialByEmail: vi.fn(async (email: string) => fixture.credential?.email === email ? fixture.credential : undefined),
  upsertUser: vi.fn(async (input: any) => {
    fixture.user = { id: 9001, role: "user", sessionVersion: 1, isBlocked: 0, ...fixture.user, ...input };
  }),
  upsertLocalAuthCredential: vi.fn(async (input: any) => { fixture.credential = input; }),
  rotateUserSessionVersion: vi.fn(async () => ++fixture.user.sessionVersion),
}));
vi.mock("./services/emailService.js", () => ({ sendWelcomeAccountEmail: vi.fn(), sendPasswordResetEmail: vi.fn() }));

let appRouter: typeof import("./routers").appRouter;
let sdk: typeof import("./_core/sdk").sdk;
let env: typeof import("./_core/env").ENV;
const password = "Synthetic-Password-42!";
const email = "release-fixture@example.invalid";
function context(user: any = null) {
  return {
    user,
    req: { protocol: "https", ip: "127.0.0.1", headers: {} },
    res: { cookie: vi.fn(), clearCookie: vi.fn() },
  } as unknown as TrpcContext;
}
function cookie(ctx: TrpcContext) {
  return vi.mocked(ctx.res.cookie).mock.calls.at(-1)![1] as string;
}
function request(token: string) {
  return { headers: { cookie: `${COOKIE_NAME}=${token}` } } as TrpcContext["req"];
}
beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("JWT_SECRET", "synthetic-release-secret-with-at-least-32-characters");
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("ADMIN_EMAILS", "release-operator@example.invalid");
  ({ appRouter } = await import("./routers"));
  ({ sdk } = await import("./_core/sdk"));
  ({ ENV: env } = await import("./_core/env"));
});
beforeEach(() => {
  fixture.user = null;
  fixture.credential = null;
  vi.clearAllMocks();
});
afterAll(() => vi.unstubAllEnvs());
describe("release public authentication (isolated adapters)", () => {
  it("registers an ordinary user with a hashed password and secure cookie; rejects duplicates", async () => {
    const ctx = context(), caller = appRouter.createCaller(ctx);
    const result = await caller.auth.localSignup({ name: "Release Fixture", email, password });
    expect(result.user?.role).toBe("user");
    expect(fixture.credential.passwordHash).not.toBe(password);
    expect(await bcrypt.compare(password, fixture.credential.passwordHash)).toBe(true);
    expect(ctx.res.cookie).toHaveBeenCalledWith(COOKIE_NAME, expect.any(String), expect.objectContaining({ secure: true, httpOnly: true, sameSite: "lax", path: "/" }));
    expect((await sdk.authenticateRequest(request(cookie(ctx)))).id).toBe(9001);
    await expect(caller.auth.localSignup({ name: "Release Fixture", email, password })).rejects.toThrow("Já existe");
  });
  it("login rotates the session and logout revokes the issued JWT", async () => {
    const ctx = context(), caller = appRouter.createCaller(ctx);
    await caller.auth.localSignup({ name: "Release Fixture", email, password });
    const original = cookie(ctx);
    await caller.auth.localLogin({ email, password });
    const loggedIn = cookie(ctx);
    await expect(sdk.authenticateRequest(request(original))).rejects.toThrow();
    await expect(sdk.authenticateRequest(request(loggedIn))).resolves.toMatchObject({ id: 9001 });
    const signed = context(fixture.user);
    await appRouter.createCaller(signed).auth.logout();
    expect(signed.res.clearCookie).toHaveBeenCalledWith(COOKIE_NAME, expect.objectContaining({ maxAge: -1 }));
    await expect(sdk.authenticateRequest(request(loggedIn))).rejects.toThrow();
  });
  it("rejects wrong passwords and blocked accounts without issuing another cookie", async () => {
    const ctx = context(), caller = appRouter.createCaller(ctx);
    await caller.auth.localSignup({ name: "Release Fixture", email, password });
    vi.mocked(ctx.res.cookie).mockClear();
    await expect(caller.auth.localLogin({ email, password: "Wrong-Password-42!" })).rejects.toThrow("E-mail ou senha inválidos");
    fixture.user.isBlocked = 1;
    await expect(caller.auth.localLogin({ email, password })).rejects.toThrow("bloqueada");
    expect(ctx.res.cookie).not.toHaveBeenCalled();
  });
  it("keeps production public signup disabled unless explicitly configured", async () => {
    const saved = { isProduction: env.isProduction, allowLocalAuthInProduction: env.allowLocalAuthInProduction, allowPublicLocalSignupInProduction: env.allowPublicLocalSignupInProduction };
    try {
      Object.assign(env, { isProduction: true, allowLocalAuthInProduction: false, allowPublicLocalSignupInProduction: false });
      const caller = appRouter.createCaller(context());
      await expect(caller.auth.localSignup({ name: "Release Fixture", email, password })).rejects.toThrow("desativado");
      await expect(caller.auth.localLogin({ email, password })).rejects.toThrow("desativado");
      expect(fixture.user).toBeNull();
    } finally { Object.assign(env, saved); }
  });
  it("does not reveal whether an unknown account exists in password recovery", async () => {
    const result = await appRouter.createCaller(context()).auth.requestPasswordReset({ email });
    expect(result.success).toBe(true);
    expect(result.message).toContain("Se existir");
    const delivery = await import("./services/emailService.js");
    expect(delivery.sendPasswordResetEmail).not.toHaveBeenCalled();
  });
});
