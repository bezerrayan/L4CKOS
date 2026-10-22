import { sql } from "drizzle-orm";
import { bigint, check, date, foreignKey, index, int, mysqlEnum, mysqlTable, smallint, text, timestamp, tinyint, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

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

// Production drops. Assignment is normalized: many products per batch, one current drop per product.
export const productionBatches = mysqlTable("productionBatches", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  status: mysqlEnum("status", ["DRAFT", "OPEN", "CLOSED", "IN_PRODUCTION", "RECEIVED", "SHIPPING", "COMPLETED", "CANCELLED"]).default("DRAFT").notNull(),
  salesOpenAt: timestamp("salesOpenAt"), salesCloseAt: timestamp("salesCloseAt"),
  estimatedShippingStart: timestamp("estimatedShippingStart"), estimatedShippingEnd: timestamp("estimatedShippingEnd"),
  estimatedManufacturingStart: date("estimatedManufacturingStart", { mode: "string" }),
  estimatedManufacturingEnd: date("estimatedManufacturingEnd", { mode: "string" }),
  manufacturingScheduleRequired: tinyint("manufacturingScheduleRequired").default(1).notNull(),
  productionStartedAt: timestamp("productionStartedAt"), receivedAt: timestamp("receivedAt"),
  shippingStartedAt: timestamp("shippingStartedAt"), completedAt: timestamp("completedAt"),
  minimumQuantity: int("minimumQuantity").default(0).notNull(), maximumQuantity: int("maximumQuantity"),
  createdAt: timestamp("createdAt").defaultNow().notNull(), updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [index("productionBatches_status").on(table.status), check("batch_quantities",sql`${table.minimumQuantity} >= 0 AND (${table.maximumQuantity} IS NULL OR (${table.maximumQuantity} > 0 AND ${table.maximumQuantity} >= ${table.minimumQuantity}))`)]);

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
  salesMode: mysqlEnum("salesMode", ["STOCK", "PREORDER"]).default("STOCK").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Product = typeof products.$inferSelect;
export type InsertProduct = typeof products.$inferInsert;

export const productionBatchProducts = mysqlTable("productionBatchProducts", {
  id: int("id").autoincrement().primaryKey(),
  productionBatchId: int("productionBatchId").notNull().references(() => productionBatches.id, { onDelete: "restrict", onUpdate: "restrict" }),
  productId: int("productId").notNull().references(() => products.id, { onDelete: "restrict", onUpdate: "restrict" }),
}, table => [uniqueIndex("batch_product_assignment").on(table.productId), index("batch_products").on(table.productionBatchId)]);

// Variações de produtos (tamanho/cor etc.)
export const productVariants = mysqlTable("productVariants", {
  id: int("id").autoincrement().primaryKey(),
  productId: int("productId").notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  sku: varchar("sku", { length: 120 }),
  price: int("price"),
  stock: int("stock").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  size: varchar("size", { length: 60 }),
  color: varchar("color", { length: 60 }),
  optionKey: varchar("optionKey", { length: 191 }),
  // Existing rows stay inactive until their color/size identity is reviewed.
  isActive: tinyint("isActive").default(0).notNull(),
}, table => [
  uniqueIndex("productVariants_product_option_unique").on(table.productId, table.optionKey),
  index("productVariants_productId_idx").on(table.productId),
  check("product_variants_stock_nonnegative_chk", sql`${table.stock} >= 0`),
  check("product_variants_active_boolean_chk", sql`${table.isActive} IN (0, 1)`),
]);

export type ProductVariant = typeof productVariants.$inferSelect;
export type InsertProductVariant = typeof productVariants.$inferInsert;

// Pedidos
export const orders = mysqlTable("orders", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  status: mysqlEnum("status", ["pending", "processing", "paid", "shipped", "delivered", "cancelled"]).default("pending").notNull(),
  paymentStatus: mysqlEnum("paymentStatus", ["unconfirmed", "confirmed"]).default("unconfirmed").notNull(),
  paymentConfirmationSource: mysqlEnum("paymentConfirmationSource", ["asaas_webhook", "manual"]),
  paymentConfirmedAt: timestamp("paymentConfirmedAt"),
  paymentConfirmedBy: int("paymentConfirmedBy"),
  paymentConfirmationReference: varchar("paymentConfirmationReference", { length: 191 }),
  trackingCode: varchar("trackingCode", { length: 120 }),
  totalPrice: int("totalPrice").notNull(), // em centavos
  asaasCheckoutId: varchar("asaasCheckoutId", { length: 64 }),
  // Existing canonical physical columns, not a new migration.
  checkoutAttemptId: varchar("checkoutAttemptId", { length: 64 }).unique(),
  checkoutFingerprint: varchar("checkoutFingerprint", { length: 64 }),
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
});

