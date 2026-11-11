import { createHash } from "node:crypto";
import { stockDeliveryV1Schema, type StockDeliveryV1 } from "../../shared/stockCheckoutV1";
import { isLocalDeliveryCep } from "../../shared/localDeliveryTerritory";

export type StockVariant = {
  id: number;
  productId: number;
  active: boolean;
  sku: string;
  size: string;
  color: string;
  unitPriceCents: number;
  availableUnits: number;
};

export type StockSnapshot = Pick<StockVariant, "id" | "productId" | "sku" | "size" | "color" | "unitPriceCents"> & {
  quantity: number;
  totalCents: number;
};

export type StockAttempt = {
  attemptId: string;
  ownerUserId: number;
  fingerprint: string;
  orderId: string;
  status: "reserved" | "paid" | "released";
  providerState: "not_started" | "creating" | "ambiguous" | "created" | "definitive_failure";
  reconciliationRequiredAt?: string | null;
  snapshots: StockSnapshot[];
  paymentId?: string;
  checkoutUrl?: string;
  reservationExpiresAt?: string;
  delivery?: StockDeliveryV1;
};

export type StockAttemptResumeRecord = {
  attemptId: string;
  orderId: string;
  status: StockAttempt["status"];
  providerState: StockAttempt["providerState"];
  paymentId: string | null;
  checkoutUrl: string | null;
  amountCents: number;
  reservationExpiresAt: string;
  reservationExpired: boolean;
  reconciliationRequired: boolean;
};

export interface StockCheckoutTransaction {
  /** Serializes checkout creation for one authenticated owner until this transaction commits. */
  lockOwnerForCheckout(ownerUserId: number): Promise<void>;
  /** Reserves exclusive quota on this same connection/transaction as attempt+stock. */
  reserveExclusiveQuota?(input: { userId: number; attemptId: string; items: Array<{ productId: number; variantId: number; quantity: number }> }): Promise<void>;
  findAttempt(attemptId: string): Promise<StockAttempt | null>;
  findOpenAttemptsForOwner(ownerUserId: number): Promise<StockAttempt[]>;
  findVariant(variantId: number): Promise<StockVariant | null>;
  isSkuUnique(sku: string, variantId: number): Promise<boolean>;
  /** Must atomically claim units, conditional on active unreserved stock >= quantity. */
  reserveVariant(variantId: number, quantity: number, attemptId: string): Promise<boolean>;
  /** Creates the admin order projection and STOCK attempt atomically; returns the canonical numeric order id. */
  createAttempt(attempt: StockAttempt): Promise<string>;
  beginProviderAttempt(attemptId: string, allowIdempotentRetry: boolean): Promise<boolean>;
  markProviderAmbiguous(attemptId: string): Promise<void>;
  markProviderFailure(attemptId: string): Promise<boolean>;
  markReconciliationRequired(attemptId: string): Promise<void>;
  recordPayment(attemptId: string, paymentId: string, checkoutUrl: string | null): Promise<void>;
  claimWebhook(eventId: string, payloadHash: string): Promise<"claimed" | "duplicate" | "conflict">;
  findAttemptByPayment(paymentId: string): Promise<StockAttempt | null>;
  findAttemptByOrder(orderId: string): Promise<StockAttempt | null>;
  consumeReservations(attemptId: string): Promise<void>;
  releaseReservations(attemptId: string): Promise<void>;
  markPaid(attemptId: string, paymentId: string): Promise<"paid" | "already-paid" | "not-pending">;
  markReleased(attemptId: string): Promise<"released" | "already-released" | "not-pending">;
  expireDueReservations(batchSize: number, ownerUserId?: number): Promise<{ releasedAttemptIds: string[]; reconciliationAttemptIds: string[] }>;
}

export interface StockCheckoutStore {
  transaction<T>(work: (tx: StockCheckoutTransaction) => Promise<T>): Promise<T>;
  /** Single-row persistent lookup includes ownerUserId in the predicate and is read-only. */
  findAttemptForOwner(attemptId: string, ownerUserId: number): Promise<StockAttemptResumeRecord | null>;
  /** Most recent persistent attempt for an owner; read-only and ownership-scoped. */
  findLatestAttemptForOwner?(ownerUserId: number): Promise<StockAttemptResumeRecord | null>;
}

