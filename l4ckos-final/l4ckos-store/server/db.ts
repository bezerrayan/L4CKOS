import { and, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  users,
  products,
  InsertProduct,
  cartItems,
  orders,
  orderItems,
  favorites,
  productImages,
  productVariants,
  productReviews,
  coupons,
  auditLogs,
  localAuthUsers,
  userProfiles,
  userAddresses,
  userPaymentMethods,
  stockReservations,
  payments,
  paymentEvents,
  notificationOutbox,
  promoBanners,
  waitlistEmails,
  emailUnsubscribes,
  passwordResetTokens,
} from "../drizzle/schema";
import { ENV } from './_core/env';
import { buildVariantOptionKey, hasValidStockReservation } from "./services/checkoutIntegrity";
import {
  ASAAS_EVENT_TO_PAYMENT_STATUS,
  type FulfillmentStatus,
  type PaymentStatus,
  projectLegacyOrderStatus,
  transitionFulfillmentStatus,
  transitionPaymentStatus,
} from "./services/orderStateMachine";

let _db: ReturnType<typeof drizzle> | null = null;

type OrderShippingSnapshotInput = {
  recipient: string;
  zipCode: string;
  street: string;
  number: string;
  complement?: string | null;
  neighborhood: string;
  city: string;
  state: string;
};

function normalizeEmailAddress(email: string) {
  return String(email ?? "").trim().toLowerCase();
}

async function getPreferredUserAddress(userId: number) {
  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select({
      recipient: userAddresses.recipient,
      zipCode: userAddresses.zipCode,
      street: userAddresses.street,
      number: userAddresses.number,
      complement: userAddresses.complement,
      neighborhood: userAddresses.neighborhood,
      city: userAddresses.city,
      state: userAddresses.state,
      isDefault: userAddresses.isDefault,
      updatedAt: userAddresses.updatedAt,
    })
    .from(userAddresses)
    .where(eq(userAddresses.userId, userId));

  if (rows.length === 0) return null;

  return rows.reduce((best, row) => {
    if (!best) return row;
    const bestWeight = Number(best.isDefault ? 1 : 0) * 10_000_000_000_000 + new Date(best.updatedAt).getTime();
    const rowWeight = Number(row.isDefault ? 1 : 0) * 10_000_000_000_000 + new Date(row.updatedAt).getTime();
    return rowWeight > bestWeight ? row : best;
  }, rows[0] as (typeof rows)[number] | null);
}

function buildOrderShippingAddress(
  order: typeof orders.$inferSelect,
  fallbackAddress?: Awaited<ReturnType<typeof getPreferredUserAddress>>,
) {
  const hasSnapshot = Boolean(
    order.shippingZipCode ||
    order.shippingStreet ||
    order.shippingNeighborhood ||
    order.shippingCity ||
    order.shippingState,
  );

  if (hasSnapshot) {
    return {
      recipient: order.shippingRecipient || null,
      zipCode: order.shippingZipCode || null,
      street: order.shippingStreet || null,
      number: order.shippingNumber || null,
      complement: order.shippingComplement || null,
      neighborhood: order.shippingNeighborhood || null,
      city: order.shippingCity || null,
      state: order.shippingState || null,
      source: "order" as const,
    };
  }

  if (!fallbackAddress) return null;

  return {
    recipient: fallbackAddress.recipient || null,
    zipCode: fallbackAddress.zipCode || null,
    street: fallbackAddress.street || null,
    number: fallbackAddress.number || null,
    complement: fallbackAddress.complement || null,
    neighborhood: fallbackAddress.neighborhood || null,
    city: fallbackAddress.city || null,
    state: fallbackAddress.state || null,
    source: "profile" as const,
  };
}

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    const normalizedEmail = (user.email ?? "").trim().toLowerCase();
    const canBeAdmin = user.openId === ENV.ownerOpenId || ENV.adminEmails.includes(normalizedEmail);

    if (user.role !== undefined) {
      const safeRole = user.role === "admin" && !canBeAdmin ? "user" : user.role;
      values.role = safeRole;
      updateSet.role = safeRole;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    } else if (user.email && ENV.adminEmails.includes(user.email.trim().toLowerCase())) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUserById(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserPhoneById(userId: number) {
  const db = await getDb();
  if (!db) return undefined;

  const profile = await db
    .select({ phone: userProfiles.phone })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);

  return profile[0]?.phone ?? undefined;
}

export async function updateUserAsaasCustomerId(userId: number, asaasCustomerId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({ asaasCustomerId }).where(eq(users.id, userId));
}

export async function getWaitlistEmailByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const normalizedEmail = email.trim().toLowerCase();
  const rows = await db
    .select()
    .from(waitlistEmails)
    .where(eq(waitlistEmails.email, normalizedEmail))
    .limit(1);
  return rows[0];
}

export async function createWaitlistEmail(email: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const normalizedEmail = email.trim().toLowerCase();
  await db.insert(waitlistEmails).values({ email: normalizedEmail });
}

export async function getAllWaitlistEmails() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ email: waitlistEmails.email, createdAt: waitlistEmails.createdAt })
    .from(waitlistEmails)
    .orderBy(desc(waitlistEmails.id));
  return rows;
}

export async function isEmailUnsubscribed(email: string) {
  const db = await getDb();
  if (!db) return false;

  const normalizedEmail = normalizeEmailAddress(email);
  if (!normalizedEmail) return false;

  const rows = await db
    .select({ id: emailUnsubscribes.id })
    .from(emailUnsubscribes)
    .where(eq(emailUnsubscribes.email, normalizedEmail))
    .limit(1);

  return rows.length > 0;
}

export async function unsubscribeEmail(payload: { email: string; reason?: string | null; source?: string | null }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const normalizedEmail = normalizeEmailAddress(payload.email);
  if (!normalizedEmail) {
    throw new Error("Email is required");
  }

  return await db
    .insert(emailUnsubscribes)
    .values({
      email: normalizedEmail,
      reason: payload.reason ?? null,
      source: payload.source ?? null,
    })
    .onDuplicateKeyUpdate({
      set: {
        reason: payload.reason ?? null,
        source: payload.source ?? null,
        createdAt: sql`CURRENT_TIMESTAMP`,
      },
    });
}

export async function setOrderAsaasCheckoutId(orderId: number, asaasCheckoutId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(orders).set({ asaasCheckoutId }).where(eq(orders.id, orderId));
}

export async function getOrderByAsaasCheckoutId(asaasCheckoutId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(orders)
    .where(eq(orders.asaasCheckoutId, asaasCheckoutId))
    .limit(1);
  return rows[0];
}

// Produtos
export async function getProducts() {
  const db = await getDb();
  if (!db) return [];
  const productRows = await db.select().from(products);
  const imageRows = await db.select().from(productImages);

  const firstImageByProduct = new Map<number, string>();
  for (const item of imageRows) {
    if (!item.imageUrl || firstImageByProduct.has(item.productId)) continue;
    firstImageByProduct.set(item.productId, item.imageUrl);
  }

  return productRows.map(product => ({
    ...product,
    imageUrl: product.imageUrl || firstImageByProduct.get(product.id) || null,
  }));
}

export async function getProductById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(products).where(eq(products.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getProductsByIds(ids: number[]) {
  const db = await getDb();
  if (!db || ids.length === 0) return [];

  const uniqueIds = Array.from(new Set(ids.filter(id => Number.isInteger(id) && id > 0)));
  if (uniqueIds.length === 0) return [];

  return await db.select().from(products).where(inArray(products.id, uniqueIds));
}

export async function getProductVariantsByIds(ids: number[]) {
  const db = await getDb();
  if (!db || ids.length === 0) return [];
  const uniqueIds = Array.from(new Set(ids.filter(id => Number.isInteger(id) && id > 0)));
  if (uniqueIds.length === 0) return [];
  return await db.select().from(productVariants).where(inArray(productVariants.id, uniqueIds));
}

export function buildProductImageList(imageRows: Array<typeof productImages.$inferSelect>) {
  return imageRows.map(item => ({
    imageUrl: item.imageUrl,
    imageThumbnailUrl: item.imageThumbnailUrl ?? null,
    imageDetailUrl: item.imageDetailUrl ?? null,
    imageBannerUrl: item.imageBannerUrl ?? null,
    color: item.color ?? null,
    alt: item.alt ?? null,
    order: item.order,
  })).filter(item => item.imageUrl);
}

export async function getProductByIdWithDetails(id: number) {
  const db = await getDb();
  if (!db) return undefined;

  const productRows = await db.select().from(products).where(eq(products.id, id)).limit(1);
  if (productRows.length === 0) return undefined;

  const imageRows = await db
    .select()
    .from(productImages)
    .where(eq(productImages.productId, id))
    .orderBy(productImages.order);

  const variantRows = await db
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, id));

  return {
    ...productRows[0],
    imageUrl: productRows[0].imageUrl || imageRows[0]?.imageUrl || null,
    images: buildProductImageList(imageRows),
    variants: variantRows,
  };
}

export async function getProductReviews(productId: number) {
  const db = await getDb();
  if (!db) return [];

  const reviews = await db
    .select({
      id: productReviews.id,
      productId: productReviews.productId,
      userId: productReviews.userId,
      rating: productReviews.rating,
      comment: productReviews.comment,
      createdAt: productReviews.createdAt,
      updatedAt: productReviews.updatedAt,
      userName: users.name,
    })
    .from(productReviews)
    .leftJoin(users, eq(users.id, productReviews.userId))
    .where(eq(productReviews.productId, productId))
    .orderBy(desc(productReviews.id));

  return reviews;
}

export async function createOrUpdateProductReview(input: {
  productId: number;
  userId: number;
  rating: number;
  comment?: string;
}) {
  throw new Error("REVIEW_UPSERT_DISABLED_USE_REVIEW_CREATE");
/*

  const existing = await db
    .select()
    .from(productReviews)
    .where(and(eq(productReviews.productId, input.productId), eq(productReviews.userId, input.userId)))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(productReviews)
      .set({
        rating: input.rating,
        comment: input.comment?.trim() || null,
      })
      .where(eq(productReviews.id, existing[0].id));

    return { updated: true, id: existing[0].id } as const;
  }

  const result = await db.insert(productReviews).values({
    productId: input.productId,
    userId: input.userId,
    rating: input.rating,
    comment: input.comment?.trim() || null,
  });

  const insertedId = Number((result as any)?.[0]?.insertId ?? 0);
  return { updated: false, id: insertedId } as const;
*/
}

export function isVerifiedReviewPayment(payment: { status: string; confirmedAt: Date | null; receivedAt: Date | null } | undefined) {
  return Boolean(payment && ((payment.status === "confirmed" && payment.confirmedAt) || (payment.status === "received" && (payment.receivedAt || payment.confirmedAt))));
}

async function reviewPurchase(tx: any, userId: number, reservationId: number) {
  const [reservation] = await tx.select().from(stockReservations).where(eq(stockReservations.id, reservationId)).limit(1);
  if (!reservation || reservation.userId !== userId || reservation.status !== "consumed") return null;
  const [order] = await tx.select().from(orders).where(eq(orders.id, reservation.orderId)).limit(1);
  const [item] = reservation.orderItemId ? await tx.select().from(orderItems).where(eq(orderItems.id, reservation.orderItemId)).limit(1) : [];
  const [payment] = await tx.select().from(payments).where(eq(payments.orderId, reservation.orderId)).limit(1);
  if (!order || order.userId !== userId || order.fulfillmentStatus !== "delivered" || !item || reservation.orderItemId !== item.id || reservation.orderId !== item.orderId || reservation.productId !== item.productId || (reservation.variantId !== null && item.variantId !== null && reservation.variantId !== item.variantId) || !isVerifiedReviewPayment(payment)) return null;
  const [review] = await tx.select({ id: productReviews.id }).from(productReviews).where(eq(productReviews.stockReservationId, reservationId)).limit(1);
  return { reservation, order, item, alreadyReviewed: Boolean(review) };
}

export async function getReviewEligibility(userId: number, productId?: number) {
  const db = await getDb(); if (!db) throw new Error("Database not available");
  const rows = await db.select().from(stockReservations).where(eq(stockReservations.userId, userId));
  const result = [] as any[];
  for (const row of rows) { const purchase = await reviewPurchase(db, userId, row.id); if (purchase && (!productId || purchase.item.productId === productId)) result.push({ eligible: !purchase.alreadyReviewed, alreadyReviewed: purchase.alreadyReviewed, stockReservationId: row.id, orderId: purchase.order.id, productId: purchase.item.productId }); }
  return result;
}