export type Order = typeof orders.$inferSelect;
export type InsertOrder = typeof orders.$inferInsert;

// Itens do Pedido
export const orderItems = mysqlTable("orderItems", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").notNull(),
  productId: int("productId").notNull(),
  variantId: int("variantId"),
  salesModeAtPurchase: mysqlEnum("salesModeAtPurchase", ["STOCK", "PREORDER"]).default("STOCK").notNull(),
  productionBatchId: int("productionBatchId").references(() => productionBatches.id, { onDelete: "restrict", onUpdate: "restrict" }),
  productionBatchNameAtPurchase: varchar("productionBatchNameAtPurchase", { length: 255 }),
  estimatedShippingStartAtPurchase: timestamp("estimatedShippingStartAtPurchase"),
  estimatedShippingEndAtPurchase: timestamp("estimatedShippingEndAtPurchase"),
  estimatedManufacturingStartAtPurchase: date("estimatedManufacturingStartAtPurchase", { mode: "string" }),
  estimatedManufacturingEndAtPurchase: date("estimatedManufacturingEndAtPurchase", { mode: "string" }),
  productName: varchar("productName", { length: 255 }),
  variantName: varchar("variantName", { length: 120 }),
  sku: varchar("sku", { length: 120 }),
  size: varchar("size", { length: 60 }),
  color: varchar("color", { length: 60 }),
  imageUrl: varchar("imageUrl", { length: 500 }),
  quantity: int("quantity").notNull(),
  unitPrice: int("unitPrice").notNull(), // snapshot unitário em centavos inteiros
  totalPrice: int("totalPrice"), // total histórico da linha; não recalcular
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [index("orderItems_batch_order").on(table.productionBatchId,table.orderId)]);

export type OrderItem = typeof orderItems.$inferSelect;
export type InsertOrderItem = typeof orderItems.$inferInsert;

// Pré-venda: contrato estrutural v7. Essas tabelas descrevem capacidade do lote,
// separada do estoque físico de products/productVariants.
export const preorderBatchCapacityPolicies = mysqlTable("preorderBatchCapacityPolicies", {
  batchId: int("batchId").notNull().primaryKey(),
  salesState: mysqlEnum("salesState", ["review_required", "accepting", "sales_closed", "settling", "consolidated", "reconciliation_required"]).default("review_required").notNull(),
  pixReservationMinutes: smallint("pixReservationMinutes", { unsigned: true }).default(30).notNull(),
  boletoPreorderEnabled: tinyint("boletoPreorderEnabled").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
  foreignKey({ name: "preorder_batch_capacity_policy_batch_fk", columns: [table.batchId], foreignColumns: [productionBatches.id] }).onDelete("restrict").onUpdate("restrict"),
  check("preorder_batch_capacity_sales_state_chk", sql`${table.salesState} IN ('review_required','accepting','sales_closed','settling','consolidated','reconciliation_required')`),
  check("preorder_batch_capacity_pix_minutes_chk", sql`${table.pixReservationMinutes} BETWEEN 1 AND 10080`),
  check("preorder_batch_capacity_boleto_boolean_chk", sql`${table.boletoPreorderEnabled} IN (0, 1)`),
]);

