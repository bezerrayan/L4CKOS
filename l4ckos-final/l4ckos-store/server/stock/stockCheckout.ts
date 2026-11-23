import { createHash } from "node:crypto";
import { stockDeliveryV1Schema, stockCheckoutItemV1Schema, type StockDeliveryV1, type StockPixPaymentV1 } from "../../shared/stockCheckoutV1";
import { isLocalDeliveryCep } from "../../shared/localDeliveryTerritory";
import type { StockShippingAcceptanceV1 } from "../../shared/stockShippingV1";
import { StockShippingQuoteError, verifyStockShippingQuoteV1 } from "./stockShippingQuoteV1";
import { isPublicProductUnavailable } from "../database/publicPurchasePolicy";
import { StockProviderError } from "./stockProviderError";
export { StockProviderError } from "./stockProviderError";

export type StockVariant = {
  id: number;
  productId: number;
  active: boolean;
  sku: string;
  size: string;
  color: string;
  unitPriceCents: number;
  availableUnits: number;
  /** V6 sales mode of the parent product. PREORDER lines never touch variant stock: capacity belongs to the production batch. */
  salesMode?: "STOCK" | "PREORDER";
  productionBatchId?: number | null;
};

export type StockSnapshot = Pick<StockVariant, "id" | "productId" | "sku" | "size" | "color" | "unitPriceCents"> & {
  quantity: number;
  totalCents: number;
  salesMode?: "STOCK" | "PREORDER";
  productionBatchId?: number | null;
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
  /** Server-verified freight acceptance (carrier deliveries only). */
  shipping?: StockShippingAcceptanceV1;
  /** Authoritative amount charged: merchandise + accepted freight. Persisted rows carry it; absent only on legacy in-memory attempts. */
  amountCents?: number;
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
  /** Persisted item identities used only to prove a latest-attempt/cart match on read. */
  cartItems?: Array<{ productId: number; variantId: number; quantity: number }>;
};

/**
 * A signed provider event that says "paid" for a charge the local ledger has already closed (or never issued).
 * The local financial state stays blocked; this is only the durable, idempotent evidence for manual reconciliation.
 * Carries identifiers and amounts only: never payer data, never the raw payload.
 */
export type StockFinancialDivergenceKind =
  | "PAID_AFTER_TERMINAL_FAILURE" // signed terminal failure released the attempt, then "paid" arrived
  | "PAID_AFTER_RELEASE" // attempt released by another path, then "paid" arrived
  | "PAID_FOR_UNSTARTED_ATTEMPT" // no charge was ever issued for this attempt
  | "PAID_WITH_DIFFERENT_PAYMENT_ID" // the order was paid under a payment id that is not the attempt's
  | "PAYMENT_ID_MISMATCH"
  | "PAYMENT_WITHOUT_CORRELATION" // provider event cannot be bound to an attempt with no persisted payment id
  | "PAYMENT_REFERENCE_MISMATCH" // payment id and external order reference point to different attempts
  | "PAYMENT_ORDER_BINDING_MISMATCH" // order owner/attempt/amount projection disagrees with the STOCK attempt
  | "PAID_AMOUNT_MISMATCH"
  | "PAYMENT_AMOUNT_MISMATCH";
export type StockFinancialDivergence = {
  kind: StockFinancialDivergenceKind;
  attemptId: string;
  orderId: string;
  /** Provider payment id carried by the event. */
  paymentId: string;
  providerEventId: string;
  observedAmountCents: number;
  expectedAmountCents: number | null;
  attemptStatus: StockAttempt["status"];
  attemptProviderState: StockAttempt["providerState"];
  attemptPaymentId: string | null;
  observedStatus: "pending" | "paid" | "failed";
  observedOrderId?: string;
};