export async function createVerifiedProductReview(input: { userId: number; stockReservationId: number; rating: number; comment?: string; sizePerception?: "small"|"true_to_size"|"large" }) {
  const db = await getDb(); if (!db) throw new Error("Database not available");
  try { return await db.transaction(async tx => { const purchase = await reviewPurchase(tx, input.userId, input.stockReservationId); if (!purchase) throw new Error("REVIEW_NOT_ELIGIBLE"); if (purchase.alreadyReviewed) throw new Error("ALREADY_REVIEWED"); const result = await tx.insert(productReviews).values({ userId: input.userId, productId: purchase.item.productId, orderId: purchase.order.id, stockReservationId: input.stockReservationId, rating: input.rating, comment: input.comment?.trim() || null, sizePerception: input.sizePerception, verifiedPurchase: 1 }); return { id: Number((result as any)[0]?.insertId || 0), verifiedPurchase: 1 }; }); } catch (error: any) { if (error?.code === "ER_DUP_ENTRY" || error?.errno === 1062) throw new Error("ALREADY_REVIEWED"); throw error; }
}

export async function createProduct(product: InsertProduct) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(products).values(product);
  return result;
}

export async function updateProduct(id: number, product: Partial<InsertProduct>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.update(products).set(product).where(eq(products.id, id));
}

export async function deleteProduct(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.delete(products).where(eq(products.id, id));
}

// Carrinho
export async function getCartItems(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(cartItems).where(eq(cartItems.userId, userId));
}

export async function addToCart(userId: number, productId: number, quantity: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.insert(cartItems).values({ userId, productId, quantity });
}

export async function removeFromCart(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.delete(cartItems).where(eq(cartItems.id, id));
}

export async function removeFromCartByUser(userId: number, id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.delete(cartItems).where(and(eq(cartItems.id, id), eq(cartItems.userId, userId)));
}

export async function clearCart(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.delete(cartItems).where(eq(cartItems.userId, userId));
}

// Pedidos
export async function createOrder(userId: number, totalPrice: number, shippingAddress?: OrderShippingSnapshotInput) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(orders).values({
    userId,
    totalPrice,
    ...(shippingAddress
      ? {
          shippingRecipient: shippingAddress.recipient,
          shippingZipCode: shippingAddress.zipCode,
          shippingStreet: shippingAddress.street,
          shippingNumber: shippingAddress.number,
          shippingComplement: shippingAddress.complement ?? null,
          shippingNeighborhood: shippingAddress.neighborhood,
          shippingCity: shippingAddress.city,
          shippingState: shippingAddress.state,
        }
      : {}),
  });
  return result;
}

export async function createOrderWithId(userId: number, totalPrice: number, shippingAddress?: OrderShippingSnapshotInput) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(orders).values({
    userId,
    totalPrice,
    ...(shippingAddress
      ? {
          shippingRecipient: shippingAddress.recipient,
          shippingZipCode: shippingAddress.zipCode,
          shippingStreet: shippingAddress.street,
          shippingNumber: shippingAddress.number,
          shippingComplement: shippingAddress.complement ?? null,
          shippingNeighborhood: shippingAddress.neighborhood,
          shippingCity: shippingAddress.city,
          shippingState: shippingAddress.state,
        }
      : {}),
  });
  const insertId = Number((result as any)?.[0]?.insertId ?? 0);

  if (!insertId) {
    throw new Error("Failed to create order id");
  }

  return insertId;
}

export async function getOrdersByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const [orderRows, paymentRows, fallbackAddress] = await Promise.all([
    db.select().from(orders).where(eq(orders.userId, userId)),
    db.select({ payment: payments, orderUserId: orders.userId }).from(payments).innerJoin(orders, eq(orders.id, payments.orderId)).where(eq(orders.userId, userId)),
    getPreferredUserAddress(userId),
  ]);
  const paymentByOrder = new Map(paymentRows.map(row => [row.payment.orderId, row.payment]));
  return orderRows.map(order => ({
    ...order,
    payment: paymentByOrder.get(order.id) ?? null,
    shippingAddress: buildOrderShippingAddress(order, fallbackAddress),
  }));
}

export async function getOrderByIdAndUser(orderId: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select({ order: orders, payment: payments })
    .from(orders)
    .leftJoin(payments, eq(payments.orderId, orders.id))
    .where(and(eq(orders.id, orderId), eq(orders.userId, userId)))
    .limit(1);

  const row = result[0];
  if (!row) return undefined;
  const order = row.order;
  const fallbackAddress = await getPreferredUserAddress(userId);
  return {
    ...order,
    payment: row.payment,
    shippingAddress: buildOrderShippingAddress(order, fallbackAddress),
  };
}

export async function getOrderById(orderId: number) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  return result[0];
}

type AtomicCheckoutItem = {
  productId: number;
  variantId?: number | null;
  quantity: number;
};

type AtomicCheckoutInput = {
  userId: number;
  checkoutAttemptId: string;
  checkoutFingerprint: string;
  method: "PIX" | "BOLETO" | "CARD";
  items: AtomicCheckoutItem[];
  shippingCents: number;
  couponCode?: string;
  shippingAddress: OrderShippingSnapshotInput;
};

function affectedRows(result: unknown) {
  const candidate = Array.isArray(result) ? result[0] : result;
  return Number((candidate as any)?.affectedRows ?? 0);
}

export async function getCheckoutByAttempt(checkoutAttemptId: string, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const rows = await db
    .select({ order: orders, payment: payments })
    .from(orders)
    .leftJoin(payments, eq(payments.orderId, orders.id))
    .where(and(eq(orders.checkoutAttemptId, checkoutAttemptId), eq(orders.userId, userId)))
    .limit(1);
  return rows[0];
}

export async function createCheckoutOrderAtomically(input: AtomicCheckoutInput) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await getCheckoutByAttempt(input.checkoutAttemptId, input.userId);
  if (existing) {
    if (existing.order.checkoutFingerprint !== input.checkoutFingerprint) {
      throw new Error("CHECKOUT_IDEMPOTENCY_CONFLICT");
    }
    return { ...existing, reused: true as const };
  }

  try {
    return await db.transaction(async tx => {
      const duplicate = await tx
        .select({ order: orders, payment: payments })
        .from(orders)
        .leftJoin(payments, eq(payments.orderId, orders.id))
        .where(eq(orders.checkoutAttemptId, input.checkoutAttemptId))
        .limit(1);
      if (duplicate[0]) {
        if (duplicate[0].order.userId !== input.userId || duplicate[0].order.checkoutFingerprint !== input.checkoutFingerprint) {
          throw new Error("CHECKOUT_IDEMPOTENCY_CONFLICT");
        }
        return { ...duplicate[0], reused: true as const };
      }

      const grouped = new Map<string, AtomicCheckoutItem>();
      for (const item of input.items) {
        const key = `${item.productId}:${item.variantId ?? "base"}`;
        const current = grouped.get(key);
        grouped.set(key, { ...item, quantity: (current?.quantity ?? 0) + item.quantity });
      }

      const normalizedItems = [...grouped.values()].sort(
        (a, b) => a.productId - b.productId || Number(a.variantId ?? 0) - Number(b.variantId ?? 0),
      );
      const productRows = await tx.select().from(products).where(inArray(products.id, normalizedItems.map(item => item.productId)));
      const productsById = new Map(productRows.map(product => [product.id, product]));
      if (productsById.size !== new Set(normalizedItems.map(item => item.productId)).size) {
        throw new Error("PRODUCT_NOT_FOUND");
      }

      const requestedVariantIds = normalizedItems
        .map(item => item.variantId)
        .filter((variantId): variantId is number => Boolean(variantId));
      const productVariantCondition = inArray(productVariants.productId, normalizedItems.map(item => item.productId));
      const variantRows = await tx
        .select()
        .from(productVariants)
        .where(
          requestedVariantIds.length > 0
            ? or(productVariantCondition, inArray(productVariants.id, requestedVariantIds))
            : productVariantCondition,
        );
      const variantsById = new Map(variantRows.map(variant => [variant.id, variant]));
      const productsWithVariants = new Set(variantRows.map(variant => variant.productId));

      const snapshots = normalizedItems.map(item => {
        const product = productsById.get(item.productId)!;
        const variant = item.variantId ? variantsById.get(item.variantId) : undefined;
        if (productsWithVariants.has(item.productId) && !variant) throw new Error("VARIANT_REQUIRED");
        if (variant && variant.productId !== item.productId) throw new Error("VARIANT_PRODUCT_MISMATCH");
        if (variant && !variant.optionKey) throw new Error("VARIANT_REQUIRES_RECONCILIATION");
        const unitPrice = Number(variant?.price ?? product.price);
        return { item, product, variant, unitPrice, totalPrice: unitPrice * item.quantity };
      });

      const itemsSubtotalCents = snapshots.reduce((sum, snapshot) => sum + snapshot.totalPrice, 0);
      const grossTotalCents = itemsSubtotalCents + input.shippingCents;
      let discountCents = 0;
      let appliedCouponId: number | null = null;

      if (input.couponCode) {
        const normalizedCode = input.couponCode.trim().toUpperCase();
        const now = new Date();
        const couponRows = await tx
          .select()
          .from(coupons)
          .where(and(eq(coupons.code, normalizedCode), eq(coupons.isActive, 1)))
          .limit(1);
        const coupon = couponRows[0];
        if (
          !coupon ||
          (coupon.startsAt && coupon.startsAt > now) ||
          (coupon.expiresAt && coupon.expiresAt < now) ||
          (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses)
        ) throw new Error("COUPON_INVALID");

        discountCents = coupon.type === "percent"
          ? Math.round(grossTotalCents * coupon.value / 100)
          : coupon.value * 100;
        discountCents = Math.min(grossTotalCents, discountCents);
        appliedCouponId = coupon.id;
      }

      const finalTotalCents = Math.max(0, grossTotalCents - discountCents);
      const orderInsert = await tx.insert(orders).values({
        userId: input.userId,
        totalPrice: finalTotalCents,
        correlationId: input.checkoutAttemptId,
        checkoutAttemptId: input.checkoutAttemptId,
        checkoutFingerprint: input.checkoutFingerprint,
        fulfillmentStatus: "awaiting_payment",
        shippingRecipient: input.shippingAddress.recipient,
        shippingZipCode: input.shippingAddress.zipCode,
        shippingStreet: input.shippingAddress.street,
        shippingNumber: input.shippingAddress.number,
        shippingComplement: input.shippingAddress.complement ?? null,
        shippingNeighborhood: input.shippingAddress.neighborhood,
        shippingCity: input.shippingAddress.city,
        shippingState: input.shippingAddress.state,
        couponId: appliedCouponId,
      });
      const orderId = Number((orderInsert as any)?.[0]?.insertId ?? 0);
      if (!orderId) throw new Error("ORDER_CREATE_FAILED");

      const expiresAt = new Date(Date.now() + 20 * 60 * 1000);
      for (const snapshot of snapshots) {
        if (snapshot.variant) {
          const variantUpdate = await tx
            .update(productVariants)
            .set({ stock: sql`${productVariants.stock} - ${snapshot.item.quantity}` })
            .where(and(eq(productVariants.id, snapshot.variant.id), gte(productVariants.stock, snapshot.item.quantity)));
          if (affectedRows(variantUpdate) !== 1) throw new Error("INSUFFICIENT_VARIANT_STOCK");
        }

        const productUpdate = await tx
          .update(products)
          .set({ stock: sql`${products.stock} - ${snapshot.item.quantity}` })
          .where(and(eq(products.id, snapshot.product.id), gte(products.stock, snapshot.item.quantity)));
        if (affectedRows(productUpdate) !== 1) throw new Error("INSUFFICIENT_PRODUCT_STOCK");

        const itemInsert = await tx.insert(orderItems).values({
          orderId,
          productId: snapshot.product.id,
          variantId: snapshot.variant?.id ?? null,
          productName: snapshot.product.name,
          variantName: snapshot.variant?.name ?? null,
          sku: snapshot.variant?.sku ?? null,
          size: snapshot.variant?.size ?? null,
          color: snapshot.variant?.color ?? null,
          quantity: snapshot.item.quantity,
          unitPrice: snapshot.unitPrice,
          totalPrice: snapshot.totalPrice,
          imageUrl: snapshot.product.imageUrl ?? null,
        });
        const orderItemId = Number((itemInsert as any)?.[0]?.insertId ?? 0);
        if (!orderItemId) throw new Error("ORDER_ITEM_CREATE_FAILED");

        await tx.insert(stockReservations).values({
          orderId,
          orderItemId,
          userId: input.userId,
          productId: snapshot.product.id,
          variantId: snapshot.variant?.id ?? null,
          quantity: snapshot.item.quantity,
          status: "active",
          expiresAt,
        });
      }

      const externalReference = `L4CKOS-ORDER-${orderId}`;
      const paymentInsert = await tx.insert(payments).values({
        orderId,
        provider: "asaas",
        billingType: input.method,
        amount: finalTotalCents,
        status: "pending",
        creationStatus: "not_started",
        externalReference,
      });
      const paymentId = Number((paymentInsert as any)?.[0]?.insertId ?? 0);

      await tx.insert(auditLogs).values([
        { actorUserId: input.userId, actorType: "user", action: "order_created", entity: "order", entityId: String(orderId), orderId, paymentId, event: "checkout", correlationId: input.checkoutAttemptId, afterState: JSON.stringify({ fulfillmentStatus: "awaiting_payment", totalPrice: finalTotalCents }) },
        { actorUserId: input.userId, actorType: "user", action: "stock_reserved", entity: "order", entityId: String(orderId), orderId, paymentId, event: "checkout", correlationId: input.checkoutAttemptId, afterState: JSON.stringify({ items: snapshots.length, expiresAt }) },
        { actorUserId: input.userId, actorType: "user", action: "payment_created", entity: "payment", entityId: String(paymentId), orderId, paymentId, event: "checkout", correlationId: input.checkoutAttemptId, afterState: JSON.stringify({ status: "pending", amount: finalTotalCents, provider: "asaas" }) },
      ]);

      if (appliedCouponId) {
        await tx.update(coupons).set({ usedCount: sql`${coupons.usedCount} + 1` }).where(eq(coupons.id, appliedCouponId));
      }

      const orderRows = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      const paymentRows = await tx.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
      return {
        order: orderRows[0],
        payment: paymentRows[0],
        reused: false as const,
        snapshots,
        pricing: { itemsSubtotalCents, shippingCents: input.shippingCents, discountCents, finalTotalCents },
      };
    });
  } catch (error) {
    const duplicate = await getCheckoutByAttempt(input.checkoutAttemptId, input.userId);
    if (duplicate) {
      if (duplicate.order.checkoutFingerprint !== input.checkoutFingerprint) throw new Error("CHECKOUT_IDEMPOTENCY_CONFLICT");
      return { ...duplicate, reused: true as const };
    }
    throw error;
  }
}