export const preorderCapacityReservations = mysqlTable("preorderCapacityReservations", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  batchId: int("batchId").notNull(),
  orderId: int("orderId").notNull(),
  orderItemId: int("orderItemId").notNull(),
  productId: int("productId").notNull(),
  variantId: int("variantId"),
  quantity: int("quantity", { unsigned: true }).notNull(),
  paymentMethod: mysqlEnum("paymentMethod", ["PIX", "CARD", "BOLETO"]).notNull(),
  state: mysqlEnum("state", ["active", "allocated", "released", "expired", "exception"]).default("active").notNull(),
  commercialExpiresAt: timestamp("commercialExpiresAt", { fsp: 3 }),
  providerPaymentReference: varchar("providerPaymentReference", { length: 191 }),
  reconciliationCode: varchar("reconciliationCode", { length: 64 }),
  stateChangedAt: timestamp("stateChangedAt", { fsp: 3 }).defaultNow().notNull(),
  createdAt: timestamp("createdAt", { fsp: 3 }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { fsp: 3 }).defaultNow().onUpdateNow().notNull(),
}, table => [
  uniqueIndex("preorder_capacity_reservations_order_item_uq").on(table.orderItemId),
  index("preorder_capacity_reservations_batch_state_expiry_idx").on(table.batchId, table.state, table.commercialExpiresAt),
  index("preorder_capacity_reservations_order_state_idx").on(table.orderId, table.state),
  index("preorder_capacity_reservations_variant_idx").on(table.productId, table.variantId),
  index("preorder_capacity_reservations_variant_fk").on(table.variantId),
  index("preorder_capacity_reservations_provider_ref_idx").on(table.providerPaymentReference),
  foreignKey({ name: "preorder_capacity_reservations_batch_fk", columns: [table.batchId], foreignColumns: [productionBatches.id] }).onDelete("restrict").onUpdate("restrict"),
  foreignKey({ name: "preorder_capacity_reservations_order_fk", columns: [table.orderId], foreignColumns: [orders.id] }).onDelete("restrict").onUpdate("restrict"),
  foreignKey({ name: "preorder_capacity_reservations_item_fk", columns: [table.orderItemId], foreignColumns: [orderItems.id] }).onDelete("restrict").onUpdate("restrict"),
  foreignKey({ name: "preorder_capacity_reservations_product_fk", columns: [table.productId], foreignColumns: [products.id] }).onDelete("restrict").onUpdate("restrict"),
  foreignKey({ name: "preorder_capacity_reservations_variant_fk", columns: [table.variantId], foreignColumns: [productVariants.id] }).onDelete("restrict").onUpdate("restrict"),
  check("preorder_capacity_reservations_payment_method_chk", sql`${table.paymentMethod} IN ('PIX', 'CARD', 'BOLETO')`),
  check("preorder_capacity_reservations_state_chk", sql`${table.state} IN ('active', 'allocated', 'released', 'expired', 'exception')`),
  check("preorder_capacity_reservations_method_expiry_chk", sql`(${table.paymentMethod} = 'CARD' AND ${table.commercialExpiresAt} IS NULL) OR (${table.paymentMethod} IN ('PIX', 'BOLETO') AND ${table.commercialExpiresAt} IS NOT NULL)`),
  check("preorder_capacity_reservations_quantity_chk", sql`${table.quantity} > 0`),
  check("preorder_capacity_reservations_exception_reason_chk", sql`(${table.state} = 'exception' AND ${table.reconciliationCode} IS NOT NULL) OR (${table.state} <> 'exception' AND ${table.reconciliationCode} IS NULL)`),
]);

// Outbox persistente para notificações que pertencem a um pedido. A chave
// única impede que uma transição repetida volte a criar o mesmo evento.
export const orderEmailEvents = mysqlTable("orderEmailEvents", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").notNull(),
  eventType: mysqlEnum("eventType", ["order_delivered_email", "review_request_email"]).notNull(),
  status: mysqlEnum("status", ["pending", "processing", "sent", "failed"]).default("pending").notNull(),
  idempotencyKey: varchar("idempotencyKey", { length: 191 }).notNull(),
  scheduledAt: timestamp("scheduledAt"),
  providerMessageId: varchar("providerMessageId", { length: 191 }),
  attemptCount: int("attemptCount").default(0).notNull(),
  processingAt: timestamp("processingAt"),
  // Lease token held by the worker that owns this processing attempt.
  processingToken: varchar("processingToken", { length: 64 }),
  sentAt: timestamp("sentAt"),
  failedAt: timestamp("failedAt"),
  lastError: varchar("lastError", { length: 500 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  orderEventUnique: uniqueIndex("orderEmailEvents_order_event_unique").on(table.orderId, table.eventType),
}));

export type OrderEmailEvent = typeof orderEmailEvents.$inferSelect;

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