export interface StockCheckoutTransaction {
  /** Serializes checkout creation for one authenticated owner until this transaction commits. */
  lockOwnerForCheckout(ownerUserId: number): Promise<void>;
  /** Reads/locks each parent product and all persisted SKUs in deterministic order. */
  getProductPurchaseCatalog(productIds: number[], lock: boolean): Promise<Array<{ productId: number; name: string; skus: Array<string | null> }>>;
  /** Reserves exclusive quota on this same connection/transaction as attempt+stock. */
  reserveExclusiveQuota?(input: { userId: number; attemptId: string; items: Array<{ productId: number; variantId: number; quantity: number }> }): Promise<void>;
  findAttempt(attemptId: string): Promise<StockAttempt | null>;
  findOpenAttemptsForOwner(ownerUserId: number): Promise<StockAttempt[]>;
  findVariant(variantId: number): Promise<StockVariant | null>;
  isSkuUnique(sku: string, variantId: number): Promise<boolean>;
  /** Must atomically claim units, conditional on active unreserved stock >= quantity. */
  reserveVariant(variantId: number, quantity: number, attemptId: string): Promise<boolean>;
  /**
   * PREORDER lines: serialize on the production batch row, require an open sales window and verify, with a locking read of the
   * latest committed order items, that already-sold units + `quantity` stay within maximumQuantity. Called BEFORE the attempt's
   * order items are inserted.
   * A store without this method cannot sell pre-orders (the domain fails closed).
   */
  reservePreorderCapacity?(attemptId: string, batchId: number, quantity: number): Promise<"ok" | "batch_unavailable" | "capacity_exceeded">;
  /** Creates the admin order projection and STOCK attempt atomically; returns the canonical numeric order id. */
  createAttempt(attempt: StockAttempt): Promise<string>;
  beginProviderAttempt(attemptId: string, allowIdempotentRetry: boolean): Promise<boolean>;
  markProviderAmbiguous(attemptId: string): Promise<void>;
  markProviderFailure(attemptId: string): Promise<boolean>;
  markReconciliationRequired(attemptId: string): Promise<void>;
  /** `providerCustomerId` (if the adapter reports it) is persisted with the payment as the durable customer link for supervised recovery. */
  recordPayment(attemptId: string, paymentId: string, checkoutUrl: string | null, providerCustomerId?: string | null): Promise<void>;
  /**
   * Returns the attempt's strong provider reference, creating and persisting it (idempotently, under the attempt lock) on first use.
   * Called in the SAME transaction that starts the provider attempt, i.e. committed BEFORE any provider call. A store without it
   * keeps the legacy numeric reference (historical behaviour).
   */
  ensurePaymentReference?(attemptId: string): Promise<string>;
  /** Exact lookup of the attempt that owns a strong reference (null when unknown, e.g. a charge from before a restore). */
  findAttemptByPaymentReference?(reference: string): Promise<StockAttempt | null>;
  claimWebhook(eventId: string, payloadHash: string): Promise<"claimed" | "duplicate" | "conflict">;
  findAttemptByPayment(paymentId: string): Promise<StockAttempt | null>;
  findAttemptByOrder(orderId: string): Promise<StockAttempt | null>;
  /** Verifies the durable order projection still belongs to this attempt and owner. */
  validateAttemptOrderProjection?(attempt: StockAttempt): Promise<boolean>;
  consumeReservations(attemptId: string): Promise<void>;
  releaseReservations(attemptId: string): Promise<void>;
  markPaid(attemptId: string, paymentId: string): Promise<"paid" | "already-paid" | "not-pending">;
  /** Called only for a signature-verified provider terminal failure event. */
  markTerminalFailure(attemptId: string, paymentId: string): Promise<"released" | "already-released" | "not-pending">;
  /**
   * Durable, idempotent evidence of a rejected approval, written in the SAME transaction as the webhook claim.
   * A failed write must throw so the delivery is not acknowledged (the provider redelivers). Never changes stock, capacity, quota or the order.
   */
  recordFinancialDivergence(divergence: StockFinancialDivergence): Promise<"recorded" | "duplicate">;
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
  createPayment(input: { orderId: string; amountCents: number; idempotencyKey: string; externalReference?: string }): Promise<{ paymentId: string; checkoutUrl: string | null; customerId?: string | null; pix?: StockPixPaymentV1 }>;
  /**
   * Read-only PIX lookup (QR + copy/paste) for an ALREADY persisted payment id. Must never create, change or cancel a charge and
   * must resolve null (not throw) when the data is unavailable.
   */
  getPixPayment?(paymentId: string, signal?: AbortSignal): Promise<StockPixPaymentV1 | null>;
}

