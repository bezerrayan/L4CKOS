import { describe, expect, it } from "vitest";
import { describeStockCheckoutError } from "./stockAttemptView";

describe("stable checkout app errors", () => {
  it.each([
    ["STOCK_UNAVAILABLE", false, true],
    ["CHECKOUT_ATTEMPT_EXPIRED", false, true],
    ["PAYMENT_UNDER_ANALYSIS", true, false],
  ])("maps %s without parsing message text", (code, outcomeUnknown, needsCartReview) => {
    const result = describeStockCheckoutError({
      message: "same generic message",
      data: { code: "CONFLICT", appError: { code } },
    });
    expect(result.outcomeUnknown).toBe(outcomeUnknown);
    expect(result.needsCartReview).toBe(needsCartReview);
  });
});
