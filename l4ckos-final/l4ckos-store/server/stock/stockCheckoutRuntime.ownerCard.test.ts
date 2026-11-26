import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "mysql2/promise";

const captured = vi.hoisted(() => ({ calls: [] as Array<Record<string, any>> }));
vi.mock("./stockCheckout", async importOriginal => {
  const actual = await importOriginal<typeof import("./stockCheckout")>();
  return { ...actual, createStockCheckout: vi.fn(async (input: Record<string, any>) => { captured.calls.push(input); return { orderId: "o", paymentId: "p", checkoutUrl: null, amountCents: 1000, snapshots: [], replayed: false }; }) };
});
import { createStockCheckoutRuntime } from "./stockCheckoutRuntime";

const ATTEMPT = "owner-card-single-attempt-20261126-001";
const OWNER = { id: 71, openId: "owner-open-id", role: "admin" };
const ENV: Record<string, string> = {
  NODE_ENV: "production", APP_ENV: "production",
  RAILWAY_PROJECT_ID: "5937dcf3-18ae-4df8-83f0-5bb60ec9b8db",
  RAILWAY_ENVIRONMENT_ID: "7d065409-7cc2-44ba-9fff-5524653b0484",
  RAILWAY_SERVICE_ID: "743f3f4e-af1b-44f7-95c8-bb152e3c2f4b",
  PUBLIC_SITE_MODE: "coming-soon", PUBLIC_CHECKOUT_ENABLED: "false", STOCK_CHECKOUT_ENABLED: "false", STOCK_RUNTIME_ENABLED: "true",
  OWNER_OPEN_ID: "owner-open-id", OWNER_PIX_TEST_ENABLED: "true", OWNER_PIX_TEST_ATTEMPT_ID: ATTEMPT,
  OWNER_PIX_TEST_MAX_AMOUNT_CENTS: "1000",
};
const body = { attemptId: "client-controlled-attempt-0001", items: [{ productId: 1, variantId: 1, quantity: 1 }], paymentMethod: "CARD" };

function runtime(cardCheckoutEnabled?: boolean) {
  return createStockCheckoutRuntime({
    pool: {} as unknown as Pool,
    provider: { supportsIdempotencyKey: true, createPayment: vi.fn() },
    checkoutEnabled: false,
    ...(cardCheckoutEnabled === undefined ? {} : { cardCheckoutEnabled }),
  });
}
function env(overrides: Record<string, string | undefined> = {}) {
  for (const [k, v] of Object.entries({ OWNER_PIX_TEST_EXPIRES_AT: new Date(Date.now() + 5 * 60_000).toISOString(), ...ENV, ...overrides })) vi.stubEnv(k, v ?? "");
}

describe("owner window with hosted card", () => {
  afterEach(() => { vi.unstubAllEnvs(); captured.calls.length = 0; });

  it("passes the independent card switch, the amount ceiling and the server attempt id to the domain", async () => {
    env();
    await runtime(true).checkoutOwnerPixTest(body, OWNER);
    expect(captured.calls[0]).toMatchObject({ enabled: true, ownerUserId: 71, maximumAmountCents: 1000, cardCheckoutEnabled: true });
    expect(captured.calls[0].request.attemptId).toBe(ATTEMPT);
  });

  it.each([undefined, false] as const)("keeps the switch closed inside the window when the runtime switch is %s", async flag => {
    env();
    await runtime(flag).checkoutOwnerPixTest(body, OWNER);
    expect(captured.calls[0].cardCheckoutEnabled).toBe(false);
  });

  it.each([
    ["a different account", { id: 72, openId: "other", role: "admin" }, {}],
    ["a non-admin owner openId", { id: 71, openId: "owner-open-id", role: "user" }, {}],
    ["an expired window", OWNER, { OWNER_PIX_TEST_EXPIRES_AT: new Date(Date.now() - 1000).toISOString() }],
    ["a window longer than 15 minutes", OWNER, { OWNER_PIX_TEST_EXPIRES_AT: new Date(Date.now() + 16 * 60_000).toISOString() }],
    ["a disabled window", OWNER, { OWNER_PIX_TEST_ENABLED: "false" }],
    ["an opened public checkout", OWNER, { PUBLIC_CHECKOUT_ENABLED: "true" }],
    ["an opened stock checkout", OWNER, { STOCK_CHECKOUT_ENABLED: "true" }],
    ["a site that is no longer coming-soon", OWNER, { PUBLIC_SITE_MODE: "open" }],
    ["a missing amount ceiling", OWNER, { OWNER_PIX_TEST_MAX_AMOUNT_CENTS: "" }],
    ["an invalid attempt id", OWNER, { OWNER_PIX_TEST_ATTEMPT_ID: "short" }],
    ["another Railway service", OWNER, { RAILWAY_SERVICE_ID: "00000000-0000-0000-0000-000000000000" }],
  ] as const)("never reaches the domain for %s", async (_name, actor, overrides) => {
    env(overrides as Record<string, string>);
    expect(() => runtime(true).checkoutOwnerPixTest(body, actor as any)).toThrowError(expect.objectContaining({ code: "PUBLIC_CHECKOUT_DISABLED" }));
    expect(captured.calls).toHaveLength(0);
  });

  it("does not make the public path accept cards: the public gate stays closed and the owner window is not used", async () => {
    env();
    await runtime(true).checkout(body, 71);
    expect(captured.calls[0]).toMatchObject({ enabled: false });
    expect(captured.calls[0].maximumAmountCents).toBeUndefined();
  });
});
