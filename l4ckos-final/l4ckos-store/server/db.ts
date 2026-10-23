import { batchAcceptsSales, batchHasCapacity, type BatchPreview } from "../shared/preorder";
import { readShippingSnapshot } from "./database/orderShippingSnapshot";
import { createVariantOptionKey, normalizeVariantLabel } from "./database/productVariantIdentity";
import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { createHash, randomUUID } from "node:crypto";
import {
  InsertUser,
  users,
  products,
  InsertProduct,
  cartItems,
  orders,
  orderItems,
  productionBatches,
  productionBatchProducts,
  favorites,
  productImages,
  productVariants,
  productReviews,
  productReviewUploads,
  coupons,
  auditLogs,
  localAuthUsers,
  userProfiles,
  userAddresses,
  userPaymentMethods,
  stockReservations,
  promoBanners,
  homeHighlightSettings,
  waitlistEmails,
  emailUnsubscribes,
  passwordResetTokens,
  asaasWebhookEvents,
  orderEmailEvents,
} from "../drizzle/schema";
import { ENV } from './_core/env';
import { assertPublicCheckoutEnabled } from "./_core/publicStore";
import {
  buildPaymentConfirmationValues,
  isTrustedPaymentConfirmation,
  type TrustedPaymentConfirmation,
} from "./payments/confirmation";

