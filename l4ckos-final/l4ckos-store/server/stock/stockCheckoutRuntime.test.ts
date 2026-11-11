import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "mysql2/promise";
import { createStockCheckoutRuntime } from "./stockCheckoutRuntime";

describe("STOCK checkout runtime boundary", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps the public gate ahead of MySQL connection acquisition and provider IO", async () => {
    vi.stubEnv("PUBLIC_SITE_MODE", "coming-soon");
    vi.stubEnv("PUBLIC_CHECKOUT_ENABLED", "false");
    const getConnection = vi.fn(() => { throw new Error("database IO must not occur"); });
    const createPayment = vi.fn(async () => ({ paymentId: "never", checkoutUrl: "never" }));
    const runtime = createStockCheckoutRuntime({
      pool: { getConnection } as unknown as Pool,
      provider: { supportsIdempotencyKey: true, createPayment },
    });
    await expect(runtime.checkout({
      attemptId: "stock-runtime-gate-0001",
      items: [{ productId: 1, variantId: 1, size: "M", color: "Preto", quantity: 1 }],
    })).rejects.toMatchObject({ code: "PUBLIC_CHECKOUT_DISABLED" });
    expect(getConnection).not.toHaveBeenCalled();
    expect(createPayment).not.toHaveBeenCalled();
  });
});
