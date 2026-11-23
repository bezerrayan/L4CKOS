import { afterEach, describe, expect, it, vi } from "vitest";
import { stockCheckoutRouter } from "./stockCheckout";
import { StockCheckoutError } from "../stock/stockCheckout";

const ATTEMPT = "owner-pix-single-attempt-20261119-001";
const OWNER = { id: 71, openId: "owner-open-id", role: "admin" };
const OWNER_ENV = {
  NODE_ENV: "production",
  APP_ENV: "production",
  RAILWAY_PROJECT_ID: "5937dcf3-18ae-4df8-83f0-5bb60ec9b8db",
  RAILWAY_ENVIRONMENT_ID: "7d065409-7cc2-44ba-9fff-5524653b0484",
  RAILWAY_SERVICE_ID: "743f3f4e-af1b-44f7-95c8-bb152e3c2f4b",
  PUBLIC_SITE_MODE: "coming-soon",
  PUBLIC_CHECKOUT_ENABLED: "false",
  STOCK_CHECKOUT_ENABLED: "false",
  STOCK_RUNTIME_ENABLED: "true",
  OWNER_OPEN_ID: "owner-open-id",
  OWNER_PIX_TEST_ENABLED: "true",
  OWNER_PIX_TEST_ATTEMPT_ID: ATTEMPT,
  OWNER_PIX_TEST_EXPIRES_AT: new Date(Date.now() + 5 * 60_000).toISOString(),
  OWNER_PIX_TEST_MAX_AMOUNT_CENTS: "1000",
};
const address = { recipient: "Proprietário L4CKOS", zipCode: "70000000", street: "Rua Teste", number: "1", neighborhood: "Centro", city: "Brasília", state: "DF" };
const checkoutInput = { attemptId: "client-controlled-attempt-0001", items: [{ productId: 4, variantId: 8, quantity: 1 }], delivery: { optionId: "local-plano-piloto", address } };

function setup(user: typeof OWNER | { id: number; openId: string; role: string }, overrides: Record<string, string | undefined> = {}) {
  for (const [key, value] of Object.entries({ ...OWNER_ENV, ...overrides })) vi.stubEnv(key, value ?? "");
  const runtime = {
    quoteShipping: vi.fn(async () => [{ optionId: "quote" }]),
    checkout: vi.fn(async () => ({ orderId: "public-order", paymentId: "public-payment", checkoutUrl: "https://pay.invalid/public", amountCents: 10000, snapshots: [], replayed: false })),
    checkoutOwnerPixTest: vi.fn(async () => ({ orderId: "owner-order", paymentId: "owner-payment", checkoutUrl: "https://pay.invalid/owner", amountCents: 1000, snapshots: [], replayed: false })),
    resume: vi.fn(async (_ownerId: number, attemptId: string) => ({ attemptId, orderId: "owner-order", status: "pending", paymentId: "owner-payment", checkoutUrl: "https://pay.invalid/owner", amountCents: 1000, reservationExpiresAt: new Date(Date.now() + 60_000).toISOString(), canStartNewAttempt: false })),
    resumeLatest: vi.fn(async () => null),
  };
  const caller = stockCheckoutRouter.createCaller({ user: user as any, req: {} as any, res: {} as any, stockCheckoutRuntime: runtime as any } as any);
  return { caller, runtime };
}

