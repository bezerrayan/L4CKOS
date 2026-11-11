import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { ExclusiveCheckoutClaim } from "../exclusive/store";
import {
  StockAttemptConflictError,
  type StockAttempt,
  type StockCheckoutStore,
  type StockCheckoutTransaction,
  type StockSnapshot,
  type StockVariant,
} from "./stockCheckout";

type AttemptRow = RowDataPacket & {
  attemptId: string;
  ownerUserId: number | string;
  fingerprint: string;
  orderId: number | string;
  status: StockAttempt["status"];
  providerState: StockAttempt["providerState"];
  paymentId: string | null;
  checkoutUrl: string | null;
  reconciliationRequiredAt: string | null;
  providerRetryEligible?: number;
};
type ResumeRow = RowDataPacket & {
  attemptId: string;
  orderId: number | string;
  status: StockAttempt["status"];
  providerState: StockAttempt["providerState"];
  paymentId: string | null;
  checkoutUrl: string | null;
  amountCents: number | string | bigint;
  reservationExpiresAt: string;
  reservationExpired: number;
  reconciliationRequired: number;
};
type ItemRow = RowDataPacket & {
  variantId: number;
  productId: number;
  sku: string;
  size: string;
  color: string;
  unitPriceCents: number;
  quantity: number;
  totalCents: number;
};

export class StockMySqlInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StockMySqlInvariantError";
  }
}

export class StockPaymentCorrelationConflictError extends Error {
  constructor() {
    super("The checkout attempt already has a different provider payment correlation");
    this.name = "StockPaymentCorrelationConflictError";
  }
}

const asNumber = (value: number | string | bigint): number => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new StockMySqlInvariantError("Unsafe integer returned by MySQL");
  return parsed;
};

async function findAttempt(connection: PoolConnection, attemptId: string): Promise<StockAttempt | null> {
  const [attemptRows] = await connection.execute<AttemptRow[]>(
    `SELECT attemptId, ownerUserId, fingerprint, orderId, status, providerState, paymentId, checkoutUrl, reconciliationRequiredAt
       FROM stockCheckoutAttempts WHERE attemptId = ?`,
    [attemptId],
  );
  const row = attemptRows[0];
  if (!row) return null;
  const [itemRows] = await connection.execute<ItemRow[]>(
    `SELECT variantId, productId, sku, size, color, unitPriceCents, quantity, totalCents
       FROM stockCheckoutItems WHERE attemptId = ? ORDER BY lineNumber`,
    [attemptId],
  );
  return {
    attemptId: row.attemptId,
    ownerUserId: asNumber(row.ownerUserId),
    fingerprint: row.fingerprint,
    orderId: String(row.orderId),
    status: row.status,
    providerState: row.providerState,
    ...(row.paymentId ? { paymentId: row.paymentId } : {}),
    ...(row.checkoutUrl ? { checkoutUrl: row.checkoutUrl } : {}),
    reconciliationRequiredAt: row.reconciliationRequiredAt,
    snapshots: itemRows.map(item => ({
      id: asNumber(item.variantId),
      productId: asNumber(item.productId),
      sku: item.sku,
      size: item.size,
      color: item.color,
      unitPriceCents: asNumber(item.unitPriceCents),
      quantity: asNumber(item.quantity),
      totalCents: asNumber(item.totalCents),
    })),
  };
}

async function lockAttempt(connection: PoolConnection, attemptId: string): Promise<AttemptRow | null> {
  const [rows] = await connection.execute<AttemptRow[]>(
    `SELECT attemptId, ownerUserId, fingerprint, orderId, status, providerState, paymentId, checkoutUrl, reconciliationRequiredAt,
            CASE WHEN reservationExpiresAt > UTC_TIMESTAMP(3) AND expiryReviewedAt IS NULL THEN 1 ELSE 0 END AS providerRetryEligible
       FROM stockCheckoutAttempts WHERE attemptId = ? FOR UPDATE`,
    [attemptId],
  );
  return rows[0] ?? null;
}

