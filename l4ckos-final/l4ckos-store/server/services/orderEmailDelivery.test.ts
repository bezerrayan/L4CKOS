import { beforeEach, describe, expect, it, vi } from "vitest";

const claim = vi.hoisted(() => vi.fn());
const sent = vi.hoisted(() => vi.fn());
const failed = vi.hoisted(() => vi.fn());
const delivered = vi.hoisted(() => vi.fn());
const review = vi.hoisted(() => vi.fn());
const idempotencyKey = vi.hoisted(() => vi.fn((orderId: number, type: string) => `order-${orderId}-${type}`));

vi.mock("../db", () => ({
  claimOrderEmailEvent: claim,
  markOrderEmailEventSent: sent,
  markOrderEmailEventFailed: failed,
  orderEmailIdempotencyKey: idempotencyKey,
}));
vi.mock("./emailService.js", () => ({
  sendOrderDeliveredEmail: delivered,
  sendReviewRequestEmail: review,
}));

import { dispatchOrderEmailEvent } from "./orderEmailDelivery";

const base = {
  orderId: 42,
  customerEmail: "test@example.test",
  customerName: "STAGING TEST",
  appBaseUrl: "https://staging.l4ckos.com.br",
} as const;

describe("order email outbox dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    claim.mockResolvedValue({ eventId: 99, claimToken: "claim-1", attemptCount: 1, reclaimed: false });
    sent.mockResolvedValue(true);
    failed.mockResolvedValue(true);
    delivered.mockResolvedValue({ id: "delivery_1" });
    review.mockResolvedValue({ id: "review_1" });
  });

  it("sends one delivery and one review on the first delivered transition", async () => {
    await dispatchOrderEmailEvent({ ...base, eventType: "order_delivered_email" });
    await dispatchOrderEmailEvent({ ...base, eventType: "review_request_email" });

    expect(delivered).toHaveBeenCalledOnce();
    expect(review).toHaveBeenCalledOnce();
    expect(sent).toHaveBeenCalledTimes(2);
    expect(delivered).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "order-42-order_delivered_email" }));
    expect(review).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "order-42-review_request_email" }));
    expect(sent).toHaveBeenCalledWith(expect.objectContaining({ claimToken: "claim-1" }));
  });

  it("does not duplicate sent events after delivered → paid → delivered", async () => {
    claim.mockResolvedValue(null);
    await dispatchOrderEmailEvent({ ...base, eventType: "order_delivered_email" });
    await dispatchOrderEmailEvent({ ...base, eventType: "review_request_email" });

    expect(delivered).not.toHaveBeenCalled();
    expect(review).not.toHaveBeenCalled();
    expect(sent).not.toHaveBeenCalled();
  });

  it("allows only one concurrent claimant for an event", async () => {
    let claimed = false;
    claim.mockImplementation(async () => {
      if (claimed) return null;
      claimed = true;
      return { eventId: 99, claimToken: "claim-1", attemptCount: 1, reclaimed: false };
    });
    await Promise.all([
      dispatchOrderEmailEvent({ ...base, eventType: "order_delivered_email" }),
      dispatchOrderEmailEvent({ ...base, eventType: "order_delivered_email" }),
    ]);

    expect(delivered).toHaveBeenCalledOnce();
    expect(sent).toHaveBeenCalledOnce();
  });

  it("persists an observable failure instead of swallowing a provider error", async () => {
    delivered.mockRejectedValueOnce(new Error("provider unavailable"));
    const result = await dispatchOrderEmailEvent({ ...base, eventType: "order_delivered_email" });

    expect(result).toEqual({ dispatched: false, reason: "provider_failed" });
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 42,
      eventType: "order_delivered_email",
      claimToken: "claim-1",
      error: "provider unavailable",
    }));
  });

  it("persists a sanitized failure for a synchronous error after the claim", async () => {
    idempotencyKey.mockImplementationOnce(() => {
      throw new Error("bad recipient person@example.test");
    });

    const result = await dispatchOrderEmailEvent({ ...base, eventType: "order_delivered_email" });

    expect(result).toEqual({ dispatched: false, reason: "provider_failed" });
    expect(delivered).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({
      claimToken: "claim-1",
      error: "bad recipient [redacted-email]",
    }));
  });

  it("records a stale reclaim without allowing a second provider dispatch", async () => {
    claim.mockResolvedValueOnce({ eventId: 99, claimToken: "claim-2", attemptCount: 2, reclaimed: true });

    await dispatchOrderEmailEvent({ ...base, eventType: "order_delivered_email" });

    expect(delivered).toHaveBeenCalledOnce();
    expect(sent).toHaveBeenCalledWith(expect.objectContaining({ claimToken: "claim-2" }));
  });

  it("does not overwrite a newer lease after provider acceptance", async () => {
    sent.mockResolvedValueOnce(false);

    const result = await dispatchOrderEmailEvent({ ...base, eventType: "order_delivered_email" });

    expect(result).toEqual({ dispatched: false, reason: "lease_lost" });
    expect(failed).not.toHaveBeenCalled();
  });

  it("keeps review scheduling approximately five minutes ahead", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T12:00:00.000Z"));
    await dispatchOrderEmailEvent({ ...base, eventType: "review_request_email" });
    expect(review).toHaveBeenCalledWith(expect.objectContaining({
      scheduledAt: "2026-09-26T12:05:00.000Z",
    }));
    vi.useRealTimers();
  });
});
