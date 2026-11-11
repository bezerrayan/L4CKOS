/** Explicit application inventory: audit 2026-09-27 plus the pending webhook table.
 * Ordering is parent-before-child, including logical dependencies without physical FKs.
 * Financial objects remain UNKNOWN_REQUIRES_EVIDENCE: preservation only.
 */
export const TABLE_MANIFEST_VERSION = 6;
export const REQUIRED_TABLES = [
  "users", "products", "productVariants", "productImages", "coupons", "orders",
  "orderItems", "payments", "paymentEvents", "notificationOutbox", "stockReservations",
  "orderEmailEvents", "auditLogs", "cartItems", "favorites", "localAuthUsers",
  "passwordResetTokens", "userProfiles", "userAddresses", "userPaymentMethods",
  "productReviews", "productReviewUploads", "promoBanners", "waitlist_emails", "emailUnsubscribes",
] as const;
export const PREORDER_TABLES = ["productionBatches", "productionBatchProducts"] as const;
export const PREORDER_CAPACITY_TABLES = ["preorderBatchCapacityPolicies", "preorderCapacityReservations"] as const;
// Preserve older artifact contracts while v5 recognizes the additive capacity ledger.
export const OPTIONAL_TABLES_V3 = [...PREORDER_TABLES, "asaasWebhookEvents", "asaasWebhookInbox"] as const;
export const OPTIONAL_TABLES_V4 = [...OPTIONAL_TABLES_V3, "homeHighlightSettings"] as const;
export const OPTIONAL_TABLES_V5 = [...OPTIONAL_TABLES_V4, ...PREORDER_CAPACITY_TABLES] as const;
// v6: STOCK V1 checkout tables (stock-v1/v6/0027) and Exclusive Drops tables (exclusive-drops-v1/0028). Both are
// additive candidates, absent until their migrations are applied, so they are OPTIONAL like the other versioned tiers.
export const STOCK_TABLES = ["stockCheckoutAttempts", "stockCheckoutItems", "stockWebhookEvents"] as const;
export const EXCLUSIVE_DROP_TABLES = [
  "exclusiveDrops", "exclusiveDropProducts", "exclusiveAccessRequests", "exclusiveGrants",
  "exclusiveGrantUsage", "exclusiveRedeemAttempts", "exclusiveEvents", "exclusiveNotificationOutbox",
] as const;
export const OPTIONAL_TABLES = [...OPTIONAL_TABLES_V5, ...STOCK_TABLES, ...EXCLUSIVE_DROP_TABLES] as const;
const BASE_ORDER: string[] = [
  ...REQUIRED_TABLES.slice(0, 4),
  ...PREORDER_TABLES,
  "preorderBatchCapacityPolicies",
  ...REQUIRED_TABLES.slice(4),
  "preorderCapacityReservations",
  "homeHighlightSettings",
  "asaasWebhookEvents",
  "asaasWebhookInbox",
  ...EXCLUSIVE_DROP_TABLES,
];
// stockCheckoutAttempts references orders and stockReservations references stockCheckoutAttempts: parents first.
BASE_ORDER.splice(BASE_ORDER.indexOf("stockReservations"), 0, ...STOCK_TABLES);
export const TABLE_ORDER: readonly string[] = BASE_ORDER;
export function classifyTable(name: string) {
  if ((REQUIRED_TABLES as readonly string[]).includes(name)) return "KNOWN";
  if (([...PREORDER_TABLES, ...PREORDER_CAPACITY_TABLES, ...STOCK_TABLES, ...EXCLUSIVE_DROP_TABLES] as readonly string[]).includes(name)) return "KNOWN_VERSIONED";
  if ((OPTIONAL_TABLES as readonly string[]).includes(name)) return "OPTIONAL_PENDING_RECONCILIATION";
  return "UNKNOWN";
}