/** Best-effort inline PIX data for an existing charge; null on any failure so callers fall back to the provider link. */
async function loadPixForExistingPayment(provider: Pick<StockPaymentProvider, "getPixPayment"> | undefined, paymentId: string | null | undefined, reservationExpiresAt: string | undefined): Promise<StockPixPaymentV1 | undefined> {
  if (!provider?.getPixPayment || !paymentId) return undefined;
  // Fail closed: past the reservation TTL (or with an unknown TTL) the stock may already be released, so never show a payment code.
  if (!reservationExpiresAt || !(Date.parse(reservationExpiresAt) > Date.now())) return undefined;
  try {
    return (await provider.getPixPayment(paymentId)) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Provider idempotency key. `stock:<orderId>` is reusable after a database restore (AUTO_INCREMENT rewinds), so for attempts that own a
 * strong reference the key is bound to that attempt's unique token: `stock:<orderId>:<token>`. Historical attempts (no reference) keep
 * the legacy key unchanged. A retry of the SAME attempt reuses the same reference and therefore the same key.
 */
export function stockProviderIdempotencyKey(orderId: string, paymentReference: string | null): string {
  const token = paymentReference ? paymentReference.slice(paymentReference.lastIndexOf(":") + 1) : "";
  return token ? `stock:${orderId}:${token}` : `stock:${orderId}`;
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

async function assertPublicPurchaseAllowed(tx: StockCheckoutTransaction, productIds: number[], lock: boolean) {
  const ids = [...new Set(productIds)].sort((a, b) => a - b);
  const catalog = await tx.getProductPurchaseCatalog(ids, lock);
  const byId = new Map(catalog.map(product => [product.productId, product]));
  for (const productId of ids) {
    const product = byId.get(productId);
    if (!product) fail("CHECKOUT_VARIANT_NOT_FOUND");
    if (isPublicProductUnavailable(product.name, product.skus.map(sku => ({ sku })))) fail("CHECKOUT_PRODUCT_REQUIRES_AUTHORIZATION");
  }
}
/** Cart facts bound into a freight quote: server-loaded variants, unit prices and aggregated quantities. */
export function stockShippingCartFingerprint(lines: Array<{ variantId: number; unitPriceCents: number; quantity: number }>): string {
  const aggregated = new Map<string, { variantId: number; unitPriceCents: number; quantity: number }>();
  for (const line of lines) {
    const key = `${line.variantId}:${line.unitPriceCents}`;
    const previous = aggregated.get(key);
    aggregated.set(key, { ...line, quantity: (previous?.quantity ?? 0) + line.quantity });
  }
  return sha256(["stock-shipping-cart-v1", [...aggregated.values()].sort((a, b) => a.variantId - b.variantId || a.unitPriceCents - b.unitPriceCents).map(l => [l.variantId, l.unitPriceCents, l.quantity])]);
}

/** Amount of a persisted attempt: the stored total, never recomputed from items alone (it includes accepted freight). */
export function stockAttemptAmountCents(attempt: StockAttempt): number {
  return attempt.amountCents ?? attempt.snapshots.reduce((sum, item) => sum + item.totalCents, 0);
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
  // Local scheduled delivery only inside the local territory; carrier delivery is authorized solely by a signed quote.
  if (delivery && !("quoteToken" in delivery) && !isLocalDeliveryCep(delivery.address.zipCode)) fail("CHECKOUT_DELIVERY_UNAVAILABLE");
  return { attemptId: value.attemptId, items, ...(delivery ? { delivery } : {}) };
}

export async function createStockCheckout(input: {
  enabled: boolean;
  ownerUserId: number;
  store: StockCheckoutStore;
  provider: StockPaymentProvider;
  request: unknown;
  /** Freight signing secret (>= 32 bytes). Without it carrier deliveries are unavailable (fail closed). */
  shipping?: { secret: string };
  /** Server-only cap used by the temporary owner PIX test admission. */
  maximumAmountCents?: number;
}): Promise<{ orderId: string; paymentId: string; checkoutUrl: string | null; amountCents: number; snapshots: StockSnapshot[]; replayed: boolean; pix?: StockPixPaymentV1 }> {
  // Gate is deliberately the first operation; no repository, provider, or financial IO may precede it.
  if (!input.enabled) fail("PUBLIC_CHECKOUT_DISABLED");
  if (!Number.isSafeInteger(input.ownerUserId) || input.ownerUserId <= 0) fail("AUTHENTICATION_REQUIRED");
  if (input.maximumAmountCents !== undefined &&
      (!Number.isSafeInteger(input.maximumAmountCents) || input.maximumAmountCents <= 0 || input.maximumAmountCents > MYSQL_SIGNED_INT_MAX)) {
    fail("OWNER_PIX_TEST_CONFIGURATION_INVALID");
  }
  const request = parseRequest(input.request);
  const cartFingerprint = canonicalCart(request.items);
  // The quote token is a bearer credential with a fresh nonce: it is verified, never part of the idempotency fingerprint.
  const fingerprint = sha256({ cart: cartFingerprint, delivery: request.delivery ? { optionId: request.delivery.optionId, address: request.delivery.address } : null });
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
        if (input.maximumAmountCents !== undefined && stockAttemptAmountCents(existing) > input.maximumAmountCents) fail("OWNER_PIX_TEST_AMOUNT_LIMIT");
        await assertPublicPurchaseAllowed(tx, request.items.map(item => item.productId), true);
        if (existing.providerState === "not_started") {
          await tx.reserveExclusiveQuota?.({ userId: input.ownerUserId, attemptId: request.attemptId, items: request.items });
        }
        return { attempt: existing, replayed: true };
      }

      // Fail before expiry maintenance writes, and recheck under locks before quota/order/reservation writes.
      await assertPublicPurchaseAllowed(tx, request.items.map(item => item.productId), false);

      // Clear this owner's definitively unstarted expired reservations before
      // deciding whether a new equivalent cart is still open. Uncertain provider
      // outcomes remain reserved and are marked for reconciliation.
      // The one-off owner test validates its amount ceiling before any DML. It
      // therefore leaves expiry maintenance to the normal worker; stale rows
      // can fail this attempt closed, but cannot cause unrelated writes first.
      if (input.maximumAmountCents === undefined) {
        let expiryBatch;
        do {
          expiryBatch = await tx.expireDueReservations(500, input.ownerUserId);
        } while (expiryBatch.releasedAttemptIds.length + expiryBatch.reconciliationAttemptIds.length === 500);
      }

      for (const open of await tx.findOpenAttemptsForOwner(input.ownerUserId)) {
        if (canonicalCart(open.snapshots.map(item => ({
          productId: item.productId,
          variantId: item.id,
          quantity: item.quantity,
        }))) === cartFingerprint) fail("CHECKOUT_ATTEMPT_NOT_REUSABLE");
      }

      await assertPublicPurchaseAllowed(tx, request.items.map(item => item.productId), true);

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
        if (variant.salesMode === "PREORDER" && !variant.productionBatchId) fail("CHECKOUT_BATCH_REQUIRED");
        if (!variant.sku.trim() || !Number.isSafeInteger(variant.unitPriceCents) || variant.unitPriceCents <= 0) fail("CHECKOUT_VARIANT_CATALOG_INVALID");
        if (!await tx.isSkuUnique(variant.sku, variant.id)) fail("CHECKOUT_VARIANT_SKU_DUPLICATE");
        const totalCents = variant.unitPriceCents * item.quantity;
        if (!Number.isSafeInteger(totalCents) || totalCents > MYSQL_SIGNED_INT_MAX) fail("CHECKOUT_MONEY_INVALID");
        snapshots.push({ id: variant.id, productId: variant.productId, sku: variant.sku, size: variant.size, color: variant.color, unitPriceCents: variant.unitPriceCents, quantity: item.quantity, totalCents, salesMode: variant.salesMode === "PREORDER" ? "PREORDER" : "STOCK", productionBatchId: variant.salesMode === "PREORDER" ? variant.productionBatchId ?? null : null });
      }

      // Public PREORDER and STOCK purchases are separate checkouts. Enforce
      // this at the server boundary as well as in the storefront UI.
      if (new Set(snapshots.map(snapshot => snapshot.salesMode)).size > 1) fail("CHECKOUT_MIXED_SALES_MODE");

      const merchandiseCents = snapshots.reduce((sum, item) => sum + item.totalCents, 0);
      if (!Number.isSafeInteger(merchandiseCents) || merchandiseCents > MYSQL_SIGNED_INT_MAX) fail("CHECKOUT_MONEY_INVALID");
      let shipping: StockShippingAcceptanceV1 | undefined;
      if (request.delivery && "quoteToken" in request.delivery) {
        if (!input.shipping?.secret) fail("CHECKOUT_DELIVERY_UNAVAILABLE");
        try {
          shipping = verifyStockShippingQuoteV1({
            secret: input.shipping!.secret,
            quoteToken: request.delivery.quoteToken,
            optionId: request.delivery.optionId,
            address: request.delivery.address,
            cartFingerprint: stockShippingCartFingerprint(snapshots.map(snapshot => ({ variantId: snapshot.id, unitPriceCents: snapshot.unitPriceCents, quantity: snapshot.quantity }))),
            itemCount: snapshots.reduce((sum, snapshot) => sum + snapshot.quantity, 0),
            merchandiseSubtotalCents: merchandiseCents,
          });
        } catch (error) {
          if (error instanceof StockShippingQuoteError) fail("CHECKOUT_SHIPPING_QUOTE_REJECTED");
          throw error;
        }
      }
      const amountCents = merchandiseCents + (shipping?.shippingPriceCents ?? 0);
      if (!Number.isSafeInteger(amountCents) || amountCents > MYSQL_SIGNED_INT_MAX) fail("CHECKOUT_MONEY_INVALID");
      if (input.maximumAmountCents !== undefined && amountCents > input.maximumAmountCents) fail("OWNER_PIX_TEST_AMOUNT_LIMIT");

      // The quota ledger, STOCK attempt, and variant reservations commit or roll
      // back together. A crash cannot leave an expiring pre-claim outside STOCK.
      await tx.reserveExclusiveQuota?.({ userId: input.ownerUserId, attemptId: request.attemptId, items: request.items });

      // Production capacity FIRST (before any order item is inserted): every pre-order writer takes the batch lock before it
      // writes, so the locking count never waits on another transaction's uncommitted rows (no lock-order inversion).
      const preorderTotals = new Map<number, number>();
      for (const snapshot of snapshots) {
        if (snapshot.salesMode === "PREORDER") preorderTotals.set(snapshot.productionBatchId!, (preorderTotals.get(snapshot.productionBatchId!) ?? 0) + snapshot.quantity);
      }
      for (const [batchId, quantity] of [...preorderTotals].sort(([a], [b]) => a - b)) {
        if (!tx.reservePreorderCapacity) fail("CHECKOUT_PREORDER_UNSUPPORTED");
        const outcome = await tx.reservePreorderCapacity!(request.attemptId, batchId, quantity);
        if (outcome === "batch_unavailable") fail("CHECKOUT_BATCH_UNAVAILABLE");
        if (outcome === "capacity_exceeded") fail("CHECKOUT_BATCH_CAPACITY_EXCEEDED");
      }

      const orderId = `stock-${sha256([request.attemptId, fingerprint]).slice(0, 32)}`;
      const attempt: StockAttempt = {
        attemptId: request.attemptId, ownerUserId: input.ownerUserId, fingerprint, orderId, status: "reserved", providerState: "not_started", snapshots,
        ...(request.delivery ? { delivery: request.delivery } : {}),
        ...(shipping ? { shipping } : {}),
        amountCents,
      };
      // The attempt header is inserted first so reservations can have a real FK; any later error rolls it back.
      attempt.orderId = await tx.createAttempt(attempt);

      // Aggregate duplicate variant lines and lock variants in stable order to avoid deadlocks.
      const quantities = new Map<number, { productId: number; quantity: number }>();
      for (const snapshot of snapshots) {
        if (snapshot.salesMode === "PREORDER") continue; // capacity lives in the production batch ledger, not variant stock
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
    const raced = await input.store.transaction(async tx => {
      const attempt = await tx.findAttempt(request.attemptId);
      if (!attempt) return null;
      if (attempt.ownerUserId !== input.ownerUserId) fail("CHECKOUT_ATTEMPT_NOT_FOUND");
      if (attempt.fingerprint !== fingerprint) fail("CHECKOUT_ATTEMPT_CHANGED");
      if (attempt.status === "released") fail("CHECKOUT_ATTEMPT_RELEASED");
      if (attempt.status === "paid") fail("CHECKOUT_ALREADY_PAID");
      if (input.maximumAmountCents !== undefined && stockAttemptAmountCents(attempt) > input.maximumAmountCents) fail("OWNER_PIX_TEST_AMOUNT_LIMIT");
      await assertPublicPurchaseAllowed(tx, request.items.map(item => item.productId), true);
      return attempt;
    });
    if (!raced) throw error;
    prepared = { attempt: raced, replayed: true };
  }

  const amountCents = stockAttemptAmountCents(prepared.attempt);
  if (!Number.isSafeInteger(amountCents) || amountCents > MYSQL_SIGNED_INT_MAX) fail("CHECKOUT_MONEY_INVALID");
  if (prepared.attempt.paymentId) {
    // Replay of a persisted charge: re-read the PIX data by the stored payment id. Never creates another charge.
    const pix = await loadPixForExistingPayment(input.provider, prepared.attempt.paymentId, prepared.attempt.reservationExpiresAt);
    return { orderId: prepared.attempt.orderId, paymentId: prepared.attempt.paymentId, checkoutUrl: prepared.attempt.checkoutUrl ?? null, amountCents, snapshots: prepared.attempt.snapshots, replayed: true, ...(pix ? { pix } : {}) };
  }

  const canRetryAmbiguous = prepared.attempt.providerState !== "not_started";
  if (canRetryAmbiguous && !input.provider.supportsIdempotencyKey) {
    await input.store.transaction(tx => tx.markReconciliationRequired(request.attemptId));
    fail("CHECKOUT_PROVIDER_RECONCILIATION_REQUIRED");
  }
  // The strong reference is persisted in the SAME transaction that starts the provider attempt and is committed before the provider
  // is called. No provider I/O happens inside this transaction.
  let paymentReference: string | null = null;
  const providerStarted = await input.store.transaction(async tx => {
    const started = await tx.beginProviderAttempt(request.attemptId, input.provider.supportsIdempotencyKey);
    if (started && tx.ensurePaymentReference) paymentReference = await tx.ensurePaymentReference(request.attemptId);
    return started;
  });
  if (!providerStarted) {
    const latest = await input.store.transaction(tx => tx.findAttempt(request.attemptId));
    if (latest?.status === "reserved" && latest.paymentId) {
      const latestAmount = stockAttemptAmountCents(latest);
      const latestPix = await loadPixForExistingPayment(input.provider, latest.paymentId, latest.reservationExpiresAt);
      return {
        orderId: latest.orderId,
        paymentId: latest.paymentId,
        checkoutUrl: latest.checkoutUrl ?? null,
        amountCents: latestAmount,
        snapshots: latest.snapshots,
        replayed: true,
        ...(latestPix ? { pix: latestPix } : {}),
      };
    }
    if (latest?.status === "reserved" && latest.providerState === "not_started") fail("CHECKOUT_ATTEMPT_EXPIRED");
    fail("CHECKOUT_RECONCILIATION_REQUIRED");
  }

  let payment: { paymentId: string; checkoutUrl: string | null; customerId?: string | null; pix?: StockPixPaymentV1 };
  try {
    payment = await input.provider.createPayment({
      orderId: prepared.attempt.orderId, amountCents, idempotencyKey: stockProviderIdempotencyKey(prepared.attempt.orderId, paymentReference),
      ...(paymentReference ? { externalReference: paymentReference } : {}),
    });
  } catch (error) {
    const safeError = error instanceof StockProviderError
      ? { phase: error.phase, category: error.category, ...(error.httpStatus ? { httpStatus: error.httpStatus } : {}) }
      : { phase: "payment_create", category: "unknown" };
    console.warn("[StockPayment] create_failed", safeError);
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
    await input.store.transaction(tx => tx.recordPayment(request.attemptId, payment.paymentId, payment.checkoutUrl, payment.customerId ?? null));
  } catch {
    // The provider may have created a real charge. Keep the reservation for reconciliation.
    console.error("[StockPayment] payment_correlation_persist_failed", { phase: "payment_correlation", category: "persistence" });
    await input.store.transaction(tx => tx.markProviderAmbiguous(request.attemptId)).catch(() => undefined);
    fail("CHECKOUT_PAYMENT_CORRELATION_REQUIRED");
  }
  return { orderId: prepared.attempt.orderId, paymentId: payment.paymentId, checkoutUrl: payment.checkoutUrl, amountCents, snapshots: prepared.attempt.snapshots, replayed: prepared.replayed, ...(payment.pix ? { pix: payment.pix } : {}) };
}

/** Formats an owner-scoped persisted attempt without changing expiry or reconciliation state. */
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
  expectedItems?: unknown;
  /** Optional: enables inline PIX data for a pending charge (read-only lookup by the persisted payment id). */
  provider?: Pick<StockPaymentProvider, "getPixPayment">;
}): Promise<import("../../shared/stockCheckoutV1").StockAttemptResumeV1> {
  if (!Number.isSafeInteger(input.authenticatedUserId) || input.authenticatedUserId <= 0) fail("AUTHENTICATION_REQUIRED");
  if (typeof input.attemptId !== "string" || !/^[A-Za-z0-9_-]{16,120}$/.test(input.attemptId)) fail("STOCK_ATTEMPT_ID_INVALID");
  const attempt = await input.store.findAttemptForOwner(input.attemptId, input.authenticatedUserId);
  if (!attempt) fail("CHECKOUT_ATTEMPT_NOT_FOUND");
  assertResumeCartMatches(attempt, input.expectedItems);

  return withPixForPending(resumeRecord(attempt), input.provider);
}