export interface StockPaymentProvider {
  /** True only when the provider guarantees the idempotencyKey is enforced server-side. */
  supportsIdempotencyKey: boolean;
  createPayment(input: { orderId: string; amountCents: number; idempotencyKey: string }): Promise<{ paymentId: string; checkoutUrl: string }>;
}

export class StockProviderError extends Error {
  constructor(message: string, public readonly definitelyNotCreated: boolean) {
    super(message);
    this.name = "StockProviderError";
  }
}

export class StockCheckoutError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "StockCheckoutError";
  }
}

/** Raised by a transactional store when a concurrent request wins the unique attempt insert. */
export class StockAttemptConflictError extends Error {
  constructor() {
    super("A concurrent request created this checkout attempt");
    this.name = "StockAttemptConflictError";
  }
}

function fail(code: string): never {
  throw new StockCheckoutError(code);
}
const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function canonicalCart(items: Array<{ productId: number; variantId: number; quantity: number }>): string {
  const quantities = new Map<string, number>();
  for (const item of items) {
    const key = `${item.productId}:${item.variantId}`;
    quantities.set(key, (quantities.get(key) ?? 0) + item.quantity);
  }
  return sha256([...quantities].map(([key, quantity]) => [key, quantity]).sort(([a], [b]) => String(a).localeCompare(String(b))));
}
// orders.totalPrice, orderItems.unitPrice/totalPrice and stockReservations.unitPriceCents are
// signed MySQL INT in the frozen legacy contract. Reject overflow before any
// order, reservation, or provider side effect.
const MYSQL_SIGNED_INT_MAX = 2_147_483_647;

function normalizeText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function parseRequest(input: unknown): { attemptId: string; items: Array<{ productId: number; variantId: number; size?: string; color?: string; quantity: number }>; delivery?: StockDeliveryV1 } {
  if (!input || typeof input !== "object") return fail("CHECKOUT_INPUT_INVALID");
  const value = input as Record<string, unknown>;
  if (typeof value.attemptId !== "string" || !/^[A-Za-z0-9_-]{16,120}$/.test(value.attemptId)) fail("CHECKOUT_ATTEMPT_INVALID");
  if (!Array.isArray(value.items) || !value.items.length || value.items.length > 30) fail("CHECKOUT_ITEMS_INVALID");
  const items = value.items.map(raw => {
    if (!raw || typeof raw !== "object") return fail("CHECKOUT_ITEM_INVALID");
    const item = raw as Record<string, unknown>;
    if (!Number.isSafeInteger(item.productId) || Number(item.productId) <= 0 || !Number.isSafeInteger(item.variantId) || Number(item.variantId) <= 0) fail("CHECKOUT_VARIANT_REQUIRED");
    if (!Number.isSafeInteger(item.quantity) || Number(item.quantity) < 1 || Number(item.quantity) > 99) fail("CHECKOUT_QUANTITY_INVALID");
    const hasSize = item.size !== undefined;
    const hasColor = item.color !== undefined;
    if (hasSize !== hasColor) fail("CHECKOUT_VARIANT_DIMENSIONS_REQUIRED");
    if (hasSize && (typeof item.size !== "string" || typeof item.color !== "string" || !normalizeText(item.size) || !normalizeText(item.color))) fail("CHECKOUT_VARIANT_DIMENSIONS_REQUIRED");
    return {
      productId: Number(item.productId),
      variantId: Number(item.variantId),
      ...(hasSize ? { size: normalizeText(item.size as string), color: normalizeText(item.color as string) } : {}),
      quantity: Number(item.quantity),
    };
  });
  const delivery = value.delivery === undefined ? undefined : stockDeliveryV1Schema.parse(value.delivery);
  if (delivery && !isLocalDeliveryCep(delivery.address.zipCode)) fail("CHECKOUT_DELIVERY_UNAVAILABLE");
  return { attemptId: value.attemptId, items, ...(delivery ? { delivery } : {}) };
}

