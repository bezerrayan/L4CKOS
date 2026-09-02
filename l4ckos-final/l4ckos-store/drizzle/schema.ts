import { check, foreignKey, index, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  cpf: varchar("cpf", { length: 18 }),
  phone: varchar("phone", { length: 32 }),
  asaasCustomerId: varchar("asaasCustomerId", { length: 64 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  isVip: int("isVip").default(0).notNull(),
  isBlocked: int("isBlocked").default(0).notNull(),
  sessionVersion: int("sessionVersion").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// Perfil do usuário
export const userProfiles = mysqlTable("userProfiles", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  phone: varchar("phone", { length: 32 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserProfile = typeof userProfiles.$inferSelect;
export type InsertUserProfile = typeof userProfiles.$inferInsert;

// Endereços do usuário
export const userAddresses = mysqlTable("userAddresses", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  label: varchar("label", { length: 100 }).notNull(),
  recipient: varchar("recipient", { length: 255 }).notNull(),
  zipCode: varchar("zipCode", { length: 20 }).notNull(),
  street: varchar("street", { length: 255 }).notNull(),
  number: varchar("number", { length: 30 }).notNull(),
  complement: varchar("complement", { length: 255 }),
  neighborhood: varchar("neighborhood", { length: 255 }).notNull(),
  city: varchar("city", { length: 255 }).notNull(),
  state: varchar("state", { length: 100 }).notNull(),
  isDefault: int("isDefault").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserAddress = typeof userAddresses.$inferSelect;
export type InsertUserAddress = typeof userAddresses.$inferInsert;

// Métodos de pagamento do usuário
export const userPaymentMethods = mysqlTable("userPaymentMethods", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  label: varchar("label", { length: 100 }).notNull(),
  holderName: varchar("holderName", { length: 255 }).notNull(),
  brand: varchar("brand", { length: 80 }).notNull(),
  last4: varchar("last4", { length: 4 }).notNull(),
  expiry: varchar("expiry", { length: 8 }).notNull(),
  isDefault: int("isDefault").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserPaymentMethod = typeof userPaymentMethods.$inferSelect;
export type InsertUserPaymentMethod = typeof userPaymentMethods.$inferInsert;

// Produtos
export const products = mysqlTable("products", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  fullDescription: text("fullDescription"),
  category: varchar("category", { length: 100 }).notNull(),
  price: int("price").notNull(), // em centavos (ex: 8990 = R$ 89.90)
  optionColors: text("optionColors"), // JSON array de cores exibidas
  optionSizes: text("optionSizes"), // JSON array de tamanhos exibidos
  sizeType: mysqlEnum("sizeType", ["alpha", "numeric", "custom"]).default("alpha").notNull(),
  imageUrl: varchar("imageUrl", { length: 500 }),
  imageThumbnailUrl: varchar("imageThumbnailUrl", { length: 500 }),
  imageDetailUrl: varchar("imageDetailUrl", { length: 500 }),
  imageBannerUrl: varchar("imageBannerUrl", { length: 500 }),
  stock: int("stock").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
  check("products_stock_nonnegative_chk", sql`${table.stock} >= 0`),
]);

export type Product = typeof products.$inferSelect;
export type InsertProduct = typeof products.$inferInsert;

// Variações de produtos (tamanho/cor etc.)
export const productVariants = mysqlTable("productVariants", {
  id: int("id").autoincrement().primaryKey(),
  productId: int("productId").notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  sku: varchar("sku", { length: 120 }),
  size: varchar("size", { length: 60 }),
  color: varchar("color", { length: 60 }),
  optionKey: varchar("optionKey", { length: 191 }),
  price: int("price"),
  stock: int("stock").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
  index("productVariants_productId_idx").on(table.productId),
  uniqueIndex("productVariants_product_option_unique").on(table.productId, table.optionKey),
  check("product_variants_stock_nonnegative_chk", sql`${table.stock} >= 0`),
]);

export type ProductVariant = typeof productVariants.$inferSelect;
export type InsertProductVariant = typeof productVariants.$inferInsert;

// Pedidos
export const orders = mysqlTable("orders", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  status: mysqlEnum("status", ["pending", "processing", "paid", "shipped", "delivered", "cancelled"]).default("pending").notNull(),
  trackingCode: varchar("trackingCode", { length: 120 }),
  totalPrice: int("totalPrice").notNull(), // em centavos
  asaasCheckoutId: varchar("asaasCheckoutId", { length: 64 }),
  checkoutAttemptId: varchar("checkoutAttemptId", { length: 64 }),
  checkoutFingerprint: varchar("checkoutFingerprint", { length: 64 }),
  fulfillmentStatus: mysqlEnum("fulfillmentStatus", [
    "awaiting_payment",
    "ready",
    "processing",
    "shipped",
    "delivered",
    "cancelled",
    "on_hold",
    "inventory_exception",
  ]).default("awaiting_payment").notNull(),
  fulfillmentIssue: varchar("fulfillmentIssue", { length: 191 }),
  fulfillmentIssueAt: timestamp("fulfillmentIssueAt"),
  correlationId: varchar("correlationId", { length: 191 }),
  couponId: int("couponId"),
  couponReleasedAt: timestamp("couponReleasedAt"),
  shippingRecipient: varchar("shippingRecipient", { length: 255 }),
  shippingZipCode: varchar("shippingZipCode", { length: 20 }),
  shippingStreet: varchar("shippingStreet", { length: 255 }),
  shippingNumber: varchar("shippingNumber", { length: 30 }),
  shippingComplement: varchar("shippingComplement", { length: 255 }),
  shippingNeighborhood: varchar("shippingNeighborhood", { length: 255 }),
  shippingCity: varchar("shippingCity", { length: 255 }),
  shippingState: varchar("shippingState", { length: 100 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
  index("orders_userId_idx").on(table.userId),
  index("orders_status_idx").on(table.status),
  index("orders_fulfillment_status_idx").on(table.fulfillmentStatus),
  index("orders_correlation_id_idx").on(table.correlationId),
  uniqueIndex("orders_checkoutAttemptId_unique").on(table.checkoutAttemptId),
]);

export type Order = typeof orders.$inferSelect;
export type InsertOrder = typeof orders.$inferInsert;

// Itens do Pedido
export const orderItems = mysqlTable("orderItems", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").notNull(),
  productId: int("productId").notNull(),
  variantId: int("variantId"),
  productName: varchar("productName", { length: 255 }),
  variantName: varchar("variantName", { length: 120 }),
  sku: varchar("sku", { length: 120 }),
  size: varchar("size", { length: 60 }),
  color: varchar("color", { length: 60 }),
  quantity: int("quantity").notNull(),
  unitPrice: int("unitPrice").notNull(), // preço unitário imutável no momento da compra
  totalPrice: int("totalPrice"), // nullable apenas para compatibilidade com registros legados
  imageUrl: varchar("imageUrl", { length: 500 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [
  index("orderItems_orderId_idx").on(table.orderId),
  index("orderItems_productId_idx").on(table.productId),
  index("orderItems_variantId_idx").on(table.variantId),
  check("order_items_quantity_positive_chk", sql`${table.quantity} > 0`),
  check("order_items_unit_price_nonnegative_chk", sql`${table.unitPrice} >= 0`),
  check("order_items_total_price_nonnegative_chk", sql`${table.totalPrice} IS NULL OR ${table.totalPrice} >= 0`),
  foreignKey({ name: "order_items_order_fk", columns: [table.orderId], foreignColumns: [orders.id] })
    .onDelete("restrict").onUpdate("restrict"),
]);

export type OrderItem = typeof orderItems.$inferSelect;
export type InsertOrderItem = typeof orderItems.$inferInsert;

// Carrinho
export const cartItems = mysqlTable("cartItems", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  productId: int("productId").notNull(),
  quantity: int("quantity").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CartItem = typeof cartItems.$inferSelect;
export type InsertCartItem = typeof cartItems.$inferInsert;

// Favoritos
export const favorites = mysqlTable("favorites", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  productId: int("productId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Favorite = typeof favorites.$inferSelect;
export type InsertFavorite = typeof favorites.$inferInsert;

// Cupons e descontos
export const coupons = mysqlTable("coupons", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  type: mysqlEnum("type", ["percent", "fixed"]).notNull(),
  value: int("value").notNull(),
  maxUses: int("maxUses"),
  usedCount: int("usedCount").default(0).notNull(),
  startsAt: timestamp("startsAt"),
  expiresAt: timestamp("expiresAt"),
  isActive: int("isActive").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Coupon = typeof coupons.$inferSelect;
export type InsertCoupon = typeof coupons.$inferInsert;

// Banners promocionais editáveis pelo admin
export const promoBanners = mysqlTable("promoBanners", {
  id: int("id").autoincrement().primaryKey(),
  badge: varchar("badge", { length: 80 }).default("PROMOCAO").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description").notNull(),
  ctaLabel: varchar("ctaLabel", { length: 120 }).default("Aproveitar Oferta").notNull(),
  imageUrl: varchar("imageUrl", { length: 500 }),
  mobileImageUrl: varchar("mobileImageUrl", { length: 500 }),
  imageAlt: varchar("imageAlt", { length: 255 }),
  linkUrl: varchar("linkUrl", { length: 500 }),
  discountText: varchar("discountText", { length: 60 }).notNull(),
  discountLabel: varchar("discountLabel", { length: 40 }).default("OFF").notNull(),
  bgStyle: varchar("bgStyle", { length: 255 }).default("linear-gradient(135deg, #1a1a1a 0%, #333333 100%)").notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  isActive: int("isActive").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PromoBanner = typeof promoBanners.$inferSelect;
export type InsertPromoBanner = typeof promoBanners.$inferInsert;

// Auditoria administrativa
export const auditLogs = mysqlTable("auditLogs", {
  id: int("id").autoincrement().primaryKey(),
  actorUserId: int("actorUserId"),
  actorType: mysqlEnum("actorType", ["admin", "user", "system"]).default("admin").notNull(),
  action: varchar("action", { length: 120 }).notNull(),
  entity: varchar("entity", { length: 120 }).notNull(),
  entityId: varchar("entityId", { length: 120 }),
  orderId: int("orderId"),
  paymentId: int("paymentId"),
  event: varchar("event", { length: 120 }),
  correlationId: varchar("correlationId", { length: 191 }),
  beforeState: text("beforeState"),
  afterState: text("afterState"),
  metadata: text("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [
  index("auditLogs_order_id_idx").on(table.orderId),
  index("auditLogs_payment_id_idx").on(table.paymentId),
  index("auditLogs_correlation_id_idx").on(table.correlationId),
]);

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = typeof auditLogs.$inferInsert;

// Credenciais locais (dev/test) com hash bcrypt
export const localAuthUsers = mysqlTable("localAuthUsers", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type LocalAuthUser = typeof localAuthUsers.$inferSelect;
export type InsertLocalAuthUser = typeof localAuthUsers.$inferInsert;

export const passwordResetTokens = mysqlTable("passwordResetTokens", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  tokenHash: varchar("tokenHash", { length: 128 }).notNull().unique(),
  expiresAt: timestamp("expiresAt").notNull(),
  usedAt: timestamp("usedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type InsertPasswordResetToken = typeof passwordResetTokens.$inferInsert;

// Imagens de Produtos (para múltiplas imagens por produto)
export const productImages = mysqlTable("productImages", {
  id: int("id").autoincrement().primaryKey(),
  productId: int("productId").notNull(),
  imageUrl: varchar("imageUrl", { length: 500 }).notNull(),
  imageThumbnailUrl: varchar("imageThumbnailUrl", { length: 500 }),
  imageDetailUrl: varchar("imageDetailUrl", { length: 500 }),
  imageBannerUrl: varchar("imageBannerUrl", { length: 500 }),
  color: varchar("color", { length: 60 }),
  alt: varchar("alt", { length: 255 }),
  order: int("order").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ProductImage = typeof productImages.$inferSelect;
export type InsertProductImage = typeof productImages.$inferInsert;

// Avaliacoes de produto
export const productReviews = mysqlTable("productReviews", {
  id: int("id").autoincrement().primaryKey(),
  productId: int("productId").notNull(),
  // These are stored references only. Future eligibility derives financial
  // proof from the hardened payment/reservation ledger, never from this row.
  orderId: int("orderId"),
  stockReservationId: int("stockReservationId"),
  userId: int("userId").notNull(),
  rating: int("rating").notNull(),
  sizePerception: mysqlEnum("sizePerception", ["small", "true_to_size", "large"]),
  comment: text("comment"),
  imageUrl: varchar("imageUrl", { length: 500 }),
  imageStatus: mysqlEnum("imageStatus", ["none", "pending", "approved", "rejected"]).default("none").notNull(),
  moderationStatus: mysqlEnum("moderationStatus", ["published", "hidden_spam", "hidden_offensive"]).default("published").notNull(),
  verifiedPurchase: int("verifiedPurchase").default(0).notNull(),
  moderatedBy: int("moderatedBy"),
  moderatedAt: timestamp("moderatedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
  index("productReviews_public_idx").on(table.productId, table.verifiedPurchase, table.moderationStatus, table.createdAt),
  uniqueIndex("productReviews_stockReservationId_unique").on(table.stockReservationId),
]);

export type ProductReview = typeof productReviews.$inferSelect;
export type InsertProductReview = typeof productReviews.$inferInsert;

// Tokens reserve a review image URL for a user/product pair. Upload and claim
// behavior is intentionally deferred to a later phase.
export const productReviewUploads = mysqlTable("productReviewUploads", {
  token: varchar("token", { length: 64 }).primaryKey(),
  userId: int("userId").notNull(),
  productId: int("productId").notNull(),
  imageUrl: varchar("imageUrl", { length: 500 }).notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  claimedAt: timestamp("claimedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [
  index("productReviewUploads_user_product_idx").on(table.userId, table.productId),
  index("productReviewUploads_expiry_idx").on(table.expiresAt),
]);

export type ProductReviewUpload = typeof productReviewUploads.$inferSelect;
export type InsertProductReviewUpload = typeof productReviewUploads.$inferInsert;

// Reserva temporaria de estoque no checkout
export const stockReservations = mysqlTable("stockReservations", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").notNull(),
  userId: int("userId").notNull(),
  productId: int("productId").notNull(),
  variantId: int("variantId"),
  orderItemId: int("orderItemId"),
  quantity: int("quantity").notNull(),
  status: mysqlEnum("status", ["active", "consumed", "released", "expired", "restocked"]).default("active").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
  index("stockReservations_order_status_idx").on(table.orderId, table.status),
  index("stockReservations_expiry_status_idx").on(table.expiresAt, table.status),
  uniqueIndex("stockReservations_orderItemId_unique").on(table.orderItemId),
  check("stock_reservations_quantity_positive_chk", sql`${table.quantity} > 0`),
  foreignKey({ name: "stock_reservations_order_fk", columns: [table.orderId], foreignColumns: [orders.id] })
    .onDelete("restrict").onUpdate("restrict"),
  foreignKey({ name: "stock_reservations_order_item_fk", columns: [table.orderItemId], foreignColumns: [orderItems.id] })
    .onDelete("restrict").onUpdate("restrict"),
]);

export type StockReservation = typeof stockReservations.$inferSelect;
export type InsertStockReservation = typeof stockReservations.$inferInsert;

// Registro financeiro próprio. O status logístico permanece no pedido e o
// financeiro é reconciliado exclusivamente por esta tabela.
export const payments = mysqlTable("payments", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").notNull(),
  provider: varchar("provider", { length: 32 }).default("asaas").notNull(),
  providerPaymentId: varchar("providerPaymentId", { length: 64 }),
  providerCustomerId: varchar("providerCustomerId", { length: 64 }),
  billingType: varchar("billingType", { length: 32 }).notNull(),
  amount: int("amount").notNull(),
  paidAmount: int("paidAmount").default(0).notNull(),
  refundedAmount: int("refundedAmount").default(0).notNull(),
  netAmount: int("netAmount").default(0).notNull(),
  status: mysqlEnum("status", [
    "pending",
    "confirmed",
    "received",
    "failed",
    "overdue",
    "cancelled",
    "partially_refunded",
    "refunded",
    "chargeback",
  ]).default("pending").notNull(),
  creationStatus: mysqlEnum("creationStatus", ["not_started", "creating", "created", "unknown", "failed"])
    .default("not_started")
    .notNull(),
  creationLeaseExpiresAt: timestamp("creationLeaseExpiresAt"),
  statusSource: mysqlEnum("statusSource", ["provider", "reconciliation", "manual", "system"]).default("provider").notNull(),
  financialIssue: varchar("financialIssue", { length: 191 }),
  financialIssueAt: timestamp("financialIssueAt"),
  manualConfirmedAt: timestamp("manualConfirmedAt"),
  manualConfirmedBy: int("manualConfirmedBy"),
  manualReason: varchar("manualReason", { length: 500 }),
  manualEvidence: varchar("manualEvidence", { length: 500 }),
  externalReference: varchar("externalReference", { length: 191 }).notNull(),
  invoiceUrl: varchar("invoiceUrl", { length: 500 }),
  bankSlipUrl: varchar("bankSlipUrl", { length: 500 }),
  pixQrCode: text("pixQrCode"),
  pixCopyPaste: text("pixCopyPaste"),
  digitableLine: varchar("digitableLine", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  confirmedAt: timestamp("confirmedAt"),
  receivedAt: timestamp("receivedAt"),
  refundedAt: timestamp("refundedAt"),
}, table => [
  uniqueIndex("payments_orderId_unique").on(table.orderId),
  uniqueIndex("payments_providerPaymentId_unique").on(table.providerPaymentId),
  uniqueIndex("payments_externalReference_unique").on(table.externalReference),
  index("payments_status_idx").on(table.status),
  check("payments_amount_nonnegative_chk", sql`${table.amount} >= 0`),
  check("payments_paid_amount_nonnegative_chk", sql`${table.paidAmount} >= 0`),
  check("payments_refunded_amount_nonnegative_chk", sql`${table.refundedAmount} >= 0`),
  check("payments_net_amount_nonnegative_chk", sql`${table.netAmount} >= 0`),
  foreignKey({ name: "payments_order_fk", columns: [table.orderId], foreignColumns: [orders.id] })
    .onDelete("restrict").onUpdate("restrict"),
]);

export type Payment = typeof payments.$inferSelect;
export type InsertPayment = typeof payments.$inferInsert;

export const paymentEvents = mysqlTable("paymentEvents", {
  id: int("id").autoincrement().primaryKey(),
  provider: varchar("provider", { length: 32 }).default("asaas").notNull(),
  providerEventId: varchar("providerEventId", { length: 191 }).notNull(),
  paymentId: int("paymentId"),
  orderId: int("orderId"),
  providerPaymentId: varchar("providerPaymentId", { length: 64 }),
  eventType: varchar("eventType", { length: 80 }).notNull(),
  processingStatus: mysqlEnum("processingStatus", ["pending", "processing", "processed", "ignored", "failed", "conflict"])
    .default("pending")
    .notNull(),
  payload: text("payload"),
  errorCode: varchar("errorCode", { length: 120 }),
  receivedAt: timestamp("receivedAt").defaultNow().notNull(),
  processedAt: timestamp("processedAt"),
}, table => [
  uniqueIndex("paymentEvents_providerEventId_unique").on(table.providerEventId),
  index("paymentEvents_paymentId_idx").on(table.paymentId),
  index("paymentEvents_orderId_idx").on(table.orderId),
  index("paymentEvents_processingStatus_idx").on(table.processingStatus),
  foreignKey({ name: "payment_events_payment_fk", columns: [table.paymentId], foreignColumns: [payments.id] })
    .onDelete("set null").onUpdate("restrict"),
]);

export type PaymentEvent = typeof paymentEvents.$inferSelect;
export type InsertPaymentEvent = typeof paymentEvents.$inferInsert;

export const notificationOutbox = mysqlTable("notificationOutbox", {
  id: int("id").autoincrement().primaryKey(),
  dedupeKey: varchar("dedupeKey", { length: 191 }).notNull(),
  type: varchar("type", { length: 80 }).notNull(),
  orderId: int("orderId"),
  paymentId: int("paymentId"),
  payload: text("payload"),
  status: mysqlEnum("status", ["pending", "processing", "sent", "failed", "dead"]).default("pending").notNull(),
  attempts: int("attempts").default(0).notNull(),
  nextAttemptAt: timestamp("nextAttemptAt").defaultNow().notNull(),
  lockedAt: timestamp("lockedAt"),
  lockedBy: varchar("lockedBy", { length: 191 }),
  leaseExpiresAt: timestamp("leaseExpiresAt"),
  lastError: text("lastError"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  sentAt: timestamp("sentAt"),
}, table => [
  uniqueIndex("notificationOutbox_dedupeKey_unique").on(table.dedupeKey),
  index("notificationOutbox_status_idx").on(table.status),
  index("notificationOutbox_claim_idx").on(table.status, table.nextAttemptAt, table.leaseExpiresAt),
  foreignKey({ name: "notification_outbox_order_fk", columns: [table.orderId], foreignColumns: [orders.id] })
    .onDelete("set null").onUpdate("restrict"),
  foreignKey({ name: "notification_outbox_payment_fk", columns: [table.paymentId], foreignColumns: [payments.id] })
    .onDelete("set null").onUpdate("restrict"),
]);

export type NotificationOutbox = typeof notificationOutbox.$inferSelect;

// Waitlist (pre-lancamento)
export const waitlistEmails = mysqlTable("waitlist_emails", {
  id: int("id").autoincrement().primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type WaitlistEmail = typeof waitlistEmails.$inferSelect;
export type InsertWaitlistEmail = typeof waitlistEmails.$inferInsert;

// Descadastro de emails de marketing
export const emailUnsubscribes = mysqlTable("emailUnsubscribes", {
  id: int("id").autoincrement().primaryKey(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  reason: varchar("reason", { length: 120 }),
  source: varchar("source", { length: 120 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type EmailUnsubscribe = typeof emailUnsubscribes.$inferSelect;
export type InsertEmailUnsubscribe = typeof emailUnsubscribes.$inferInsert;