function assertResumeCartMatches(attempt: StockAttemptResumeRecord, expectedItems: unknown): void {
  if (expectedItems === undefined) return;
  const parsedItems = stockCheckoutItemV1Schema.array().min(1).max(30).safeParse(expectedItems);
  if (!parsedItems.success || !attempt.cartItems || canonicalCart(attempt.cartItems) !== canonicalCart(parsedItems.data)) {
    // Keep the same not-found result for a missing attempt and a cart mismatch.
    fail("CHECKOUT_ATTEMPT_NOT_FOUND");
  }
}

/** Adds inline PIX data only to a still-payable pending attempt; every other state is returned unchanged. */
async function withPixForPending(resume: import("../../shared/stockCheckoutV1").StockAttemptResumeV1, provider: Pick<StockPaymentProvider, "getPixPayment"> | undefined) {
  if (resume.status !== "pending" || !resume.paymentId) return resume;
  const pix = await loadPixForExistingPayment(provider, resume.paymentId, resume.reservationExpiresAt);
  return pix ? { ...resume, pix } : resume;
}

export async function resumeLatestStockCheckout(input: { store: StockCheckoutStore; authenticatedUserId: number; expectedItems?: unknown; provider?: Pick<StockPaymentProvider, "getPixPayment"> }) {
  if (!Number.isSafeInteger(input.authenticatedUserId) || input.authenticatedUserId <= 0) fail("AUTHENTICATION_REQUIRED");
  if (!input.store.findLatestAttemptForOwner) fail("CHECKOUT_RESUME_UNAVAILABLE");
  const attempt = await input.store.findLatestAttemptForOwner(input.authenticatedUserId);
  if (attempt) {
    try {
      assertResumeCartMatches(attempt, input.expectedItems);
    } catch (error) {
      if (error instanceof StockCheckoutError && error.code === "CHECKOUT_ATTEMPT_NOT_FOUND") return null;
      throw error;
    }
  }
  return attempt ? withPixForPending(resumeRecord(attempt), input.provider) : null;
}

