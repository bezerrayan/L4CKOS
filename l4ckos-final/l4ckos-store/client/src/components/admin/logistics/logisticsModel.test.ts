import { describe, expect, it } from "vitest";
import { confirmedSizesBySize, isConfirmedPayment } from "./logisticsModel";

describe("logistics model", () => {
  it("only includes payments with trusted confirmation evidence", () => {
    expect(isConfirmedPayment({
      paymentStatus: "confirmed", paymentConfirmedAt: "2026-11-11T12:00:00.000Z",
      paymentConfirmationSource: "manual", paymentConfirmedBy: 7, status: "paid",
    })).toBe(true);
    expect(isConfirmedPayment({
      paymentStatus: "confirmed", paymentConfirmedAt: "2026-11-11T12:00:00.000Z",
      paymentConfirmationSource: "asaas_webhook", paymentConfirmationReference: "pay-123", status: "processing",
    })).toBe(true);
    expect(isConfirmedPayment({
      paymentStatus: "confirmed", paymentConfirmedAt: "2026-11-11T12:00:00.000Z",
      paymentConfirmationSource: "asaas_webhook", paymentConfirmationReference: " ", status: "paid",
    })).toBe(false);
    expect(isConfirmedPayment({ paymentStatus: "unconfirmed", status: "paid" })).toBe(false);
    expect(isConfirmedPayment({
      paymentStatus: "confirmed", paymentConfirmedAt: "2026-11-11T12:00:00.000Z",
      paymentConfirmationSource: "manual", paymentConfirmedBy: 7, status: "cancelled",
    })).toBe(false);
  });

  it("consolidates confirmed pieces in the requested size order", () => {
    expect(confirmedSizesBySize([
      { size: "M", quantity: 3 }, { size: "PP", quantity: 2 }, { size: "M", quantity: 1 },
      { size: "GG", quantity: 4 }, { size: "XG", quantity: 2 },
    ])).toEqual([["PP", 2], ["M", 4], ["GG", 4], ["XG", 2]]);
  });
});