export async function claimPaymentCreation(paymentId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + 60_000);
  const result = await db
    .update(payments)
    .set({ creationStatus: "creating", creationLeaseExpiresAt: leaseExpiresAt })
    .where(and(
      eq(payments.id, paymentId),
      or(
        inArray(payments.creationStatus, ["not_started", "unknown", "failed"]),
        and(eq(payments.creationStatus, "creating"), lt(payments.creationLeaseExpiresAt, now)),
      ),
    ));
  return affectedRows(result) === 1;
}

export async function getPaymentById(paymentId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
  return rows[0];
}

export async function getPaymentsForReconciliation(limit = 100) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.select().from(payments)
    .where(and(inArray(payments.status, ["pending", "overdue", "failed", "chargeback"]), isNull(payments.financialIssue)))
    .orderBy(payments.updatedAt)
    .limit(Math.max(1, Math.min(limit, 500)));
}

export async function completePaymentCreation(paymentId: number, data: {
  providerPaymentId: string;
  providerCustomerId?: string | null;
  billingType?: string | null;
  invoiceUrl?: string | null;
  bankSlipUrl?: string | null;
  pixQrCode?: string | null;
  pixCopyPaste?: string | null;
  digitableLine?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(payments).set({
    providerPaymentId: data.providerPaymentId,
    providerCustomerId: data.providerCustomerId ?? null,
    billingType: data.billingType || undefined,
    invoiceUrl: data.invoiceUrl ?? null,
    bankSlipUrl: data.bankSlipUrl ?? null,
    pixQrCode: data.pixQrCode ?? null,
    pixCopyPaste: data.pixCopyPaste ?? null,
    digitableLine: data.digitableLine ?? null,
    creationStatus: "created",
    creationLeaseExpiresAt: null,
  }).where(eq(payments.id, paymentId));
  const paymentRows = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
  const payment = paymentRows[0];
  if (payment) await db.insert(auditLogs).values({ actorUserId: null, actorType: "system", action: "external_charge_created", entity: "payment", entityId: String(paymentId), orderId: payment.orderId, paymentId, event: "asaas_charge_created", correlationId: payment.externalReference, afterState: JSON.stringify({ providerPaymentId: data.providerPaymentId, creationStatus: "created" }) });
}

export async function markPaymentCreationUnknown(paymentId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(payments).set({ creationStatus: "unknown", creationLeaseExpiresAt: null }).where(eq(payments.id, paymentId));
}

export async function releaseExpiredStockReservations(now = new Date(), batchSize = 100) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const candidates = await db.select().from(stockReservations)
    .where(and(eq(stockReservations.status, "active"), lte(stockReservations.expiresAt, now)))
    .orderBy(stockReservations.expiresAt)
    .limit(Math.max(1, Math.min(batchSize, 500)));
  let released = 0;
  let protectedPaid = 0;
  let failed = 0;
  for (const candidate of candidates) {
    try {
      await db.transaction(async tx => {
        await tx.execute(sql`SELECT id FROM stockReservations WHERE id = ${candidate.id} FOR UPDATE`);
        await tx.execute(sql`SELECT id FROM orders WHERE id = ${candidate.orderId} FOR UPDATE`);
        const orderRows = await tx.select().from(orders).where(eq(orders.id, candidate.orderId)).limit(1);
        const order = orderRows[0];
        const paymentRows = await tx.select().from(payments).where(eq(payments.orderId, candidate.orderId)).limit(1);
        const payment = paymentRows[0];
        if (payment && ["confirmed", "received", "partially_refunded"].includes(payment.status)) {
          const consumed = await tx.update(stockReservations).set({ status: "consumed" })
            .where(and(eq(stockReservations.id, candidate.id), eq(stockReservations.status, "active")));
          if (affectedRows(consumed) === 1) {
            protectedPaid += 1;
            await tx.insert(auditLogs).values({ actorUserId: null, actorType: "system", action: "reservation_expiry_paid_protected", entity: "stockReservation", entityId: String(candidate.id), orderId: candidate.orderId, paymentId: payment.id, event: "reservation_expiry", correlationId: payment.externalReference, beforeState: JSON.stringify({ status: "active" }), afterState: JSON.stringify({ status: "consumed" }) });
          }
          return;
        }
        const claimed = await tx.update(stockReservations).set({ status: "expired" }).where(and(eq(stockReservations.id, candidate.id), eq(stockReservations.status, "active"), lte(stockReservations.expiresAt, now)));
        if (affectedRows(claimed) !== 1) return;
        await tx.update(products).set({ stock: sql`${products.stock} + ${candidate.quantity}` }).where(eq(products.id, candidate.productId));
        if (candidate.variantId) await tx.update(productVariants).set({ stock: sql`${productVariants.stock} + ${candidate.quantity}` }).where(eq(productVariants.id, candidate.variantId));
        await tx.insert(auditLogs).values({ actorUserId: null, actorType: "system", action: "reservation_expired", entity: "stockReservation", entityId: String(candidate.id), orderId: candidate.orderId, paymentId: payment?.id ?? null, event: "reservation_expiry", correlationId: payment?.externalReference ?? null, beforeState: JSON.stringify({ status: "active" }), afterState: JSON.stringify({ status: "expired" }) });
        const remainingRows = await tx.select({ total: sql<number>`count(*)` }).from(stockReservations).where(and(eq(stockReservations.orderId, candidate.orderId), eq(stockReservations.status, "active")));
        if (order && Number(remainingRows[0]?.total ?? 0) === 0) {
          if (order.couponId && !order.couponReleasedAt) {
            await tx.update(coupons).set({ usedCount: sql`greatest(${coupons.usedCount} - 1, 0)` }).where(eq(coupons.id, order.couponId));
          }
          await tx.update(orders).set({
            fulfillmentStatus: "cancelled",
            fulfillmentIssue: "RESERVATION_EXPIRED_UNPAID",
            fulfillmentIssueAt: now,
            couponReleasedAt: order.couponId && !order.couponReleasedAt ? now : order.couponReleasedAt,
            status: projectLegacyOrderStatus(payment?.status as PaymentStatus | undefined, "cancelled"),
          }).where(eq(orders.id, candidate.orderId));
        }
        released += 1;
      });
    } catch (error) {
      failed += 1;
      await db.insert(auditLogs).values({ actorUserId: null, actorType: "system", action: "reservation_expiry_failed", entity: "stockReservation", entityId: String(candidate.id), orderId: candidate.orderId, event: "reservation_expiry", metadata: JSON.stringify({ error: error instanceof Error ? error.name : "unknown" }) });
    }
  }
  return { scanned: candidates.length, released, protectedPaid, failed };
}

export async function getOrderByTrackingCodeAndUser(trackingCode: string, userId: number) {
  const db = await getDb();
  if (!db) return undefined;

  const normalizedTrackingCode = trackingCode.trim();
  if (!normalizedTrackingCode) return undefined;

  const result = await db
    .select({ order: orders, payment: payments })
    .from(orders)
    .leftJoin(payments, eq(payments.orderId, orders.id))
    .where(and(eq(orders.trackingCode, normalizedTrackingCode), eq(orders.userId, userId)))
    .limit(1);

  const row = result[0];
  if (!row) return undefined;
  const order = row.order;
  const fallbackAddress = await getPreferredUserAddress(userId);
  return {
    ...order,
    payment: row.payment,
    shippingAddress: buildOrderShippingAddress(order, fallbackAddress),
  };
}

export async function getOrderReservationItems(orderId: number) {
  const db = await getDb();
  if (!db) return [];

  const items = await db
    .select({
      id: orderItems.id,
      orderId: orderItems.orderId,
      productId: orderItems.productId,
      variantId: orderItems.variantId,
      quantity: orderItems.quantity,
      productName: orderItems.productName,
      variantName: orderItems.variantName,
      sku: orderItems.sku,
      size: orderItems.size,
      color: orderItems.color,
      productImage: orderItems.imageUrl,
      unitPrice: orderItems.unitPrice,
      productPrice: orderItems.unitPrice,
      totalPrice: orderItems.totalPrice,
      status: stockReservations.status,
      expiresAt: stockReservations.expiresAt,
      reservationStatus: stockReservations.status,
      reservationExpiresAt: stockReservations.expiresAt,
      createdAt: orderItems.createdAt,
    })
    .from(orderItems)
    .leftJoin(stockReservations, eq(stockReservations.orderItemId, orderItems.id))
    .where(eq(orderItems.orderId, orderId))
    .orderBy(desc(orderItems.id));

  return items;
}

function orderIdFromExternalReference(reference?: string | null) {
  const normalized = String(reference ?? "").trim();
  const match = normalized.match(/^(?:L4CKOS-ORDER-)?(\d+)$/);
  const value = match ? Number(match[1]) : 0;
  return Number.isInteger(value) && value > 0 ? value : null;
}

