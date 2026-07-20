import { describe, expect, it } from "vitest";
import {
  buildPaymentConfirmationValues,
  isTrustedPaymentConfirmation,
  manualPaymentConfirmationInputSchema,
} from "./confirmation";

describe("payment confirmation policy", () => {
  it("does not treat delivered status alone as payment proof", () => {
    expect(isTrustedPaymentConfirmation({ paymentStatus: "unconfirmed" })).toBe(false);
  });

  it("requires the admin actor for a manual confirmation", () => {
    expect(isTrustedPaymentConfirmation({
      paymentStatus: "confirmed",
      paymentConfirmationSource: "manual",
      paymentConfirmedAt: new Date(),
      paymentConfirmedBy: null,
    })).toBe(false);

    expect(isTrustedPaymentConfirmation({
      paymentStatus: "confirmed",
      paymentConfirmationSource: "manual",
      paymentConfirmedAt: new Date(),
      paymentConfirmedBy: 7,
    })).toBe(true);
  });

  it("requires a webhook reference for an Asaas confirmation", () => {
    expect(isTrustedPaymentConfirmation({
      paymentStatus: "confirmed",
      paymentConfirmationSource: "asaas_webhook",
      paymentConfirmedAt: new Date(),
      paymentConfirmationReference: null,
    })).toBe(false);

    expect(isTrustedPaymentConfirmation({
      paymentStatus: "confirmed",
      paymentConfirmationSource: "asaas_webhook",
      paymentConfirmedAt: new Date(),
      paymentConfirmationReference: "evt_123",
    })).toBe(true);
  });

  it("does not accept payment evidence fields from the manual endpoint input", () => {
    expect(manualPaymentConfirmationInputSchema.safeParse({ orderId: 42 }).success).toBe(true);
    expect(manualPaymentConfirmationInputSchema.safeParse({
      orderId: 42,
      paymentStatus: "confirmed",
      source: "manual",
      actorUserId: 99,
    }).success).toBe(false);
  });

  it("derives the manual actor and origin only from trusted server input", () => {
    const values = buildPaymentConfirmationValues({
      source: "manual",
      actorUserId: 12,
      confirmedAt: new Date("2026-07-19T20:00:00.000Z"),
    });

    expect(values).toMatchObject({
      paymentStatus: "confirmed",
      paymentConfirmationSource: "manual",
      paymentConfirmedBy: 12,
      paymentConfirmationReference: null,
    });
  });
});
