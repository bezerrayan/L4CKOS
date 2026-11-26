import { afterEach, describe, expect, it, vi } from "vitest";
import { stockCheckoutRouter } from "./stockCheckout";
import { StockCheckoutError } from "../stock/stockCheckout";

const address = { recipient: "Comprador Teste", zipCode: "70000000", street: "Rua Teste", number: "1", neighborhood: "Centro", city: "Brasília", state: "DF" };
const input = { attemptId: "router-card-flag-attempt-0001", paymentMethod: "CARD", items: [{ productId: 4, variantId: 8, quantity: 1 }], delivery: { optionId: "local-plano-piloto", address } };

describe("STOCK router: card switch is closed with an explicit, non-leaky error", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("maps CHECKOUT_CARD_DISABLED to FORBIDDEN / CARD_CHECKOUT_DISABLED and keeps PIX untouched", async () => {
    vi.stubEnv("PUBLIC_SITE_MODE", "store");
    vi.stubEnv("PUBLIC_CHECKOUT_ENABLED", "true");
    const checkout = vi.fn(async (request: { paymentMethod?: string }) => {
      if (request.paymentMethod === "CARD") throw new StockCheckoutError("CHECKOUT_CARD_DISABLED");
      return { orderId: "o1", paymentId: "p1", checkoutUrl: "https://pay.invalid/x", amountCents: 1000, snapshots: [], replayed: false };
    });
    const caller = stockCheckoutRouter.createCaller({ user: { id: 5, openId: "buyer", role: "user" }, req: {}, res: {}, stockCheckoutRuntime: { checkout } } as any);
    const rejected = await caller.create(input as any).catch(error => error);
    expect(rejected).toMatchObject({ code: "FORBIDDEN" });
    expect((rejected as { appCode?: string }).appCode).toBe("CARD_CHECKOUT_DISABLED");
    expect(String(rejected.message)).not.toMatch(/CHECKOUT_CARD_DISABLED|STOCK_/);
    await expect(caller.create({ ...input, paymentMethod: "PIX" } as any)).resolves.toMatchObject({ orderId: "o1" });
  });
});
