import { index, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

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
});

export type Product = typeof products.$inferSelect;
export type InsertProduct = typeof products.$inferInsert;

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
});

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
  quantity: int("quantity").notNull(),
  price: int("price").notNull(), // preço no momento da compra
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

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
  actorUserId: int("actorUserId").notNull(),
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
  userProductUnique: uniqueIndex("productReviews_user_product_unique").on(table.userId, table.productId),
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
  quantity: int("quantity").notNull(),
  status: mysqlEnum("status", ["active", "consumed", "released", "expired"]).default("active").notNull(),
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