export async function createStockCheckout(input: {
  enabled: boolean;
  ownerUserId: number;
  store: StockCheckoutStore;
  provider: StockPaymentProvider;
  request: unknown;
}): Promise<{ orderId: string; paymentId: string; checkoutUrl: string; amountCents: number; snapshots: StockSnapshot[]; replayed: boolean }> {
  // Gate is deliberately the first operation; no repository, provider, or financial IO may precede it.
  if (!input.enabled) fail("PUBLIC_CHECKOUT_DISABLED");
  if (!Number.isSafeInteger(input.ownerUserId) || input.ownerUserId <= 0) fail("AUTHENTICATION_REQUIRED");
  const request = parseRequest(input.request);
  const cartFingerprint = canonicalCart(request.items);
  const fingerprint = sha256({ cart: cartFingerprint, delivery: request.delivery ?? null });
  let prepared: { attempt: StockAttempt; replayed: boolean };
  try {
    prepared = await input.store.transaction(async tx => {
      // A locked owner row prevents the empty-result race: two tabs with different
      // attemptIds cannot both observe that the owner has no equivalent open cart.
      await tx.lockOwnerForCheckout(input.ownerUserId);
      const existing = await tx.findAttempt(request.attemptId);
      if (existing) {
        if (existing.ownerUserId !== input.ownerUserId) fail("CHECKOUT_ATTEMPT_NOT_FOUND");
        if (existing.fingerprint !== fingerprint) fail("CHECKOUT_ATTEMPT_CHANGED");
        if (existing.status === "released") fail("CHECKOUT_ATTEMPT_RELEASED");
        if (existing.status === "paid") fail("CHECKOUT_ALREADY_PAID");
        if (existing.providerState === "not_started") {
          await tx.reserveExclusiveQuota?.({ userId: input.ownerUserId, attemptId: request.attemptId, items: request.items });
        }
        return { attempt: existing, replayed: true };
      }

      // Clear this owner's definitively unstarted expired reservations before
      // deciding whether a new equivalent cart is still open. Uncertain provider
      // outcomes remain reserved and are marked for reconciliation.
      let expiryBatch;
      do {
        expiryBatch = await tx.expireDueReservations(500, input.ownerUserId);
      } while (expiryBatch.releasedAttemptIds.length + expiryBatch.reconciliationAttemptIds.length === 500);

      for (const open of await tx.findOpenAttemptsForOwner(input.ownerUserId)) {
        if (canonicalCart(open.snapshots.map(item => ({
          productId: item.productId,
          variantId: item.id,
          quantity: item.quantity,
        }))) === cartFingerprint) fail("CHECKOUT_ATTEMPT_NOT_REUSABLE");
      }

      const variants = new Map<number, StockVariant>();
      for (const variantId of [...new Set(request.items.map(item => item.variantId))].sort((a, b) => a - b)) {
        const variant = await tx.findVariant(variantId);
        if (!variant) fail("CHECKOUT_VARIANT_NOT_FOUND");
        variants.set(variantId, variant);
      }

      const snapshots: StockSnapshot[] = [];
      for (const item of request.items) {
        const variant = variants.get(item.variantId)!;
        if (variant.productId !== item.productId) fail("CHECKOUT_VARIANT_OWNERSHIP");
        if (!variant.active) fail("CHECKOUT_VARIANT_INACTIVE");
        if (item.size && item.color && (normalizeText(variant.size).toLowerCase() !== item.size.toLowerCase() || normalizeText(variant.color).toLowerCase() !== item.color.toLowerCase())) fail("CHECKOUT_VARIANT_DIMENSIONS_MISMATCH");
        if (!variant.sku.trim() || !Number.isSafeInteger(variant.unitPriceCents) || variant.unitPriceCents <= 0) fail("CHECKOUT_VARIANT_CATALOG_INVALID");
        if (!await tx.isSkuUnique(variant.sku, variant.id)) fail("CHECKOUT_VARIANT_SKU_DUPLICATE");
        const totalCents = variant.unitPriceCents * item.quantity;
        if (!Number.isSafeInteger(totalCents) || totalCents > MYSQL_SIGNED_INT_MAX) fail("CHECKOUT_MONEY_INVALID");
        snapshots.push({ id: variant.id, productId: variant.productId, sku: variant.sku, size: variant.size, color: variant.color, unitPriceCents: variant.unitPriceCents, quantity: item.quantity, totalCents });
      }

      const amountCents = snapshots.reduce((sum, item) => sum + item.totalCents, 0);
      if (!Number.isSafeInteger(amountCents) || amountCents > MYSQL_SIGNED_INT_MAX) fail("CHECKOUT_MONEY_INVALID");

      // The quota ledger, STOCK attempt, and variant reservations commit or roll
      // back together. A crash cannot leave an expiring pre-claim outside STOCK.
      await tx.reserveExclusiveQuota?.({ userId: input.ownerUserId, attemptId: request.attemptId, items: request.items });

      const orderId = `stock-${sha256([request.attemptId, fingerprint]).slice(0, 32)}`;
      const attempt: StockAttempt = {
        attemptId: request.attemptId, ownerUserId: input.ownerUserId, fingerprint, orderId, status: "reserved", providerState: "not_started", snapshots,
        ...(request.delivery ? { delivery: request.delivery } : {}),
      };
      // The attempt header is inserted first so reservations can have a real FK; any later error rolls it back.
      attempt.orderId = await tx.createAttempt(attempt);

      // Aggregate duplicate variant lines and lock variants in stable order to avoid deadlocks.
      const quantities = new Map<number, { productId: number; quantity: number }>();
      for (const snapshot of snapshots) {
        const previous = quantities.get(snapshot.id);
        quantities.set(snapshot.id, { productId: snapshot.productId, quantity: (previous?.quantity ?? 0) + snapshot.quantity });
      }
      for (const [variantId, group] of [...quantities].sort(([aId, a], [bId, b]) => a.productId - b.productId || aId - bId)) {
        const { quantity } = group;
        if (!await tx.reserveVariant(variantId, quantity, request.attemptId)) fail("CHECKOUT_STOCK_INSUFFICIENT");
      }
      return { attempt, replayed: false };
    });
  } catch (error) {
    if (!(error instanceof StockAttemptConflictError)) throw error;
    const raced = await input.store.transaction(tx => tx.findAttempt(request.attemptId));
    if (!raced) throw error;
    if (raced.ownerUserId !== input.ownerUserId) fail("CHECKOUT_ATTEMPT_NOT_FOUND");
    if (raced.fingerprint !== fingerprint) fail("CHECKOUT_ATTEMPT_CHANGED");
    if (raced.status === "released") fail("CHECKOUT_ATTEMPT_RELEASED");
    if (raced.status === "paid") fail("CHECKOUT_ALREADY_PAID");
    prepared = { attempt: raced, replayed: true };
  }

  const amountCents = prepared.attempt.snapshots.reduce((sum, item) => sum + item.totalCents, 0);
  if (!Number.isSafeInteger(amountCents) || amountCents > MYSQL_SIGNED_INT_MAX) fail("CHECKOUT_MONEY_INVALID");
  if (prepared.attempt.paymentId) {
    return { orderId: prepared.attempt.orderId, paymentId: prepared.attempt.paymentId, checkoutUrl: prepared.attempt.checkoutUrl ?? "", amountCents, snapshots: prepared.attempt.snapshots, replayed: true };
  }

  const canRetryAmbiguous = prepared.attempt.providerState !== "not_started";
  if (canRetryAmbiguous && !input.provider.supportsIdempotencyKey) {
    await input.store.transaction(tx => tx.markReconciliationRequired(request.attemptId));
    fail("CHECKOUT_PROVIDER_RECONCILIATION_REQUIRED");
  }
  const providerStarted = await input.store.transaction(tx =>
    tx.beginProviderAttempt(request.attemptId, input.provider.supportsIdempotencyKey),
  );
  if (!providerStarted) {
    const latest = await input.store.transaction(tx => tx.findAttempt(request.attemptId));
    if (latest?.status === "reserved" && latest.paymentId) {
      const latestAmount = latest.snapshots.reduce((sum, item) => sum + item.totalCents, 0);
      return {
        orderId: latest.orderId,
        paymentId: latest.paymentId,
        checkoutUrl: latest.checkoutUrl ?? "",
        amountCents: latestAmount,
        snapshots: latest.snapshots,
        replayed: true,
      };
    }
    if (latest?.status === "reserved" && latest.providerState === "not_started") fail("CHECKOUT_ATTEMPT_EXPIRED");
    fail("CHECKOUT_RECONCILIATION_REQUIRED");
  }

  let payment: { paymentId: string; checkoutUrl: string };
  try {
    payment = await input.provider.createPayment({ orderId: prepared.attempt.orderId, amountCents, idempotencyKey: `stock:${prepared.attempt.orderId}` });
  } catch (error) {
    if (error instanceof StockProviderError && error.definitelyNotCreated) {
      await input.store.transaction(async tx => {
        const released = await tx.markProviderFailure(request.attemptId);
        if (released) await tx.releaseReservations(request.attemptId);
      });
      throw error;
    }
    await input.store.transaction(tx => tx.markProviderAmbiguous(request.attemptId)).catch(() => undefined);
    fail("CHECKOUT_PROVIDER_OUTCOME_UNKNOWN");
  }
  try {
    await input.store.transaction(tx => tx.recordPayment(request.attemptId, payment.paymentId, payment.checkoutUrl));
  } catch {
    // The provider may have created a real charge. Keep the reservation for reconciliation.
    fail("CHECKOUT_PAYMENT_CORRELATION_REQUIRED");
  }
  return { orderId: prepared.attempt.orderId, paymentId: payment.paymentId, checkoutUrl: payment.checkoutUrl, amountCents, snapshots: prepared.attempt.snapshots, replayed: prepared.replayed };
}