async function activeReservations(connection: PoolConnection, attemptId: string) {
  const [rows] = await connection.execute<(RowDataPacket & { variantId: number; quantity: number })[]>(
    `SELECT variantId, quantity FROM stockReservations
       WHERE attemptId = ? AND status = 'active' ORDER BY variantId FOR UPDATE`,
    [attemptId],
  );
  return rows.map(row => ({ variantId: asNumber(row.variantId), quantity: asNumber(row.quantity) }));
}

type ExclusiveQuotaReserver = (connection: PoolConnection, input: ExclusiveCheckoutClaim) => Promise<void>;

function createTransaction(connection: PoolConnection, reservationTtlSeconds: number, reserveExclusiveQuota?: ExclusiveQuotaReserver): StockCheckoutTransaction {
  return {
    async lockOwnerForCheckout(ownerUserId): Promise<void> {
      const [rows] = await connection.execute<(RowDataPacket & { id: number })[]>(
        `SELECT id FROM users WHERE id = ? FOR UPDATE`,
        [ownerUserId],
      );
      if (!rows.length) throw new StockMySqlInvariantError("Checkout owner does not exist");
    },

    async reserveExclusiveQuota(input): Promise<void> {
      if (!reserveExclusiveQuota) throw new StockMySqlInvariantError("Exclusive checkout guard is not composed into STOCK runtime");
      await reserveExclusiveQuota(connection, input);
    },

    findAttempt: attemptId => findAttempt(connection, attemptId),

    async findOpenAttemptsForOwner(ownerUserId): Promise<StockAttempt[]> {
      const [rows] = await connection.execute<(RowDataPacket & { attemptId: string })[]>(
        `SELECT attemptId FROM stockCheckoutAttempts
          WHERE ownerUserId = ? AND status = 'reserved'
          ORDER BY createdAt, attemptId FOR UPDATE`,
        [ownerUserId],
      );
      const attempts: StockAttempt[] = [];
      for (const row of rows) {
        const attempt = await findAttempt(connection, row.attemptId);
        if (attempt) attempts.push(attempt);
      }
      return attempts;
    },

    async findVariant(variantId): Promise<StockVariant | null> {
      const [rows] = await connection.execute<(RowDataPacket & {
        id: number;
        productId: number;
        sku: string | null;
        size: string | null;
        color: string | null;
        price: number | null;
        stock: number;
        isActive: number;
      })[]>(
        `SELECT v.id, v.productId, v.sku, v.size, v.color, v.price, v.stock, v.isActive
           FROM productVariants v
           INNER JOIN products p ON p.id = v.productId
          WHERE v.id = ? LIMIT 1 FOR UPDATE OF v`,
        [variantId],
      );
      const row = rows[0];
      if (!row) return null;
      if (row.sku == null || row.size == null || row.color == null || row.price == null) {
        throw new StockMySqlInvariantError("Variant identity and price columns must be populated");
      }
      return {
        id: asNumber(row.id),
        productId: asNumber(row.productId),
        active: Number(row.isActive) === 1,
        sku: row.sku,
        size: row.size,
        color: row.color,
        unitPriceCents: asNumber(row.price),
        availableUnits: asNumber(row.stock),
      };
    },

    async isSkuUnique(sku, variantId): Promise<boolean> {
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT id FROM productVariants
          WHERE LOWER(TRIM(sku)) = LOWER(TRIM(?)) AND id <> ? LIMIT 1`,
        [sku, variantId],
      );
      return rows.length === 0;
    },

    async reserveVariant(variantId, quantity, attemptId): Promise<boolean> {
      // Lock the parent product first to serialize against the legacy product-level
      // reservation writer, then reject open reservations with no variant identity.
      const [parentRows] = await connection.execute<(RowDataPacket & { productId: number })[]>(
        `SELECT productId FROM productVariants WHERE id = ? LIMIT 1`,
        [variantId],
      );
      const productId = parentRows[0] ? asNumber(parentRows[0].productId) : null;
      if (productId === null) return false;
      await connection.execute<RowDataPacket[]>(
        `SELECT id FROM products WHERE id = ? FOR UPDATE`,
        [productId],
      );
      const [legacyReservations] = await connection.execute<RowDataPacket[]>(
        `SELECT id FROM stockReservations
          WHERE productId = ? AND variantId IS NULL AND status = 'active'
            AND expiresAt >= UTC_TIMESTAMP(3)
          LIMIT 1 FOR UPDATE`,
        [productId],
      );
      if (legacyReservations.length > 0) return false;

      // Explicit variant row lock serializes claims. The guarded UPDATE remains
      // the final invariant check for active and unreserved sellable units.
      const [rows] = await connection.execute<(RowDataPacket & { stock: number; reservedStock: number; isActive: number })[]>(
        `SELECT stock, reservedStock, isActive FROM productVariants WHERE id = ? FOR UPDATE`,
        [variantId],
      );
      const variant = rows[0];
      if (!variant || Number(variant.isActive) !== 1) return false;
      if (asNumber(variant.stock) - asNumber(variant.reservedStock) < quantity) return false;

      const [update] = await connection.execute<ResultSetHeader>(
        `UPDATE productVariants SET reservedStock = reservedStock + ?
          WHERE id = ? AND isActive = 1 AND stock - reservedStock >= ?`,
        [quantity, variantId, quantity],
      );
      if (update.affectedRows !== 1) return false;
      const [identityRows] = await connection.execute<(RowDataPacket & {
        orderId: string;
        ownerUserId: number | string;
        productId: number | string;
        sku: string;
        size: string;
        color: string;
        unitPriceCents: number | string;
      })[]>(
        `SELECT a.orderId, a.ownerUserId, i.productId, i.sku, i.size, i.color, i.unitPriceCents
           FROM stockCheckoutAttempts a
           JOIN stockCheckoutItems i ON i.attemptId = a.attemptId AND i.variantId = ?
          WHERE a.attemptId = ? LIMIT 1`,
        [variantId, attemptId],
      );
      const identity = identityRows[0];
      if (!identity) throw new StockMySqlInvariantError("Attempt snapshot missing during reservation projection");
      await connection.execute<ResultSetHeader>(
        `INSERT INTO stockReservations
          (orderId, userId, productId, attemptId, variantId, skuSnapshot, sizeSnapshot, colorSnapshot, unitPriceCents, quantity, status, expiresAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND))`,
        [identity.orderId, identity.ownerUserId, identity.productId, attemptId, variantId, identity.sku, identity.size, identity.color, identity.unitPriceCents, quantity, reservationTtlSeconds],
      );
      return true;
    },

    async createAttempt(attempt): Promise<string> {
      const amountCents = attempt.snapshots.reduce((sum, item) => sum + item.totalCents, 0);
      let orderId: string;
      try {
        const [orderResult] = await connection.execute<ResultSetHeader>(
          `INSERT INTO orders
            (userId, status, paymentStatus, totalPrice, stockAttemptId, shippingOptionId,
             shippingRecipient, shippingZipCode, shippingStreet, shippingNumber, shippingComplement,
             shippingNeighborhood, shippingCity, shippingState)
           VALUES (?, 'pending', 'unconfirmed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            attempt.ownerUserId, amountCents, attempt.attemptId, attempt.delivery?.optionId ?? null,
            attempt.delivery?.address.recipient ?? null, attempt.delivery?.address.zipCode ?? null,
            attempt.delivery?.address.street ?? null, attempt.delivery?.address.number ?? null,
            attempt.delivery?.address.complement ?? null, attempt.delivery?.address.neighborhood ?? null,
            attempt.delivery?.address.city ?? null, attempt.delivery?.address.state ?? null,
          ],
        );
        if (orderResult.affectedRows !== 1 || !orderResult.insertId) throw new StockMySqlInvariantError("Administrative order projection insert failed");
        orderId = String(orderResult.insertId);
      } catch (error) {
        if ((error as { code?: string })?.code === "ER_DUP_ENTRY") throw new StockAttemptConflictError();
        throw error;
      }
      const [header] = await connection.execute<ResultSetHeader>(
        `INSERT INTO stockCheckoutAttempts
          (attemptId, ownerUserId, fingerprint, orderId, status, providerState, amountCents, reservationExpiresAt)
         VALUES (?, ?, ?, ?, 'reserved', 'not_started', ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND))`,
        [attempt.attemptId, attempt.ownerUserId, attempt.fingerprint, orderId, amountCents, reservationTtlSeconds],
      ).catch(error => {
        if ((error as { code?: string })?.code === "ER_DUP_ENTRY") throw new StockAttemptConflictError();
        throw error;
      });
      if (header.affectedRows !== 1) throw new StockMySqlInvariantError("Checkout attempt header insert failed");
      for (const [lineNumber, item] of attempt.snapshots.entries()) {
        await connection.execute<ResultSetHeader>(
          `INSERT INTO orderItems (orderId, productId, quantity, price, variantId, skuSnapshot, sizeSnapshot, colorSnapshot)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [orderId, item.productId, item.quantity, item.unitPriceCents, item.id, item.sku, item.size, item.color],
        );
        await connection.execute<ResultSetHeader>(
          `INSERT INTO stockCheckoutItems
            (attemptId, lineNumber, variantId, productId, sku, size, color, unitPriceCents, quantity, totalCents)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [attempt.attemptId, lineNumber, item.id, item.productId, item.sku, item.size, item.color, item.unitPriceCents, item.quantity, item.totalCents],
        );
      }
      return orderId;
    },

    async beginProviderAttempt(attemptId, allowIdempotentRetry): Promise<boolean> {
      const attempt = await lockAttempt(connection, attemptId);
      if (!attempt || attempt.status !== "reserved") return false;
      if (attempt.providerState === "not_started") {
        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE stockCheckoutAttempts SET providerState = 'creating'
            WHERE attemptId = ? AND status = 'reserved' AND providerState = 'not_started'
              AND reservationExpiresAt > UTC_TIMESTAMP(3) AND expiryReviewedAt IS NULL`,
          [attemptId],
        );
        return result.affectedRows === 1;
      }
      if (!allowIdempotentRetry || !["creating", "ambiguous"].includes(attempt.providerState) || Number(attempt.providerRetryEligible) !== 1) return false;
      if (attempt.providerState === "creating") return true;
      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE stockCheckoutAttempts SET providerState = 'creating'
          WHERE attemptId = ? AND status = 'reserved' AND providerState IN ('creating', 'ambiguous')
            AND reservationExpiresAt > UTC_TIMESTAMP(3) AND expiryReviewedAt IS NULL`,
        [attemptId],
      );
      return result.affectedRows === 1;
    },

    async markProviderAmbiguous(attemptId): Promise<void> {
      await connection.execute<ResultSetHeader>(
        `UPDATE stockCheckoutAttempts SET providerState = 'ambiguous'
          WHERE attemptId = ? AND status = 'reserved' AND providerState = 'creating'`,
        [attemptId],
      );
    },

    async markProviderFailure(attemptId): Promise<boolean> {
      const attempt = await lockAttempt(connection, attemptId);
      if (!attempt || attempt.status !== "reserved" || !["creating", "ambiguous"].includes(attempt.providerState)) return false;
      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE stockCheckoutAttempts
            SET status = 'released', providerState = 'definitive_failure', releasedAt = UTC_TIMESTAMP(3)
          WHERE attemptId = ? AND status = 'reserved' AND providerState IN ('creating', 'ambiguous')`,
        [attemptId],
      );
      return result.affectedRows === 1;
    },

    async markReconciliationRequired(attemptId): Promise<void> {
      await connection.execute<ResultSetHeader>(
        `UPDATE stockCheckoutAttempts SET reconciliationRequiredAt = COALESCE(reconciliationRequiredAt, UTC_TIMESTAMP(3))
          WHERE attemptId = ? AND status = 'reserved' AND providerState <> 'not_started'`,
        [attemptId],
      );
    },

    async recordPayment(attemptId, paymentId, checkoutUrl): Promise<void> {
      const attempt = await lockAttempt(connection, attemptId);
      if (!attempt || attempt.status !== "reserved" || !["creating", "ambiguous", "created"].includes(attempt.providerState)) {
        throw new StockMySqlInvariantError("Payment correlation requires a submitted or recoverable attempt");
      }
      if (attempt.paymentId) {
        if (attempt.paymentId !== paymentId || (checkoutUrl && attempt.checkoutUrl && attempt.checkoutUrl !== checkoutUrl)) {
          throw new StockPaymentCorrelationConflictError();
        }
        const [projectionRows] = await connection.execute<(RowDataPacket & { stockPaymentId: string | null })[]>(
          `SELECT stockPaymentId FROM orders WHERE id = ? AND stockAttemptId = ? LIMIT 1`,
          [attempt.orderId, attemptId],
        );
        if (!projectionRows[0] || (projectionRows[0].stockPaymentId && projectionRows[0].stockPaymentId !== paymentId)) {
          throw new StockMySqlInvariantError("Payment correlation conflicts with the administrative projection");
        }
        if (!projectionRows[0].stockPaymentId) {
          const [projected] = await connection.execute<ResultSetHeader>(
            `UPDATE orders SET stockPaymentId = ? WHERE id = ? AND stockAttemptId = ? AND stockPaymentId IS NULL`,
            [paymentId, attempt.orderId, attemptId],
          );
          if (projected.affectedRows !== 1) throw new StockMySqlInvariantError("Payment projection was not persisted");
        }
        if (checkoutUrl && !attempt.checkoutUrl) {
          await connection.execute<ResultSetHeader>(
            `UPDATE stockCheckoutAttempts SET checkoutUrl = ? WHERE attemptId = ? AND paymentId = ?`,
            [checkoutUrl, attemptId, paymentId],
          );
        }
        return;
      }
      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE stockCheckoutAttempts SET paymentId = ?, checkoutUrl = ?, providerState = 'created'
          WHERE attemptId = ? AND status = 'reserved' AND paymentId IS NULL
            AND providerState IN ('creating', 'ambiguous', 'created')`,
        [paymentId, checkoutUrl, attemptId],
      );
      if (result.affectedRows !== 1) throw new StockMySqlInvariantError("Payment correlation was not persisted");
      const [orderResult] = await connection.execute<ResultSetHeader>(
        `UPDATE orders SET stockPaymentId = ? WHERE id = ? AND stockAttemptId = ? AND stockPaymentId IS NULL`,
        [paymentId, attempt.orderId, attemptId],
      );
      if (orderResult.affectedRows !== 1) throw new StockMySqlInvariantError("Payment correlation projection was not persisted");
    },

    async claimWebhook(eventId, payloadHash): Promise<"claimed" | "duplicate" | "conflict"> {
      try {
        const [result] = await connection.execute<ResultSetHeader>(
          `INSERT INTO stockWebhookEvents (eventId, payloadHash) VALUES (?, ?)`,
          [eventId, payloadHash],
        );
        return result.affectedRows === 1 ? "claimed" : "conflict";
      } catch (error) {
        if ((error as { code?: string })?.code !== "ER_DUP_ENTRY") throw error;
        const [rows] = await connection.execute<(RowDataPacket & { payloadHash: string })[]>(
          `SELECT payloadHash FROM stockWebhookEvents WHERE eventId = ?`,
          [eventId],
        );
        if (!rows[0]) throw new StockMySqlInvariantError("Webhook unique conflict without a persisted event");
        return rows[0].payloadHash === payloadHash ? "duplicate" : "conflict";
      }
    },

    async findAttemptByPayment(paymentId): Promise<StockAttempt | null> {
      const [rows] = await connection.execute<(RowDataPacket & { attemptId: string })[]>(
        `SELECT attemptId FROM stockCheckoutAttempts WHERE paymentId = ? LIMIT 1`,
        [paymentId],
      );
      return rows[0] ? findAttempt(connection, rows[0].attemptId) : null;
    },

    async findAttemptByOrder(orderId): Promise<StockAttempt | null> {
      const [rows] = await connection.execute<(RowDataPacket & { attemptId: string })[]>(
        `SELECT attemptId FROM stockCheckoutAttempts WHERE orderId = ? LIMIT 1`,
        [orderId],
      );
      return rows[0] ? findAttempt(connection, rows[0].attemptId) : null;
    },

    async consumeReservations(attemptId): Promise<void> {
      const reservations = await activeReservations(connection, attemptId);
      if (reservations.length === 0) throw new StockMySqlInvariantError("Cannot consume an attempt without active reservations");
      for (const reservation of reservations) {
        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE productVariants
              SET stock = stock - ?, reservedStock = reservedStock - ?
            WHERE id = ? AND stock >= ? AND reservedStock >= ?`,
          [reservation.quantity, reservation.quantity, reservation.variantId, reservation.quantity, reservation.quantity],
        );
        if (result.affectedRows !== 1) throw new StockMySqlInvariantError("Reserved inventory could not be consumed");
        const [reservationResult] = await connection.execute<ResultSetHeader>(
          `UPDATE stockReservations SET status = 'consumed'
            WHERE attemptId = ? AND variantId = ? AND status = 'active'`,
          [attemptId, reservation.variantId],
        );
        if (reservationResult.affectedRows !== 1) throw new StockMySqlInvariantError("Reservation consume transition was not unique");
      }
    },

    async releaseReservations(attemptId): Promise<void> {
      const reservations = await activeReservations(connection, attemptId);
      for (const reservation of reservations) {
        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE productVariants SET reservedStock = reservedStock - ?
            WHERE id = ? AND reservedStock >= ?`,
          [reservation.quantity, reservation.variantId, reservation.quantity],
        );
        if (result.affectedRows !== 1) throw new StockMySqlInvariantError("Reserved inventory could not be released");
        const [reservationResult] = await connection.execute<ResultSetHeader>(
          `UPDATE stockReservations SET status = 'released'
            WHERE attemptId = ? AND variantId = ? AND status = 'active'`,
          [attemptId, reservation.variantId],
        );
        if (reservationResult.affectedRows !== 1) throw new StockMySqlInvariantError("Reservation release transition was not unique");
      }
      await connection.execute<ResultSetHeader>(
        `UPDATE orders SET status = 'cancelled'
          WHERE stockAttemptId = ? AND paymentStatus = 'unconfirmed' AND status = 'pending'`,
        [attemptId],
      );
    },

    async expireDueReservations(batchSize, ownerUserId?): Promise<{ releasedAttemptIds: string[]; reconciliationAttemptIds: string[] }> {
      if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500) {
        throw new RangeError("batchSize must be between 1 and 500");
      }
      const ownerFilter = ownerUserId === undefined ? "" : " AND ownerUserId = ?";
      const [dueRows] = await connection.execute<(RowDataPacket & {
        attemptId: string;
        providerState: StockAttempt["providerState"];
      })[]>(
        `SELECT attemptId, providerState
           FROM stockCheckoutAttempts
          WHERE status = 'reserved'
            AND reservationExpiresAt <= UTC_TIMESTAMP(3)
            AND expiryReviewedAt IS NULL
            ${ownerFilter}
          ORDER BY reservationExpiresAt, attemptId
          LIMIT ${batchSize}
          FOR UPDATE SKIP LOCKED`,
        ownerUserId === undefined ? [] : [ownerUserId],
      );
      const releasedAttemptIds: string[] = [];
      const reconciliationAttemptIds: string[] = [];
      for (const row of dueRows) {
        if (row.providerState === "not_started") {
          const [result] = await connection.execute<ResultSetHeader>(
            `UPDATE stockCheckoutAttempts
                SET status = 'released', releasedAt = UTC_TIMESTAMP(3), expiryReviewedAt = UTC_TIMESTAMP(3)
              WHERE attemptId = ? AND status = 'reserved' AND providerState = 'not_started'
                AND reservationExpiresAt <= UTC_TIMESTAMP(3) AND expiryReviewedAt IS NULL`,
            [row.attemptId],
          );
          if (result.affectedRows === 1) {
            await this.releaseReservations(row.attemptId);
            releasedAttemptIds.push(row.attemptId);
          }
          continue;
        }
        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE stockCheckoutAttempts
              SET expiryReviewedAt = UTC_TIMESTAMP(3),
                  reconciliationRequiredAt = COALESCE(reconciliationRequiredAt, UTC_TIMESTAMP(3))
            WHERE attemptId = ? AND status = 'reserved'
              AND reservationExpiresAt <= UTC_TIMESTAMP(3) AND expiryReviewedAt IS NULL`,
          [row.attemptId],
        );
        if (result.affectedRows === 1) reconciliationAttemptIds.push(row.attemptId);
      }
      return { releasedAttemptIds, reconciliationAttemptIds };
    },

    async markPaid(attemptId, paymentId): Promise<"paid" | "already-paid" | "not-pending"> {
      const attempt = await lockAttempt(connection, attemptId);
      if (!attempt) return "not-pending";
      if (attempt.status === "paid") {
        if (attempt.paymentId !== paymentId) throw new StockPaymentCorrelationConflictError();
        const [projectionRows] = await connection.execute<(RowDataPacket & { status: string; paymentStatus: string; paymentConfirmationReference: string | null })[]>(
          `SELECT status, paymentStatus, paymentConfirmationReference FROM orders WHERE id = ? AND stockAttemptId = ? LIMIT 1`,
          [attempt.orderId, attemptId],
        );
        if (!projectionRows[0] || projectionRows[0].status !== "paid" || projectionRows[0].paymentStatus !== "confirmed" || projectionRows[0].paymentConfirmationReference !== paymentId) {
          throw new StockMySqlInvariantError("Paid STOCK attempt has no matching administrative order projection");
        }
        return "already-paid";
      }
      if (attempt.status !== "reserved") return "not-pending";
      if (attempt.paymentId !== paymentId) throw new StockPaymentCorrelationConflictError();
      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE stockCheckoutAttempts
            SET status = 'paid', providerState = 'created', paidAt = UTC_TIMESTAMP(3),
                reconciliationRequiredAt = NULL
          WHERE attemptId = ? AND status = 'reserved' AND paymentId = ?`,
        [attemptId, paymentId],
      );
      if (result.affectedRows !== 1) return "not-pending";
      const [orderResult] = await connection.execute<ResultSetHeader>(
        `UPDATE orders SET status = 'paid', paymentStatus = 'confirmed', paymentConfirmationSource = 'asaas_webhook',
              paymentConfirmationReference = ?, paymentConfirmedAt = UTC_TIMESTAMP(3)
          WHERE id = ? AND stockAttemptId = ? AND status = 'pending' AND paymentStatus = 'unconfirmed'`,
        [paymentId, attempt.orderId, attemptId],
      );
      if (orderResult.affectedRows !== 1) throw new StockMySqlInvariantError("Administrative order projection could not be confirmed atomically");
      return "paid";
    },

    async markReleased(attemptId): Promise<"released" | "already-released" | "not-pending"> {
      const attempt = await lockAttempt(connection, attemptId);
      if (!attempt) return "not-pending";
      if (attempt.status === "released") return "already-released";
      if (attempt.status !== "reserved") return "not-pending";
      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE stockCheckoutAttempts
            SET status = 'released', releasedAt = UTC_TIMESTAMP(3), reconciliationRequiredAt = NULL
          WHERE attemptId = ? AND status = 'reserved'`,
        [attemptId],
      );
      return result.affectedRows === 1 ? "released" : "not-pending";
    },
  };
}

/** Uses only the caller's already-configured pool; TLS/identity connection guards remain outside this adapter. */
export function createMysqlStockCheckoutStore(pool: Pool, options: { reservationTtlSeconds?: number; reserveExclusiveQuota?: ExclusiveQuotaReserver } = {}): StockCheckoutStore {
  const reservationTtlSeconds = options.reservationTtlSeconds ?? 15 * 60;
  if (!Number.isSafeInteger(reservationTtlSeconds) || reservationTtlSeconds < 60 || reservationTtlSeconds > 24 * 60 * 60) {
    throw new RangeError("reservationTtlSeconds must be between 60 and 86400");
  }
  return {
    async findAttemptForOwner(attemptId, ownerUserId) {
      const [rows] = await pool.execute<ResumeRow[]>(
        `SELECT attemptId, orderId, status, providerState, paymentId, checkoutUrl, amountCents,
                DATE_FORMAT(reservationExpiresAt, '%Y-%m-%dT%H:%i:%s.%fZ') AS reservationExpiresAt,
                (reservationExpiresAt <= UTC_TIMESTAMP(3)) AS reservationExpired,
                (reconciliationRequiredAt IS NOT NULL) AS reconciliationRequired
           FROM stockCheckoutAttempts
          WHERE attemptId = ? AND ownerUserId = ?
          LIMIT 1`,
        [attemptId, ownerUserId],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        attemptId: row.attemptId,
        orderId: String(row.orderId),
        status: row.status,
        providerState: row.providerState,
        paymentId: row.paymentId,
        checkoutUrl: row.checkoutUrl,
        amountCents: asNumber(row.amountCents),
        reservationExpiresAt: row.reservationExpiresAt,
        reservationExpired: Boolean(row.reservationExpired),
        reconciliationRequired: Boolean(row.reconciliationRequired),
      };
    },
    async findLatestAttemptForOwner(ownerUserId) {
      const [rows] = await pool.execute<ResumeRow[]>(
        `SELECT attemptId, orderId, status, providerState, paymentId, checkoutUrl, amountCents,
                DATE_FORMAT(reservationExpiresAt, '%Y-%m-%dT%H:%i:%s.%fZ') AS reservationExpiresAt,
                (reservationExpiresAt <= UTC_TIMESTAMP(3)) AS reservationExpired,
                (reconciliationRequiredAt IS NOT NULL) AS reconciliationRequired
           FROM stockCheckoutAttempts
          WHERE ownerUserId = ?
          ORDER BY createdAt DESC, attemptId DESC
          LIMIT 1`,
        [ownerUserId],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        attemptId: row.attemptId,
        orderId: String(row.orderId),
        status: row.status,
        providerState: row.providerState,
        paymentId: row.paymentId,
        checkoutUrl: row.checkoutUrl,
        amountCents: asNumber(row.amountCents),
        reservationExpiresAt: row.reservationExpiresAt,
        reservationExpired: Boolean(row.reservationExpired),
        reconciliationRequired: Boolean(row.reconciliationRequired),
      };
    },
    async transaction<T>(work: (tx: StockCheckoutTransaction) => Promise<T>): Promise<T> {
      const connection = await pool.getConnection();
      let transactionStarted = false;
      try {
        await connection.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
        await connection.beginTransaction();
        transactionStarted = true;
        const result = await work(createTransaction(connection, reservationTtlSeconds, options.reserveExclusiveQuota));
        await connection.commit();
        transactionStarted = false;
        return result;
      } catch (error) {
        if (transactionStarted) {
          try {
            await connection.rollback();
          } catch (rollbackError) {
            throw new AggregateError([error, rollbackError], "MySQL transaction failed and rollback also failed");
          }
        }
        throw error;
      } finally {
        connection.release();
      }
    },
  };
}
