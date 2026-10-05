/** Explicit application inventory: audit 2026-09-27 plus the pending webhook table.
 * Ordering is parent-before-child, including logical dependencies without physical FKs.
 * Financial objects remain UNKNOWN_REQUIRES_EVIDENCE: preservation only.
 */
export const TABLE_MANIFEST_VERSION = 1;
export const REQUIRED_TABLES = [
  "users", "products", "productVariants", "productImages", "coupons", "orders",
  "orderItems", "payments", "paymentEvents", "notificationOutbox", "stockReservations",
  "orderEmailEvents", "auditLogs", "cartItems", "favorites", "localAuthUsers",
  "passwordResetTokens", "userProfiles", "userAddresses", "userPaymentMethods",
  "productReviews", "productReviewUploads", "promoBanners", "waitlist_emails", "emailUnsubscribes",
] as const;
export const OPTIONAL_TABLES = ["asaasWebhookEvents"] as const;
export const TABLE_ORDER: readonly string[] = [...REQUIRED_TABLES, ...OPTIONAL_TABLES];
export function classifyTable(name: string) {
  if ((REQUIRED_TABLES as readonly string[]).includes(name)) return "KNOWN";
  if ((OPTIONAL_TABLES as readonly string[]).includes(name)) return "OPTIONAL_PENDING_RECONCILIATION";
  return "UNKNOWN";
}