/** Formats an owner-scoped attempt after due reservations have been reconciled. */
function resumeRecord(attempt: StockAttemptResumeRecord): import("../../shared/stockCheckoutV1").StockAttemptResumeV1 {
  let status: import("../../shared/stockCheckoutV1").StockAttemptResumeV1["status"];
  if (attempt.status === "paid") status = "paid";
  else if (attempt.providerState === "ambiguous" || attempt.reconciliationRequired || (attempt.providerState === "creating" && attempt.reservationExpired)) status = "ambiguous";
  else if (attempt.status === "released") {
    status = attempt.providerState === "definitive_failure" ? "failed" : attempt.providerState === "not_started" ? "expired" : "ambiguous";
  } else if (attempt.providerState === "creating") status = "creating";
  else if (attempt.providerState === "created") status = "pending";
  else if (attempt.reservationExpired) status = "expired";
  else status = "reserved";

  const canStartNewAttempt = status === "failed" || (status === "expired" && attempt.status === "released");
  return {
    attemptId: attempt.attemptId,
    orderId: attempt.orderId,
    status,
    ...(attempt.paymentId ? { paymentId: attempt.paymentId } : {}),
    ...(attempt.checkoutUrl && status === "pending" ? { checkoutUrl: attempt.checkoutUrl } : {}),
    amountCents: attempt.amountCents,
    reservationExpiresAt: new Date(attempt.reservationExpiresAt).toISOString(),
    canStartNewAttempt,
  };
}

