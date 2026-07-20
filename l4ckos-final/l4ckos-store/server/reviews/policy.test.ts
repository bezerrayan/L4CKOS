import { describe, expect, it } from "vitest";
import { createReviewInputSchema, reviewModerationInputSchema } from "./policy";

describe("verified review validation", () => {
  const validReview = {
    productId: 12,
    stockReservationId: 120,
    rating: 5,
    comment: "A peça vestiu muito bem e chegou em ótimo estado.",
    sizePerception: "true_to_size" as const,
  };

  it("accepts the supported review fields", () => {
    expect(createReviewInputSchema.parse(validReview)).toEqual(validReview);
  });

  it("accepts only the selected purchase id and rejects identity or verification claims", () => {
    expect(createReviewInputSchema.safeParse({ ...validReview, userId: 99 }).success).toBe(false);
    expect(createReviewInputSchema.safeParse({ ...validReview, orderId: 77 }).success).toBe(false);
    expect(createReviewInputSchema.safeParse({ ...validReview, verifiedPurchase: true }).success).toBe(false);
    expect(createReviewInputSchema.safeParse({ ...validReview, imageUrl: "https://evil.example/file.svg" }).success).toBe(false);
  });

  it("requires rating, meaningful comment and size perception", () => {
    expect(createReviewInputSchema.safeParse({ ...validReview, rating: 0 }).success).toBe(false);
    expect(createReviewInputSchema.safeParse({ ...validReview, rating: 6 }).success).toBe(false);
    expect(createReviewInputSchema.safeParse({ ...validReview, comment: "Gostei" }).success).toBe(false);
    expect(createReviewInputSchema.safeParse({ ...validReview, sizePerception: "medium" }).success).toBe(false);
  });

  it("allows moderation only to change visibility or image approval", () => {
    expect(reviewModerationInputSchema.safeParse({ reviewId: 1, moderationStatus: "hidden_spam" }).success).toBe(true);
    expect(reviewModerationInputSchema.safeParse({ reviewId: 1, imageStatus: "approved" }).success).toBe(true);
    expect(reviewModerationInputSchema.safeParse({ reviewId: 1, rating: 1 }).success).toBe(false);
    expect(reviewModerationInputSchema.safeParse({ reviewId: 1, comment: "texto alterado" }).success).toBe(false);
    expect(reviewModerationInputSchema.safeParse({ reviewId: 1 }).success).toBe(false);
  });
});
