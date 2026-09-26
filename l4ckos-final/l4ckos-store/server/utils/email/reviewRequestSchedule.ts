export const REVIEW_REQUEST_DELAY_MS = 5 * 60 * 1_000;

export function getReviewRequestScheduledAt(now: Date = new Date()): string {
  return new Date(now.getTime() + REVIEW_REQUEST_DELAY_MS).toISOString();
}