export async function resumeStockCheckout(input: {
  store: StockCheckoutStore;
  authenticatedUserId: number;
  attemptId: unknown;
}): Promise<import("../../shared/stockCheckoutV1").StockAttemptResumeV1> {
  if (!Number.isSafeInteger(input.authenticatedUserId) || input.authenticatedUserId <= 0) fail("AUTHENTICATION_REQUIRED");
  if (typeof input.attemptId !== "string" || !/^[A-Za-z0-9_-]{16,120}$/.test(input.attemptId)) fail("STOCK_ATTEMPT_ID_INVALID");
  await expireOwnerReservations(input.store, input.authenticatedUserId);
  const attempt = await input.store.findAttemptForOwner(input.attemptId, input.authenticatedUserId);
  if (!attempt) fail("CHECKOUT_ATTEMPT_NOT_FOUND");

  return resumeRecord(attempt);
}

export async function resumeLatestStockCheckout(input: { store: StockCheckoutStore; authenticatedUserId: number }) {
  if (!Number.isSafeInteger(input.authenticatedUserId) || input.authenticatedUserId <= 0) fail("AUTHENTICATION_REQUIRED");
  if (!input.store.findLatestAttemptForOwner) fail("CHECKOUT_RESUME_UNAVAILABLE");
  await expireOwnerReservations(input.store, input.authenticatedUserId);
  const attempt = await input.store.findLatestAttemptForOwner(input.authenticatedUserId);
  return attempt ? resumeRecord(attempt) : null;
}

