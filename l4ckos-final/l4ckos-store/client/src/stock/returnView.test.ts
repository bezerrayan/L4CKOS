import { describe, expect, it } from "vitest";
import { describeReturnAttempt, RETURN_POLL_WINDOW_MS, shouldKeepPollingReturn } from "./returnView";
import type { StockAttemptResumeV1 } from "../../../shared/stockCheckoutV1";

const base: StockAttemptResumeV1 = {
  attemptId: "attempt-return-0000001", status: "pending", paymentMethod: "CARD", orderId: "42", paymentId: "pay_1",
  checkoutUrl: "https://sandbox.asaas.com/i/abc", amountCents: 3759, reservationExpiresAt: "2026-11-26T20:00:00.000Z", canStartNewAttempt: false,
};

describe("return page presentation", () => {
  it("coming back from the payment page never confirms the order: pending stays pending", () => {
    const view = describeReturnAttempt(base, 0);
    expect(view.tone).toBe("pending");
    expect(view.title).not.toMatch(/aprovado/i);
    expect(view.message).toMatch(/Voltar da página de pagamento não confirma o pedido/);
    expect(view.canContinuePayment).toBe(true);
  });

  it("only a server-reported paid attempt is shown as approved", () => {
    const paid = describeReturnAttempt({ ...base, status: "paid" }, 0);
    expect(paid.tone).toBe("success");
    expect(paid.title).toBe("Pagamento aprovado");
    expect(paid.orderPath).toBe("/meus-pedidos/42");
    for (const status of ["reserved", "creating", "pending", "ambiguous", "failed", "expired", "cancelled"] as const) {
      expect(describeReturnAttempt({ ...base, status }, 0).tone, status).not.toBe("success");
    }
  });

  it("builds the order link only from a numeric server order id", () => {
    expect(describeReturnAttempt({ ...base, orderId: "7" }, 0).orderPath).toBe("/meus-pedidos/7");
    expect(describeReturnAttempt({ ...base, orderId: "../admin" }, 0).orderPath).toBeNull();
    expect(describeReturnAttempt({ ...base, orderId: null }, 0).orderPath).toBeNull();
  });

  it("explains a payment that is still unconfirmed after the poll window, without inviting a second payment", () => {
    expect(describeReturnAttempt(base, RETURN_POLL_WINDOW_MS - 1).stillWaiting).toBe(false);
    expect(describeReturnAttempt(base, RETURN_POLL_WINDOW_MS).stillWaiting).toBe(true);
    expect(describeReturnAttempt({ ...base, status: "paid" }, RETURN_POLL_WINDOW_MS).stillWaiting).toBe(false);
  });

  it("an ambiguous result asks the customer not to pay again", () => {
    expect(describeReturnAttempt({ ...base, status: "ambiguous" }, 0).message).toMatch(/Não pague novamente/);
  });
});

describe("return polling policy", () => {
  it("polls while the payment is open and stops on terminal and ambiguous states or after the window", () => {
    expect(shouldKeepPollingReturn(undefined, 0)).toBe(true);
    for (const status of ["reserved", "creating", "pending"] as const) expect(shouldKeepPollingReturn(status, 1_000)).toBe(true);
    for (const status of ["paid", "failed", "expired", "cancelled", "ambiguous"] as const) expect(shouldKeepPollingReturn(status, 1_000), status).toBe(false);
    expect(shouldKeepPollingReturn("pending", RETURN_POLL_WINDOW_MS)).toBe(false);
  });
});