export async function processAsaasPaymentEvent(input: {
  providerEventId: string;
  eventType: string;
  providerPaymentId?: string | null;
  externalReference?: string | null;
  amountCents?: number | null;
  refundedAmountCents?: number | null;
  sanitizedPayload: string;
  source?: "webhook" | "reconciliation";
  correlationId?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db.select().from(paymentEvents).where(eq(paymentEvents.providerEventId, input.providerEventId)).limit(1);
  if (existing[0]) return { duplicate: true as const, event: existing[0], notificationCreated: false };

  try {
    return await db.transaction(async tx => {
      const duplicate = await tx.select().from(paymentEvents).where(eq(paymentEvents.providerEventId, input.providerEventId)).limit(1);
      if (duplicate[0]) return { duplicate: true as const, event: duplicate[0], notificationCreated: false };

      const byProviderId = input.providerPaymentId
        ? await tx.select().from(payments).where(eq(payments.providerPaymentId, input.providerPaymentId)).limit(1)
        : [];
      const byExternalReference = input.externalReference
        ? await tx.select().from(payments).where(eq(payments.externalReference, input.externalReference)).limit(1)
        : [];
      let payment = byProviderId[0] ?? byExternalReference[0];
      const referencedOrderId = orderIdFromExternalReference(input.externalReference);
      const orderId = payment?.orderId ?? referencedOrderId;

      const eventInsert = await tx.insert(paymentEvents).values({
        provider: "asaas",
        providerEventId: input.providerEventId,
        paymentId: payment?.id ?? null,
        orderId,
        providerPaymentId: input.providerPaymentId ?? null,
        eventType: input.eventType,
        processingStatus: "processing",
        payload: input.sanitizedPayload,
      });
      const eventId = Number((eventInsert as any)?.[0]?.insertId ?? 0);

      if (!payment || !orderId) {
        await tx.update(paymentEvents).set({ processingStatus: "conflict", errorCode: "PAYMENT_NOT_RECONCILED", processedAt: new Date() }).where(eq(paymentEvents.id, eventId));
        await tx.insert(auditLogs).values({ actorUserId: null, actorType: "system", action: "payment_webhook_conflict", entity: "paymentEvent", entityId: String(eventId), metadata: JSON.stringify({ reason: "PAYMENT_NOT_RECONCILED", providerPaymentId: input.providerPaymentId, externalReference: input.externalReference }) });
        return { duplicate: false as const, conflict: true as const, reason: "PAYMENT_NOT_RECONCILED", orderId, eventId, notificationCreated: false };
      }

      await tx.execute(sql`SELECT id FROM payments WHERE id = ${payment.id} FOR UPDATE`);
      const lockedPaymentRows = await tx.select().from(payments).where(eq(payments.id, payment.id)).limit(1);
      payment = lockedPaymentRows[0];
      if (!payment) throw new Error("Payment disappeared while processing event");

      const orderRows = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      const order = orderRows[0];
      const referenceMismatch = Boolean(input.externalReference && input.externalReference !== payment.externalReference);
      const providerMismatch = Boolean(payment.providerPaymentId && input.providerPaymentId && payment.providerPaymentId !== input.providerPaymentId);
      const amountMismatch = input.amountCents !== null && input.amountCents !== undefined && input.amountCents !== payment.amount;
      if (!order || referenceMismatch || providerMismatch || amountMismatch) {
        const reason = !order ? "ORDER_NOT_FOUND" : referenceMismatch ? "EXTERNAL_REFERENCE_MISMATCH" : providerMismatch ? "PROVIDER_PAYMENT_MISMATCH" : "PAYMENT_AMOUNT_MISMATCH";
        await tx.update(paymentEvents).set({ processingStatus: "conflict", errorCode: reason, processedAt: new Date() }).where(eq(paymentEvents.id, eventId));
        await tx.update(payments).set({ financialIssue: reason, financialIssueAt: new Date() }).where(eq(payments.id, payment.id));
        if (order && !["shipped", "delivered", "cancelled"].includes(order.fulfillmentStatus)) {
          await tx.update(orders).set({
            fulfillmentStatus: "on_hold",
            fulfillmentIssue: "FINANCIAL_EXCEPTION",
            fulfillmentIssueAt: new Date(),
            status: projectLegacyOrderStatus(payment.status as PaymentStatus, "on_hold"),
          }).where(eq(orders.id, orderId));
        }
        await tx.insert(auditLogs).values({ actorUserId: null, actorType: "system", action: "financial_exception", entity: "paymentEvent", entityId: String(eventId), orderId, paymentId: payment.id, event: input.eventType, correlationId: input.correlationId ?? payment.externalReference, beforeState: JSON.stringify({ payment: payment.status, fulfillment: order?.fulfillmentStatus }), afterState: JSON.stringify({ financialIssue: reason }), metadata: JSON.stringify({ reason }) });
        return { duplicate: false as const, conflict: true as const, reason, orderId, eventId, notificationCreated: false };
      }

      const incomingStatus = ASAAS_EVENT_TO_PAYMENT_STATUS[input.eventType];
      if (!incomingStatus) {
        await tx.update(paymentEvents).set({ processingStatus: "ignored", processedAt: new Date() }).where(eq(paymentEvents.id, eventId));
        return { duplicate: false as const, ignored: true as const, orderId, eventId, notificationCreated: false };
      }

      const chargebackReversal = payment.status === "chargeback"
        && (incomingStatus === "confirmed" || incomingStatus === "received")
        && order.fulfillmentIssue === "CHARGEBACK_AWAITING_REVERSAL";
      const transition = transitionPaymentStatus(payment.status as PaymentStatus, incomingStatus, {
        source: input.source ?? "webhook",
        chargebackReversal,
      });
      if (transition.decision !== "allowed") {
        await tx.update(paymentEvents).set({
          processingStatus: transition.decision === "ignored" ? "ignored" : "conflict",
          errorCode: transition.reason,
          processedAt: new Date(),
        }).where(eq(paymentEvents.id, eventId));
        await tx.insert(auditLogs).values({ actorUserId: null, actorType: "system", action: `payment_transition_${transition.decision}`, entity: "payment", entityId: String(payment.id), orderId, paymentId: payment.id, event: input.eventType, correlationId: input.correlationId ?? payment.externalReference, beforeState: JSON.stringify({ status: payment.status }), afterState: JSON.stringify({ requestedStatus: incomingStatus }), metadata: JSON.stringify({ reason: transition.reason }) });
        return { duplicate: false as const, ignored: transition.decision === "ignored", conflict: transition.decision !== "ignored", reason: transition.reason, orderId, paymentId: payment.id, eventId, notificationCreated: false };
      }

      const now = new Date();
      let paidAmount = payment.paidAmount;
      let refundedAmount = payment.refundedAmount;
      if (incomingStatus === "confirmed" || incomingStatus === "received") paidAmount = payment.amount;
      if (incomingStatus === "partially_refunded") {
        if (!Number.isInteger(input.refundedAmountCents) || Number(input.refundedAmountCents) <= 0) {
          await tx.update(paymentEvents).set({ processingStatus: "conflict", errorCode: "REFUND_AMOUNT_MISSING", processedAt: now }).where(eq(paymentEvents.id, eventId));
          return { duplicate: false as const, conflict: true as const, reason: "REFUND_AMOUNT_MISSING", orderId, paymentId: payment.id, eventId, notificationCreated: false };
        }
        refundedAmount = Number(input.refundedAmountCents);
      }
      if (incomingStatus === "refunded") refundedAmount = payment.amount;
      if (refundedAmount > Math.max(paidAmount, payment.amount)) {
        await tx.update(paymentEvents).set({ processingStatus: "conflict", errorCode: "REFUND_EXCEEDS_PAID_AMOUNT", processedAt: now }).where(eq(paymentEvents.id, eventId));
        await tx.update(payments).set({ financialIssue: "REFUND_EXCEEDS_PAID_AMOUNT", financialIssueAt: now }).where(eq(payments.id, payment.id));
        return { duplicate: false as const, conflict: true as const, reason: "REFUND_EXCEEDS_PAID_AMOUNT", orderId, paymentId: payment.id, eventId, notificationCreated: false };
      }

      await tx.update(payments).set({
        status: incomingStatus,
        statusSource: input.source === "reconciliation" ? "reconciliation" : "provider",
        providerPaymentId: payment.providerPaymentId ?? input.providerPaymentId ?? null,
        paidAmount,
        refundedAmount,
        netAmount: Math.max(0, paidAmount - refundedAmount),
        confirmedAt: incomingStatus === "confirmed" || incomingStatus === "received" ? (payment.confirmedAt ?? now) : payment.confirmedAt,
        receivedAt: incomingStatus === "received" ? (payment.receivedAt ?? now) : payment.receivedAt,
        refundedAt: incomingStatus === "refunded" || incomingStatus === "partially_refunded" ? now : payment.refundedAt,
        financialIssue: chargebackReversal ? null : payment.financialIssue,
        financialIssueAt: chargebackReversal ? null : payment.financialIssueAt,
      }).where(eq(payments.id, payment.id));

      let fulfillmentConflict = false;
      let nextFulfillment = order.fulfillmentStatus as FulfillmentStatus;
      let nextIssue = order.fulfillmentIssue;
      if (incomingStatus === "confirmed" || incomingStatus === "received") {
        if (!["ready", "processing", "shipped", "delivered"].includes(order.fulfillmentStatus)) {
        const itemCountRows = await tx.select({ total: sql<number>`count(*)` }).from(orderItems).where(eq(orderItems.orderId, orderId));
        const reservations = await tx.select().from(stockReservations).where(eq(stockReservations.orderId, orderId));
        const expectedItems = Number(itemCountRows[0]?.total ?? 0);
        if (hasValidStockReservation(expectedItems, reservations, now)) {
          await tx.update(stockReservations).set({ status: "consumed" }).where(and(eq(stockReservations.orderId, orderId), eq(stockReservations.status, "active")));
          await tx.insert(auditLogs).values({ actorUserId: null, actorType: "system", action: "stock_consumed", entity: "order", entityId: String(orderId), orderId, paymentId: payment.id, event: input.eventType, correlationId: input.correlationId ?? payment.externalReference, beforeState: JSON.stringify({ reservationStatus: "active" }), afterState: JSON.stringify({ reservationStatus: "consumed" }) });
          nextFulfillment = "ready";
          nextIssue = null;
        } else {
          fulfillmentConflict = true;
          for (const reservation of reservations.filter(row => row.status === "active")) {
            const claimed = await tx.update(stockReservations).set({ status: "released" }).where(and(eq(stockReservations.id, reservation.id), eq(stockReservations.status, "active")));
            if (affectedRows(claimed) !== 1) continue;
            await tx.update(products).set({ stock: sql`${products.stock} + ${reservation.quantity}` }).where(eq(products.id, reservation.productId));
            if (reservation.variantId) await tx.update(productVariants).set({ stock: sql`${productVariants.stock} + ${reservation.quantity}` }).where(eq(productVariants.id, reservation.variantId));
          }
          nextFulfillment = "inventory_exception";
          nextIssue = "PAYMENT_CONFIRMED_WITHOUT_STOCK";
          await tx.insert(auditLogs).values({ actorUserId: null, actorType: "system", action: "payment_confirmed_inventory_exception", entity: "order", entityId: String(orderId), orderId, paymentId: payment.id, event: input.eventType, correlationId: input.correlationId ?? payment.externalReference, beforeState: JSON.stringify({ fulfillmentStatus: order.fulfillmentStatus }), afterState: JSON.stringify({ fulfillmentStatus: nextFulfillment, issue: nextIssue }), metadata: JSON.stringify({ providerEventId: input.providerEventId }) });
        }
      }
      } else if (incomingStatus === "refunded") {
        if (order.fulfillmentStatus === "ready") {
          const consumed = await tx.select().from(stockReservations).where(and(eq(stockReservations.orderId, orderId), eq(stockReservations.status, "consumed")));
          for (const reservation of consumed) {
            const claimed = await tx.update(stockReservations).set({ status: "restocked" }).where(and(eq(stockReservations.id, reservation.id), eq(stockReservations.status, "consumed")));
            if (affectedRows(claimed) !== 1) continue;
            await tx.update(products).set({ stock: sql`${products.stock} + ${reservation.quantity}` }).where(eq(products.id, reservation.productId));
            if (reservation.variantId) await tx.update(productVariants).set({ stock: sql`${productVariants.stock} + ${reservation.quantity}` }).where(eq(productVariants.id, reservation.variantId));
          }
          nextFulfillment = "cancelled";
          nextIssue = "FULL_REFUND_BEFORE_PROCESSING";
        } else if (["processing", "shipped", "delivered"].includes(order.fulfillmentStatus)) {
          nextIssue = "REFUND_REQUIRES_PHYSICAL_RETURN_REVIEW";
        }
      } else if (incomingStatus === "chargeback") {
        if (["awaiting_payment", "ready", "processing", "inventory_exception"].includes(order.fulfillmentStatus)) nextFulfillment = "on_hold";
        nextIssue = input.eventType === "PAYMENT_AWAITING_CHARGEBACK_REVERSAL"
          ? "CHARGEBACK_AWAITING_REVERSAL"
          : ["shipped", "delivered"].includes(order.fulfillmentStatus) ? "CHARGEBACK_AFTER_SHIPMENT" : "CHARGEBACK";
      } else if (incomingStatus === "cancelled" && order.fulfillmentStatus === "awaiting_payment") {
        const active = await tx.select().from(stockReservations).where(and(eq(stockReservations.orderId, orderId), eq(stockReservations.status, "active")));
        for (const reservation of active) {
          const claimed = await tx.update(stockReservations).set({ status: "released" }).where(and(eq(stockReservations.id, reservation.id), eq(stockReservations.status, "active")));
          if (affectedRows(claimed) !== 1) continue;
          await tx.update(products).set({ stock: sql`${products.stock} + ${reservation.quantity}` }).where(eq(products.id, reservation.productId));
          if (reservation.variantId) await tx.update(productVariants).set({ stock: sql`${productVariants.stock} + ${reservation.quantity}` }).where(eq(productVariants.id, reservation.variantId));
        }
        if (order.couponId && !order.couponReleasedAt) {
          await tx.update(coupons).set({ usedCount: sql`greatest(${coupons.usedCount} - 1, 0)` }).where(eq(coupons.id, order.couponId));
          await tx.update(orders).set({ couponReleasedAt: now }).where(eq(orders.id, orderId));
        }
        nextFulfillment = "cancelled";
        nextIssue = "PROVIDER_PAYMENT_DELETED";
      }

      await tx.update(orders).set({
        fulfillmentStatus: nextFulfillment,
        fulfillmentIssue: nextIssue,
        fulfillmentIssueAt: nextIssue ? now : null,
        status: projectLegacyOrderStatus(incomingStatus, nextFulfillment),
      }).where(eq(orders.id, orderId));

      const notificationType = incomingStatus === "confirmed" || incomingStatus === "received"
        ? "payment-approved"
        : incomingStatus === "failed" ? "payment-failed"
          : incomingStatus === "partially_refunded" || incomingStatus === "refunded" ? "payment-refunded"
            : incomingStatus === "chargeback" ? "payment-chargeback" : null;
      let notificationCreated = false;
      if (notificationType) {
      const outboxInsert = await tx.insert(notificationOutbox).values({
        dedupeKey: `${notificationType}:${payment.id}:${incomingStatus}:${refundedAmount}`,
        type: notificationType,
        orderId,
        paymentId: payment.id,
        payload: JSON.stringify({ orderId, paymentId: payment.id }),
      }).onDuplicateKeyUpdate({ set: { dedupeKey: sql`${notificationOutbox.dedupeKey}` } });
      notificationCreated = affectedRows(outboxInsert) === 1;
      }

      await tx.insert(auditLogs).values({
          actorUserId: null,
          actorType: "system",
          action: input.source === "reconciliation" ? "payment_reconciled" : "payment_webhook_processed",
          entity: "payment",
          entityId: String(payment.id),
          orderId,
          paymentId: payment.id,
          event: input.eventType,
          correlationId: input.correlationId ?? payment.externalReference,
          beforeState: JSON.stringify({ paymentStatus: payment.status, fulfillmentStatus: order.fulfillmentStatus, refundedAmount: payment.refundedAmount }),
          afterState: JSON.stringify({ paymentStatus: incomingStatus, fulfillmentStatus: nextFulfillment, refundedAmount }),
          metadata: JSON.stringify({ providerEventId: input.providerEventId }),
        });
      const criticalAction = incomingStatus === "refunded" || incomingStatus === "partially_refunded" ? "payment_refunded"
        : incomingStatus === "chargeback" ? "payment_chargeback"
          : incomingStatus === "confirmed" ? "payment_confirmed"
            : incomingStatus === "received" ? "payment_received" : null;
      if (criticalAction) await tx.insert(auditLogs).values({ actorUserId: null, actorType: "system", action: criticalAction, entity: "payment", entityId: String(payment.id), orderId, paymentId: payment.id, event: input.eventType, correlationId: input.correlationId ?? payment.externalReference, beforeState: JSON.stringify({ status: payment.status }), afterState: JSON.stringify({ status: incomingStatus, paidAmount, refundedAmount, netAmount: Math.max(0, paidAmount - refundedAmount) }) });
      await tx.update(paymentEvents).set({ processingStatus: fulfillmentConflict ? "conflict" : "processed", errorCode: fulfillmentConflict ? "PAYMENT_CONFIRMED_WITHOUT_STOCK" : null, processedAt: now }).where(eq(paymentEvents.id, eventId));
      return { duplicate: false as const, financialStatus: incomingStatus, conflict: fulfillmentConflict, reason: fulfillmentConflict ? "PAYMENT_CONFIRMED_WITHOUT_STOCK" : null, orderId, paymentId: payment.id, eventId, notificationCreated };
    });
  } catch (error) {
    const duplicate = await db.select().from(paymentEvents).where(eq(paymentEvents.providerEventId, input.providerEventId)).limit(1);
    if (duplicate[0]) return { duplicate: true as const, event: duplicate[0], notificationCreated: false };
    throw error;
  }
}

export async function markNotificationSent(paymentId: number, type = "payment-approved") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(notificationOutbox).set({ status: "sent", sentAt: new Date(), attempts: sql`${notificationOutbox.attempts} + 1` }).where(and(eq(notificationOutbox.paymentId, paymentId), eq(notificationOutbox.type, type)));
}