async function processStockPaymentWebhook(input: {
  store: StockCheckoutStore;
  eventId: string;
  orderId: string;
  paymentId: string;
  status: "pending" | "paid" | "failed";
  amountCents: number;
  payload: unknown;
  strongReference?: string;
  referenceKind?: "strong" | "legacy";
}): Promise<"processed" | "duplicate" | "conflict"> {
  if (!input.eventId.trim() || !input.orderId.trim() || !input.paymentId.trim() || !Number.isSafeInteger(input.amountCents) || input.amountCents < 0) fail("WEBHOOK_INPUT_INVALID");
  const payloadHash = sha256(input.payload);
  return input.store.transaction(async tx => {
    const claim = await tx.claimWebhook(input.eventId, payloadHash);
    if (claim !== "claimed") return claim;
    // A strong reference selects the attempt by an exact, persisted, non-reusable token; a legacy numeric reference selects by the
    // (restore-reusable) order id and therefore never proves ownership by itself.
    const attemptByOrder = input.strongReference
      ? (tx.findAttemptByPaymentReference ? await tx.findAttemptByPaymentReference(input.strongReference) : null)
      : await tx.findAttemptByOrder(input.orderId);
    const attemptByPayment = await tx.findAttemptByPayment(input.paymentId);
    const resolvedOrderId = input.strongReference ? (attemptByOrder?.orderId ?? null) : input.orderId;
    const attempt = attemptByOrder ?? attemptByPayment;
    if (!attempt) fail("WEBHOOK_PAYMENT_UNKNOWN");
    const rejectApproval = async (kind: StockFinancialDivergenceKind, current: StockAttempt = attempt): Promise<"conflict"> => {
      let expectedAmountCents: number | null = null;
      try { expectedAmountCents = stockAttemptAmountCents(current); } catch { /* legacy attempt without an authoritative amount */ }
      await tx.recordFinancialDivergence({
        kind, attemptId: current.attemptId, orderId: current.orderId, paymentId: input.paymentId, providerEventId: input.eventId,
        observedAmountCents: input.amountCents, expectedAmountCents,
        attemptStatus: current.status, attemptProviderState: current.providerState, attemptPaymentId: current.paymentId ?? null,
        observedStatus: input.status, observedOrderId: input.orderId,
      });
      return "conflict";
    };
    if (attemptByPayment && (attemptByPayment.orderId !== resolvedOrderId || (attemptByOrder && attemptByOrder.attemptId !== attemptByPayment.attemptId))) {
      return rejectApproval("PAYMENT_REFERENCE_MISMATCH", attemptByPayment);
    }
    if (!attemptByOrder) return rejectApproval("PAYMENT_REFERENCE_MISMATCH", attempt);
    if (tx.validateAttemptOrderProjection && !(await tx.validateAttemptOrderProjection(attempt))) {
      return rejectApproval("PAYMENT_ORDER_BINDING_MISMATCH");
    }
    if (attempt.providerState === "not_started" || attempt.providerState === "definitive_failure") {
      if (input.status !== "paid") return "conflict";
      return rejectApproval(attempt.providerState === "not_started" ? "PAID_FOR_UNSTARTED_ATTEMPT" : attempt.status === "released" ? "PAID_AFTER_TERMINAL_FAILURE" : "PAID_AFTER_RELEASE");
    }
    // A restored or ambiguous attempt has no proof that this provider charge was created for it.
    // Never adopt a charge from its reusable numeric order reference, even when the amount matches.
    if (!attempt.paymentId) return rejectApproval("PAYMENT_WITHOUT_CORRELATION");
    if (attempt.paymentId !== input.paymentId) {
      return input.status === "paid" ? rejectApproval("PAID_WITH_DIFFERENT_PAYMENT_ID") : rejectApproval("PAYMENT_ID_MISMATCH");
    }
    // The charged total (merchandise + accepted freight), exactly as persisted with the attempt.
    let expected: number;
    try { expected = stockAttemptAmountCents(attempt); }
    catch { return rejectApproval(input.status === "paid" ? "PAID_AMOUNT_MISMATCH" : "PAYMENT_AMOUNT_MISMATCH"); }
    if (expected !== input.amountCents) return rejectApproval(input.status === "paid" ? "PAID_AMOUNT_MISMATCH" : "PAYMENT_AMOUNT_MISMATCH");
    if (attempt.status === "paid") return input.status === "failed" ? "conflict" : "processed";
    if (attempt.status === "released") {
      if (input.status === "failed") return "processed";
      return input.status === "paid" ? rejectApproval("PAID_AFTER_RELEASE") : "conflict";
    }
    if (input.status === "pending") return "processed";
    if (input.status === "paid") {
      const result = await tx.markPaid(attempt.attemptId, input.paymentId);
      if (result === "not-pending") {
        // Lost a race against a terminal failure/release committed after our first (unlocked) read: classify from the fresh state.
        const latest = (await tx.findAttemptByOrder(input.orderId)) ?? attempt;
        return rejectApproval(latest.status === "released" && latest.providerState === "definitive_failure" ? "PAID_AFTER_TERMINAL_FAILURE" : "PAID_AFTER_RELEASE", latest);
      }
      if (result === "paid") await tx.consumeReservations(attempt.attemptId);
      return "processed";
    }
    const result = await tx.markTerminalFailure(attempt.attemptId, input.paymentId);
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
  /** `failed` is emitted only for authenticated, allowlisted terminal failures, never transient provider errors. */
  status: "pending" | "paid" | "failed";
  amountCents: number;
  payload: unknown;
  /** Set when the event's externalReference is a strong attempt reference; `orderId` then carries that opaque reference. */
  strongReference?: string;
  /** "legacy" = historical numeric order reference. */
  referenceKind?: "strong" | "legacy";
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
