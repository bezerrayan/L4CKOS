import { describe, expect, it } from "vitest";
import {
  batchAcceptsSales,
  batchHasCapacity,
  batchRemainingCapacity,
  type BatchPreview,
} from "../../shared/preorder";

const batch = (remainingQuantity: number | null): BatchPreview => ({
  id: 1,
  name: "Synthetic PREORDER",
  status: "OPEN",
  salesOpenAt: null,
  salesCloseAt: null,
  estimatedShippingStart: null,
  estimatedShippingEnd: null,
  capacity: {
    maximumQuantity: remainingQuantity === null ? null : 2,
    claimedQuantity: remainingQuantity === null ? 0 : 2 - remainingQuantity,
    remainingQuantity,
  },
});

describe("preorder capacity preview", () => {
  it("keeps an open lot with remaining capacity available", () => {
    expect(batchAcceptsSales(batch(1))).toBe(true);
    expect(batchRemainingCapacity(batch(1))).toBe(1);
    expect(batchHasCapacity(batch(1))).toBe(true);
  });

  it("marks an exhausted lot unavailable without changing its sales window", () => {
    expect(batchAcceptsSales(batch(0))).toBe(true);
    expect(batchHasCapacity(batch(0))).toBe(false);
  });

  it("does not impose a UI cap on batches without a configured maximum", () => {
    expect(batchRemainingCapacity(batch(null))).toBeNull();
    expect(batchHasCapacity(batch(null))).toBe(true);
  });
});
