import { describe, expect, it } from "vitest";
import { describeStockAttempt, describeStockCheckoutError, isAttemptNotFound } from "./stockAttemptView";

describe("describeStockAttempt", () => {
  it("never presents a pending charge as approved", () => {
    const view = describeStockAttempt({ status: "pending", checkoutUrl: "https://pay.example/x" });
    expect(view.tone).toBe("pending");
    expect(view.title).toBe("Aguardando confirmação do pagamento");
    expect(view.title).not.toMatch(/aprovado|confirmado$/i);
    expect(view.canContinuePayment).toBe(true);
    expect(view.blocksCheckout).toBe(true);
  });

  it("hides the pay link when pending without a checkout url", () => {
    expect(describeStockAttempt({ status: "pending", checkoutUrl: null }).canContinuePayment).toBe(false);
  });

  it("only paid is success, and it stops polling actions", () => {
    const view = describeStockAttempt({ status: "paid" });
    expect(view.tone).toBe("success");
    expect(view.title).toBe("Pagamento aprovado");
    expect(view.canRefresh).toBe(false);
    expect(view.blocksCheckout).toBe(true);
  });

  it.each(["reserved", "creating", "pending", "ambiguous"] as const)("%s is not a success tone", status => {
    expect(describeStockAttempt({ status }).tone).not.toBe("success");
    expect(describeStockAttempt({ status }).blocksCheckout).toBe(true);
  });

  it("ambiguous warns against paying twice", () => {
    const view = describeStockAttempt({ status: "ambiguous", canStartNewAttempt: true });
    expect(view.message).toMatch(/não pague novamente/i);
    expect(view.canStartNewAttempt).toBe(false);
  });

  it.each(["failed", "expired", "cancelled"] as const)("%s allows a new attempt only when the server says so", status => {
    expect(describeStockAttempt({ status, canStartNewAttempt: true })).toMatchObject({ canStartNewAttempt: true, blocksCheckout: false });
    expect(describeStockAttempt({ status, canStartNewAttempt: false }).canStartNewAttempt).toBe(false);
    expect(describeStockAttempt({ status }).canStartNewAttempt).toBe(false);
  });

  it("expired without server release waits instead of offering retry", () => {
    expect(describeStockAttempt({ status: "expired", canStartNewAttempt: false }).message).toMatch(/atualize/i);
  });
});

describe("describeStockCheckoutError", () => {
  const trpc = (code: string, message: string) => ({ message, data: { code } });

  it("hides internal codes from the customer", () => {
    const view = describeStockCheckoutError(new Error("STOCK_VARIANT_NOT_AVAILABLE"));
    expect(view.message).not.toContain("STOCK_");
    expect(view.needsCartReview).toBe(true);
    expect(view.outcomeUnknown).toBe(false);
  });

  it("reports the closed gate calmly", () => {
    expect(describeStockCheckoutError(new Error("PUBLIC_CHECKOUT_DISABLED")).message).toMatch(/ainda não está disponível/);
  });

  const stable = (appCode: string, message = "texto que pode mudar") => ({ message, data: { code: "CONFLICT", appError: { code: appCode } } });

  it("maps STOCK_UNAVAILABLE by stable code to a cart review", () => {
    const view = describeStockCheckoutError(stable("STOCK_UNAVAILABLE"));
    expect(view).toMatchObject({ needsCartReview: true, outcomeUnknown: false });
    expect(view.message).toMatch(/indisponível/);
  });

  it("maps CHECKOUT_ATTEMPT_EXPIRED: definitive, not an unknown outcome", () => {
    expect(describeStockCheckoutError(stable("CHECKOUT_ATTEMPT_EXPIRED"))).toMatchObject({ outcomeUnknown: false, needsCartReview: true, message: expect.stringMatching(/expirou/) });
  });

  it("maps PAYMENT_UNDER_ANALYSIS and CHECKOUT_ATTEMPT_NOT_REUSABLE as unknown outcome", () => {
    expect(describeStockCheckoutError(stable("PAYMENT_UNDER_ANALYSIS")).outcomeUnknown).toBe(true);
    expect(describeStockCheckoutError(stable("CHECKOUT_ATTEMPT_NOT_REUSABLE")).outcomeUnknown).toBe(true);
  });

  it("never interprets message text: the same words without a code do not change the mapping", () => {
    // Misleading texts must not be read as stock/analysis; unknown CONFLICT stays "unknown outcome".
    const withText = describeStockCheckoutError({ message: "Estoque indisponível para esta variante.", data: { code: "CONFLICT" } });
    expect(withText.needsCartReview).toBe(false);
    expect(withText.outcomeUnknown).toBe(true);
    // And a stable code wins over a contradicting message.
    expect(describeStockCheckoutError(stable("STOCK_UNAVAILABLE", "O pagamento está em análise.")).outcomeUnknown).toBe(false);
  });

  it("keeps the cart when the server gate is closed and never marks the outcome unknown", () => {
    const view = describeStockCheckoutError(trpc("FORBIDDEN", "x"));
    expect(view.message).toMatch(/ainda não está liberada/);
    expect(view.outcomeUnknown).toBe(false);
  });

  it("keeps the attempt when the runtime is unavailable", () => {
    const view = describeStockCheckoutError(trpc("SERVICE_UNAVAILABLE", "x"));
    expect(view.message).toMatch(/tentativa foi mantida/);
    expect(view.outcomeUnknown).toBe(false);
  });

  it("detects NOT_FOUND on resume", () => {
    expect(isAttemptNotFound(trpc("NOT_FOUND", "x"))).toBe(true);
    expect(isAttemptNotFound(new Error("x"))).toBe(false);
  });

  it("asks to log in on UNAUTHORIZED", () => {
    expect(describeStockCheckoutError(trpc("UNAUTHORIZED", "x")).message).toMatch(/Entre novamente/);
  });

  it("treats network failures as ambiguous and never as a definitive failure", () => {
    for (const error of [new TypeError("Failed to fetch"), new Error("Load failed"), "boom", null]) {
      const view = describeStockCheckoutError(error);
      expect(view.outcomeUnknown).toBe(true);
      expect(view.message).toMatch(/consulte o status/i);
    }
  });
});
