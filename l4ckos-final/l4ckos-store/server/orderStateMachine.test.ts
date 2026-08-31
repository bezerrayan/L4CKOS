import { describe, expect, it } from "vitest";
import {
  projectLegacyOrderStatus,
  transitionFulfillmentStatus,
  transitionPaymentStatus,
} from "./services/orderStateMachine";

describe("P1 state machines", () => {
  it("allows a valid financial transition", () => {
    expect(transitionPaymentStatus("pending", "confirmed", { source: "webhook" }).decision).toBe("allowed");
  });

  it("rejects an invalid financial transition", () => {
    expect(transitionPaymentStatus("refunded", "overdue", { source: "webhook" }).decision).toBe("invalid");
  });

  it("ignores an old financial event", () => {
    expect(transitionPaymentStatus("received", "confirmed", { source: "webhook" }).decision).toBe("ignored");
  });

  it("requires provider evidence to reverse chargeback", () => {
    expect(transitionPaymentStatus("chargeback", "received", { source: "manual" }).decision).toBe("manual");
    expect(transitionPaymentStatus("chargeback", "received", { source: "reconciliation", chargebackReversal: true }).decision).toBe("allowed");
  });

  it("rejects fulfillment rollback", () => {
    expect(transitionFulfillmentStatus("delivered", "processing").decision).toBe("invalid");
    expect(transitionFulfillmentStatus("shipped", "awaiting_payment").decision).toBe("invalid");
    expect(transitionFulfillmentStatus("cancelled", "shipped").decision).toBe("invalid");
  });

  it("projects legacy status centrally", () => {
    expect(projectLegacyOrderStatus("received", "ready")).toBe("paid");
    expect(projectLegacyOrderStatus("pending", "shipped")).toBe("shipped");
    expect(projectLegacyOrderStatus("received", "cancelled")).toBe("cancelled");
  });
});
