import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { createHash } from "node:crypto";
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
  promoBanners,
  waitlistEmails,
  emailUnsubscribes,
  passwordResetTokens,
  asaasWebhookEvents,
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;
const inMemoryAsaasWebhookEvents = new Set<string>();

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

function hashWebhookPayload(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload ?? null), "utf8").digest("hex");
}

function isDuplicateKeyError(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
  return code === "ER_DUP_ENTRY" || code === "SQLITE_CONSTRAINT_UNIQUE";
}

export function resetInMemoryAsaasWebhookEventsForTests() {
  inMemoryAsaasWebhookEvents.clear();
}

export async function runAsaasWebhookOnce<T>(
  input: {
    eventId: string;
    eventType: string;
    paymentId?: string | null;
    checkoutId?: string | null;
    orderId?: number | null;
    payload: unknown;
  },
  handler: () => Promise<T>,
): Promise<{ duplicate: boolean; result?: T }> {
  const eventId = input.eventId.trim();
  if (!eventId) throw new Error("Asaas webhook event_id is required");

  const db = await getDb();
  if (!db) {
    if (ENV.isProduction) {
      throw new Error("Persistent webhook idempotency unavailable");
    }

    if (inMemoryAsaasWebhookEvents.has(eventId)) {
      return { duplicate: true };
    }
    inMemoryAsaasWebhookEvents.add(eventId);
    const result = await handler();
    return { duplicate: false, result };
  }

  const payloadHash = hashWebhookPayload(input.payload);

  try {
    await db.insert(asaasWebhookEvents).values({
      eventId,
      eventType: input.eventType,
      paymentId: input.paymentId ?? null,
      checkoutId: input.checkoutId ?? null,
      orderId: input.orderId ?? null,
      payloadHash,
      status: "processing",
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return { duplicate: true };
    }
    throw error;
  }

  try {
    const result = await handler();
    await db
      .update(asaasWebhookEvents)
      .set({ status: "processed", processedAt: new Date() })
      .where(eq(asaasWebhookEvents.eventId, eventId));
    return { duplicate: false, result };
  } catch (error) {
    await db
      .update(asaasWebhookEvents)
      .set({ status: "failed" })
      .where(eq(asaasWebhookEvents.eventId, eventId));
    throw error;
  }
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

  const firstImageByProduct = new Map<number, {
    imageUrl: string;
    imageThumbnailUrl: string | null;
    imageDetailUrl: string | null;
    imageBannerUrl: string | null;
  }>();
  for (const item of imageRows) {
    if (!item.imageUrl || firstImageByProduct.has(item.productId)) continue;
    firstImageByProduct.set(item.productId, {
      imageUrl: item.imageUrl,
      imageThumbnailUrl: item.imageThumbnailUrl ?? null,
      imageDetailUrl: item.imageDetailUrl ?? null,
      imageBannerUrl: item.imageBannerUrl ?? null,
    });
  }

  return productRows.map(product => {
    const firstImage = firstImageByProduct.get(product.id);
    return {
      ...product,
      imageUrl: product.imageUrl || firstImage?.imageUrl || null,
      imageThumbnailUrl: product.imageThumbnailUrl || firstImage?.imageThumbnailUrl || firstImage?.imageUrl || product.imageUrl || null,
      imageDetailUrl: product.imageDetailUrl || firstImage?.imageDetailUrl || firstImage?.imageUrl || product.imageUrl || null,
      imageBannerUrl: product.imageBannerUrl || firstImage?.imageBannerUrl || firstImage?.imageUrl || product.imageUrl || null,
    };
  });
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
    imageThumbnailUrl: productRows[0].imageThumbnailUrl || imageRows[0]?.imageThumbnailUrl || imageRows[0]?.imageUrl || productRows[0].imageUrl || null,
    imageDetailUrl: productRows[0].imageDetailUrl || imageRows[0]?.imageDetailUrl || imageRows[0]?.imageUrl || productRows[0].imageUrl || null,
    imageBannerUrl: productRows[0].imageBannerUrl || imageRows[0]?.imageBannerUrl || imageRows[0]?.imageUrl || productRows[0].imageUrl || null,
    images: imageRows.map(item => ({
      imageUrl: item.imageUrl,
      imageThumbnailUrl: item.imageThumbnailUrl ?? null,
      imageDetailUrl: item.imageDetailUrl ?? null,
      imageBannerUrl: item.imageBannerUrl ?? null,
      color: item.color ?? null,
      alt: item.alt ?? null,
      order: item.order,
    })).filter(item => item.imageUrl),
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
  const db = await getDb();
  if (!db) throw new Error("Database not available");

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
  const [orderRows, fallbackAddress] = await Promise.all([
    db.select().from(orders).where(eq(orders.userId, userId)),
    getPreferredUserAddress(userId),
  ]);
  return orderRows.map(order => ({
    ...order,
    shippingAddress: buildOrderShippingAddress(order, fallbackAddress),
  }));
}

export async function getOrderByIdAndUser(orderId: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.userId, userId)))
    .limit(1);

  const order = result[0];
  if (!order) return undefined;
  const fallbackAddress = await getPreferredUserAddress(userId);
  return {
    ...order,
    shippingAddress: buildOrderShippingAddress(order, fallbackAddress),
  };
}

export async function getOrderById(orderId: number) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  return result[0];
}

export async function getOrderByTrackingCodeAndUser(trackingCode: string, userId: number) {
  const db = await getDb();
  if (!db) return undefined;

  const normalizedTrackingCode = trackingCode.trim();
  if (!normalizedTrackingCode) return undefined;

  const result = await db
    .select()
    .from(orders)
    .where(and(eq(orders.trackingCode, normalizedTrackingCode), eq(orders.userId, userId)))
    .limit(1);

  const order = result[0];
  if (!order) return undefined;
  const fallbackAddress = await getPreferredUserAddress(userId);
  return {
    ...order,
    shippingAddress: buildOrderShippingAddress(order, fallbackAddress),
  };
}