/**
 * Resume also advances due, definitively unstarted attempts. The store performs
 * release and inventory accounting in one transaction; attempts whose provider
 * outcome may exist are only marked for reconciliation and keep their stock.
 */
async function expireOwnerReservations(store: StockCheckoutStore, ownerUserId: number): Promise<void> {
  for (let batch = 0; batch < 10; batch += 1) {
    const result = await store.transaction(tx => tx.expireDueReservations(500, ownerUserId));
    if (result.releasedAttemptIds.length + result.reconciliationAttemptIds.length < 500) return;
  }
}

async function processStockPaymentWebhook(input: {
  store: StockCheckoutStore;
  eventId: string;
  orderId: string;
  paymentId: string;
  status: "pending" | "paid" | "failed";
  amountCents: number;
  payload: unknown;
}): Promise<"processed" | "duplicate" | "conflict"> {
  if (!input.eventId.trim() || !input.orderId.trim() || !input.paymentId.trim() || !Number.isSafeInteger(input.amountCents) || input.amountCents < 0) fail("WEBHOOK_INPUT_INVALID");
  const payloadHash = sha256(input.payload);
  return input.store.transaction(async tx => {
    const claim = await tx.claimWebhook(input.eventId, payloadHash);
    if (claim !== "claimed") return claim;
    const attempt = await tx.findAttemptByOrder(input.orderId);
    if (!attempt) fail("WEBHOOK_PAYMENT_UNKNOWN");
    if (attempt.paymentId && attempt.paymentId !== input.paymentId) return "conflict";
    if (attempt.providerState === "not_started" || attempt.providerState === "definitive_failure") return "conflict";
    const expected = attempt.snapshots.reduce((sum, item) => sum + item.totalCents, 0);
    if (expected !== input.amountCents) fail("WEBHOOK_AMOUNT_MISMATCH");
    if (attempt.status === "paid") return input.status === "failed" ? "conflict" : "processed";
    if (attempt.status === "released") {
      return input.status === "failed" && attempt.paymentId === input.paymentId ? "processed" : "conflict";
    }
    if (!attempt.paymentId) await tx.recordPayment(attempt.attemptId, input.paymentId, null);
    if (input.status === "pending") return "processed";
    if (input.status === "paid") {
      const result = await tx.markPaid(attempt.attemptId, input.paymentId);
      if (result === "not-pending") return "conflict";
      if (result === "paid") await tx.consumeReservations(attempt.attemptId);
      return "processed";
    }
    const result = await tx.markReleased(attempt.attemptId);
    if (result === "not-pending") return "conflict";
    if (result === "released") await tx.releaseReservations(attempt.attemptId);
    return "processed";
  });
}

export async function expireStockReservations(
  store: StockCheckoutStore,
  batchSize = 50,
): Promise<{ releasedAttemptIds: string[]; reconciliationAttemptIds: string[] }> {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500) fail("EXPIRATION_BATCH_SIZE_INVALID");
  return store.transaction(tx => tx.expireDueReservations(batchSize));
}

export type StockNormalizedWebhook = {
  eventId: string;
  orderId: string;
  paymentId: string;
  status: "pending" | "paid" | "failed";
  amountCents: number;
  payload: unknown;
};

export interface StockWebhookBoundary {
  verifySignature(input: { rawBody: string; headers: Readonly<Record<string, string | string[] | undefined>> }): Promise<boolean>;
  decodeSignedEvent(rawBody: string): StockNormalizedWebhook;
}

/** Signature verification runs before decoding, database reads, or financial state mutation. */
export async function processSignedStockWebhook(input: {
  rawBody: string;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  store: StockCheckoutStore;
  boundary: StockWebhookBoundary;
}): Promise<"processed" | "duplicate" | "conflict"> {
  if (!await input.boundary.verifySignature({ rawBody: input.rawBody, headers: input.headers })) fail("WEBHOOK_SIGNATURE_INVALID");
  const event = input.boundary.decodeSignedEvent(input.rawBody);
  return processStockPaymentWebhook({ store: input.store, ...event });
}