import { webhookDb, inWebhookTransaction } from "./database/webhookTransaction";
import {assertNoRecoveryHold, assertOrderNotRecoveryHeld, assertWebhookBusinessEffectsAllowed} from './payments/webhookRecovery';
import {confirmSelectedCheckoutStock} from './payments/selectedCheckoutStock';
import {assertSelectedLedgerBinding,selectiveOrderAllowed} from './payments/stagingCheckoutAdmission';
import { aggregateSalesReport } from "./reports/salesReport";
import { isRestrictedPublicPurchase } from "./database/publicPurchasePolicy";

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
export async function getDb(): Promise<ReturnType<typeof drizzle> | null> {
  const scoped = webhookDb();
  if (scoped) return scoped;
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

export function isDuplicateKeyError(error: unknown) {
  const seen = new Set<object>();
  let current: unknown = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    const code = "code" in current ? String((current as { code?: unknown }).code ?? "") : "";
    if (code === "ER_DUP_ENTRY" || code === "SQLITE_CONSTRAINT_UNIQUE") return true;
    current = "cause" in current ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}

function affectedRows(result: unknown) {
  const header = Array.isArray(result) ? result[0] : result;
  return Number(
    typeof header === "object" && header !== null && "affectedRows" in header
      ? (header as { affectedRows?: unknown }).affectedRows ?? 0
      : 0,
  );
}

export async function runAsaasWebhookOnce<T>(
  input: {
    eventId: string;
    eventType: string;
    paymentId?: string | null;
    checkoutId?: string | null;
    orderId?: number | null;
    payload: unknown;
    sourcePayloadHash?: string;
  },
  handler: () => Promise<T>,
): Promise<{ duplicate: boolean; result?: T }> {
  const eventId = input.eventId.trim();
  if (!eventId) throw new Error("Asaas webhook event_id is required");

  const db = await getDb();
  if (!db) throw new Error("Persistent webhook idempotency unavailable");
  assertSelectedLedgerBinding(input);
  await assertNoRecoveryHold(db,eventId);

  const payloadHash = input.sourcePayloadHash && /^[a-f0-9]{64}$/.test(input.sourcePayloadHash)
    ? input.sourcePayloadHash : hashWebhookPayload(input.payload);
  try {
    await db.insert(asaasWebhookEvents).values({
      eventId, eventType: input.eventType, paymentId: input.paymentId ?? null,
      checkoutId: input.checkoutId ?? null, orderId: input.orderId ?? null,
      payloadHash, status: "processing",
    });
  } catch (error) { if (!isDuplicateKeyError(error)) throw error; }
  const effects: Array<() => Promise<void>> = [];
  try {
    const output = await db.transaction(async tx => {
      const [record] = await tx.select().from(asaasWebhookEvents)
        .where(eq(asaasWebhookEvents.eventId, eventId)).for("update");
      if (!record || record.eventId !== eventId || record.eventType !== input.eventType ||
        (record.paymentId && record.paymentId !== input.paymentId) ||
        (record.checkoutId && record.checkoutId !== input.checkoutId) ||
        (record.orderId && record.orderId !== input.orderId)) throw new Error("WEBHOOK_EVENT_CONFLICT");
      if (record.status === "processed") return { duplicate: true };
      if (record.payloadHash !== payloadHash) throw new Error("WEBHOOK_EVENT_CONFLICT");
      // A failed/orphan processing marker is NOT completed. The transaction context
      // binds all nested order/reservation/audit transactions to this same commit.
      const result = await inWebhookTransaction(tx as unknown as NonNullable<typeof db>, handler, effects);
      await tx.update(asaasWebhookEvents).set({ status: "processed", processedAt: new Date() })
        .where(eq(asaasWebhookEvents.eventId, eventId));
      return { duplicate: false, result };
    });
    // When an inbox transaction owns us, notifications belong to its commit.
    const { afterWebhookCommit } = await import("./database/webhookTransaction");
    for (const effect of effects) await afterWebhookCommit(effect);
    return output;
  } catch (error) {
    await db.update(asaasWebhookEvents).set({ status: "failed" })
      .where(and(eq(asaasWebhookEvents.eventId, eventId), sql`${asaasWebhookEvents.status} <> 'processed'`));
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
function normalizeProductRow(row: any): typeof products.$inferSelect {
  return {
    ...row,
    id: Number(row.id),
    price: Number(row.price ?? 0),
    stock: Number(row.stock ?? 0),
    description: row.description ?? null,
    fullDescription: row.fullDescription ?? null,
    optionColors: row.optionColors ?? null,
    optionSizes: row.optionSizes ?? null,
    sizeType: row.sizeType ?? "alpha",
    imageUrl: row.imageUrl ?? null,
    imageThumbnailUrl: row.imageThumbnailUrl ?? null,
    imageDetailUrl: row.imageDetailUrl ?? null,
    imageBannerUrl: row.imageBannerUrl ?? null,
  };
}

function normalizeProductImageRow(row: any) {
  return {
    ...row,
    id: Number(row.id),
    productId: Number(row.productId),
    imageUrl: row.imageUrl ?? null,
    imageThumbnailUrl: row.imageThumbnailUrl ?? null,
    imageDetailUrl: row.imageDetailUrl ?? null,
    imageBannerUrl: row.imageBannerUrl ?? null,
    color: row.color ?? null,
    alt: row.alt ?? null,
    order: Number(row.order ?? 0),
  };
}

function normalizeProductVariantRow(row: any) {
  return {
    ...row,
    id: Number(row.id),
    productId: Number(row.productId),
    price: row.price === null || row.price === undefined ? null : Number(row.price),
    stock: Number(row.stock ?? 0),
  };
}

async function selectProductRows(db: Awaited<ReturnType<typeof getDb>>, options?: { id?: number; ids?: number[] }) {
  if (!db) return [];

  if (options?.id) {
    const rows = extractExecutedRows(await db.execute(sql`select * from products where id = ${options.id} limit 1`));
    return rows.map(normalizeProductRow);
  }

  if (options?.ids) {
    const ids = Array.from(new Set(options.ids.filter(id => Number.isInteger(id) && id > 0)));
    if (ids.length === 0) return [];
    const rows = extractExecutedRows(
      await db.execute(sql`select * from products where id in (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`),
    );
    return rows.map(normalizeProductRow);
  }

  const rows = extractExecutedRows(await db.execute(sql`select * from products order by id desc`));
  return rows.map(normalizeProductRow);
}

async function selectProductImageRows(db: Awaited<ReturnType<typeof getDb>>, productIds?: number[]) {
  if (!db) return [];
  try {
    if (productIds) {
      const ids = Array.from(new Set(productIds.filter(id => Number.isInteger(id) && id > 0)));
      if (ids.length === 0) return [];
      const rows = extractExecutedRows(
        await db.execute(sql`select * from productImages where productId in (${sql.join(ids.map(id => sql`${id}`), sql`, `)}) order by \`order\` asc`),
      );
      return rows.map(normalizeProductImageRow);
    }

    const rows = extractExecutedRows(await db.execute(sql`select * from productImages order by \`order\` asc`));
    return rows.map(normalizeProductImageRow);
  } catch (error) {
    if (isMissingDatabaseObjectError(error)) return [];
    throw error;
  }
}

async function selectProductVariantRows(db: Awaited<ReturnType<typeof getDb>>, productIds?: number[]) {
  if (!db) return [];
  try {
    if (productIds) {
      const ids = Array.from(new Set(productIds.filter(id => Number.isInteger(id) && id > 0)));
      if (ids.length === 0) return [];
      const rows = extractExecutedRows(
        await db.execute(sql`select * from productVariants where productId in (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`),
      );
      return rows.map(normalizeProductVariantRow);
    }

    const rows = extractExecutedRows(await db.execute(sql`select * from productVariants`));
    return rows.map(normalizeProductVariantRow);
  } catch (error) {
    if (isMissingDatabaseObjectError(error)) return [];
    throw error;
  }
}

function mergeProductRowsWithImages(productRows: Array<typeof products.$inferSelect>, imageRows: Array<ReturnType<typeof normalizeProductImageRow>>) {
  const firstImageByProduct = new Map<number, ReturnType<typeof normalizeProductImageRow>>();
  for (const item of imageRows) {
    if (!item.imageUrl || firstImageByProduct.has(item.productId)) continue;
    firstImageByProduct.set(item.productId, item);
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

async function enrichProductsWithBatch<T extends {id:number; salesMode:string},
>(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, rows: T[]) {
  const assignments = extractExecutedRows(
    await db.execute(sql`SELECT b.id,b.name,b.status,b.maximumQuantity,DATE_FORMAT(b.estimatedManufacturingStart,'%Y-%m-%d') estimatedManufacturingStart,DATE_FORMAT(b.estimatedManufacturingEnd,'%Y-%m-%d') estimatedManufacturingEnd,UNIX_TIMESTAMP(b.salesOpenAt)*1000 salesOpenAt,UNIX_TIMESTAMP(b.salesCloseAt)*1000 salesCloseAt,UNIX_TIMESTAMP(b.estimatedShippingStart)*1000 estimatedShippingStart,UNIX_TIMESTAMP(b.estimatedShippingEnd)*1000 estimatedShippingEnd,bp.productId,COALESCE((SELECT SUM(oi.quantity) FROM orderItems oi JOIN orders o ON o.id=oi.orderId WHERE oi.productionBatchId=b.id AND oi.salesModeAtPurchase='PREORDER' AND o.status<>'cancelled'),0) claimedQuantity FROM productionBatchProducts bp JOIN productionBatches b ON b.id=bp.productionBatchId`
    )
  );
  const byProduct = new Map(assignments.map(row=> [Number(row.productId),
      {
    id:Number(row.id),name:String(row.name),status:row.status,
    salesOpenAt:row.salesOpenAt===null?null:new Date(Number(row.salesOpenAt)),
    salesCloseAt:row.salesCloseAt===null?null:new Date(Number(row.salesCloseAt)),
    estimatedShippingStart:row.estimatedShippingStart===null?null:new Date(Number(row.estimatedShippingStart)),
    estimatedShippingEnd:row.estimatedShippingEnd===null?null:new Date(Number(row.estimatedShippingEnd)),
    estimatedManufacturingStart:row.estimatedManufacturingStart ?? null,
    estimatedManufacturingEnd:row.estimatedManufacturingEnd ?? null,
        capacity: (() => {
          const maximumQuantity =
              row.maximumQuantity === null ? null : Number(row.maximumQuantity),
            claimedQuantity = Number(row.claimedQuantity);
          return {
            maximumQuantity,
            claimedQuantity,
            remainingQuantity:
              maximumQuantity === null
                ? null
                : Math.max(0, maximumQuantity - claimedQuantity),
          };
        })(),
      } as BatchPreview,
    ])
  );
  return rows.map(row=>({...row,productionBatch:row.salesMode==='PREORDER' ? byProduct.get(row.id) ?? null : null}));
}

export async function getProducts() {
  const db = await getDb();
  if (!db) return [];
  const productRows = await selectProductRows(db);
  const imageRows = await selectProductImageRows(db, productRows.map(product => product.id));
  const productsWithBatch = await enrichProductsWithBatch(db, mergeProductRowsWithImages(productRows, imageRows));
  const variantRows = await selectProductVariantRows(db, productRows.map(product => product.id));
  if (!variantRows.length) return productsWithBatch.map(product => ({
    ...product,
    hasVariants: false,
    hasSellableVariants: false,
  }));
  const reservations = await db.select({
    variantId: stockReservations.variantId,
    quantity: sql<number>`coalesce(sum(${stockReservations.quantity}), 0)`,
  }).from(stockReservations).where(and(
    eq(stockReservations.status, "active"),
    gte(stockReservations.expiresAt, new Date()),
    inArray(stockReservations.variantId, variantRows.map(variant => variant.id)),
  )).groupBy(stockReservations.variantId);
  const reserved = new Map(reservations.flatMap(row => row.variantId === null ? [] : [[row.variantId, Number(row.quantity ?? 0)] as const]));
  const variantsByProduct = new Map<number, typeof variantRows>();
  for (const variant of variantRows) variantsByProduct.set(variant.productId, [...(variantsByProduct.get(variant.productId) ?? []), variant]);
  return productsWithBatch.map(product => {
    const variants = variantsByProduct.get(product.id) ?? [];
    const skuCounts = new Map<string, number>();
    for (const variant of variants) {
      const sku = String(variant.sku ?? "").normalize("NFKC").trim().toLowerCase();
      if (sku) skuCounts.set(sku, (skuCounts.get(sku) ?? 0) + 1);
    }
    const hasSellableVariants = !isRestrictedPublicPurchase(product.name) && variants.some(variant => {
      const color = typeof variant.color === "string" ? normalizeVariantLabel(variant.color) : "";
      const size = typeof variant.size === "string" ? normalizeVariantLabel(variant.size) : "";
      const sku = String(variant.sku ?? "").normalize("NFKC").trim().toLowerCase();
      if (Number(variant.isActive) !== 1 || !color || !size || !sku || skuCounts.get(sku) !== 1 || !variant.optionKey) return false;
      try { if (createVariantOptionKey(color, size) !== variant.optionKey) return false; } catch { return false; }
      const effectivePrice = variant.price === null ? Number(product.price) : Number(variant.price);
      if (!Number.isSafeInteger(effectivePrice) || effectivePrice <= 0) return false;
      return product.salesMode === "PREORDER"
        ? batchAcceptsSales(product.productionBatch) && batchHasCapacity(product.productionBatch)
        : Number(variant.stock) - (reserved.get(variant.id) ?? 0) > 0;
    });
    return { ...product, hasVariants: variants.length > 0, hasSellableVariants };
  });
}

export async function getProductById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await selectProductRows(db, { id });
  return result.length > 0 ? result[0] : undefined;
}

export async function getProductsByIds(ids: number[]) {
  const db = await getDb();
  if (!db || ids.length === 0) return [];

  const uniqueIds = Array.from(new Set(ids.filter(id => Number.isInteger(id) && id > 0)));
  if (uniqueIds.length === 0) return [];

  return await selectProductRows(db, { ids: uniqueIds });
}

export async function getProductByIdWithDetails(id: number) {
  const db = await getDb();
  if (!db) return undefined;

  const productRows = await selectProductRows(db, { id });
  if (productRows.length === 0) return undefined;

  const imageRows = await selectProductImageRows(db, [id]);
  const variantRows = await selectProductVariantRows(db, [id]);

  return {
    ...(await enrichProductsWithBatch(db,productRows))[0],
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
  if (!db) {
    return {
      summary: {
        total: 0,
        average: 0,
        ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<number, number>,
        sizeDistribution: { small: 0, true_to_size: 0, large: 0 },
      },
      reviews: [],
    };
  }

  const reviews = await db
    .select({
      id: productReviews.id,
      productId: productReviews.productId,
      rating: productReviews.rating,
      comment: productReviews.comment,
      sizePerception: productReviews.sizePerception,
      imageUrl: productReviews.imageUrl,
      imageStatus: productReviews.imageStatus,
      createdAt: productReviews.createdAt,
      userName: users.name,
    })
    .from(productReviews)
    .leftJoin(users, eq(users.id, productReviews.userId))
    .where(and(
      eq(productReviews.productId, productId),
      eq(productReviews.verifiedPurchase, 1),
      eq(productReviews.moderationStatus, "published"),
    ))
    .orderBy(desc(productReviews.id));

  const ratingDistribution = [1, 2, 3, 4, 5].reduce<Record<number, number>>((acc, rating) => {
    acc[rating] = reviews.filter(review => review.rating === rating).length;
    return acc;
  }, {});
  const sizeDistribution = {
    small: reviews.filter(review => review.sizePerception === "small").length,
    true_to_size: reviews.filter(review => review.sizePerception === "true_to_size").length,
    large: reviews.filter(review => review.sizePerception === "large").length,
  };
  const total = reviews.length;

  return {
    summary: {
      total,
      average: total
        ? Number((reviews.reduce((sum, review) => sum + review.rating, 0) / total).toFixed(1))
        : 0,
      ratingDistribution,
      sizeDistribution,
    },
    reviews: reviews.slice(0, 12).map(review => ({
      ...review,
      userName: String(review.userName || "Cliente L4CKOS").trim().split(/\s+/)[0],
      imageUrl: review.imageStatus === "approved" ? review.imageUrl : null,
      verifiedPurchase: true as const,
    })),
  };
}

export async function getEligibleReviewProducts(userId: number, orderId?: number) {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select({
      stockReservationId: stockReservations.id,
      orderId: orders.id,
      productId: products.id,
      productName: products.name,
      productImage: products.imageThumbnailUrl,
      productFallbackImage: products.imageUrl,
      deliveredAt: orders.updatedAt,
      paymentStatus: orders.paymentStatus,
      paymentConfirmationSource: orders.paymentConfirmationSource,
      paymentConfirmedAt: orders.paymentConfirmedAt,
      paymentConfirmedBy: orders.paymentConfirmedBy,
      paymentConfirmationReference: orders.paymentConfirmationReference,
    })
    .from(stockReservations)
    .innerJoin(orders, eq(orders.id, stockReservations.orderId))
    .innerJoin(products, eq(products.id, stockReservations.productId))
    .leftJoin(
      productReviews,
      and(
        eq(productReviews.stockReservationId, stockReservations.id),
        eq(productReviews.verifiedPurchase, 1),
      ),
    )
    .where(and(
      eq(stockReservations.userId, userId),
      eq(orders.userId, userId),
      eq(orders.status, "delivered"),
      ...(orderId ? [eq(orders.id, orderId)] : []),
      isNull(productReviews.id),
    ))
    .orderBy(desc(orders.updatedAt), desc(stockReservations.id));

  return rows.filter(isTrustedPaymentConfirmation).map(row => ({
    stockReservationId: row.stockReservationId,
    orderId: row.orderId,
    productId: row.productId,
    productName: row.productName,
    productImage: row.productImage || row.productFallbackImage || null,
    deliveredAt: row.deliveredAt,
  }));
}

export async function hasEligibleReviewPurchase(userId: number, productId: number) {
  const eligible = await getEligibleReviewProducts(userId);
  return eligible.some(item => item.productId === productId);
}

export async function registerProductReviewUpload(input: {
  token: string;
  userId: number;
  productId: number;
  imageUrl: string;
  expiresAt: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(productReviewUploads).values(input);
}

export async function createVerifiedProductReview(input: {
  productId: number;
  stockReservationId: number;
  userId: number;
  rating: number;
  comment: string;
  sizePerception: "small" | "true_to_size" | "large";
  imageToken?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db.transaction(async tx => {
    const eligibleRows = await tx
      .select({
        stockReservationId: stockReservations.id,
        orderId: orders.id,
        paymentStatus: orders.paymentStatus,
        paymentConfirmationSource: orders.paymentConfirmationSource,
        paymentConfirmedAt: orders.paymentConfirmedAt,
        paymentConfirmedBy: orders.paymentConfirmedBy,
        paymentConfirmationReference: orders.paymentConfirmationReference,
      })
      .from(stockReservations)
      .innerJoin(orders, eq(orders.id, stockReservations.orderId))
      .where(and(
        eq(stockReservations.id, input.stockReservationId),
        eq(stockReservations.userId, input.userId),
        eq(stockReservations.productId, input.productId),
        eq(orders.userId, input.userId),
        eq(orders.status, "delivered"),
      ))
      .limit(1);

    const purchase = eligibleRows[0];
    if (!purchase || !isTrustedPaymentConfirmation(purchase)) {
      return { outcome: "not_eligible" as const };
    }

    const existing = await tx
      .select({
        id: productReviews.id,
      })
      .from(productReviews)
      .where(eq(productReviews.stockReservationId, purchase.stockReservationId))
      .limit(1);
    if (existing[0]) return { outcome: "duplicate" as const };

    let imageUrl: string | null = null;
    if (input.imageToken) {
      const uploadRows = await tx
        .select()
        .from(productReviewUploads)
        .where(and(
          eq(productReviewUploads.token, input.imageToken),
          eq(productReviewUploads.userId, input.userId),
          eq(productReviewUploads.productId, input.productId),
          isNull(productReviewUploads.claimedAt),
          gte(productReviewUploads.expiresAt, new Date()),
        ))
        .limit(1);
      if (!uploadRows[0]) return { outcome: "invalid_image" as const };
      imageUrl = uploadRows[0].imageUrl;
    }

    const result = await tx.insert(productReviews).values({
      productId: input.productId,
      userId: input.userId,
      orderId: purchase.orderId,
      stockReservationId: purchase.stockReservationId,
      rating: input.rating,
      comment: input.comment.trim(),
      sizePerception: input.sizePerception,
      imageUrl,
      imageStatus: imageUrl ? "pending" : "none",
      moderationStatus: "published",
      verifiedPurchase: 1,
    });

    if (input.imageToken) {
      await tx
        .update(productReviewUploads)
        .set({ claimedAt: new Date() })
        .where(eq(productReviewUploads.token, input.imageToken));
    }

    return {
      outcome: "created" as const,
      id: Number((result as any)?.[0]?.insertId ?? 0),
    };
  });
}

export async function getAdminProductReviews() {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select({
      id: productReviews.id,
      productId: productReviews.productId,
      productName: products.name,
      userName: users.name,
      userEmail: users.email,
      orderId: productReviews.orderId,
      rating: productReviews.rating,
      comment: productReviews.comment,
      sizePerception: productReviews.sizePerception,
      imageUrl: productReviews.imageUrl,
      imageStatus: productReviews.imageStatus,
      moderationStatus: productReviews.moderationStatus,
      verifiedPurchase: productReviews.verifiedPurchase,
      createdAt: productReviews.createdAt,
      moderatedAt: productReviews.moderatedAt,
    })
    .from(productReviews)
    .leftJoin(products, eq(products.id, productReviews.productId))
    .leftJoin(users, eq(users.id, productReviews.userId))
    .orderBy(desc(productReviews.id));
}

export async function moderateProductReview(input: {
  reviewId: number;
  actorUserId: number;
  moderationStatus?: "published" | "hidden_spam" | "hidden_offensive";
  imageStatus?: "approved" | "rejected";
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const update = {
    ...(input.moderationStatus ? { moderationStatus: input.moderationStatus } : {}),
    ...(input.imageStatus ? { imageStatus: input.imageStatus } : {}),
    moderatedBy: input.actorUserId,
    moderatedAt: new Date(),
  };
  await db.update(productReviews).set(update).where(eq(productReviews.id, input.reviewId));
  return { success: true } as const;
}

function getDatabaseErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message;
}

function isMissingDatabaseObjectError(error: unknown) {
  const message = getDatabaseErrorMessage(error);
  return /(unknown column|unknown table|doesn't exist|does not exist|no such table)/i.test(message);
}

function isLegacyProductColumnError(error: unknown) {
  const message = getDatabaseErrorMessage(error);
  return /unknown column/i.test(message) && /(description|fullDescription|imageUrl|image(Thumbnail|Detail|Banner)Url|optionColors|optionSizes|sizeType|stock)/i.test(message);
}

function getUnknownColumnName(error: unknown) {
  const message = getDatabaseErrorMessage(error);
  return message.match(/unknown column ['"`]?([^'"`\s]+)['"`]?/i)?.[1] ?? null;
}

function getRecoverableProductColumnName(error: unknown) {
  const message = getDatabaseErrorMessage(error);
  return (
    getUnknownColumnName(error) ||
    message.match(/data too long for column ['"`]?([^'"`]+)['"`]?/i)?.[1] ||
    message.match(/data truncated for column ['"`]?([^'"`]+)['"`]?/i)?.[1] ||
    null
  );
}

function isOptionalProductColumn(column: string | null) {
  return Boolean(column && [
    "description",
    "fullDescription",
    "imageUrl",
    "imageThumbnailUrl",
    "imageDetailUrl",
    "imageBannerUrl",
    "optionColors",
    "optionSizes",
    "sizeType",
    "stock",
  ].includes(column));
}

type DatabaseColumnInfo = {
  Field: string;
  Type?: string;
  Null?: string;
  Default?: unknown;
  Extra?: string;
};

async function getDatabaseTableColumns(db: Awaited<ReturnType<typeof getDb>>, tableName: string) {
  if (!db) return [];
  const safeTableName = tableName.replace(/`/g, "``");
  return extractExecutedRows(await db.execute(sql.raw(`show columns from \`${safeTableName}\``))) as DatabaseColumnInfo[];
}

function normalizeProductPayloadForColumns(product: Partial<InsertProduct>, columns: DatabaseColumnInfo[]) {
  const columnByName = new Map(columns.map(column => [column.Field, column]));
  const payload: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(product as Record<string, unknown>)) {
    const column = columnByName.get(key);
    if (!column || value === undefined) continue;

    const varcharLength = String(column.Type ?? "").match(/^varchar\((\d+)\)/i)?.[1];
    if (typeof value === "string" && varcharLength) {
      const maxLength = Number(varcharLength);
      if (Number.isFinite(maxLength) && value.length > maxLength) {
        if (isOptionalProductColumn(key)) continue;
        payload[key] = value.slice(0, maxLength);
        continue;
      }
    }

    payload[key] = value;
  }

  return payload;
}

async function insertProductFromActualColumns(db: Awaited<ReturnType<typeof getDb>>, product: InsertProduct) {
  if (!db) throw new Error("Database not available");
  const columns = await getDatabaseTableColumns(db, "products");
  const payload = normalizeProductPayloadForColumns(product, columns);
  const writableColumns = Object.keys(payload).filter(column => column !== "id" && columns.some(item => item.Field === column));

  if (!writableColumns.includes("name") || !writableColumns.includes("category") || !writableColumns.includes("price")) {
    throw new Error("Tabela products sem colunas obrigatórias para criar produto.");
  }

  const columnSql = sql.raw(writableColumns.map(column => `\`${column.replace(/`/g, "``")}\``).join(", "));
  const valueSql = sql.join(writableColumns.map(column => sql`${payload[column]}`), sql`, `);
  return await db.execute(sql`insert into products (${columnSql}) values (${valueSql})`);
}

async function updateProductFromActualColumns(
  db: Awaited<ReturnType<typeof getDb>>,
  id: number,
  product: Partial<InsertProduct>,
) {
  if (!db) throw new Error("Database not available");
  const columns = await getDatabaseTableColumns(db, "products");
  const payload = normalizeProductPayloadForColumns(product, columns);
  const writableColumns = Object.keys(payload).filter(column => column !== "id" && columns.some(item => item.Field === column));

  if (writableColumns.length === 0) return { success: true };

  const setSql = sql.join(
    writableColumns.map(column => sql`${sql.raw(`\`${column.replace(/`/g, "``")}\``)} = ${payload[column]}`),
    sql`, `,
  );
  return await db.execute(sql`update products set ${setSql} where id = ${id}`);
}

function stripOptionalProductFields(product: Partial<InsertProduct>) {
  const {
    imageThumbnailUrl,
    imageDetailUrl,
    imageBannerUrl,
    fullDescription,
    optionColors,
    optionSizes,
    sizeType,
    ...legacyProduct
  } = product as Partial<InsertProduct> & {
    imageThumbnailUrl?: string | null;
    imageDetailUrl?: string | null;
    imageBannerUrl?: string | null;
    fullDescription?: string | null;
    optionColors?: string | null;
    optionSizes?: string | null;
    sizeType?: string | null;
  };
  return legacyProduct;
}

async function insertProductWithLegacyFallback(db: Awaited<ReturnType<typeof getDb>>, product: InsertProduct) {
  if (!db) throw new Error("Database not available");
  let payload = { ...product } as Record<string, unknown>;
  const removedColumns = new Set<string>();

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await db.insert(products).values(payload as InsertProduct);
    } catch (error) {
      const recoverableColumn = getRecoverableProductColumnName(error);
      if (!recoverableColumn || removedColumns.has(recoverableColumn) || !(recoverableColumn in payload) || !isOptionalProductColumn(recoverableColumn)) {
        if (!isLegacyProductColumnError(error)) throw error;
        payload = stripOptionalProductFields(payload as Partial<InsertProduct>) as Record<string, unknown>;
        continue;
      }
      delete payload[recoverableColumn];
      removedColumns.add(recoverableColumn);
    }
  }

  return await db.insert(products).values(payload as InsertProduct);
}

async function updateProductWithLegacyFallback(
  db: Awaited<ReturnType<typeof getDb>>,
  id: number,
  product: Partial<InsertProduct>,
) {
  if (!db) throw new Error("Database not available");
  let payload = { ...product } as Record<string, unknown>;
  const removedColumns = new Set<string>();

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await db.update(products).set(payload as Partial<InsertProduct>).where(eq(products.id, id));
    } catch (error) {
      const recoverableColumn = getRecoverableProductColumnName(error);
      if (!recoverableColumn || removedColumns.has(recoverableColumn) || !(recoverableColumn in payload) || !isOptionalProductColumn(recoverableColumn)) {
        if (!isLegacyProductColumnError(error)) throw error;
        payload = stripOptionalProductFields(payload as Partial<InsertProduct>) as Record<string, unknown>;
        continue;
      }
      delete payload[recoverableColumn];
      removedColumns.add(recoverableColumn);
    }
  }

  return await db.update(products).set(payload as Partial<InsertProduct>).where(eq(products.id, id));
}

export async function createProduct(product: InsertProduct) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    return await insertProductFromActualColumns(db, product);
  } catch (error) {
    console.warn("[db.createProduct] dynamic insert failed, falling back to drizzle insert", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return await insertProductWithLegacyFallback(db, product);
  }
}

export async function updateProduct(id: number, product: Partial<InsertProduct>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    return await updateProductFromActualColumns(db, id, product);
  } catch (error) {
    console.warn("[db.updateProduct] dynamic update failed, falling back to drizzle update", {
      productId: id,
      reason: error instanceof Error ? error.message : String(error),
    });
    return await updateProductWithLegacyFallback(db, id, product);
  }
}

export async function deleteProduct(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.transaction(async tx => {
    const [product] = await tx.select({ id: products.id }).from(products).where(eq(products.id, id)).for("update");
    if (!product) throw new ProductCatalogConflictError("Produto não encontrado.");
    const references = await Promise.all([
      tx.select({ id: orderItems.id }).from(orderItems).where(eq(orderItems.productId, id)).limit(1),
      tx.select({ id: stockReservations.id }).from(stockReservations).where(eq(stockReservations.productId, id)).limit(1),
      tx.select({ id: productionBatchProducts.id }).from(productionBatchProducts).where(eq(productionBatchProducts.productId, id)).limit(1),
      tx.select({ id: productReviews.id }).from(productReviews).where(eq(productReviews.productId, id)).limit(1),
      tx.select({ id: cartItems.id }).from(cartItems).where(eq(cartItems.productId, id)).limit(1),
      tx.select({ id: favorites.id }).from(favorites).where(eq(favorites.productId, id)).limit(1),
    ]);
    if (references.some(rows => rows.length > 0)) {
      throw new ProductCatalogConflictError("Este produto está vinculado a pedidos, reservas, avaliações, lotes, carrinhos ou favoritos e não pode ser excluído com segurança.");
    }
    await tx.delete(productImages).where(eq(productImages.productId, id));
    await tx.delete(productVariants).where(eq(productVariants.productId, id));
    return await tx.delete(products).where(eq(products.id, id));
  });
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
  assertPublicCheckoutEnabled();
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
  assertPublicCheckoutEnabled();
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
  const preorderRows = orderRows.length ? await db.select({ orderId: orderItems.orderId, status: productionBatches.status })
    .from(orderItems).leftJoin(productionBatches, eq(productionBatches.id, orderItems.productionBatchId))
    .where(and(inArray(orderItems.orderId, orderRows.map(order => order.id)), eq(orderItems.salesModeAtPurchase, "PREORDER"))) : [];
  const awaitingProduction = new Set(preorderRows.filter(item => !["RECEIVED", "SHIPPING", "COMPLETED"].includes(item.status ?? "")).map(item => item.orderId));
  return orderRows.map(order => ({
    ...order,
    awaitingProduction: ["paid", "processing"].includes(order.status) && awaitingProduction.has(order.id),
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

/** Call only after order ownership/admin authorization, like getOrderReservationItems. */
export async function getOrderShippingDeadlineSnapshot(orderId: number) {
  const db = await getDb();
  if (!db) return null;
  const [event] = await db.select({ metadata: auditLogs.metadata }).from(auditLogs)
    .where(and(eq(auditLogs.entity, "order"), eq(auditLogs.entityId, String(orderId)), eq(auditLogs.action, "checkout.created")))
    .orderBy(auditLogs.id).limit(1);
  return readShippingSnapshot(event?.metadata);
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
      productName: sql<string>`case when ${orderItems.id} is null then ${products.name} else ${orderItems.productName} end`,
      productImage: sql<string>`case when ${orderItems.id} is null then ${products.imageUrl} else ${orderItems.imageUrl} end`,
      sku: sql<string>`case when ${orderItems.id} is null then ${productVariants.sku} else ${orderItems.sku} end`,
      // Public DTO alias: productPrice is the frozen unitPrice for linked items.
      // Historical unlinked reservations retain their existing catalog fallback.
      productPrice: sql<number>`coalesce(${orderItems.unitPrice}, ${products.price})`,
    })
    .from(stockReservations)
    .leftJoin(orderItems, eq(orderItems.id, stockReservations.orderItemId))
    .leftJoin(products, eq(products.id, stockReservations.productId))
    .leftJoin(productVariants, eq(productVariants.id, stockReservations.variantId))
    .where(eq(stockReservations.orderId, orderId))
    .orderBy(desc(stockReservations.id));

  const purchased = await db.select({
    id: orderItems.id, orderId:orderItems.orderId, productId:orderItems.productId, sku:orderItems.sku,
    quantity:orderItems.quantity, productName:orderItems.productName, productImage:orderItems.imageUrl,
    productPrice:orderItems.unitPrice, size:orderItems.size, color:orderItems.color,
    salesModeAtPurchase:orderItems.salesModeAtPurchase, productionBatchId:orderItems.productionBatchId,
    productionBatchNameAtPurchase:orderItems.productionBatchNameAtPurchase,
    estimatedShippingStartAtPurchase:orderItems.estimatedShippingStartAtPurchase,
    estimatedShippingEndAtPurchase:orderItems.estimatedShippingEndAtPurchase,
    estimatedManufacturingStartAtPurchase:orderItems.estimatedManufacturingStartAtPurchase,
    estimatedManufacturingEndAtPurchase:orderItems.estimatedManufacturingEndAtPurchase,
    productionStatus:productionBatches.status,
    currentEstimatedShippingStart:productionBatches.estimatedShippingStart,
    currentEstimatedShippingEnd:productionBatches.estimatedShippingEnd,
    currentEstimatedManufacturingStart:productionBatches.estimatedManufacturingStart,
    currentEstimatedManufacturingEnd:productionBatches.estimatedManufacturingEnd,
  }).from(orderItems).leftJoin(productionBatches,eq(productionBatches.id,orderItems.productionBatchId))
    .where(eq(orderItems.orderId,orderId)).orderBy(orderItems.id);
  const legacy=await db.select({id:stockReservations.id}).from(stockReservations)
    .where(and(eq(stockReservations.orderId,orderId),sql`${stockReservations.orderItemId} IS NULL`));
  const legacyIds=new Set(legacy.map(row=>row.id));
  return [...purchased.map(item=>({...item,status:'purchased',expiresAt:null})),...items.filter(item=>legacyIds.has(item.id)).map(item=>({...item,salesModeAtPurchase:'STOCK' as const,productionBatchId:null,productionBatchNameAtPurchase:null,estimatedShippingStartAtPurchase:null,estimatedShippingEndAtPurchase:null,productionStatus:null,size:null,color:null}))];
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
  items: Array<{ productId: number; variantId?: number; orderItemId?: number; quantity: number }>;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 20 * 60 * 1000);

  await db.transaction(async tx => {
    const [order] = await tx.select({ id: orders.id, userId: orders.userId, status: orders.status })
      .from(orders).where(and(eq(orders.id, input.orderId), eq(orders.userId, input.userId))).for("update");
    if (!order || order.status !== "pending") throw new Error("Order cannot receive a stock reservation.");
    await tx
      .update(stockReservations)
      .set({ status: "released" })
      .where(and(eq(stockReservations.orderId, input.orderId), eq(stockReservations.status, "active")));

    for (const item of input.items) {
      if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) throw new Error("Invalid reservation quantity.");
      const [product] = await tx.select().from(products).where(eq(products.id, item.productId)).for("update");
      if (!product) throw new Error(`Produto ${item.productId} nao encontrado.`);
      if (isRestrictedPublicPurchase(product.name)) throw new Error("Product requires server-side purchase authorization.");
      if (product.salesMode === "PREORDER") throw new Error("Preorder items do not reserve physical stock.");
      if (item.orderItemId === undefined) throw new Error("Stock reservation requires its order item.");
      const [orderItem] = await tx.select().from(orderItems).where(and(
        eq(orderItems.id, item.orderItemId), eq(orderItems.orderId, input.orderId),
      )).for("update");
      if (!orderItem || orderItem.productId !== item.productId || orderItem.quantity !== item.quantity ||
        orderItem.salesModeAtPurchase !== "STOCK" || orderItem.variantId !== (item.variantId ?? null)) {
        throw new Error("Stock reservation does not match its order item.");
      }
      const variants = await tx.select().from(productVariants).where(eq(productVariants.productId, item.productId)).orderBy(productVariants.id).for("update");
      const variant = item.variantId === undefined ? null : variants.find(row => row.id === item.variantId);
      if (variants.length > 0 && !item.variantId) throw new Error("Variant ID required for this product.");
      if (item.variantId !== undefined && !variant) throw new Error("Variant does not belong to this product.");
      if (variants.length === 0 && item.variantId !== undefined) throw new Error("Simple products cannot reserve variant stock.");
      if (variant) {
        const color = normalizeVariantLabel(String(variant.color ?? ""));
        const size = normalizeVariantLabel(String(variant.size ?? ""));
        if (Number(variant.isActive) !== 1 || !color || !size || !variant.sku?.trim() ||
          !variant.optionKey || variant.optionKey !== createVariantOptionKey(color, size) ||
          isRestrictedPublicPurchase(product.name, variant.sku)) throw new Error("Variant is not available for public reservation.");
        if (orderItem.variantId !== variant.id) {
          throw new Error("Variant reservation does not match its order item.");
        }
      }

      const [reservedRow] = await tx
        .select({
          total: sql<number>`coalesce(sum(${stockReservations.quantity}), 0)`,
        })
        .from(stockReservations)
        .where(
          and(
            eq(stockReservations.productId, item.productId),
            variant ? eq(stockReservations.variantId, variant.id) : isNull(stockReservations.variantId),
            eq(stockReservations.status, "active"),
            gte(stockReservations.expiresAt, now),
          ),
        );

      const reservedQty = Number(reservedRow?.total ?? 0);
      const available = Number(variant?.stock ?? product.stock ?? 0) - reservedQty;
      if (available < item.quantity) {
        throw new Error(`Estoque insuficiente para ${product.name}. Disponivel: ${Math.max(0, available)}.`);
      }

      await tx.insert(stockReservations).values({
        orderId: input.orderId,
        userId: input.userId,
        productId: item.productId,
        variantId: variant?.id ?? null,
        orderItemId: item.orderItemId ?? null,
        quantity: item.quantity,
        status: "active",
        expiresAt,
      });
    }
  });
}

export async function getAllOrders() {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(orders);
}

/** Immutable reconciliation evidence only; no financial or fulfillment mutation. */
export async function reserveExternalCheckoutCreation(orderId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Persistent checkout evidence unavailable");
  return db.transaction(async tx => {
    const [order] = await tx.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.userId, userId))).for("update");
    if (!order || order.status !== "pending" || isTrustedPaymentConfirmation(order) || order.asaasCheckoutId || order.checkoutAttemptId) throw new Error("Checkout reconciliation required");
    const [attempt] = await tx.select({id:auditLogs.id}).from(auditLogs).where(and(eq(auditLogs.entity,"order"),eq(auditLogs.entityId,String(orderId)),eq(auditLogs.action,"checkout.external_creation_requested"))).limit(1);
    if (attempt) throw new Error("Checkout reconciliation required");
    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(orderItems.id).for("update");
    const reservations = await tx.select().from(stockReservations).where(eq(stockReservations.orderId, orderId)).orderBy(stockReservations.id).for("update");
    if (!items.length || items.some(item => item.salesModeAtPurchase !== "STOCK") || reservations.length !== items.length) {
      throw new Error("Legacy checkout requires a complete, active stock reservation snapshot.");
    }
    const now = new Date();
    for (const item of items) {
      const matching = reservations.filter(reservation => reservation.orderItemId === item.id);
      if (matching.length !== 1 || matching[0].userId !== userId || matching[0].productId !== item.productId ||
        matching[0].variantId !== item.variantId || matching[0].quantity !== item.quantity ||
        matching[0].status !== "active" || matching[0].expiresAt <= now) {
        throw new Error("Legacy checkout reservation is absent, expired, or inconsistent.");
      }
      const [product] = await tx.select({ name: products.name }).from(products).where(eq(products.id, item.productId)).for("update");
      if (!product || isRestrictedPublicPurchase(product.name, item.sku)) throw new Error("Product is not available for legacy checkout.");
      const variants = await tx.select().from(productVariants).where(eq(productVariants.productId, item.productId)).orderBy(productVariants.id).for("update");
      if (variants.length && item.variantId === null) throw new Error("Legacy checkout variant identity is missing.");
      if (item.variantId !== null) {
        const variant = variants.find(candidate => candidate.id === item.variantId);
        const color = normalizeVariantLabel(String(variant?.color ?? ""));
        const size = normalizeVariantLabel(String(variant?.size ?? ""));
        if (!variant || Number(variant.isActive) !== 1 || !color || !size || !variant.sku?.trim() ||
          !variant.optionKey || variant.optionKey !== createVariantOptionKey(color, size) ||
          normalizeVariantLabel(String(item.color ?? "")) !== color || normalizeVariantLabel(String(item.size ?? "")) !== size ||
          variants.filter(candidate => String(candidate.sku ?? "").normalize("NFKC").trim().toLowerCase() === variant.sku!.normalize("NFKC").trim().toLowerCase()).length !== 1) {
          throw new Error("Legacy checkout variant is inactive or inconsistent.");
        }
      }
    }
    await tx.insert(auditLogs).values({actorUserId:userId,actorType:"user",action:"checkout.external_creation_requested",entity:"order",entityId:String(orderId),metadata:JSON.stringify({recoveryRequiredOnUncertainResult:true})});
    return order;
  });
}

/** Immutable reconciliation evidence only; no financial or fulfillment mutation. */
export async function recordPaymentException(input: { orderId: number; eventId: string; event: string; paymentId: string | null; checkoutId: string | null; observation?: { eventDeleted: boolean; currentDeleted: boolean | null; currentStatus: string | null; currentAmountCents: number | null; eventAmountCents: number | null } }) {
  const db = await getDb();
  if (!db) throw new Error("Persistent reconciliation unavailable");
  await db.transaction(async tx => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, input.orderId)).for("update");
    if (!order) throw new Error("Order not found");
    if (input.checkoutId && order.asaasCheckoutId && input.checkoutId !== order.asaasCheckoutId) throw new Error("Payment checkout mismatch");
    await tx.insert(auditLogs).values({ actorType: "system", action: "payment.reconciliation_required", entity: "order", entityId: String(input.orderId), metadata: JSON.stringify({ ...input, orderStatus: order.status, providerObservationOnly: true, financialMutation: false, reservationMutation: false, reconciliationRequired: true }) });
  });
}

export async function markOrderPaid(
  orderId: number,
  confirmation: TrustedPaymentConfirmation,
) {
  assertWebhookBusinessEffectsAllowed();
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db.transaction(async tx => {
    await assertOrderNotRecoveryHeld(tx,orderId);
    // Serializa webhook e confirmação manual concorrentes para impedir baixa
    // duplicada de estoque ou sobrescrita da evidência de pagamento.
    const current = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1)
      .for("update");
    const order = current[0];
    if (!order) {
      throw new Error("Order not found");
    }

    if (order.status === "cancelled") {
      await tx.insert(auditLogs).values({ actorType: "system", action: "payment.reconciliation_required", entity: "order", entityId: String(orderId), metadata: JSON.stringify({ reason: "payment_after_cancellation", source: confirmation.source, reconciliationRequired: true, financialMutation: false }) });
      return { updated: false, invalidTransition: true, status: order.status, lowStockProducts: [] } as const;
    }
    if (isTrustedPaymentConfirmation(order)) {
      return { updated: false, status: order.status, lowStockProducts: [] } as const;
    }

    if(selectiveOrderAllowed(orderId))return confirmSelectedCheckoutStock(tx,orderId,buildPaymentConfirmationValues(confirmation));

    const reservations = await tx.select().from(stockReservations).where(eq(stockReservations.orderId, orderId)).for("update");
    const purchasedItems = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(orderItems.id).for("update");
    const expiryTime = new Date();
    if (reservations.some(r => r.status !== "active" || r.expiresAt.getTime() <= expiryTime.getTime())) {
      await tx.update(stockReservations).set({ status: "expired" }).where(and(
        eq(stockReservations.orderId, orderId),
        eq(stockReservations.status, "active"),
        lte(stockReservations.expiresAt, expiryTime),
      ));
      await tx.insert(auditLogs).values({ actorType: "system", action: "payment.reconciliation_required", entity: "order", entityId: String(orderId), metadata: JSON.stringify({ reason: "stock_reservation_unavailable", source: confirmation.source, reconciliationRequired: true, financialMutation: false }) });
      return { updated: false, invalidTransition: true, status: order.status, lowStockProducts: [] } as const;
    }
    const reservationLinkInvalid = purchasedItems.some(item => {
      if (item.salesModeAtPurchase !== "STOCK") return reservations.some(reservation => reservation.orderItemId === item.id);
      const matching = reservations.filter(reservation => reservation.orderItemId === item.id);
      return matching.length !== 1 || matching[0].productId !== item.productId ||
        matching[0].variantId !== item.variantId || matching[0].quantity !== item.quantity ||
        matching[0].userId !== order.userId;
    }) || reservations.some(reservation => {
      if (reservation.orderItemId === null || reservation.userId !== order.userId) return true;
      const item = purchasedItems.find(candidate => candidate.id === reservation.orderItemId);
      return !item || item.productId !== reservation.productId || item.variantId !== reservation.variantId || item.quantity !== reservation.quantity;
    });
    if (reservationLinkInvalid) {
      await tx.insert(auditLogs).values({ actorType: "system", action: "payment.reconciliation_required", entity: "order", entityId: String(orderId), metadata: JSON.stringify({ reason: "stock_reservation_item_mismatch", source: confirmation.source, reconciliationRequired: true, financialMutation: false, reservationMutation: false }) });
      return { updated: false, invalidTransition: true, status: order.status, lowStockProducts: [] } as const;
    }

    const lowStockProducts: Array<{ id: number; name: string; stock: number }> = [];
    const confirmationValues = buildPaymentConfirmationValues(confirmation);
    const nextStatus = ["pending", "processing"].includes(order.status) ? "paid" : order.status;

    await tx
      .update(orders)
      .set({
        status: nextStatus,
        ...confirmationValues,
      })
      .where(eq(orders.id, orderId));

    if (confirmation.source === "manual") {
      await tx.insert(auditLogs).values({
        actorUserId: confirmation.actorUserId,
        actorType: "admin",
        action: "order.payment_confirmed_manual",
        entity: "order",
        entityId: String(orderId),
        metadata: JSON.stringify({
          source: "manual",
          paymentConfirmedAt: confirmationValues.paymentConfirmedAt.toISOString(),
          previousOrderStatus: order.status,
          resultingOrderStatus: nextStatus,
        }),
      });
    }

    const now = new Date();
    const activeReservations = reservations.filter(reservation => reservation.status === "active" && reservation.expiresAt.getTime() >= now.getTime());

    for (const reservation of activeReservations) {
      const productRows = await tx
        .select({
          id: products.id,
          name: products.name,
          stock: products.stock,
        })
        .from(products)
        .where(eq(products.id, reservation.productId))
        .limit(1)
        .for("update");
      const product = productRows[0];
      if (!product) throw new Error("Reserved product no longer exists");

      if (reservation.variantId) {
        const [variant] = await tx.select().from(productVariants)
          .where(and(eq(productVariants.id, reservation.variantId), eq(productVariants.productId, reservation.productId))).for("update");
        if (!variant || variant.stock < reservation.quantity) throw new Error("Reserved variant stock unavailable");
        await tx.update(productVariants).set({ stock: sql`${productVariants.stock} - ${reservation.quantity}` })
          .where(eq(productVariants.id, variant.id));
        const [stockTotal] = await tx.select({ total: sql<number>`coalesce(sum(${productVariants.stock}), 0)` })
          .from(productVariants).where(eq(productVariants.productId, reservation.productId));
        const aggregateBefore = Number(product.stock ?? 0);
        const aggregateAfter = Number(stockTotal.total ?? 0);
        await tx.update(products).set({ stock: aggregateAfter }).where(eq(products.id, product.id));
        if (aggregateBefore > 5 && aggregateAfter <= 5) {
          lowStockProducts.push({ id: Number(product.id), name: product.name, stock: aggregateAfter });
        }
        continue;
      }
      const [hasVariants] = await tx.select({ id: productVariants.id }).from(productVariants)
        .where(eq(productVariants.productId, reservation.productId)).limit(1).for("update");
      if (hasVariants) throw new Error("Variant reservation ID missing; reconciliation required");
      const currentStock = Number(product?.stock ?? 0);
      if (currentStock < reservation.quantity) throw new Error("Reserved product stock unavailable");
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

    if (activeReservations.length > 0) {
      await tx
        .update(stockReservations)
        .set({ status: "consumed" })
        .where(inArray(stockReservations.id, activeReservations.map(reservation => reservation.id)));
    }

    return {
      updated: true,
      status: nextStatus,
      paymentConfirmedAt: confirmationValues.paymentConfirmedAt,
      lowStockProducts,
    } as const;
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
    .from(userAddresses)
    .catch(error => {
      if (isMissingDatabaseObjectError(error)) return [];
      throw error;
    });
  const reservations = (await Promise.all(baseOrders.map(order=>getOrderReservationItems(order.id)))).flat();

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
  return updateOrderAndReserveDeliveredEmailEvents(orderId,data);
}

export type OrderEmailEventType = "order_delivered_email" | "review_request_email";

export function orderEmailIdempotencyKey(orderId: number, eventType: OrderEmailEventType) {
  return `order-${orderId}-${eventType}`;
}

/**
 * Inserts the one durable event for an order/type pair. A duplicate of this
 * exact insert is the expected idempotency path; no existing row is updated.
 */
export async function reserveOrderEmailEvent(tx: any, orderId: number, eventType: OrderEmailEventType) {
  let reserved = true;
  try {
    await tx.insert(orderEmailEvents).values({
      orderId,
      eventType,
      idempotencyKey: orderEmailIdempotencyKey(orderId, eventType),
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    reserved = false;
  }

  const events = await tx
    .select({ id: orderEmailEvents.id })
    .from(orderEmailEvents)
    .where(and(eq(orderEmailEvents.orderId, orderId), eq(orderEmailEvents.eventType, eventType)))
    .limit(1);
  const eventId = events[0]?.id ?? null;
  if (reserved) {
    console.info("[OrderEmailEvent] event reserved", {
      orderId,
      eventId,
      eventType,
      attemptCount: 0,
    });
  }
  return { reserved, eventId };
}

/**
 * Persists the delivery transition and its outbox events under the same row
 * lock.  The unique key is the concurrency boundary: repeated/concurrent
 * delivered transitions cannot reserve a second logical email event.
 */
export async function updateOrderAndReserveDeliveredEmailEvents(
  orderId: number,
  data: { status?: "pending" | "processing" | "paid" | "shipped" | "delivered" | "cancelled"; trackingCode?: string | null },
  actorUserId?: number,
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db.transaction(async tx => {
    await assertOrderNotRecoveryHeld(tx,orderId);
    const rows = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1).for("update");
    const previousOrder = rows[0];
    if (!previousOrder) throw new Error("Order not found");

    if (previousOrder.status === "cancelled" && data.status && data.status !== "cancelled") throw new Error('Cancelled order cannot be reactivated');
    if (data.status && ['paid','processing','shipped','delivered'].includes(data.status) && !isTrustedPaymentConfirmation(previousOrder)) throw new Error('Trusted payment confirmation required');

    if (data.status === "cancelled" && previousOrder.status !== "cancelled") {
      // Cancellation is not a refund. Consumed stock is never automatically restocked.
      await tx.update(stockReservations).set({ status: "released" }).where(and(eq(stockReservations.orderId, orderId), eq(stockReservations.status, "active")));
      await tx.insert(auditLogs).values({ actorUserId: actorUserId ?? null, actorType: actorUserId ? "admin" : "system", action: "order.cancelled", entity: "order", entityId: String(orderId), metadata: JSON.stringify({ previousStatus: previousOrder.status, paymentConfirmed: isTrustedPaymentConfirmation(previousOrder), refundExecuted: false, reconciliationRequired: isTrustedPaymentConfirmation(previousOrder), stockPolicy: "release_active_only" }) });
    }

    if(data.status) {
      const preorder=await tx.select({batchStatus:productionBatches.status}).from(orderItems)
        .leftJoin(productionBatches,eq(orderItems.productionBatchId,productionBatches.id))
        .where(and(eq(orderItems.orderId,orderId),eq(orderItems.salesModeAtPurchase,'PREORDER')));
      if(preorder.length && previousOrder.status==='cancelled' && data.status!=='cancelled') throw new Error('Cancelled preorder cannot be reactivated');
      if(['shipped','delivered'].includes(data.status) && preorder.some(i=>!['RECEIVED','SHIPPING','COMPLETED'].includes(String(i.batchStatus)))) throw new Error('Preorder production not received');
    }

    await tx.update(orders).set({
      ...(data.status ? { status: data.status } : {}),
      ...(data.trackingCode !== undefined ? { trackingCode: data.trackingCode } : {}),
    }).where(eq(orders.id, orderId));

    const reservedEventTypes: OrderEmailEventType[] = [];
    if (data.status === "delivered" && previousOrder.status !== "delivered") {
      for (const eventType of ["order_delivered_email", "review_request_email"] as const) {
        const reservation = await reserveOrderEmailEvent(tx, orderId, eventType);
        if (reservation.reserved) reservedEventTypes.push(eventType);
      }
    }

    const updated = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    return { previousOrder, updatedOrder: updated[0], reservedEventTypes };
  });
}

export const ORDER_EMAIL_PROCESSING_LEASE_MS = 15 * 60 * 1000;

export async function claimOrderEmailEvent(orderId: number, eventType: OrderEmailEventType) {
  assertWebhookBusinessEffectsAllowed();
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const now = new Date();
  const staleBefore = new Date(now.getTime() - ORDER_EMAIL_PROCESSING_LEASE_MS);

  return await db.transaction(async tx => {
    await assertOrderNotRecoveryHeld(tx,orderId);
    const rows = await tx
      .select({
        id: orderEmailEvents.id,
        status: orderEmailEvents.status,
        attemptCount: orderEmailEvents.attemptCount,
        processingAt: orderEmailEvents.processingAt,
      })
      .from(orderEmailEvents)
      .where(and(eq(orderEmailEvents.orderId, orderId), eq(orderEmailEvents.eventType, eventType)))
      .limit(1)
      .for("update");
    const event = rows[0];
    if (!event) return null;

    const reclaimed = event.status === "processing" && !!event.processingAt && event.processingAt < staleBefore;
    const claimable = event.status === "pending" || event.status === "failed" || reclaimed;
    if (!claimable) return null;

    const claimToken = randomUUID();
    await tx.update(orderEmailEvents).set({
      status: "processing",
      processingAt: now,
      processingToken: claimToken,
      attemptCount: event.attemptCount + 1,
      lastError: null,
      failedAt: null,
    }).where(eq(orderEmailEvents.id, event.id));

    return {
      eventId: event.id,
      claimToken,
      attemptCount: event.attemptCount + 1,
      reclaimed,
    };
  });
}

export async function markOrderEmailEventSent(input: { orderId: number; eventType: OrderEmailEventType; claimToken: string; providerMessageId?: string | null; scheduledAt?: Date | null }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.update(orderEmailEvents).set({
    status: "sent",
    providerMessageId: input.providerMessageId ?? null,
    scheduledAt: input.scheduledAt ?? null,
    sentAt: new Date(),
    processingAt: null,
    processingToken: null,
    failedAt: null,
    lastError: null,
  }).where(and(
    eq(orderEmailEvents.orderId, input.orderId),
    eq(orderEmailEvents.eventType, input.eventType),
    eq(orderEmailEvents.status, "processing"),
    eq(orderEmailEvents.processingToken, input.claimToken),
  ));
  return affectedRows(result) === 1;
}

export async function markOrderEmailEventFailed(input: { orderId: number; eventType: OrderEmailEventType; claimToken: string; error: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.update(orderEmailEvents).set({
    status: "failed",
    processingAt: null,
    processingToken: null,
    failedAt: new Date(),
    lastError: input.error.slice(0, 500),
  }).where(and(
    eq(orderEmailEvents.orderId, input.orderId),
    eq(orderEmailEvents.eventType, input.eventType),
    eq(orderEmailEvents.status, "processing"),
    eq(orderEmailEvents.processingToken, input.claimToken),
  ));
  return affectedRows(result) === 1;
}

async function safeOptionalSelect<T>(label: string, query: () => Promise<T[]>, warnings?: string[]) {
  try {
    return await query();
  } catch (error) {
    if (!isMissingDatabaseObjectError(error)) throw error;
    warnings?.push(`${label}: ${getDatabaseErrorMessage(error)}`);
    return [];
  }
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
  await db.transaction(async tx => {
    await syncProductImages(tx as unknown as ProductDatabase, productId, imageUrls);
  });
}

export async function replaceProductVariants(
  productId: number,
  variants: ProductVariantWrite[],
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.transaction(async tx => {
    const txDb = tx as unknown as ProductDatabase;
    const rows = extractExecutedRows(await txDb.execute(sql`select price from products where id = ${productId} for update`));
    if (!rows.length) throw new Error("Produto não encontrado.");
    await syncProductVariants(txDb, productId, variants, Number(rows[0].price ?? 0));
  });
}

type ProductDatabase = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type ProductVariantWrite = {
  id?: number;
  name?: string;
  color?: string | null;
  size?: string | null;
  sku?: string | null;
  price?: number | null;
  stock?: number;
  isActive?: boolean;
};
type NormalizedProductVariantWrite = {
  id?: number;
  name: string;
  color: string | null;
  size: string | null;
  optionKey: string | null;
  sku: string | null;
  price: number | null;
  stock: number;
  isActive: 0 | 1;
};
export class ProductCatalogConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductCatalogConflictError";
  }
}
export function assertVariantStockCoversReservations(variantName: string, proposedStock: number, activeReserved: number) {
  if (proposedStock < activeReserved) {
    throw new ProductCatalogConflictError(`O estoque da variante “${variantName}” não pode ficar abaixo das ${activeReserved} unidades reservadas ativas.`);
  }
}
type ProductImageWrite = string | {
  imageUrl: string;
  imageThumbnailUrl?: string | null;
  imageDetailUrl?: string | null;
  imageBannerUrl?: string | null;
  color?: string | null;
  alt?: string | null;
};

function normalizeProductImageInput(productId: number, values: ProductImageWrite[]) {
  const seen = new Set<string>();
  return values.map((item, order) => {
    const image = typeof item === "string" ? { imageUrl: item } : item;
    const imageUrl = String(image.imageUrl ?? "").trim();
    if (!imageUrl || seen.has(imageUrl)) return null;
    seen.add(imageUrl);
    return {
      productId,
      imageUrl,
      imageThumbnailUrl: typeof item === "string" ? null : item.imageThumbnailUrl ?? null,
      imageDetailUrl: typeof item === "string" ? null : item.imageDetailUrl ?? null,
      imageBannerUrl: typeof item === "string" ? null : item.imageBannerUrl ?? null,
      color: typeof item === "string" ? null : item.color ?? null,
      alt: typeof item === "string" ? null : item.alt ?? null,
      order,
    };
  }).filter((row): row is NonNullable<typeof row> => row !== null);
}

async function syncProductImages(db: ProductDatabase, productId: number, imageValues: ProductImageWrite[]) {
  const nextRows = normalizeProductImageInput(productId, imageValues);
  let columns: DatabaseColumnInfo[];
  try {
    columns = await getDatabaseTableColumns(db, "productImages");
  } catch (error) {
    if (isMissingDatabaseObjectError(error) && nextRows.length === 0) return;
    if (isMissingDatabaseObjectError(error)) throw new ProductCatalogConflictError("A estrutura de fotos do catálogo não está disponível; as alterações foram canceladas.");
    throw error;
  }
  const available = new Set(columns.map(column => column.Field));
  if (!["id", "productId", "imageUrl", "order"].every(column => available.has(column))) {
    if (nextRows.length === 0) return;
    throw new ProductCatalogConflictError("A estrutura atual de fotos não permite persistir a galeria com segurança.");
  }
  for (const row of nextRows) {
    for (const field of ["imageThumbnailUrl", "imageDetailUrl", "imageBannerUrl", "color", "alt"] as const) {
      if (row[field] != null && !available.has(field)) {
        throw new ProductCatalogConflictError(`A estrutura atual de fotos não suporta ${field}; nenhuma alteração foi gravada.`);
      }
    }
  }

  const existing = extractExecutedRows(await db.execute(
    sql`select * from productImages where productId = ${productId} order by \`order\` asc, id asc for update`,
  )).map(normalizeProductImageRow);
  const byUrl = new Map<string, typeof existing[number]>();
  for (const row of existing) {
    if (byUrl.has(String(row.imageUrl))) throw new ProductCatalogConflictError("Há imagens duplicadas no catálogo; revise a galeria antes de editá-la.");
    byUrl.set(String(row.imageUrl), row);
  }
  const nextUrls = new Set(nextRows.map(row => row.imageUrl));
  const removeIds = existing.filter(row => !nextUrls.has(String(row.imageUrl))).map(row => row.id);
  if (removeIds.length) await db.delete(productImages).where(inArray(productImages.id, removeIds));

  for (const row of nextRows) {
    const current = byUrl.get(row.imageUrl);
    const values = Object.fromEntries(Object.entries(row).filter(([key]) => available.has(key)));
    if (current) {
      const { id: _id, productId: _productId, ...updateValues } = values;
      await db.update(productImages).set(updateValues as any).where(eq(productImages.id, current.id));
    } else {
      await db.insert(productImages).values(values as any);
    }
  }
}

export function planProductVariantSync(
  existing: Array<{ id: number; name: string; sku: string | null; price: number | null; stock: number; color?: string | null; size?: string | null; optionKey?: string | null; isActive?: number | null }>,
  incoming: ProductVariantWrite[],
  referencedVariantIds: number[] = [],
) {
  const ids = new Set<number>();
  const update: Array<{ id: number; value: NormalizedProductVariantWrite }> = [];
  const insert: Array<NormalizedProductVariantWrite> = [];

  for (const variant of incoming) {
    let match: typeof existing[number] | undefined;
    if (variant.id !== undefined) {
      if (ids.has(variant.id)) throw new ProductCatalogConflictError("Uma variante foi enviada mais de uma vez.");
      ids.add(variant.id);
      match = existing.find(row => row.id === variant.id);
      if (!match) throw new ProductCatalogConflictError("A variante informada não pertence a este produto; recarregue o catálogo.");
    } else if (variant.color == null || variant.size == null || variant.sku == null || variant.stock === undefined || variant.isActive === undefined) {
      throw new ProductCatalogConflictError("Uma nova variante precisa de cor, tamanho, SKU, estoque e disponibilidade explícitos.");
    }

    const isActive: 0 | 1 = variant.isActive === undefined ? Number(match?.isActive ?? 0) === 1 ? 1 : 0 : variant.isActive ? 1 : 0;
    const merged = {
      ...variant,
      name: variant.name?.trim() || match?.name || `${variant.color ?? match?.color ?? ""} ${variant.size ?? match?.size ?? ""}`.trim(),
      color: variant.color === undefined ? match?.color ?? null : variant.color,
      size: variant.size === undefined ? match?.size ?? null : variant.size,
      sku: variant.sku === undefined ? match?.sku ?? null : variant.sku,
      price: variant.price === undefined ? match?.price ?? null : variant.price,
      stock: variant.stock === undefined ? match?.stock ?? 0 : variant.stock,
      isActive,
    };
    const color = merged.color == null ? null : normalizeVariantLabel(merged.color);
    const size = merged.size == null ? null : normalizeVariantLabel(merged.size);
    let optionKey: string | null = null;
    if (color && size) optionKey = createVariantOptionKey(color, size);
    if (merged.isActive === 1 && (!color || !size || !optionKey || !merged.sku?.trim())) {
      throw new ProductCatalogConflictError("Uma variante só pode ser ativada após revisão explícita de cor, tamanho, SKU e combinação.");
    }
    if (!merged.name || merged.name.length > 120) throw new ProductCatalogConflictError("O nome de exibição da variante é inválido.");
    if (!Number.isSafeInteger(merged.stock) || merged.stock < 0) throw new ProductCatalogConflictError("O estoque da variante deve ser um inteiro não negativo.");
    if (merged.price !== null && (!Number.isSafeInteger(merged.price) || merged.price < 0)) throw new ProductCatalogConflictError("O preço da variante deve ser nulo (herdado) ou um valor em centavos não negativo.");
    const value: NormalizedProductVariantWrite = { ...merged, id: match?.id, color, size, optionKey, isActive };
    if (match) update.push({ id: match.id, value });
    else insert.push({ ...value, color: color!, size: size!, optionKey: optionKey! });
  }

  const finalRows: NormalizedProductVariantWrite[] = existing.map(row => {
    const change = update.find(item => item.id === row.id)?.value;
    return change ?? {
      id: row.id, name: row.name, color: row.color ?? null, size: row.size ?? null, optionKey: row.optionKey ?? null,
      sku: row.sku, price: row.price, stock: row.stock, isActive: Number(row.isActive ?? 0) === 1 ? 1 : 0,
    };
  });
  finalRows.push(...insert);
  const newlyActivatedIds = new Set([
    ...update.filter(item => item.value.isActive === 1 && Number(existing.find(row => row.id === item.id)?.isActive ?? 0) !== 1).map(item => item.id),
    ...insert.filter(item => item.isActive === 1).map((_, index) => -(index + 1)),
  ]);
  if (newlyActivatedIds.size > 0) {
    const activatingRows = finalRows.filter(row => row.id !== undefined ? newlyActivatedIds.has(row.id) : row.isActive === 1);
    for (const candidate of activatingRows) {
      const unresolvedPeer = finalRows.some(row => row !== candidate && (!row.color || !row.size || !row.optionKey));
      if (unresolvedPeer) throw new ProductCatalogConflictError("Classifique explicitamente ou mantenha inativas as variantes legadas sem identidade antes de ativar novas combinações.");
    }
  }
  const keys = new Set<string>();
  const skus = new Set<string>();
  for (const row of finalRows) {
    if (row.color && row.size) {
      const key = createVariantOptionKey(row.color, row.size);
      if (keys.has(key)) throw new ProductCatalogConflictError("Já existe uma variante com esta combinação de cor e tamanho.");
      keys.add(key);
      if (row.optionKey && row.optionKey !== key) throw new ProductCatalogConflictError("A chave da combinação não corresponde à cor e ao tamanho informados.");
    }
    if (row.sku?.trim()) {
      const skuKey = row.sku.normalize("NFKC").trim().toLocaleLowerCase("pt-BR");
      if (skus.has(skuKey)) throw new ProductCatalogConflictError("Já existe uma variante com este SKU.");
      skus.add(skuKey);
    }
  }
  return { update, insert, remove: [] as number[], referencedVariantIds };
}

async function syncProductVariants(db: ProductDatabase, productId: number, incoming: ProductVariantWrite[], basePriceCents: number) {
  let existing: Array<{ id: number; name: string; sku: string | null; price: number | null; stock: number; color: string | null; size: string | null; optionKey: string | null; isActive: number }>;
  try {
    existing = extractExecutedRows(await db.execute(
      sql`select id, name, sku, price, stock, color, size, optionKey, isActive from productVariants where productId = ${productId} order by id for update`,
    )).map(row => ({ id: Number(row.id), name: String(row.name), sku: row.sku ?? null, price: row.price == null ? null : Number(row.price), stock: Number(row.stock ?? 0), color: row.color ?? null, size: row.size ?? null, optionKey: row.optionKey ?? null, isActive: Number(row.isActive ?? 0) }));
  } catch (error) {
    if (isMissingDatabaseObjectError(error) && incoming.length === 0) return;
    if (isMissingDatabaseObjectError(error)) throw new ProductCatalogConflictError("A estrutura de variantes não está disponível; nenhuma alteração foi gravada.");
    throw error;
  }

  const referencedRows = existing.length
    ? extractExecutedRows(await db.execute(sql`
        select variantId from orderItems where variantId in (${sql.join(existing.map(row => sql`${row.id}`), sql`, `)})
        union
        select variantId from stockReservations where variantId in (${sql.join(existing.map(row => sql`${row.id}`), sql`, `)})
      `))
    : [];
  const referencedIds = referencedRows.map(row => Number(row.variantId));
  const plan = planProductVariantSync(existing, incoming, referencedIds);
  if (plan.update.some(item => item.value.isActive === 1 && item.value.price === null)
    || plan.insert.some(item => item.isActive === 1 && item.price === null)) {
    if (!Number.isSafeInteger(basePriceCents) || basePriceCents <= 0) {
      throw new ProductCatalogConflictError("Variantes com preço herdado exigem preço base válido no produto.");
    }
  }

  const stockReductions = plan.update.filter(item => item.value.stock < (existing.find(row => row.id === item.id)?.stock ?? 0));
  const reservations = stockReductions.length ? await db.select({ variantId: stockReservations.variantId, quantity: stockReservations.quantity })
    .from(stockReservations)
    .where(and(
      eq(stockReservations.productId, productId),
      eq(stockReservations.status, "active"),
      gte(stockReservations.expiresAt, new Date()),
    ))
    .for("update") : [];
  const reservedByVariant = new Map<number, number>();
  for (const reservation of reservations) {
    if (reservation.variantId == null) continue;
    reservedByVariant.set(reservation.variantId, (reservedByVariant.get(reservation.variantId) ?? 0) + Number(reservation.quantity));
  }
  for (const item of plan.update) {
    const reserved = reservedByVariant.get(item.id) ?? 0;
    assertVariantStockCoversReservations(item.value.name, item.value.stock, reserved);
  }

  for (const item of plan.update) {
    await db.update(productVariants).set({
      name: item.value.name.trim(),
      sku: item.value.sku,
      price: item.value.price,
      stock: item.value.stock,
      color: item.value.color,
      size: item.value.size,
      optionKey: item.value.optionKey,
      isActive: item.value.isActive,
    }).where(and(eq(productVariants.id, item.id), eq(productVariants.productId, productId)));
  }
  if (plan.insert.length) await db.insert(productVariants).values(plan.insert.map(item => ({
    productId,
    name: item.name.trim(),
    sku: item.sku,
    price: item.price,
    stock: item.stock,
    color: item.color,
    size: item.size,
    optionKey: item.optionKey,
    isActive: item.isActive,
  })));
  if (existing.length === 0 && plan.insert.length === 0) return;
  const [stockTotal] = await db.select({ total: sql<number>`coalesce(sum(${productVariants.stock}), 0)` })
    .from(productVariants).where(eq(productVariants.productId, productId));
  await db.update(products).set({ stock: Number(stockTotal?.total ?? 0) }).where(eq(products.id, productId));
}

export async function createProductWithCatalog(input: {
  product: InsertProduct;
  images: ProductImageWrite[];
  variants: ProductVariantWrite[];
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const txDb = tx as unknown as ProductDatabase;
    let result: any;
    try {
      result = await insertProductFromActualColumns(txDb, input.product);
    } catch (error) {
      console.warn("[db.createProductWithCatalog] dynamic insert failed, using legacy-compatible insert", {
        reason: error instanceof Error ? error.message : String(error),
      });
      result = await insertProductWithLegacyFallback(txDb, input.product);
    }
    const productId = Number((result as any)?.[0]?.insertId ?? (result as any)?.insertId ?? 0);
    if (!Number.isSafeInteger(productId) || productId <= 0) throw new Error("Não foi possível confirmar o cadastro do produto.");
    await syncProductImages(txDb, productId, input.images);
    await syncProductVariants(txDb, productId, input.variants, Number(input.product.price ?? 0));
    const [variantCountRow] = extractExecutedRows(await txDb.execute(
      sql`select count(*) as variantCount from productVariants where productId = ${productId}`,
    ));
    return { productId, variantCount: Number(variantCountRow?.variantCount ?? 0) };
  });
}

export async function updateProductWithCatalog(input: {
  id: number;
  product: Partial<InsertProduct>;
  images?: ProductImageWrite[];
  variants?: ProductVariantWrite[];
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const txDb = tx as unknown as ProductDatabase;
    const rows = extractExecutedRows(await txDb.execute(sql`select * from products where id = ${input.id} for update`));
    if (!rows.length) throw new Error("Produto não encontrado.");
    const product = normalizeProductRow(rows[0]);
    const existingVariants = await txDb.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.productId, input.id)).for("update");
    const requestedStock = input.product.stock;
    if (existingVariants.length > 0 && requestedStock !== undefined) {
      throw new ProductCatalogConflictError("O estoque agregado de um produto com variantes é calculado pelas variantes; edite o estoque de cada combinação.");
    }
    if (requestedStock !== undefined && requestedStock < Number(product.stock)) {
      const reservations = await txDb.select({ quantity: stockReservations.quantity }).from(stockReservations).where(and(
        eq(stockReservations.productId, input.id),
        eq(stockReservations.status, "active"),
        gte(stockReservations.expiresAt, new Date()),
      )).for("update");
      const activeReserved = reservations.reduce((sum, reservation) => sum + Number(reservation.quantity), 0);
      if (requestedStock < activeReserved) {
        throw new ProductCatalogConflictError(`O estoque do produto não pode ficar abaixo das ${activeReserved} unidades reservadas ativas.`);
      }
    }

    try {
      await updateProductFromActualColumns(txDb, input.id, input.product);
    } catch (error) {
      console.warn("[db.updateProductWithCatalog] dynamic update failed, using legacy-compatible update", {
        productId: input.id,
        reason: error instanceof Error ? error.message : String(error),
      });
      await updateProductWithLegacyFallback(txDb, input.id, input.product);
    }
    if (input.images !== undefined) await syncProductImages(txDb, input.id, input.images);
    if (input.variants !== undefined) await syncProductVariants(txDb, input.id, input.variants, Number(input.product.price ?? product.price ?? 0));
    const persistedVariants = input.variants !== undefined
      ? extractExecutedRows(await txDb.execute(sql`select id, color, size, sku, price, stock, isActive from productVariants where productId = ${input.id} order by id`))
      : undefined;
    return {
      success: true,
      ...(persistedVariants ? { variants: persistedVariants.map(row => ({
        id: Number(row.id), color: row.color ?? null, size: row.size ?? null, sku: row.sku ?? null,
        price: row.price == null ? null : Number(row.price), stock: Number(row.stock ?? 0), isActive: Number(row.isActive ?? 0),
      })) } : {}),
    } as const;
  });
}

export async function getProductsAdmin() {
  const db = await getDb();
  if (!db) return [];
  const productRows = await selectProductRows(db);
  const imageRows = await selectProductImageRows(db, productRows.map(product => product.id));
  const variantRows = await selectProductVariantRows(db, productRows.map(product => product.id));
  const variantIds = variantRows.map(variant => variant.id);
  const [orderReferences, reservationReferences] = variantIds.length ? await Promise.all([
    db.select({ variantId: orderItems.variantId, count: sql<number>`count(*)` })
      .from(orderItems).where(inArray(orderItems.variantId, variantIds)).groupBy(orderItems.variantId),
    db.select({ variantId: stockReservations.variantId, count: sql<number>`count(*)` })
      .from(stockReservations).where(inArray(stockReservations.variantId, variantIds)).groupBy(stockReservations.variantId),
  ]) : [[], []];
  const orderReferenceCounts = new Map(orderReferences.map(row => [Number(row.variantId), Number(row.count)]));
  const reservationReferenceCounts = new Map(reservationReferences.map(row => [Number(row.variantId), Number(row.count)]));

  const imagesMap = new Map<number, typeof imageRows>();
  for (const item of imageRows) {
    const current = imagesMap.get(item.productId) ?? [];
    current.push(item);
    imagesMap.set(item.productId, current);
  }

  const variantsMap = new Map<number, typeof variantRows>();
  for (const item of variantRows) {
    const current = variantsMap.get(item.productId) ?? [];
    current.push({
      ...item,
      historicalOrderReferences: orderReferenceCounts.get(item.id) ?? 0,
      historicalReservationReferences: reservationReferenceCounts.get(item.id) ?? 0,
    });
    variantsMap.set(item.productId, current);
  }

  return productRows.map(product => ({
    ...product,
    imageUrl: product.imageUrl || imagesMap.get(product.id)?.[0]?.imageUrl || null,
    images: imagesMap.get(product.id) ?? [],
    variants: variantsMap.get(product.id) ?? [],
  }));
}

/** Read-only, sellable variant projection for the public catalog; it does not participate in checkout. */
export async function getPublicProductVariants(productId: number) {
  const db = await getDb();
  if (!db) return { product: null, hasVariants: false, variants: [] as Array<{ variantId: number; color: string; size: string; price: number; availableUnits: number | null }> };
  const product = await getProductByIdWithDetails(productId);
  if (!product) return { product: null, hasVariants: false, variants: [] as Array<{ variantId: number; color: string; size: string; price: number; availableUnits: number | null }> };
  const sourceVariants = product.variants ?? [];
  if (sourceVariants.length === 0) return { product, hasVariants: false, variants: [] };
  const skuCounts = new Map<string, number>();
  for (const variant of sourceVariants) {
    const sku = String(variant.sku ?? "").normalize("NFKC").trim().toLowerCase();
    if (sku) skuCounts.set(sku, (skuCounts.get(sku) ?? 0) + 1);
  }

  const reservationRows = await db.select({ variantId: stockReservations.variantId, quantity: sql<number>`coalesce(sum(${stockReservations.quantity}), 0)` })
    .from(stockReservations)
    .where(and(
      eq(stockReservations.productId, productId),
      eq(stockReservations.status, "active"),
      gte(stockReservations.expiresAt, new Date()),
    ))
    .groupBy(stockReservations.variantId);
  const reserved = new Map<number, number>();
  for (const row of reservationRows) if (row.variantId != null) reserved.set(row.variantId, Number(row.quantity ?? 0));

  const variants = sourceVariants.flatMap(variant => {
    const color = typeof variant.color === "string" ? normalizeVariantLabel(variant.color) : "";
    const size = typeof variant.size === "string" ? normalizeVariantLabel(variant.size) : "";
    if (Number(variant.isActive) !== 1 || !color || !size || !variant.optionKey || !variant.sku?.trim()) return [];
    if (skuCounts.get(variant.sku.normalize("NFKC").trim().toLowerCase()) !== 1) return [];
    let canonicalKey: string;
    try { canonicalKey = createVariantOptionKey(color, size); } catch { return []; }
    if (canonicalKey !== variant.optionKey) return [];
    const price = variant.price == null ? Number(product.price) : Number(variant.price);
    if (!Number.isSafeInteger(price) || price <= 0) return [];
    const availableUnits: number | null = product.salesMode === "PREORDER"
      ? null
      : Math.max(0, Number(variant.stock ?? 0) - (reserved.get(variant.id) ?? 0));
    if (product.salesMode !== "PREORDER" && (availableUnits === null || availableUnits <= 0)) return [];
    return [{ variantId: variant.id, color, size, price, availableUnits }];
  });
  return { product, hasVariants: true, variants };
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

export const HOME_HIGHLIGHT_DEFAULTS = { displayMode: "single" as const, rotationIntervalSeconds: 8 as const };

export async function getHomeHighlightSettings() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(homeHighlightSettings).where(eq(homeHighlightSettings.id, 1)).limit(1);
  return rows[0] ?? null;
}

export async function updateHomeHighlightSettings(input: {
  displayMode: "single" | "rotate";
  rotationIntervalSeconds: 5 | 8 | 10;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.transaction(async tx => {
    const existing = await tx.select({ id: homeHighlightSettings.id })
      .from(homeHighlightSettings)
      .where(eq(homeHighlightSettings.id, 1))
      .limit(1);
    if (!existing.length) throw new Error("Home highlight settings row missing; apply migration 0024 before updating settings.");
    await tx.update(homeHighlightSettings).set(input).where(eq(homeHighlightSettings.id, 1));
  });
  return await getHomeHighlightSettings();
}

export async function getPublicHomeHighlights() {
  const db = await getDb();
  if (!db) return { ...HOME_HIGHLIGHT_DEFAULTS, campaigns: [] };
  return await db.transaction(async tx => {
    let displayMode: "single" | "rotate" = HOME_HIGHLIGHT_DEFAULTS.displayMode;
    let rotationIntervalSeconds: 5 | 8 | 10 = HOME_HIGHLIGHT_DEFAULTS.rotationIntervalSeconds;
    try {
      const settingsRows = await tx.select().from(homeHighlightSettings).where(eq(homeHighlightSettings.id, 1)).limit(1);
      if (settingsRows[0]) {
        displayMode = settingsRows[0].displayMode;
        rotationIntervalSeconds = settingsRows[0].rotationIntervalSeconds as 5 | 8 | 10;
      }
    } catch (error) {
      const databaseError = error as { code?: string; errno?: number };
      if (databaseError.code !== "ER_NO_SUCH_TABLE" && databaseError.errno !== 1146) throw error;
      // Keep the public Home compatible during a staged rollout. The admin query
      // deliberately does not use this fallback, so a missing migration stays visible there.
    }
    const campaigns = await tx.select().from(promoBanners)
      .where(eq(promoBanners.isActive, 1))
      .orderBy(promoBanners.sortOrder, desc(promoBanners.id));
    return {
      displayMode,
      rotationIntervalSeconds,
      campaigns: campaigns.map(item => ({ ...item, isActive: item.isActive === 1 })),
    };
  });
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
  try {
    await db.insert(auditLogs).values({
      actorUserId: payload.actorUserId,
      actorType: "admin",
      action: payload.action,
      entity: payload.entity,
      entityId: payload.entityId ?? null,
      metadata: payload.metadata ? JSON.stringify(payload.metadata) : null,
    });
  } catch (error) {
    if (isMissingDatabaseObjectError(error)) return;
    throw error;
  }
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
    .where(and(eq(products.salesMode, "STOCK"), lte(products.stock, 5)));

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

export const SALES_REPORT_MAX_ORDERS = 5000;

export class SalesReportTooLargeError extends Error {
  constructor() {
    super(`O período contém mais de ${SALES_REPORT_MAX_ORDERS} pedidos. Selecione um intervalo menor.`);
    this.name = "SalesReportTooLargeError";
  }
}

export async function getAdminSalesReport(from: Date, to: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const rows = await db
    .select({
      id: orders.id,
      createdAt: orders.createdAt,
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      totalPrice: orders.totalPrice,
    })
    .from(orders)
    .where(and(gte(orders.createdAt, from), lte(orders.createdAt, to)))
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(SALES_REPORT_MAX_ORDERS + 1);

  if (rows.length > SALES_REPORT_MAX_ORDERS) throw new SalesReportTooLargeError();
  const items = rows.length
    ? await db.select({
      orderId: orderItems.orderId,
      productId: orderItems.productId,
      productName: orderItems.productName,
      quantity: orderItems.quantity,
    }).from(orderItems).where(inArray(orderItems.orderId, rows.map(row => row.id)))
    : [];
  return aggregateSalesReport(rows, from, to, items);
}

export async function getSalesByPeriod(from: Date, to: Date) {
  const report = await getAdminSalesReport(from, to);
  return report.daily.map(row => ({
    day: row.day,
    totalSales: row.totalCents,
    ordersCount: row.ordersCount,
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

/** Consume the reset link, replace the credential and revoke sessions atomically. */
export async function consumePasswordReset(input: { userId: number; tokenHash: string; passwordHash: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const [user] = await tx.select({id:users.id}).from(users).where(eq(users.id,input.userId)).for("update");
    if (!user) return false;
    const [token] = await tx.select().from(passwordResetTokens).where(and(eq(passwordResetTokens.userId,input.userId),eq(passwordResetTokens.tokenHash,input.tokenHash))).for("update");
    if (!token || token.usedAt || token.expiresAt.getTime() <= Date.now()) return false;
    const [credential] = await tx.select({id:localAuthUsers.id}).from(localAuthUsers).where(eq(localAuthUsers.userId,input.userId)).for("update");
    if (!credential) return false;
    await tx.update(localAuthUsers).set({passwordHash:input.passwordHash}).where(eq(localAuthUsers.id,credential.id));
    await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.userId,input.userId));
    await tx.update(users).set({sessionVersion:sql`${users.sessionVersion} + 1`}).where(eq(users.id,input.userId));
    return true;
  });
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

function extractExecutedRows(result: unknown) {
  if (Array.isArray(result)) {
    return Array.isArray(result[0]) ? result[0] : result;
  }
  if (result && typeof result === "object" && "rows" in result && Array.isArray((result as { rows: unknown[] }).rows)) {
    return (result as { rows: unknown[] }).rows;
  }
  return [];
}

// Dedicated mysql2 connection: all tables share one repeatable-read snapshot.
export async function getBackupPayload() {
  const { backupDatabase, openBackupConnection, BackupError } = await import("./database/backupRestore");
  if (!process.env.DATABASE_URL) throw new BackupError("DATABASE_CONFIGURATION_REQUIRED");
  const connection = await openBackupConnection(process.env.DATABASE_URL, process.env.L4CKOS_LOCAL_MYSQL_SOCKET);
  try { return await backupDatabase(connection); }
  finally { await connection.end(); }
}

export async function restoreBackupPayload(payload: unknown) {
  const { assertLocalRestoreTarget, restoreDatabase, openBackupConnection, BackupError } = await import("./database/backupRestore");
  if (!process.env.DATABASE_URL) throw new BackupError("DATABASE_CONFIGURATION_REQUIRED");
  const target = { url: process.env.DATABASE_URL, socketPath: process.env.L4CKOS_LOCAL_MYSQL_SOCKET };
  assertLocalRestoreTarget(target.url, target.socketPath); // Reject remote before any connection.
  const connection = await openBackupConnection(target.url, target.socketPath);
  try { return await restoreDatabase(connection, payload, target); }
  finally { await connection.end(); }
}