describe("STOCK routes keep public checkout closed during the owner PIX test", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses only the server-configured attempt id for owner checkout and allows the matching freight quote", async () => {
    const { caller, runtime } = setup(OWNER);
    await expect(caller.quoteShipping({ items: [{ productId: 4, variantId: 8, quantity: 1 }], address })).resolves.toEqual([{ optionId: "quote" }]);
    const created = await caller.create(checkoutInput as any);
    expect(created.attemptId).toBe(ATTEMPT);
    expect(runtime.checkoutOwnerPixTest).toHaveBeenCalledWith({ ...checkoutInput, attemptId: ATTEMPT }, expect.objectContaining(OWNER));
    expect(runtime.checkout).not.toHaveBeenCalled();
  });

  it("rejects non-owner and different-account attempts before runtime calls", async () => {
    const { caller, runtime } = setup({ id: 72, openId: "other-user", role: "admin" });
    await expect(caller.create(checkoutInput as any)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.quoteShipping({ items: [{ productId: 4, variantId: 8, quantity: 1 }], address })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.resume({ attemptId: ATTEMPT })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.resumeLatest()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(runtime.checkoutOwnerPixTest).not.toHaveBeenCalled();
    expect(runtime.checkout).not.toHaveBeenCalled();
    expect(runtime.quoteShipping).not.toHaveBeenCalled();
    expect(runtime.resume).not.toHaveBeenCalled();
    expect(runtime.resumeLatest).not.toHaveBeenCalled();
  });

  it("requires the configured owner to have the admin role", async () => {
    const { caller, runtime } = setup({ id: OWNER.id, openId: OWNER.openId, role: "customer" });
    await expect(caller.resumeLatest()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(runtime.resume).not.toHaveBeenCalled();
    expect(runtime.resumeLatest).not.toHaveBeenCalled();
  });

  it("resumes only the configured owner attempt while public checkout remains closed", async () => {
    const { caller, runtime } = setup(OWNER);
    await expect(caller.resume({ attemptId: ATTEMPT })).resolves.toMatchObject({ attemptId: ATTEMPT, checkoutUrl: "https://pay.invalid/owner" });
    // Browser IDs are ignored under the closed-store owner read gate; only the server-configured ID reaches storage.
    await expect(caller.resume({ attemptId: "some-other-attempt-00000001" })).resolves.toMatchObject({ attemptId: ATTEMPT, checkoutUrl: "https://pay.invalid/owner" });
    const items = [{ productId: 4, variantId: 8, quantity: 1 }];
    await expect(caller.resume({ attemptId: "browser-local-attempt-00000001", items })).resolves.toMatchObject({ attemptId: ATTEMPT, checkoutUrl: "https://pay.invalid/owner" });
    await expect(caller.resumeLatest()).resolves.toMatchObject({ attemptId: ATTEMPT, checkoutUrl: "https://pay.invalid/owner" });
    await expect(caller.resumeLatest({ items })).resolves.toMatchObject({ attemptId: ATTEMPT, checkoutUrl: "https://pay.invalid/owner" });
    expect(runtime.resume).toHaveBeenNthCalledWith(1, OWNER.id, ATTEMPT);
    expect(runtime.resume).toHaveBeenNthCalledWith(2, OWNER.id, ATTEMPT);
    expect(runtime.resume).toHaveBeenNthCalledWith(3, OWNER.id, ATTEMPT, items);
    expect(runtime.resume).toHaveBeenNthCalledWith(4, OWNER.id, ATTEMPT);
    expect(runtime.resume).toHaveBeenNthCalledWith(5, OWNER.id, ATTEMPT, items);
    expect(runtime.resumeLatest).not.toHaveBeenCalled();
  });

  it("returns no owner attempt when the configured attempt has not been created", async () => {
    const { caller, runtime } = setup(OWNER);
    runtime.resume.mockRejectedValueOnce(new StockCheckoutError("CHECKOUT_ATTEMPT_NOT_FOUND"));
    await expect(caller.resumeLatest()).resolves.toBeNull();
    expect(runtime.resume).toHaveBeenCalledWith(OWNER.id, ATTEMPT);
    expect(runtime.resumeLatest).not.toHaveBeenCalled();
  });

  it("uses the ordinary latest-attempt lookup only when public checkout is open", async () => {
    const { caller, runtime } = setup(OWNER, {
      PUBLIC_SITE_MODE: "store",
      PUBLIC_CHECKOUT_ENABLED: "true",
      STOCK_CHECKOUT_ENABLED: "true",
    });
    await expect(caller.resumeLatest()).resolves.toBeNull();
    expect(runtime.resumeLatest).toHaveBeenCalledWith(OWNER.id);
    expect(runtime.resume).not.toHaveBeenCalled();
  });

  it("keeps read-only owner recovery available after the create authorization expires", async () => {
    const { caller, runtime } = setup(OWNER, { OWNER_PIX_TEST_EXPIRES_AT: new Date(Date.now() - 1000).toISOString() });
    await expect(caller.create(checkoutInput as any)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.resume({ attemptId: "client-controlled-attempt-0001" })).resolves.toMatchObject({ attemptId: ATTEMPT });
    await expect(caller.resumeLatest()).resolves.toMatchObject({ attemptId: ATTEMPT });
    expect(runtime.resume).toHaveBeenCalledTimes(2);
    expect(runtime.resumeLatest).not.toHaveBeenCalled();
    expect(runtime.checkoutOwnerPixTest).not.toHaveBeenCalled();
  });

  it("keeps read-only owner recovery independent of the create amount limit", async () => {
    const { caller, runtime } = setup(OWNER, { OWNER_PIX_TEST_MAX_AMOUNT_CENTS: "0" });
    await expect(caller.create(checkoutInput as any)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.resumeLatest()).resolves.toMatchObject({ attemptId: ATTEMPT });
    expect(runtime.resume).toHaveBeenCalledWith(OWNER.id, ATTEMPT);
    expect(runtime.resumeLatest).not.toHaveBeenCalled();
    expect(runtime.checkoutOwnerPixTest).not.toHaveBeenCalled();
  });

  it("allows exact owner read recovery when the temporary PIX gate is disabled, without opening checkout", async () => {
    const { caller, runtime } = setup(OWNER, { OWNER_PIX_TEST_ENABLED: "false" });
    await expect(caller.create(checkoutInput as any)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.resume({ attemptId: "browser-local-attempt-00000001" })).resolves.toMatchObject({ attemptId: ATTEMPT });
    await expect(caller.resumeLatest()).resolves.toMatchObject({ attemptId: ATTEMPT });
    expect(runtime.resume).toHaveBeenCalledTimes(2);
    expect(runtime.resumeLatest).not.toHaveBeenCalled();
    expect(runtime.checkoutOwnerPixTest).not.toHaveBeenCalled();
  });

  it("keeps the owner exception unavailable if any public or runtime checkout flag is enabled", async () => {
    const { caller, runtime } = setup(OWNER, { STOCK_CHECKOUT_ENABLED: "true" });
    await expect(caller.create(checkoutInput as any)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(runtime.checkoutOwnerPixTest).not.toHaveBeenCalled();
  });
});