export async function markNotificationFailed(paymentId: number, error: string, type = "payment-approved") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(notificationOutbox).set({ status: "failed", lastError: error.slice(0, 2000), attempts: sql`${notificationOutbox.attempts} + 1` }).where(and(eq(notificationOutbox.paymentId, paymentId), eq(notificationOutbox.type, type)));
}

export async function claimNotificationOutbox(workerId: string, batchSize = 20, _now = new Date(), leaseMs = 60_000, maxAttempts = 5) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const limit = Math.max(1, Math.min(batchSize, 100));
  const leaseSeconds = Math.max(1, Math.ceil(leaseMs / 1000));
  await db.execute(sql`
    UPDATE notificationOutbox
    SET status = 'processing', lockedAt = CURRENT_TIMESTAMP, lockedBy = ${workerId}, leaseExpiresAt = TIMESTAMPADD(SECOND, ${leaseSeconds}, CURRENT_TIMESTAMP)
    WHERE id IN (
      SELECT id FROM (
        SELECT id FROM notificationOutbox
        WHERE attempts < ${maxAttempts}
          AND (
            (status IN ('pending','failed') AND nextAttemptAt <= CURRENT_TIMESTAMP)
            OR (status = 'processing' AND leaseExpiresAt < CURRENT_TIMESTAMP)
          )
        ORDER BY id
        LIMIT ${limit}
      ) claimable
    )
    AND attempts < ${maxAttempts}
    AND (
      (status IN ('pending','failed') AND nextAttemptAt <= CURRENT_TIMESTAMP)
      OR (status = 'processing' AND leaseExpiresAt < CURRENT_TIMESTAMP)
    )
  `);
  return await db.select().from(notificationOutbox)
    .where(and(eq(notificationOutbox.status, "processing"), eq(notificationOutbox.lockedBy, workerId)))
    .orderBy(notificationOutbox.id)
    .limit(limit);
}

export async function completeOutboxNotification(id: number, workerId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.transaction(async tx => {
    const result = await tx.update(notificationOutbox).set({ status: "sent", sentAt: new Date(), attempts: sql`${notificationOutbox.attempts} + 1`, lockedAt: null, lockedBy: null, leaseExpiresAt: null, lastError: null })
      .where(and(eq(notificationOutbox.id, id), eq(notificationOutbox.status, "processing"), eq(notificationOutbox.lockedBy, workerId)));
    if (affectedRows(result) !== 1) return false;
    const rows = await tx.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)).limit(1);
    const row = rows[0];
    await tx.insert(auditLogs).values({ actorUserId: null, actorType: "system", action: "notification_sent", entity: "notificationOutbox", entityId: String(id), orderId: row?.orderId ?? null, paymentId: row?.paymentId ?? null, event: row?.type ?? null, beforeState: JSON.stringify({ status: "processing" }), afterState: JSON.stringify({ status: "sent" }) });
    return true;
  });
}

