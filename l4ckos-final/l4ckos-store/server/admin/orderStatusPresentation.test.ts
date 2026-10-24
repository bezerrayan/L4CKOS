import { describe, expect, it } from "vitest";
import { getOrderLogisticsAccent, getPaymentStatusAccent, orderLogisticsAccents, paymentStatusAccents } from "../../client/src/lib/orderStatusPresentation";

describe("admin order status presentation", () => {
  it("keeps the requested logistics status palette centralized", () => {
    expect(orderLogisticsAccents).toEqual({
      pending: "#F59E0B",
      paid: "#A855F7",
      processing: "#0EA5E9",
      shipped: "#6366F1",
      delivered: "#16A34A",
      cancelled: "#EF4444",
    });
    expect(getOrderLogisticsAccent("unknown")).toBe("#A3A3A3");
  });

  it("keeps payment colors separate from logistics colors", () => {
    expect(paymentStatusAccents).toEqual({ confirmed: "#16A34A", pending: "#F59E0B" });
    expect(getPaymentStatusAccent("confirmed")).toBe(paymentStatusAccents.confirmed);
    expect(getPaymentStatusAccent("unconfirmed")).toBe(paymentStatusAccents.pending);
  });
});