export async function getOrderReservationItems(orderId: number) {
  const db = await getDb();
  if (!db) return [];

  const items = await db
    .select({
      id: stockReservations.id,
      orderId: stockReservations.orderId,
      productId: stockReservations.productId,
      quantity: stockReservations.quantity,
      status: stockReservations.status,
      expiresAt: stockReservations.expiresAt,
      createdAt: stockReservations.createdAt,
      productName: products.name,
      productImage: products.imageUrl,
      productPrice: products.price,
    })
    .from(stockReservations)
    .leftJoin(products, eq(products.id, stockReservations.productId))
    .where(eq(stockReservations.orderId, orderId))
    .orderBy(desc(stockReservations.id));

  return items;
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
  orderId: number,
  status: "pending" | "processing" | "paid" | "shipped" | "delivered" | "cancelled",
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.update(orders).set({ status }).where(eq(orders.id, orderId));
}

export async function markOrderPaid(orderId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db.transaction(async tx => {
    const current = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    const order = current[0];
    if (!order) {
      throw new Error("Order not found");
    }

    if (order.status === "paid" || order.status === "shipped" || order.status === "delivered") {
      return { updated: false, status: order.status, lowStockProducts: [] } as const;
    }

    const lowStockProducts: Array<{ id: number; name: string; stock: number }> = [];

    await tx.update(orders).set({ status: "paid" }).where(eq(orders.id, orderId));

    const now = new Date();
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
      const productRows = await tx
        .select({
          id: products.id,
          name: products.name,
          stock: products.stock,
        })
        .from(products)
        .where(eq(products.id, reservation.productId))
        .limit(1);

      const product = productRows[0];
      const currentStock = Number(product?.stock ?? 0);
      const nextStock = currentStock - reservation.quantity;

      await tx
        .update(products)
        .set({
          stock: sql`${products.stock} - ${reservation.quantity}`,
        })
        .where(eq(products.id, reservation.productId));

      if (product && currentStock > 5 && nextStock <= 5) {
        lowStockProducts.push({
          id: Number(product.id),
          name: product.name,
          stock: Math.max(0, nextStock),
        });
      }
    }

    await tx
      .update(stockReservations)
      .set({ status: "consumed" })
      .where(and(eq(stockReservations.orderId, orderId), eq(stockReservations.status, "active")));

    return { updated: true, status: "paid", lowStockProducts } as const;
  });
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
      productName: products.name,
    })
    .from(stockReservations)
    .leftJoin(products, eq(products.id, stockReservations.productId));

  const usersById = new Map(usersRows.map(user => [user.id, user]));
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
      shippingAddress,
    };
  });
}

export async function setOrderAdminData(
  orderId: number,
  data: {
    status?: "pending" | "processing" | "paid" | "shipped" | "delivered" | "cancelled";
    trackingCode?: string | null;
  },
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db
    .update(orders)
    .set({
      ...(data.status ? { status: data.status } : {}),
      ...(data.trackingCode !== undefined ? { trackingCode: data.trackingCode } : {}),
    })
    .where(eq(orders.id, orderId));
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
  variants: Array<{ name: string; sku?: string | null; price?: number | null; stock: number }>,
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
        price: variant.price ?? null,
        stock: variant.stock,
      })),
    );
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
    .where(and(gte(orders.createdAt, startOfDay), eq(orders.status, "delivered")));

  const [pendingRow] = await db
    .select({ total: sql<number>`count(*)` })
    .from(orders)
    .where(eq(orders.status, "pending"));

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
    .where(and(gte(orders.createdAt, from), lte(orders.createdAt, to)))
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
    paymentRows,
    auditRows,
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
    db.select().from(auditLogs),
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
      userPaymentMethods: paymentRows,
      auditLogs: auditRows,
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
    auditLogs?: Array<any>;
  };
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(orderItems);
  await db.delete(orders);
  await db.delete(productVariants);
  await db.delete(productImages);
  await db.delete(products);
  await db.delete(coupons);
  await db.delete(productReviews);
  await db.delete(stockReservations);
  await db.delete(userAddresses);
  await db.delete(userPaymentMethods);
  await db.delete(userProfiles);
  await db.delete(auditLogs);
  await db.delete(users);

  if (payload.data.users?.length) await db.insert(users).values(payload.data.users);
  if (payload.data.products?.length) await db.insert(products).values(payload.data.products);
  if (payload.data.productVariants?.length) await db.insert(productVariants).values(payload.data.productVariants);
  if (payload.data.productImages?.length) await db.insert(productImages).values(payload.data.productImages);
  if (payload.data.orders?.length) await db.insert(orders).values(payload.data.orders);
  if (payload.data.orderItems?.length) await db.insert(orderItems).values(payload.data.orderItems);
  if (payload.data.coupons?.length) await db.insert(coupons).values(payload.data.coupons);
  if (payload.data.productReviews?.length) await db.insert(productReviews).values(payload.data.productReviews);
  if (payload.data.stockReservations?.length)
    await db.insert(stockReservations).values(payload.data.stockReservations);
  if (payload.data.userProfiles?.length) await db.insert(userProfiles).values(payload.data.userProfiles);
  if (payload.data.userAddresses?.length) await db.insert(userAddresses).values(payload.data.userAddresses);
  if (payload.data.userPaymentMethods?.length)
    await db.insert(userPaymentMethods).values(payload.data.userPaymentMethods);
  if (payload.data.auditLogs?.length) await db.insert(auditLogs).values(payload.data.auditLogs);
}