export async function failOutboxNotification(id: number, workerId: string, error: unknown, now = new Date(), maxAttempts = 5) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM notificationOutbox WHERE id = ${id} FOR UPDATE`);
    const rows = await tx.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)).limit(1);
    const row = rows[0];
    if (!row || row.status !== "processing" || row.lockedBy !== workerId) return false;
    const attempts = row.attempts + 1;
    const dead = attempts >= maxAttempts;
    const backoffMs = Math.min(60 * 60_000, 30_000 * (2 ** Math.max(0, attempts - 1)));
    const safeError = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 1000) : "Unknown notification failure";
    await tx.update(notificationOutbox).set({ status: dead ? "dead" : "failed", attempts, nextAttemptAt: new Date(now.getTime() + backoffMs), lockedAt: null, lockedBy: null, leaseExpiresAt: null, lastError: safeError }).where(eq(notificationOutbox.id, id));
    await tx.insert(auditLogs).values({ actorUserId: null, actorType: "system", action: dead ? "notification_dead" : "notification_failed", entity: "notificationOutbox", entityId: String(id), orderId: row.orderId, paymentId: row.paymentId, event: row.type, beforeState: JSON.stringify({ status: "processing", attempts: row.attempts }), afterState: JSON.stringify({ status: dead ? "dead" : "failed", attempts }), metadata: JSON.stringify({ errorType: error instanceof Error ? error.name : "unknown" }) });
    return true;
  });
}

export async function updateOrderShippingAddress(
  orderId: number,
  data: {
    recipient: string;
    street: string;
    number: string;
    complement?: string | null;
    neighborhood: string;
  },
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db
    .update(orders)
    .set({
      shippingRecipient: data.recipient,
      shippingStreet: data.street,
      shippingNumber: data.number,
      shippingComplement: data.complement ?? null,
      shippingNeighborhood: data.neighborhood,
    })
    .where(eq(orders.id, orderId));
}

export async function reserveStockForOrder(input: {
  userId: number;
  orderId: number;
  items: Array<{ productId: number; quantity: number }>;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 20 * 60 * 1000);

  await db.transaction(async tx => {
    await tx
      .update(stockReservations)
      .set({ status: "released" })
      .where(and(eq(stockReservations.orderId, input.orderId), eq(stockReservations.status, "active")));

    for (const item of input.items) {
      const productRow = await tx.select().from(products).where(eq(products.id, item.productId)).limit(1);
      if (productRow.length === 0) {
        throw new Error(`Produto ${item.productId} nao encontrado.`);
      }

      const [reservedRow] = await tx
        .select({
          total: sql<number>`coalesce(sum(${stockReservations.quantity}), 0)`,
        })
        .from(stockReservations)
        .where(
          and(
            eq(stockReservations.productId, item.productId),
            eq(stockReservations.status, "active"),
            gte(stockReservations.expiresAt, now),
          ),
        );

      const reservedQty = Number(reservedRow?.total ?? 0);
      const available = Number(productRow[0].stock ?? 0) - reservedQty;
      if (available < item.quantity) {
        throw new Error(`Estoque insuficiente para ${productRow[0].name}. Disponivel: ${Math.max(0, available)}.`);
      }

      await tx.insert(stockReservations).values({
        orderId: input.orderId,
        userId: input.userId,
        productId: item.productId,
        quantity: item.quantity,
        status: "active",
        expiresAt,
      });
    }
  });
}

export async function consumeStockReservationsForOrder(orderId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const now = new Date();
  await db.transaction(async tx => {
    const activeReservations = await tx
      .select()
      .from(stockReservations)
      .where(
        and(
          eq(stockReservations.orderId, orderId),
          eq(stockReservations.status, "active"),
          gte(stockReservations.expiresAt, now),
        ),
      );

    for (const reservation of activeReservations) {
      await tx
        .update(products)
        .set({
          stock: sql`${products.stock} - ${reservation.quantity}`,
        })
        .where(eq(products.id, reservation.productId));
    }

    await tx
      .update(stockReservations)
      .set({ status: "consumed" })
      .where(and(eq(stockReservations.orderId, orderId), eq(stockReservations.status, "active")));
  });
}

export async function getAllOrders() {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(orders);
}

export async function updateOrderStatus(
  _orderId: number,
  _status: "pending" | "processing" | "paid" | "shipped" | "delivered" | "cancelled",
) {
  throw new Error("LEGACY_ORDER_STATUS_MUTATION_DISABLED");
}

export async function markOrderPaid(_orderId: number) {
  throw new Error("LEGACY_MARK_ORDER_PAID_DISABLED_USE_PAYMENT_STATE_MACHINE");
}

export async function getAllUsers() {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(users);
}

export async function updateUserRole(userId: number, role: "user" | "admin") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (role === "admin") {
    const target = await getUserById(userId);
    const normalizedEmail = String(target?.email ?? "").trim().toLowerCase();
    const isAllowed = Boolean(normalizedEmail) && ENV.adminEmails.includes(normalizedEmail);
    if (!isAllowed) {
      throw new Error("Admin role assignment not allowed for this email");
    }
  }
  return await db.update(users).set({ role }).where(eq(users.id, userId));
}

// Favoritos
export async function getFavorites(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(favorites).where(eq(favorites.userId, userId));
}

export async function addFavorite(userId: number, productId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.insert(favorites).values({ userId, productId });
}

export async function removeFavorite(userId: number, productId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.delete(favorites).where(and(eq(favorites.userId, userId), eq(favorites.productId, productId)));
}

type ProfileAddressInput = {
  label: string;
  recipient: string;
  zipCode: string;
  street: string;
  number: string;
  complement?: string | null;
  neighborhood: string;
  city: string;
  state: string;
  isDefault: boolean;
};

type ProfilePaymentInput = {
  label: string;
  holderName: string;
  brand: string;
  last4: string;
  expiry: string;
  isDefault: boolean;
};

export async function getProfileData(userId: number) {
  const db = await getDb();
  if (!db) {
    return {
      phone: "",
      addresses: [] as Array<{
        id: number;
        label: string;
        recipient: string;
        zipCode: string;
        street: string;
        number: string;
        complement: string;
        neighborhood: string;
        city: string;
        state: string;
        isDefault: boolean;
      }>,
      payments: [] as Array<{
        id: number;
        label: string;
        holderName: string;
        brand: string;
        last4: string;
        expiry: string;
        isDefault: boolean;
      }>,
    };
  }

  const profileRow = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);

  const addressRows = await db
    .select()
    .from(userAddresses)
    .where(eq(userAddresses.userId, userId));

  const paymentRows = await db
    .select()
    .from(userPaymentMethods)
    .where(eq(userPaymentMethods.userId, userId));

  return {
    phone: profileRow[0]?.phone ?? "",
    addresses: addressRows.map((item) => ({
      id: item.id,
      label: item.label,
      recipient: item.recipient,
      zipCode: item.zipCode,
      street: item.street,
      number: item.number,
      complement: item.complement ?? "",
      neighborhood: item.neighborhood,
      city: item.city,
      state: item.state,
      isDefault: item.isDefault === 1,
    })),
    payments: paymentRows.map((item) => ({
      id: item.id,
      label: item.label,
      holderName: item.holderName,
      brand: item.brand,
      last4: item.last4,
      expiry: item.expiry,
      isDefault: item.isDefault === 1,
    })),
  };
}

export async function saveProfileData(
  userId: number,
  payload: {
    name?: string;
    email?: string;
    phone: string;
    addresses: ProfileAddressInput[];
    payments: ProfilePaymentInput[];
  },
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  if (payload.name !== undefined || payload.email !== undefined) {
    await db
      .update(users)
      .set({
        ...(payload.name !== undefined ? { name: payload.name || null } : {}),
        ...(payload.email !== undefined ? { email: payload.email || null } : {}),
      })
      .where(eq(users.id, userId));
  }

  const existing = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(userProfiles)
      .set({ phone: payload.phone || null })
      .where(eq(userProfiles.userId, userId));
  } else {
    await db.insert(userProfiles).values({
      userId,
      phone: payload.phone || null,
    });
  }

  await db.delete(userAddresses).where(eq(userAddresses.userId, userId));
  if (payload.addresses.length > 0) {
    await db.insert(userAddresses).values(
      payload.addresses.map((item, index) => ({
        userId,
        label: item.label,
        recipient: item.recipient,
        zipCode: item.zipCode,
        street: item.street,
        number: item.number,
        complement: item.complement || null,
        neighborhood: item.neighborhood,
        city: item.city,
        state: item.state,
        isDefault: item.isDefault || index === 0 ? 1 : 0,
      })),
    );
  }

  await db.delete(userPaymentMethods).where(eq(userPaymentMethods.userId, userId));
  if (payload.payments.length > 0) {
    await db.insert(userPaymentMethods).values(
      payload.payments.map((item, index) => ({
        userId,
        label: item.label,
        holderName: item.holderName,
        brand: item.brand,
        last4: item.last4,
        expiry: item.expiry,
        isDefault: item.isDefault || index === 0 ? 1 : 0,
      })),
    );
  }
}

export async function setUserFlags(
  userId: number,
  flags: { isVip?: boolean; isBlocked?: boolean },
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db
    .update(users)
    .set({
      ...(flags.isVip !== undefined ? { isVip: flags.isVip ? 1 : 0 } : {}),
      ...(flags.isBlocked !== undefined ? { isBlocked: flags.isBlocked ? 1 : 0 } : {}),
    })
    .where(eq(users.id, userId));
}

export async function rotateUserSessionVersion(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const current = await db
    .select({ sessionVersion: users.sessionVersion })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const nextVersion = Number(current[0]?.sessionVersion ?? 0) + 1;
  if (nextVersion <= 0) {
    throw new Error("Failed to rotate session version");
  }

  await db.update(users).set({ sessionVersion: nextVersion }).where(eq(users.id, userId));
  return nextVersion;
}

export async function getUsersWithStats() {
  const db = await getDb();
  if (!db) return [];

  const usersRows = await db.select().from(users);
  const counts = await db
    .select({ userId: orders.userId, count: sql<number>`count(*)` })
    .from(orders)
    .groupBy(orders.userId);

  const countMap = new Map<number, number>();
  for (const row of counts) {
    countMap.set(Number(row.userId), Number(row.count));
  }

  return usersRows.map(user => ({
    ...user,
    isVip: user.isVip === 1,
    isBlocked: user.isBlocked === 1,
    ordersCount: countMap.get(user.id) ?? 0,
  }));
}

export async function getOrdersByFilters(filters?: {
  status?: "pending" | "processing" | "paid" | "shipped" | "delivered" | "cancelled";
  from?: Date;
  to?: Date;
}) {
  const db = await getDb();
  if (!db) return [];

  const whereClauses = [] as Array<ReturnType<typeof eq>>;
  if (filters?.status) whereClauses.push(eq(orders.status, filters.status));
  if (filters?.from) whereClauses.push(gte(orders.createdAt, filters.from));
  if (filters?.to) whereClauses.push(lte(orders.createdAt, filters.to));

  const baseOrders = whereClauses.length
    ? await db.select().from(orders).where(and(...whereClauses)).orderBy(desc(orders.id))
    : await db.select().from(orders).orderBy(desc(orders.id));

  const usersRows = await db.select({ id: users.id, name: users.name, email: users.email }).from(users);
  const paymentRows = await db.select().from(payments);
  const addressRows = await db
    .select({
      userId: userAddresses.userId,
      recipient: userAddresses.recipient,
      zipCode: userAddresses.zipCode,
      street: userAddresses.street,
      number: userAddresses.number,
      complement: userAddresses.complement,
      neighborhood: userAddresses.neighborhood,
      city: userAddresses.city,
      state: userAddresses.state,
      isDefault: userAddresses.isDefault,
      updatedAt: userAddresses.updatedAt,
    })
    .from(userAddresses);
  const reservations = await db
    .select({
      orderId: stockReservations.orderId,
      productId: stockReservations.productId,
      quantity: stockReservations.quantity,
      variantId: stockReservations.variantId,
      productName: products.name,
      variantName: productVariants.name,
    })
    .from(stockReservations)
    .leftJoin(products, eq(products.id, stockReservations.productId))
    .leftJoin(productVariants, eq(productVariants.id, stockReservations.variantId));

  const usersById = new Map(usersRows.map(user => [user.id, user]));
  const paymentByOrder = new Map(paymentRows.map(payment => [payment.orderId, payment]));
  const itemsByOrder = new Map<number, typeof reservations>();
  const preferredAddressByUser = new Map<number, (typeof addressRows)[number]>();
  for (const item of reservations) {
    const current = itemsByOrder.get(item.orderId) ?? [];
    current.push(item);
    itemsByOrder.set(item.orderId, current);
  }
  for (const row of addressRows) {
    const current = preferredAddressByUser.get(row.userId);
    if (!current) {
      preferredAddressByUser.set(row.userId, row);
      continue;
    }

    const currentWeight = Number(current.isDefault ? 1 : 0) * 10_000_000_000_000 + new Date(current.updatedAt).getTime();
    const nextWeight = Number(row.isDefault ? 1 : 0) * 10_000_000_000_000 + new Date(row.updatedAt).getTime();
    if (nextWeight > currentWeight) {
      preferredAddressByUser.set(row.userId, row);
    }
  }

  return baseOrders.map(order => {
    const fallbackAddress = preferredAddressByUser.get(order.userId);
    const hasSnapshot = Boolean(
      order.shippingZipCode ||
      order.shippingStreet ||
      order.shippingNeighborhood ||
      order.shippingCity ||
      order.shippingState,
    );

    const shippingAddress = hasSnapshot
      ? {
          recipient: order.shippingRecipient || null,
          zipCode: order.shippingZipCode || null,
          street: order.shippingStreet || null,
          number: order.shippingNumber || null,
          complement: order.shippingComplement || null,
          neighborhood: order.shippingNeighborhood || null,
          city: order.shippingCity || null,
          state: order.shippingState || null,
          source: "order" as const,
        }
      : fallbackAddress
        ? {
            recipient: fallbackAddress.recipient || null,
            zipCode: fallbackAddress.zipCode || null,
            street: fallbackAddress.street || null,
            number: fallbackAddress.number || null,
            complement: fallbackAddress.complement || null,
            neighborhood: fallbackAddress.neighborhood || null,
            city: fallbackAddress.city || null,
            state: fallbackAddress.state || null,
            source: "profile" as const,
          }
        : null;

    return {
      ...order,
      customerName: usersById.get(order.userId)?.name || null,
      customerEmail: usersById.get(order.userId)?.email || null,
      items: itemsByOrder.get(order.id) ?? [],
      payment: paymentByOrder.get(order.id) ?? null,
      shippingAddress,
    };
  });
}

export async function setOrderAdminData(
  orderId: number,
  data: {
    status?: "pending" | "processing" | "paid" | "shipped" | "delivered" | "cancelled";
    trackingCode?: string | null;
    actorUserId?: number;
  },
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`);
    const orderRows = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    const order = orderRows[0];
    if (!order) throw new Error("ORDER_NOT_FOUND");
    const paymentRows = await tx.select().from(payments).where(eq(payments.orderId, orderId)).limit(1);
    const payment = paymentRows[0];
    let nextFulfillment = order.fulfillmentStatus as FulfillmentStatus;

    if (data.status === "pending" || data.status === "paid") throw new Error("ADMIN_FINANCIAL_STATUS_FORBIDDEN");
    if (data.status === "cancelled") {
      if (["shipped", "delivered"].includes(order.fulfillmentStatus)) throw new Error("CANCELLATION_BLOCKED_AFTER_SHIPMENT");
      if (payment && ["confirmed", "received", "partially_refunded", "chargeback"].includes(payment.status)) throw new Error("CANCELLATION_REQUIRES_FINANCIAL_RESOLUTION");
      const active = await tx.select().from(stockReservations).where(and(eq(stockReservations.orderId, orderId), eq(stockReservations.status, "active")));
      for (const reservation of active) {
        const claimed = await tx.update(stockReservations).set({ status: "released" }).where(and(eq(stockReservations.id, reservation.id), eq(stockReservations.status, "active")));
        if (affectedRows(claimed) !== 1) continue;
        await tx.update(products).set({ stock: sql`${products.stock} + ${reservation.quantity}` }).where(eq(products.id, reservation.productId));
        if (reservation.variantId) await tx.update(productVariants).set({ stock: sql`${productVariants.stock} + ${reservation.quantity}` }).where(eq(productVariants.id, reservation.variantId));
      }
      if (order.couponId && !order.couponReleasedAt) {
        await tx.update(coupons).set({ usedCount: sql`greatest(${coupons.usedCount} - 1, 0)` }).where(eq(coupons.id, order.couponId));
      }
      nextFulfillment = "cancelled";
    } else if (data.status) {
      const requested = data.status as FulfillmentStatus;
      if (!payment || !["confirmed", "received", "partially_refunded"].includes(payment.status)) throw new Error("FULFILLMENT_REQUIRES_PAID_PAYMENT");
      if (order.fulfillmentIssue) throw new Error("FULFILLMENT_BLOCKED_BY_OPERATIONAL_ISSUE");
      const transition = transitionFulfillmentStatus(order.fulfillmentStatus as FulfillmentStatus, requested);
      if (transition.decision !== "allowed") throw new Error(transition.reason);
      nextFulfillment = requested;
    }

    const legacy = projectLegacyOrderStatus(payment?.status as PaymentStatus | undefined, nextFulfillment);
    await tx.update(orders).set({ status: legacy, fulfillmentStatus: nextFulfillment, ...(data.status === "cancelled" && order.couponId && !order.couponReleasedAt ? { couponReleasedAt: new Date() } : {}), ...(data.trackingCode !== undefined ? { trackingCode: data.trackingCode } : {}) }).where(eq(orders.id, orderId));
    await tx.insert(auditLogs).values({ actorUserId: data.actorUserId ?? null, actorType: "admin", action: data.status === "cancelled" ? "order_cancelled" : "fulfillment_changed", entity: "order", entityId: String(orderId), orderId, paymentId: payment?.id ?? null, event: data.status ?? "tracking_updated", correlationId: payment?.externalReference ?? order.correlationId, beforeState: JSON.stringify({ fulfillmentStatus: order.fulfillmentStatus, trackingCode: order.trackingCode }), afterState: JSON.stringify({ fulfillmentStatus: nextFulfillment, trackingCode: data.trackingCode === undefined ? order.trackingCode : data.trackingCode }) });
    return { fulfillmentStatus: nextFulfillment, status: legacy };
  });
}