// Persisted public presentation mode for the Home highlights. The singleton is
// constrained to id=1 by the release migration; writes update this row only.
export const homeHighlightSettings = mysqlTable("homeHighlightSettings", {
  id: tinyint("id", { unsigned: true }).primaryKey(),
  displayMode: mysqlEnum("displayMode", ["single", "rotate"]).default("single").notNull(),
  rotationIntervalSeconds: tinyint("rotationIntervalSeconds", { unsigned: true }).default(8).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
  check("home_highlight_settings_singleton", sql`${table.id} = 1`),
  check("home_highlight_settings_interval", sql`${table.rotationIntervalSeconds} IN (5, 8, 10)`),
]);

export type HomeHighlightSettings = typeof homeHighlightSettings.$inferSelect;

// Auditoria administrativa
export const auditLogs = mysqlTable("auditLogs", {
  id: int("id").autoincrement().primaryKey(),
  actorUserId: int("actorUserId"),
  actorType: mysqlEnum("actorType", ["admin", "user", "system"]).default("admin").notNull(),
  action: varchar("action", { length: 120 }).notNull(),
  entity: varchar("entity", { length: 120 }).notNull(),
  entityId: varchar("entityId", { length: 120 }),
  metadata: text("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

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

export const asaasWebhookEvents = mysqlTable("asaasWebhookEvents", {
  id: int("id").autoincrement().primaryKey(),
  eventId: varchar("eventId", { length: 191 }).notNull().unique(),
  eventType: varchar("eventType", { length: 80 }).notNull(),
  paymentId: varchar("paymentId", { length: 120 }),
  checkoutId: varchar("checkoutId", { length: 120 }),
  orderId: int("orderId"),
  payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
  status: mysqlEnum("status", ["processing", "processed", "failed"]).default("processing").notNull(),
  processedAt: timestamp("processedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AsaasWebhookEvent = typeof asaasWebhookEvents.$inferSelect;
export type InsertAsaasWebhookEvent = typeof asaasWebhookEvents.$inferInsert;

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
  userId: int("userId").notNull(),
  orderId: int("orderId"),
  stockReservationId: int("stockReservationId"),
  rating: int("rating").notNull(),
  comment: text("comment"),
  sizePerception: mysqlEnum("sizePerception", ["small", "true_to_size", "large"]),
  imageUrl: varchar("imageUrl", { length: 500 }),
  imageStatus: mysqlEnum("imageStatus", ["none", "pending", "approved", "rejected"]).default("none").notNull(),
  moderationStatus: mysqlEnum("moderationStatus", ["published", "hidden_spam", "hidden_offensive"]).default("published").notNull(),
  verifiedPurchase: int("verifiedPurchase").default(0).notNull(),
  moderatedBy: int("moderatedBy"),
  moderatedAt: timestamp("moderatedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  reservationUnique: uniqueIndex("productReviews_reservation_unique").on(table.stockReservationId),
  productPublicationIdx: index("productReviews_product_publication_idx").on(
    table.productId,
    table.verifiedPurchase,
    table.moderationStatus,
    table.createdAt,
  ),
}));

export type ProductReview = typeof productReviews.$inferSelect;
export type InsertProductReview = typeof productReviews.$inferInsert;

// Uploads de fotos de avaliações ficam vinculados ao usuário antes de serem
// consumidos por uma avaliação. O token impede o uso de URLs arbitrárias.
export const productReviewUploads = mysqlTable("productReviewUploads", {
  token: varchar("token", { length: 64 }).primaryKey(),
  userId: int("userId").notNull(),
  productId: int("productId").notNull(),
  imageUrl: varchar("imageUrl", { length: 500 }).notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  claimedAt: timestamp("claimedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  ownerProductIdx: index("productReviewUploads_owner_product_idx").on(table.userId, table.productId),
  expiresAtIdx: index("productReviewUploads_expires_idx").on(table.expiresAt),
}));

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
});

export type StockReservation = typeof stockReservations.$inferSelect;
export type InsertStockReservation = typeof stockReservations.$inferInsert;

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

// Minimal financial envelope only; never provider headers/customer/contact data.
export const asaasWebhookInbox = mysqlTable("asaasWebhookInbox", {
  eventId: varchar("eventId", { length: 191 }).primaryKey(),
  payload: text("payload"),
  payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
  state: mysqlEnum("state", ["received", "processing", "processed", "failed", "rejected"]).default("received").notNull(),
  attempts: int("attempts").default(0).notNull(),
  errorCode: varchar("errorCode", { length: 64 }),
  nextAttemptAt: timestamp("nextAttemptAt"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [index("inbox_pending").on(table.state, table.nextAttemptAt, table.createdAt)]);
