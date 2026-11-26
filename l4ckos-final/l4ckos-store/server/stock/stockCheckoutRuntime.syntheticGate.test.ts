import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "mysql2/promise";

const admission = vi.hoisted(() => ({ allow: false }));
vi.mock("../_core/publicStore", async importOriginal => {
  const actual = await importOriginal<typeof import("../_core/publicStore")>();
  return {
    ...actual,
    assertPublicOrSyntheticSandboxCheckoutEnabled: (userId?: number) => {
      if (!admission.allow || userId !== 2) throw new actual.PublicCheckoutDisabledError();
    },
  };
});
import { createStockCheckoutRuntime } from "./stockCheckoutRuntime";

describe("STOCK checkout runtime synthetic sandbox admission", () => {
  afterEach(() => { vi.unstubAllEnvs(); admission.allow = false; });
  const request = { attemptId: "stock-runtime-synthetic-01", items: [{ productId: 1, variantId: 1, quantity: 1 }] };
  function runtime(getConnection: () => never) {
    vi.stubEnv("PUBLIC_SITE_MODE", "coming-soon");
    vi.stubEnv("PUBLIC_CHECKOUT_ENABLED", "false");
    return createStockCheckoutRuntime({
      pool: { getConnection } as unknown as Pool,
      provider: { supportsIdempotencyKey: true, createPayment: vi.fn() },
      checkoutEnabled: true,
    });
  }

  it("reaches the domain for the admitted synthetic buyer while public checkout stays closed", async () => {
    admission.allow = true;
    const getConnection = vi.fn((): never => { throw new Error("reached database"); });
    await expect(runtime(getConnection).checkout(request, 2)).rejects.not.toMatchObject({ code: "PUBLIC_CHECKOUT_DISABLED" });
    expect(getConnection).toHaveBeenCalled();
  });

  it("stays closed for any other buyer or when the sandbox phase is not admitted", async () => {
    const getConnection = vi.fn((): never => { throw new Error("database IO must not occur"); });
    admission.allow = true;
    await expect(runtime(getConnection).checkout(request, 3)).rejects.toMatchObject({ code: "PUBLIC_CHECKOUT_DISABLED" });
    admission.allow = false;
    await expect(runtime(getConnection).checkout(request, 2)).rejects.toMatchObject({ code: "PUBLIC_CHECKOUT_DISABLED" });
    expect(getConnection).not.toHaveBeenCalled();
  });
});