export async function confirmManualPayment(input: { orderId: number; actorUserId: number; amount: number; reason: string; evidence: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM orders WHERE id = ${input.orderId} FOR UPDATE`);
    const orderRows = await tx.select().from(orders).where(eq(orders.id, input.orderId)).limit(1);
    const order = orderRows[0];
    if (!order) throw new Error("ORDER_NOT_FOUND");
    const paymentRows = await tx.select().from(payments).where(eq(payments.orderId, input.orderId)).limit(1);
    const payment = paymentRows[0];
    if (!payment) throw new Error("PAYMENT_NOT_FOUND");
    if (input.amount !== payment.amount) throw new Error("MANUAL_PAYMENT_AMOUNT_MISMATCH");
    const transition = transitionPaymentStatus(payment.status as PaymentStatus, "received", { source: "manual" });
    if (transition.decision !== "allowed") throw new Error(transition.reason);
    const now = new Date();
    await tx.update(payments).set({ status: "received", statusSource: "manual", paidAmount: input.amount, netAmount: input.amount - payment.refundedAmount, manualConfirmedAt: now, manualConfirmedBy: input.actorUserId, manualReason: input.reason, manualEvidence: input.evidence, confirmedAt: payment.confirmedAt ?? now, receivedAt: payment.receivedAt ?? now }).where(eq(payments.id, payment.id));
    const reservations = await tx.select().from(stockReservations).where(eq(stockReservations.orderId, input.orderId));
    const itemCountRows = await tx.select({ total: sql<number>`count(*)` }).from(orderItems).where(eq(orderItems.orderId, input.orderId));
    const valid = hasValidStockReservation(Number(itemCountRows[0]?.total ?? 0), reservations, now);
    const fulfillmentStatus: FulfillmentStatus = valid ? "ready" : "inventory_exception";
    if (valid) await tx.update(stockReservations).set({ status: "consumed" }).where(and(eq(stockReservations.orderId, input.orderId), eq(stockReservations.status, "active")));
    await tx.update(orders).set({ fulfillmentStatus, fulfillmentIssue: valid ? null : "MANUAL_PAYMENT_CONFIRMED_WITHOUT_STOCK", fulfillmentIssueAt: valid ? null : now, status: projectLegacyOrderStatus("received", fulfillmentStatus) }).where(eq(orders.id, input.orderId));
    await tx.insert(auditLogs).values({ actorUserId: input.actorUserId, actorType: "admin", action: "manual_payment_confirmation", entity: "payment", entityId: String(payment.id), orderId: input.orderId, paymentId: payment.id, event: "manual_payment_confirmation", correlationId: payment.externalReference, beforeState: JSON.stringify({ status: payment.status, source: payment.statusSource }), afterState: JSON.stringify({ status: "received", source: "manual", amount: input.amount }), metadata: JSON.stringify({ reason: input.reason, evidence: input.evidence }) });
    return { paymentId: payment.id, paymentStatus: "received" as const, fulfillmentStatus };
  });
}

export async function resolveInventoryException(input: { orderId: number; actorUserId: number; action: "stock_replenished" | "refund_required" | "note"; note: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM orders WHERE id = ${input.orderId} FOR UPDATE`);
    const orderRows = await tx.select().from(orders).where(eq(orders.id, input.orderId)).limit(1);
    const order = orderRows[0];
    if (!order || order.fulfillmentStatus !== "inventory_exception") throw new Error("INVENTORY_EXCEPTION_NOT_FOUND");
    const paymentRows = await tx.select().from(payments).where(eq(payments.orderId, input.orderId)).limit(1);
    const payment = paymentRows[0];
    let next: FulfillmentStatus = "inventory_exception";
    let issue = order.fulfillmentIssue;
    if (input.action === "stock_replenished") {
      const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, input.orderId));
      for (const item of items) {
        if (item.variantId) {
          const updated = await tx.update(productVariants).set({ stock: sql`${productVariants.stock} - ${item.quantity}` }).where(and(eq(productVariants.id, item.variantId), gte(productVariants.stock, item.quantity)));
          if (affectedRows(updated) !== 1) throw new Error("INSUFFICIENT_VARIANT_STOCK");
        }
        const updated = await tx.update(products).set({ stock: sql`${products.stock} - ${item.quantity}` }).where(and(eq(products.id, item.productId), gte(products.stock, item.quantity)));
        if (affectedRows(updated) !== 1) throw new Error("INSUFFICIENT_PRODUCT_STOCK");
      }
      next = "ready";
      issue = null;
    } else if (input.action === "refund_required") {
      next = "on_hold";
      issue = "REFUND_REQUIRED_AT_GATEWAY";
    }
    await tx.update(orders).set({ fulfillmentStatus: next, fulfillmentIssue: issue, fulfillmentIssueAt: issue ? new Date() : null, status: projectLegacyOrderStatus(payment?.status as PaymentStatus | undefined, next) }).where(eq(orders.id, input.orderId));
    await tx.insert(auditLogs).values({ actorUserId: input.actorUserId, actorType: "admin", action: input.action === "note" ? "inventory_exception_note" : "inventory_exception_resolved", entity: "order", entityId: String(input.orderId), orderId: input.orderId, paymentId: payment?.id ?? null, event: input.action, correlationId: payment?.externalReference ?? order.correlationId, beforeState: JSON.stringify({ fulfillmentStatus: order.fulfillmentStatus, issue: order.fulfillmentIssue }), afterState: JSON.stringify({ fulfillmentStatus: next, issue }), metadata: JSON.stringify({ note: input.note }) });
    return { fulfillmentStatus: next, fulfillmentIssue: issue };
  });
}

export async function replaceProductImages(
  productId: number,
  imageUrls: Array<string | {
    imageUrl: string;
    imageThumbnailUrl?: string | null;
    imageDetailUrl?: string | null;
    imageBannerUrl?: string | null;
    color?: string | null;
    alt?: string | null;
  }>,
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(productImages).where(eq(productImages.productId, productId));
  if (imageUrls.length > 0) {
    await db.insert(productImages).values(
      imageUrls.map((item, index) => ({
        productId,
        imageUrl: typeof item === "string" ? item : item.imageUrl,
        imageThumbnailUrl: typeof item === "string" ? null : item.imageThumbnailUrl ?? null,
        imageDetailUrl: typeof item === "string" ? null : item.imageDetailUrl ?? null,
        imageBannerUrl: typeof item === "string" ? null : item.imageBannerUrl ?? null,
        color: typeof item === "string" ? null : item.color ?? null,
        alt: typeof item === "string" ? null : item.alt ?? null,
        order: index,
      })),
    );
  }
}

export async function replaceProductVariants(
  productId: number,
  variants: Array<{ name: string; sku?: string | null; size?: string | null; color?: string | null; price?: number | null; stock: number }>,
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(productVariants).where(eq(productVariants.productId, productId));
  if (variants.length > 0) {
    await db.insert(productVariants).values(
      variants.map(variant => ({
        productId,
        name: variant.name,
        sku: variant.sku ?? null,
        size: variant.size?.trim() || null,
        color: variant.color?.trim() || null,
        optionKey: buildVariantOptionKey(variant.size, variant.color),
        price: variant.price ?? null,
        stock: variant.stock,
      })),
    );
    await db.update(products).set({ stock: variants.reduce((sum, variant) => sum + variant.stock, 0) }).where(eq(products.id, productId));
  }
}

export async function getProductsAdmin() {
  const db = await getDb();
  if (!db) return [];
  const productRows = await db.select().from(products).orderBy(desc(products.id));
  const imageRows = await db.select().from(productImages);
  const variantRows = await db.select().from(productVariants);

  const imagesMap = new Map<number, typeof imageRows>();
  for (const item of imageRows) {
    const current = imagesMap.get(item.productId) ?? [];
    current.push(item);
    imagesMap.set(item.productId, current);
  }

  const variantsMap = new Map<number, typeof variantRows>();
  for (const item of variantRows) {
    const current = variantsMap.get(item.productId) ?? [];
    current.push(item);
    variantsMap.set(item.productId, current);
  }

  return productRows.map(product => ({
    ...product,
    imageUrl: product.imageUrl || imagesMap.get(product.id)?.[0]?.imageUrl || null,
    images: imagesMap.get(product.id) ?? [],
    variants: variantsMap.get(product.id) ?? [],
  }));
}

export async function createCoupon(payload: {
  code: string;
  type: "percent" | "fixed";
  value: number;
  maxUses?: number | null;
  startsAt?: Date | null;
  expiresAt?: Date | null;
  isActive?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.insert(coupons).values({
    code: payload.code.toUpperCase(),
    type: payload.type,
    value: payload.value,
    maxUses: payload.maxUses ?? null,
    startsAt: payload.startsAt ?? null,
    expiresAt: payload.expiresAt ?? null,
    isActive: payload.isActive === false ? 0 : 1,
  });
}

export async function getCoupons() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(coupons).orderBy(desc(coupons.id));
  return rows.map(item => ({ ...item, isActive: item.isActive === 1 }));
}

export async function getApplicableCouponByCode(code: string) {
  const db = await getDb();
  if (!db) return undefined;
  const normalizedCode = code.trim().toUpperCase();
  if (!normalizedCode) return undefined;

  const now = new Date();
  const rows = await db
    .select()
    .from(coupons)
    .where(eq(coupons.code, normalizedCode))
    .limit(1);

  if (rows.length === 0) return undefined;
  const coupon = rows[0];
  if (coupon.isActive !== 1) return undefined;
  if (coupon.startsAt && coupon.startsAt > now) return undefined;
  if (coupon.expiresAt && coupon.expiresAt < now) return undefined;
  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) return undefined;

  return coupon;
}

export async function incrementCouponUsage(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const current = await db
    .select({ usedCount: coupons.usedCount })
    .from(coupons)
    .where(eq(coupons.id, id))
    .limit(1);
  if (current.length === 0) return;
  await db
    .update(coupons)
    .set({ usedCount: current[0].usedCount + 1 })
    .where(eq(coupons.id, id));
}

export async function updateCoupon(
  id: number,
  payload: Partial<{
    code: string;
    type: "percent" | "fixed";
    value: number;
    maxUses: number | null;
    startsAt: Date | null;
    expiresAt: Date | null;
    isActive: boolean;
  }>,
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db
    .update(coupons)
    .set({
      ...(payload.code !== undefined ? { code: payload.code.toUpperCase() } : {}),
      ...(payload.type !== undefined ? { type: payload.type } : {}),
      ...(payload.value !== undefined ? { value: payload.value } : {}),
      ...(payload.maxUses !== undefined ? { maxUses: payload.maxUses } : {}),
      ...(payload.startsAt !== undefined ? { startsAt: payload.startsAt } : {}),
      ...(payload.expiresAt !== undefined ? { expiresAt: payload.expiresAt } : {}),
      ...(payload.isActive !== undefined ? { isActive: payload.isActive ? 1 : 0 } : {}),
    })
    .where(eq(coupons.id, id));
}

export async function deleteCoupon(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.delete(coupons).where(eq(coupons.id, id));
}

export async function getPromoBanners(options?: { activeOnly?: boolean }) {
  const db = await getDb();
  if (!db) return [];
  const activeOnly = options?.activeOnly ?? false;
  const rows = activeOnly
    ? await db
        .select()
        .from(promoBanners)
        .where(eq(promoBanners.isActive, 1))
        .orderBy(promoBanners.sortOrder, desc(promoBanners.id))
    : await db.select().from(promoBanners).orderBy(promoBanners.sortOrder, desc(promoBanners.id));

  return rows.map(item => ({ ...item, isActive: item.isActive === 1 }));
}

