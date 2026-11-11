import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";

const dbMocks = vi.hoisted(() => ({
  getUserByOpenIdForAuthentication: vi.fn(),
  upsertUser: vi.fn(),
}));

vi.mock("../db", () => dbMocks);

let createContext: typeof import("./context")["createContext"];
let sdk: typeof import("./sdk")["sdk"];
let getPublicAppError: typeof import("./appErrors")["getPublicAppError"];
const previousEnv = {
  jwtSecret: process.env.JWT_SECRET,
  jwtIssuer: process.env.JWT_ISSUER,
  jwtAudience: process.env.JWT_AUDIENCE,
};

beforeAll(async () => {
  vi.stubEnv("JWT_SECRET", "synthetic-context-test-secret-at-least-32-chars");
  vi.stubEnv("JWT_ISSUER", "context-test");
  vi.stubEnv("JWT_AUDIENCE", "context-test-client");
  ({ createContext } = await import("./context"));
  ({ sdk } = await import("./sdk"));
  ({ getPublicAppError } = await import("./appErrors"));
});

afterAll(() => {
  for (const [key, value] of Object.entries({
    JWT_SECRET: previousEnv.jwtSecret,
    JWT_ISSUER: previousEnv.jwtIssuer,
    JWT_AUDIENCE: previousEnv.jwtAudience,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function options(cookie?: string) {
  return {
    req: { headers: cookie ? { cookie } : {} },
    res: {},
  } as any;
}

describe("authentication context database availability", () => {
  it("keeps missing credentials unauthenticated instead of reporting database availability", async () => {
    const ctx = await createContext(options());
    expect(ctx.user).toBeNull();
    const { router, protectedProcedure } = await import("./trpc");
    const protectedRouter = router({ me: protectedProcedure.query(({ ctx: protectedCtx }) => protectedCtx.user.id) });
    await expect(protectedRouter.createCaller(ctx).me()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("returns sanitized 503 for a valid session when its database lookup is unavailable", async () => {
    const token = await sdk.createSessionToken("synthetic-user", { expiresInMs: 60_000 });
    dbMocks.getUserByOpenIdForAuthentication.mockRejectedValueOnce(new Error("ECONNREFUSED private-db-secret-host"));

    await expect(createContext(options(`app_session_id=${token}`))).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      message: "Autenticação temporariamente indisponível.",
    });
    const publicError = getPublicAppError(new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Autenticação temporariamente indisponível." }));
    expect(publicError).toMatchObject({ status: 503, message: "Serviço temporariamente indisponível." });
    expect(JSON.stringify(publicError)).not.toContain("private-db-secret-host");
  });
});
