import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveOwnerPixTestAuthorization, resolveOwnerPixTestReadAuthorization } from "./ownerPixTestGate";

const now = Date.parse("2026-11-19T12:00:00.000Z");
const env = () => ({
  NODE_ENV: "production",
  APP_ENV: "production",
  RAILWAY_PROJECT_ID: "5937dcf3-18ae-4df8-83f0-5bb60ec9b8db",
  RAILWAY_ENVIRONMENT_ID: "7d065409-7cc2-44ba-9fff-5524653b0484",
  RAILWAY_SERVICE_ID: "743f3f4e-af1b-44f7-95c8-bb152e3c2f4b",
  PUBLIC_SITE_MODE: "coming-soon",
  PUBLIC_CHECKOUT_ENABLED: "false",
  STOCK_CHECKOUT_ENABLED: "false",
  STOCK_RUNTIME_ENABLED: "true",
  OWNER_PIX_TEST_ENABLED: "true",
  OWNER_PIX_TEST_ATTEMPT_ID: "owner-pix-single-attempt-20261119-001",
  OWNER_PIX_TEST_EXPIRES_AT: "2026-11-19T12:10:00.000Z",
  OWNER_PIX_TEST_MAX_AMOUNT_CENTS: "25000",
  OWNER_OPEN_ID: "owner-open-id",
});
const owner = { id: 71, role: "admin", openId: "owner-open-id" };

describe("temporary owner PIX test admission", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("admits only the exact authenticated owner on the exact production service while public checkout stays closed", () => {
    expect(resolveOwnerPixTestAuthorization(owner, env(), now)).toEqual({
      attemptId: "owner-pix-single-attempt-20261119-001",
      maxAmountCents: 25000,
      expiresAtMs: Date.parse("2026-11-19T12:10:00.000Z"),
    });
  });

  it.each([
    ["disabled by default", { OWNER_PIX_TEST_ENABLED: "false" }],
    ["wrong project", { RAILWAY_PROJECT_ID: "wrong" }],
    ["wrong environment", { RAILWAY_ENVIRONMENT_ID: "wrong" }],
    ["wrong service", { RAILWAY_SERVICE_ID: "wrong" }],
    ["not production", { NODE_ENV: "test" }],
    ["checkout is open", { PUBLIC_CHECKOUT_ENABLED: "true" }],
    ["stock checkout flag is open", { STOCK_CHECKOUT_ENABLED: "true" }],
    ["no runtime", { STOCK_RUNTIME_ENABLED: "false" }],
    ["expired", { OWNER_PIX_TEST_EXPIRES_AT: "2026-11-19T11:59:59.000Z" }],
    ["invalid date", { OWNER_PIX_TEST_EXPIRES_AT: "2026-02-30T12:10:00.000Z" }],
    ["window exceeds fifteen minutes", { OWNER_PIX_TEST_EXPIRES_AT: "2026-11-19T12:16:00.000Z" }],
    ["attempt id is not high entropy length", { OWNER_PIX_TEST_ATTEMPT_ID: "short-attempt" }],
    ["invalid maximum", { OWNER_PIX_TEST_MAX_AMOUNT_CENTS: "0" }],
  ] as const)("fails closed: %s", (_case, overrides) => {
    expect(resolveOwnerPixTestAuthorization(owner, { ...env(), ...overrides }, now)).toBeNull();
  });

  it.each([
    ["different openId", { ...owner, openId: "other" }],
    ["regular user", { ...owner, role: "user" }],
  ])("rejects %s", (_case, actor) => {
    expect(resolveOwnerPixTestAuthorization(actor, env(), now)).toBeNull();
  });
});

describe("owner PIX read-only recovery authorization", () => {
  it("allows only the configured owner to read the pinned attempt after the create window closes", () => {
    expect(resolveOwnerPixTestReadAuthorization(owner, {
      ...env(),
      OWNER_PIX_TEST_ENABLED: "false",
      OWNER_PIX_TEST_EXPIRES_AT: "2026-11-19T11:59:00.000Z",
      OWNER_PIX_TEST_MAX_AMOUNT_CENTS: "invalid-for-create",
    })).toEqual({ attemptId: "owner-pix-single-attempt-20261119-001" });
  });

  it.each([
    ["wrong production service", { RAILWAY_SERVICE_ID: "wrong" }],
    ["public checkout open", { PUBLIC_CHECKOUT_ENABLED: "true" }],
    ["stock checkout open", { STOCK_CHECKOUT_ENABLED: "true" }],
    ["wrong site mode", { PUBLIC_SITE_MODE: "store" }],
    ["missing attempt", { OWNER_PIX_TEST_ATTEMPT_ID: "" }],
    ["wrong owner identity", { OWNER_OPEN_ID: "other-owner" }],
  ] as const)("fails closed for %s", (_case, overrides) => {
    expect(resolveOwnerPixTestReadAuthorization(owner, { ...env(), ...overrides })).toBeNull();
  });

  it.each([
    ["another admin", { ...owner, id: 72, openId: "other" }],
    ["a non-admin owner account", { ...owner, role: "user" }],
  ])("rejects %s", (_case, actor) => {
    expect(resolveOwnerPixTestReadAuthorization(actor, env())).toBeNull();
  });
});
