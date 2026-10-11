/** Explicit application inventory: audit 2026-09-27 plus the pending webhook table.
 * Ordering is parent-before-child, including logical dependencies without physical FKs.
 * Financial objects remain UNKNOWN_REQUIRES_EVIDENCE: preservation only.
 */
export const TABLE_MANIFEST_VERSION = 3;
export const REQUIRED_TABLES = [
  "users", "products", "productVariants", "productImages", "coupons", "orders",
  "orderItems", "payments", "paymentEvents", "notificationOutbox", "stockReservations",
  "orderEmailEvents", "auditLogs", "cartItems", "favorites", "localAuthUsers",
  "passwordResetTokens", "userProfiles", "userAddresses", "userPaymentMethods",
  "productReviews", "productReviewUploads", "promoBanners", "waitlist_emails", "emailUnsubscribes",
] as const;
export const PREORDER_TABLES = ["productionBatches", "productionBatchProducts"] as const;
// v1 backups remain readable; v2 schema must contain both batch tables.
export const OPTIONAL_TABLES = [...PREORDER_TABLES, "asaasWebhookEvents", "asaasWebhookInbox"] as const;
export const TABLE_ORDER: readonly string[] = [...REQUIRED_TABLES.slice(0,4), ...PREORDER_TABLES, ...REQUIRED_TABLES.slice(4), "asaasWebhookEvents", "asaasWebhookInbox"];
export function classifyTable(name: string) {
  if ((REQUIRED_TABLES as readonly string[]).includes(name)) return "KNOWN";
  if ((PREORDER_TABLES as readonly string[]).includes(name)) return "KNOWN_VERSIONED";
  if ((OPTIONAL_TABLES as readonly string[]).includes(name)) return "OPTIONAL_PENDING_RECONCILIATION";
  return "UNKNOWN";
}