export async function createPromoBanner(payload: {
  badge: string;
  title: string;
  description: string;
  ctaLabel: string;
  imageUrl?: string | null;
  mobileImageUrl?: string | null;
  imageAlt?: string | null;
  linkUrl?: string | null;
  discountText: string;
  discountLabel: string;
  bgStyle: string;
  sortOrder?: number;
  isActive?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.insert(promoBanners).values({
    badge: payload.badge,
    title: payload.title,
    description: payload.description,
    ctaLabel: payload.ctaLabel,
    imageUrl: payload.imageUrl ?? null,
    mobileImageUrl: payload.mobileImageUrl ?? null,
    imageAlt: payload.imageAlt ?? null,
    linkUrl: payload.linkUrl ?? null,
    discountText: payload.discountText,
    discountLabel: payload.discountLabel,
    bgStyle: payload.bgStyle,
    sortOrder: payload.sortOrder ?? 0,
    isActive: payload.isActive === false ? 0 : 1,
  });
}

export async function updatePromoBanner(
  id: number,
  payload: Partial<{
    badge: string;
    title: string;
    description: string;
    ctaLabel: string;
    imageUrl: string | null;
    mobileImageUrl: string | null;
    imageAlt: string | null;
    linkUrl: string | null;
    discountText: string;
    discountLabel: string;
    bgStyle: string;
    sortOrder: number;
    isActive: boolean;
  }>,
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db
    .update(promoBanners)
    .set({
      ...(payload.badge !== undefined ? { badge: payload.badge } : {}),
      ...(payload.title !== undefined ? { title: payload.title } : {}),
      ...(payload.description !== undefined ? { description: payload.description } : {}),
      ...(payload.ctaLabel !== undefined ? { ctaLabel: payload.ctaLabel } : {}),
      ...(payload.imageUrl !== undefined ? { imageUrl: payload.imageUrl } : {}),
      ...(payload.mobileImageUrl !== undefined ? { mobileImageUrl: payload.mobileImageUrl } : {}),
      ...(payload.imageAlt !== undefined ? { imageAlt: payload.imageAlt } : {}),
      ...(payload.linkUrl !== undefined ? { linkUrl: payload.linkUrl } : {}),
      ...(payload.discountText !== undefined ? { discountText: payload.discountText } : {}),
      ...(payload.discountLabel !== undefined ? { discountLabel: payload.discountLabel } : {}),
      ...(payload.bgStyle !== undefined ? { bgStyle: payload.bgStyle } : {}),
      ...(payload.sortOrder !== undefined ? { sortOrder: payload.sortOrder } : {}),
      ...(payload.isActive !== undefined ? { isActive: payload.isActive ? 1 : 0 } : {}),
    })
    .where(eq(promoBanners.id, id));
}

export async function deletePromoBanner(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.delete(promoBanners).where(eq(promoBanners.id, id));
}

export async function createAuditLog(payload: {
  actorUserId: number;
  action: string;
  entity: string;
  entityId?: string;
  metadata?: unknown;
}) {
  const db = await getDb();
  if (!db) return;
  await db.insert(auditLogs).values({
    actorUserId: payload.actorUserId,
    action: payload.action,
    entity: payload.entity,
    entityId: payload.entityId ?? null,
    metadata: payload.metadata ? JSON.stringify(payload.metadata) : null,
  });
}

export async function getAuditLogs(limit = 300) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(auditLogs).orderBy(desc(auditLogs.id)).limit(limit);
  return rows.map(item => ({
    ...item,
    metadata: item.metadata ? JSON.parse(item.metadata) : null,
  }));
}

export async function getDashboardKpis() {
  const db = await getDb();
  if (!db) {
    return {
      salesToday: 0,
      pendingOrders: 0,
      lowStockCount: 0,
      ordersToday: 0,
    };
  }

  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  const [salesTodayRow] = await db
    .select({ total: sql<number>`coalesce(sum(${orders.totalPrice}), 0)` })
    .from(orders)
    .innerJoin(payments, eq(payments.orderId, orders.id))
    .where(and(gte(orders.createdAt, startOfDay), inArray(payments.status, ["confirmed", "received", "partially_refunded"])));

  const [pendingRow] = await db
    .select({ total: sql<number>`count(*)` })
    .from(orders)
    .where(eq(orders.fulfillmentStatus, "awaiting_payment"));

  const [lowStockRow] = await db
    .select({ total: sql<number>`count(*)` })
    .from(products)
    .where(lte(products.stock, 5));

  const [ordersTodayRow] = await db
    .select({ total: sql<number>`count(*)` })
    .from(orders)
    .where(gte(orders.createdAt, startOfDay));

  return {
    salesToday: Number(salesTodayRow?.total ?? 0),
    pendingOrders: Number(pendingRow?.total ?? 0),
    lowStockCount: Number(lowStockRow?.total ?? 0),
    ordersToday: Number(ordersTodayRow?.total ?? 0),
  };
}

export async function getSalesByPeriod(from: Date, to: Date) {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select({
      day: sql<string>`date(${orders.createdAt})`,
      totalSales: sql<number>`coalesce(sum(${orders.totalPrice}), 0)`,
      ordersCount: sql<number>`count(*)`,
    })
    .from(orders)
    .innerJoin(payments, eq(payments.orderId, orders.id))
    .where(and(gte(orders.createdAt, from), lte(orders.createdAt, to), inArray(payments.status, ["confirmed", "received", "partially_refunded"])))
    .groupBy(sql`date(${orders.createdAt})`)
    .orderBy(sql`date(${orders.createdAt}) asc`);

  return rows.map(row => ({
    day: row.day,
    totalSales: Number(row.totalSales),
    ordersCount: Number(row.ordersCount),
  }));
}

export async function upsertLocalAuthCredential(payload: {
  userId: number;
  email: string;
  passwordHash: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db
    .select()
    .from(localAuthUsers)
    .where(eq(localAuthUsers.email, payload.email.toLowerCase()))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(localAuthUsers)
      .set({ userId: payload.userId, passwordHash: payload.passwordHash })
      .where(eq(localAuthUsers.id, existing[0].id));
    return;
  }

  await db.insert(localAuthUsers).values({
    userId: payload.userId,
    email: payload.email.toLowerCase(),
    passwordHash: payload.passwordHash,
  });
}

export async function getLocalAuthCredentialByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(localAuthUsers)
    .where(eq(localAuthUsers.email, email.toLowerCase()))
    .limit(1);
  return rows[0];
}

export async function getLocalAuthCredentialByUserId(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(localAuthUsers)
    .where(eq(localAuthUsers.userId, userId))
    .limit(1);
  return rows[0];
}

export async function createPasswordResetToken(payload: {
  userId: number;
  tokenHash: string;
  expiresAt: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, payload.userId));

  await db.insert(passwordResetTokens).values({
    userId: payload.userId,
    tokenHash: payload.tokenHash,
    expiresAt: payload.expiresAt,
  });
}

export async function getActivePasswordResetTokenByHash(tokenHash: string) {
  const db = await getDb();
  if (!db) return undefined;

  const now = new Date();
  const rows = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        gte(passwordResetTokens.expiresAt, now),
        isNull(passwordResetTokens.usedAt),
      ),
    )
    .limit(1);

  return rows[0];
}

export async function markPasswordResetTokenUsed(tokenId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokens.id, tokenId));
}

export async function deletePasswordResetTokensForUser(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId));
}

export async function updateLocalAuthPasswordByUserId(payload: { userId: number; passwordHash: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(localAuthUsers)
    .set({ passwordHash: payload.passwordHash })
    .where(eq(localAuthUsers.userId, payload.userId));
}

export async function getBackupPayload() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [
    usersRows,
    productsRows,
    variantsRows,
    productImagesRows,
    ordersRows,
    orderItemsRows,
    couponsRows,
    reviewsRows,
    reservationsRows,
    profilesRows,
    addressesRows,
    userPaymentMethodRows,
    paymentsRows,
    paymentEventsRows,
    notificationOutboxRows,
    auditRows,
    promoBannerRows,
    waitlistRows,
  ] = await Promise.all([
    db.select().from(users),
    db.select().from(products),
    db.select().from(productVariants),
    db.select().from(productImages),
    db.select().from(orders),
    db.select().from(orderItems),
    db.select().from(coupons),
    db.select().from(productReviews),
    db.select().from(stockReservations),
    db.select().from(userProfiles),
    db.select().from(userAddresses),
    db.select().from(userPaymentMethods),
    db.select().from(payments),
    db.select().from(paymentEvents),
    db.select().from(notificationOutbox),
    db.select().from(auditLogs),
    db.select().from(promoBanners),
    db.select().from(waitlistEmails),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    data: {
      users: usersRows,
      products: productsRows,
      productVariants: variantsRows,
      productImages: productImagesRows,
      orders: ordersRows,
      orderItems: orderItemsRows,
      coupons: couponsRows,
      productReviews: reviewsRows,
      stockReservations: reservationsRows,
      userProfiles: profilesRows,
      userAddresses: addressesRows,
      userPaymentMethods: userPaymentMethodRows,
      payments: paymentsRows,
      paymentEvents: paymentEventsRows,
      notificationOutbox: notificationOutboxRows,
      auditLogs: auditRows,
      promoBanners: promoBannerRows,
      waitlistEmails: waitlistRows,
    },
  };
}

export async function restoreBackupPayload(payload: {
  data: {
    users?: Array<any>;
    products?: Array<any>;
    productVariants?: Array<any>;
    productImages?: Array<any>;
    orders?: Array<any>;
    orderItems?: Array<any>;
    coupons?: Array<any>;
    productReviews?: Array<any>;
    stockReservations?: Array<any>;
    userProfiles?: Array<any>;
    userAddresses?: Array<any>;
    userPaymentMethods?: Array<any>;
    payments?: Array<any>;
    paymentEvents?: Array<any>;
    notificationOutbox?: Array<any>;
    auditLogs?: Array<any>;
    promoBanners?: Array<any>;
    waitlistEmails?: Array<any>;
  };
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const timestampFields: Record<string, string[]> = {
    users: ["createdAt", "updatedAt", "lastSignedIn"],
    products: ["createdAt", "updatedAt"],
    productVariants: ["createdAt", "updatedAt"],
    productImages: ["createdAt"],
    orders: ["fulfillmentIssueAt", "couponReleasedAt", "createdAt", "updatedAt"],
    orderItems: ["createdAt"],
    coupons: ["startsAt", "expiresAt", "createdAt", "updatedAt"],
    productReviews: ["createdAt", "updatedAt"],
    stockReservations: ["expiresAt", "createdAt", "updatedAt"],
    userProfiles: ["createdAt", "updatedAt"],
    userAddresses: ["createdAt", "updatedAt"],
    userPaymentMethods: ["createdAt", "updatedAt"],
    payments: ["creationLeaseExpiresAt", "financialIssueAt", "manualConfirmedAt", "createdAt", "updatedAt", "confirmedAt", "receivedAt", "refundedAt"],
    paymentEvents: ["receivedAt", "processedAt"],
    notificationOutbox: ["nextAttemptAt", "lockedAt", "leaseExpiresAt", "createdAt", "updatedAt", "sentAt"],
    auditLogs: ["createdAt"],
    promoBanners: ["createdAt", "updatedAt"],
    waitlistEmails: ["createdAt"],
  };
  const backupData = payload.data as Record<string, Array<Record<string, unknown>> | undefined>;
  for (const [table, fields] of Object.entries(timestampFields)) {
    for (const row of backupData[table] ?? []) {
      for (const field of fields) {
        const value = row[field];
        if (value === null || value === undefined || value instanceof Date) continue;
        const date = new Date(String(value));
        if (Number.isNaN(date.getTime())) throw new Error(`INVALID_BACKUP_TIMESTAMP:${table}.${field}`);
        row[field] = date;
      }
    }
  }

  await db.delete(notificationOutbox);
  await db.delete(paymentEvents);
  await db.delete(payments);
  await db.delete(stockReservations);
  await db.delete(orderItems);
  await db.delete(orders);
  await db.delete(productVariants);
  await db.delete(productImages);
  await db.delete(products);
  await db.delete(coupons);
  await db.delete(productReviews);
  await db.delete(userAddresses);
  await db.delete(userPaymentMethods);
  await db.delete(userProfiles);
  await db.delete(auditLogs);
  await db.delete(promoBanners);
  await db.delete(waitlistEmails);
  await db.delete(users);

  if (payload.data.users?.length) await db.insert(users).values(payload.data.users);
  if (payload.data.products?.length) await db.insert(products).values(payload.data.products);
  if (payload.data.productVariants?.length) await db.insert(productVariants).values(payload.data.productVariants);
  if (payload.data.productImages?.length) await db.insert(productImages).values(payload.data.productImages);
  if (payload.data.orders?.length) await db.insert(orders).values(payload.data.orders);
  if (payload.data.orderItems?.length) {
    await db.insert(orderItems).values(
      payload.data.orderItems.map((item: any) => ({
        ...item,
        unitPrice: item.unitPrice ?? item.price,
        totalPrice: item.totalPrice ?? (Number(item.unitPrice ?? item.price ?? 0) * Number(item.quantity ?? 0)),
      })),
    );
  }
  if (payload.data.payments?.length) await db.insert(payments).values(payload.data.payments);
  if (payload.data.paymentEvents?.length) await db.insert(paymentEvents).values(payload.data.paymentEvents);
  if (payload.data.notificationOutbox?.length) await db.insert(notificationOutbox).values(payload.data.notificationOutbox);
  if (payload.data.coupons?.length) await db.insert(coupons).values(payload.data.coupons);
  if (payload.data.productReviews?.length) await db.insert(productReviews).values(payload.data.productReviews);
  if (payload.data.stockReservations?.length)
    await db.insert(stockReservations).values(payload.data.stockReservations);
  if (payload.data.userProfiles?.length) await db.insert(userProfiles).values(payload.data.userProfiles);
  if (payload.data.userAddresses?.length) await db.insert(userAddresses).values(payload.data.userAddresses);
  if (payload.data.userPaymentMethods?.length)
    await db.insert(userPaymentMethods).values(payload.data.userPaymentMethods);
  if (payload.data.auditLogs?.length) await db.insert(auditLogs).values(payload.data.auditLogs);
  if (payload.data.promoBanners?.length) await db.insert(promoBanners).values(payload.data.promoBanners);
  if (payload.data.waitlistEmails?.length) await db.insert(waitlistEmails).values(payload.data.waitlistEmails);
}
