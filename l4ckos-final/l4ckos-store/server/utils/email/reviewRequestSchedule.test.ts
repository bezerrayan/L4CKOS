import { describe, expect, it } from "vitest";
import {
  getReviewRequestScheduledAt,
  REVIEW_REQUEST_DELAY_MS,
} from "./reviewRequestSchedule";

describe("review request email schedule", () => {
  it("schedules the review request five minutes after delivery confirmation", () => {
    const deliveredAt = new Date("2026-07-19T22:20:43.000Z");
    const scheduledAt = getReviewRequestScheduledAt(deliveredAt);

    expect(scheduledAt).toBe("2026-07-19T22:25:43.000Z");
    expect(new Date(scheduledAt).getTime() - deliveredAt.getTime()).toBe(
      REVIEW_REQUEST_DELAY_MS,
    );
  });
});
