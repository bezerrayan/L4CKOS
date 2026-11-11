import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPool, type Pool, type ResultSetHeader } from "mysql2/promise";
import {
  createStockCheckout as createStockCheckoutDomain,
  expireStockReservations,
  processSignedStockWebhook,
  resumeStockCheckout,
  type StockNormalizedWebhook,
  StockProviderError,
  type StockCheckoutStore,
  type StockCheckoutTransaction,
} from "./stockCheckout";
import { createMysqlStockCheckoutStore } from "./mysqlStockCheckoutStore";
import { createExclusiveStore } from "../exclusive/store";

const createStockCheckout = (input: Omit<Parameters<typeof createStockCheckoutDomain>[0], "ownerUserId">) =>
  createStockCheckoutDomain({ ...input, ownerUserId: 81 });

const database = process.env.STOCK_MYSQL_DATABASE ?? "";
const host = process.env.STOCK_MYSQL_HOST ?? "";
const port = Number(process.env.STOCK_MYSQL_PORT ?? 0);
const user = process.env.STOCK_MYSQL_USER ?? "";
const password = process.env.STOCK_MYSQL_PASSWORD ?? "";

function assertSyntheticTarget() {
  if (!/^(127\.0\.0\.1|localhost|::1)$/.test(host)) throw new Error("STOCK_MYSQL_HOST must be loopback");
  if (database !== "l4ckos_stock_test") throw new Error("STOCK_MYSQL_DATABASE must be the disposable l4ckos_stock_test database");
  if (user !== "stock_test") throw new Error("STOCK_MYSQL_USER must be the disposable stock_test user");
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !password) throw new Error("A loopback port and synthetic test password are required");
}

let pool: Pool;
let store: StockCheckoutStore;

async function resetDatabase() {
  await pool.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const table of ["stockWebhookEvents", "stockReservations", "orderItems", "stockCheckoutItems", "stockCheckoutAttempts", "orders", "productVariants", "products", "users"]) {
    await pool.query("TRUNCATE TABLE " + table);
  }
  await pool.query("SET FOREIGN_KEY_CHECKS = 1");
  await pool.execute("INSERT INTO users (id, openId, name, email) VALUES (81, 'synthetic-owner-81', 'STOCK Customer', 'stock-customer@example.invalid'), (82, 'synthetic-other-82', 'Other Customer', 'other-customer@example.invalid')");
  await pool.execute("INSERT INTO products (id, name) VALUES (4, 'Synthetic STOCK shirt')");
  await pool.execute(
    "INSERT INTO productVariants (id, productId, sku, size, color, price, stock, reservedStock, isActive) " +
    "VALUES (8, 4, 'TSHIRT-BLK-M', 'M', 'Preto', 12900, 1, 0, 1), " +
    "(9, 4, 'TSHIRT-BLK-G', 'G', 'Preto', 14900, 2, 0, 1)",
  );
}

const checkoutRequest = (attemptId: string, variantId = 8, quantity = 1, size = variantId === 8 ? "M" : "G") => ({
  attemptId,
  items: [{ productId: 4, variantId, size, color: "Preto", quantity }],
});

function provider(result?: () => Promise<{ paymentId: string; checkoutUrl: string }>) {
  const calls: Array<{ orderId: string; amountCents: number; idempotencyKey: string }> = [];
  return {
    calls,
    supportsIdempotencyKey: true,
    async createPayment(input: { orderId: string; amountCents: number; idempotencyKey: string }) {
      calls.push(input);
      return result ? result() : { paymentId: "pay-" + input.orderId, checkoutUrl: "https://sandbox.invalid/" + input.orderId };
    },
  };
}

async function readInventory(variantId: number) {
  const [rows] = await pool.execute<(Record<string, unknown> & { stock: number; reservedStock: number })[]>(
    "SELECT stock, reservedStock FROM productVariants WHERE id = ?", [variantId],
  );
  return rows[0];
}

async function attemptStatus(attemptId: string) {
  const [rows] = await pool.execute<(Record<string, unknown> & { status: string; providerState: string; paymentId: string | null })[]>(
    "SELECT status, providerState, paymentId FROM stockCheckoutAttempts WHERE attemptId = ?", [attemptId],
  );
  return rows[0] ?? null;
}

async function seedReservedAttempt(attemptId: string, variantId = 8) {
  return store.transaction(async tx => {
    const variant = await tx.findVariant(variantId);
    if (!variant) throw new Error("synthetic variant missing");
    const item = {
      id: variant.id, productId: variant.productId, sku: variant.sku, size: variant.size, color: variant.color,
      unitPriceCents: variant.unitPriceCents, quantity: 1, totalCents: variant.unitPriceCents,
    };
    const orderId = await tx.createAttempt({
      attemptId, ownerUserId: 81, fingerprint: "f".repeat(64), orderId: "order-" + attemptId, status: "reserved",
      providerState: "not_started", snapshots: [item],
    });
    if (!await tx.reserveVariant(variantId, 1, attemptId)) throw new Error("synthetic inventory unavailable");
    return orderId;
  });
}

async function forceAttemptExpired(attemptId: string) {
  await pool.execute(
    "UPDATE stockCheckoutAttempts SET reservationExpiresAt = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE attemptId = ?",
    [attemptId],
  );
  await pool.execute(
    "UPDATE stockReservations SET expiresAt = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE attemptId = ?",
    [attemptId],
  );
}

function wrapTransactionFault(fault: "reserve-after-first" | "consume-after-write"): StockCheckoutStore {
  return {
    findAttemptForOwner: (...args) => store.findAttemptForOwner(...args),
    transaction<T>(work: (tx: StockCheckoutTransaction) => Promise<T>): Promise<T> {
      return store.transaction(tx => {
        let reserveCalls = 0;
        return work({
          ...tx,
          async reserveVariant(...args) {
            const reserved = await tx.reserveVariant(...args);
            reserveCalls++;
            if (fault === "reserve-after-first" && reserved && reserveCalls === 1) throw new Error("injected reservation failure");
            return reserved;
          },
          async consumeReservations(...args) {
            await tx.consumeReservations(...args);
            if (fault === "consume-after-write") throw new Error("injected consumption failure");
          },
        });
      });
    },
  };
}

function sendWebhook(input: StockNormalizedWebhook & { store?: StockCheckoutStore; signatureVerified?: boolean }) {
  const { store: targetStore = store, signatureVerified = true, ...event } = input;
  return processSignedStockWebhook({
    rawBody: JSON.stringify(event.payload),
    headers: {},
    store: targetStore,
    boundary: {
      verifySignature: async () => signatureVerified,
      decodeSignedEvent: () => event,
    },
  });
}

describe.skipIf(!process.env.STOCK_MYSQL_HOST)("MySQL 9.7.2 STOCK checkout adapter (disposable database only)", () => {
  beforeAll(async () => {
    assertSyntheticTarget();
    pool = createPool({ host, port, user, password, database, connectionLimit: 12, waitForConnections: true, queueLimit: 0 });
    const [identity] = await pool.query<(Record<string, unknown> & { version: string; dbName: string; currentUser: string })[]>(
      "SELECT VERSION() AS version, DATABASE() AS dbName, CURRENT_USER() AS currentUser",
    );
    if (!String(identity[0]?.version).startsWith("9.7.2") || identity[0]?.dbName !== database || !String(identity[0]?.currentUser).startsWith("stock_test@")) {
      throw new Error("MySQL identity/version did not match the disposable test target");
    }
    const [existingSchema] = await pool.execute<(RowDataPacket & { tableCount: number })[]>(
      "SELECT COUNT(*) AS tableCount FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'products'",
    );
    if (Number(existingSchema[0]?.tableCount) === 0) {
      const schema = await readFile(resolve("server/stock/fixtures/mysql8-stock-schema.sql"), "utf8");
      for (const statement of schema.split(";").map(part => part.trim()).filter(Boolean)) await pool.query(statement);
    }
    const exclusiveMigration = await readFile(resolve("database/migrations/exclusive-drops-v1/0028_exclusive_drops_candidate.sql"), "utf8");
    const creates = exclusiveMigration.match(/CREATE TABLE IF NOT EXISTS[\s\S]*?ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;/g) ?? [];
    if (creates.length !== 8) throw new Error("Exclusive-drop candidate schema fixture is incomplete");
    for (const statement of creates) await pool.query(statement);
    const exclusive = createExclusiveStore(pool);
    store = createMysqlStockCheckoutStore(pool, {
      reservationTtlSeconds: 900,
      reserveExclusiveQuota: (connection, claim) => exclusive.reserveForCheckoutInTransaction(connection, claim),
    });
  }, 30_000);

  beforeEach(async () => resetDatabase());
  afterAll(async () => { if (pool) await pool.end(); });

  it("allows only one of two concurrent purchases to reserve the last unit", async () => {
    const results = await Promise.allSettled([
      createStockCheckout({ enabled: true, store, provider: provider(), request: checkoutRequest("mysql-race-attempt-0001") }),
      createStockCheckout({ enabled: true, store, provider: provider(), request: checkoutRequest("mysql-race-attempt-0002") }),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(await readInventory(8)).toMatchObject({ stock: 1, reservedStock: 1 });
  });

  it("blocks STOCK while an unexpired legacy product-level reservation has no variant identity", async () => {
    const [order] = await pool.execute<{ insertId: number } & ResultSetHeader>(
      "INSERT INTO orders (userId, status, paymentStatus, totalPrice) VALUES (81, 'pending', 'unconfirmed', 12900)",
    );
    await pool.execute(
      "INSERT INTO stockReservations (orderId, userId, productId, quantity, status, expiresAt) VALUES (?, 81, 4, 1, 'active', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 10 MINUTE))",
      [order.insertId],
    );
    const payments = provider();
    await expect(createStockCheckout({
      enabled: true, store, provider: payments, request: checkoutRequest("mysql-legacy-reservation-block-01"),
    })).rejects.toMatchObject({ code: "CHECKOUT_STOCK_INSUFFICIENT" });
    expect(await readInventory(8)).toMatchObject({ stock: 1, reservedStock: 0 });
    expect(payments.calls).toHaveLength(0);
    const [attempts] = await pool.execute<(Record<string, unknown> & { total: number })[]>(
      "SELECT COUNT(*) AS total FROM stockCheckoutAttempts WHERE attemptId = 'mysql-legacy-reservation-block-01'",
    );
    expect(Number(attempts[0].total)).toBe(0);
  });

  it("reads a persisted attempt only for its owner", async () => {
    const payments = provider();
    const checkout = await createStockCheckout({ enabled: true, store, provider: payments, request: checkoutRequest("mysql-owner-resume-0001") });
    const owned = await resumeStockCheckout({ store, authenticatedUserId: 81, attemptId: "mysql-owner-resume-0001" });
    const foreignLookup = await store.findAttemptForOwner("mysql-owner-resume-0001", 82);
    expect(owned).toMatchObject({ status: "pending", orderId: checkout.orderId, paymentId: checkout.paymentId, amountCents: 12900 });
    expect(foreignLookup).toBeNull();
    expect(payments.calls).toHaveLength(1);
  });

  it("reserves two variants of one product independently at their server prices", async () => {
    const result = await createStockCheckout({
      enabled: true, store, provider: provider(),
      request: { attemptId: "mysql-two-variants-0001", items: [
        { productId: 4, variantId: 8, size: "M", color: "Preto", quantity: 1 },
        { productId: 4, variantId: 9, size: "G", color: "Preto", quantity: 1 },
      ] },
    });
    expect(result.amountCents).toBe(27800);
    expect(result.snapshots.map(item => item.sku)).toEqual(["TSHIRT-BLK-M", "TSHIRT-BLK-G"]);
    expect(await readInventory(8)).toMatchObject({ stock: 1, reservedStock: 1 });
    expect(await readInventory(9)).toMatchObject({ stock: 2, reservedStock: 1 });
  });

  it("keeps the original price snapshot on replay after a catalog price change", async () => {
    const payments = provider();
    const first = await createStockCheckout({ enabled: true, store, provider: payments, request: checkoutRequest("mysql-price-change-0001") });
    await pool.execute("UPDATE productVariants SET price = 17700 WHERE id = 8");
    const replay = await createStockCheckout({ enabled: true, store, provider: payments, request: checkoutRequest("mysql-price-change-0001") });
    expect(first.amountCents).toBe(12900);
    expect(replay.amountCents).toBe(12900);
    expect(replay.snapshots[0].unitPriceCents).toBe(12900);
    expect(payments.calls).toHaveLength(1);
  });

  it("returns a repeated attempt and rejects a conflicting payload", async () => {
    const payments = provider();
    const first = await createStockCheckout({ enabled: true, store, provider: payments, request: checkoutRequest("mysql-idempotent-00001") });
    const replay = await createStockCheckout({ enabled: true, store, provider: payments, request: checkoutRequest("mysql-idempotent-00001") });
    expect(replay).toMatchObject({ orderId: first.orderId, paymentId: first.paymentId, replayed: true });
    await expect(createStockCheckout({ enabled: true, store, provider: payments, request: checkoutRequest("mysql-idempotent-00001", 9, 1, "G") }))
      .rejects.toMatchObject({ code: "CHECKOUT_ATTEMPT_CHANGED" });
    expect(await readInventory(8)).toMatchObject({ reservedStock: 1 });
    expect(await readInventory(9)).toMatchObject({ reservedStock: 0 });
  });

  it("serializes concurrent identical attempts without creating duplicate reservations", async () => {
    const payments = provider();
    const request = checkoutRequest("mysql-same-attempt-race-0001");
    const results = await Promise.all([
      createStockCheckout({ enabled: true, store, provider: payments, request }),
      createStockCheckout({ enabled: true, store, provider: payments, request }),
    ]);
    expect(results[0].orderId).toBe(results[1].orderId);
    expect(results.map(result => result.paymentId)).toEqual([results[0].paymentId, results[0].paymentId]);
    expect(new Set(payments.calls.map(call => call.idempotencyKey)).size).toBe(1);
    expect(await readInventory(8)).toMatchObject({ stock: 1, reservedStock: 1 });
    const [rows] = await pool.execute<(Record<string, unknown> & { total: number })[]>(
      "SELECT COUNT(*) AS total FROM stockReservations WHERE attemptId = 'mysql-same-attempt-race-0001'",
    );
    expect(Number(rows[0].total)).toBe(1);
  });

  it("serializes equivalent carts with different attemptIds and creates one provider payment", async () => {
    const payments = provider();
    const results = await Promise.allSettled([
      createStockCheckout({ enabled: true, store, provider: payments, request: checkoutRequest("mysql-equivalent-cart-0001", 9) }),
      createStockCheckout({ enabled: true, store, provider: payments, request: checkoutRequest("mysql-equivalent-cart-0002", 9) }),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "CHECKOUT_ATTEMPT_NOT_REUSABLE" } });
    expect(payments.calls).toHaveLength(1);
    expect(await readInventory(9)).toMatchObject({ stock: 2, reservedStock: 1 });
    const [rows] = await pool.execute<(Record<string, unknown> & { attempts: number; reservations: number })[]>(
      "SELECT (SELECT COUNT(*) FROM stockCheckoutAttempts WHERE ownerUserId = 81) AS attempts, (SELECT COUNT(*) FROM stockReservations WHERE variantId = 9 AND status = 'active') AS reservations",
    );
    expect(Number(rows[0].attempts)).toBe(1);
    expect(Number(rows[0].reservations)).toBe(1);
  });

  it("rolls back the attempt and first variant reservation if a later reservation step fails", async () => {
    const failingStore = wrapTransactionFault("reserve-after-first");
    await expect(createStockCheckout({
      enabled: true, store: failingStore, provider: provider(),
      request: { attemptId: "mysql-reserve-rollback-0001", items: [
        { productId: 4, variantId: 8, size: "M", color: "Preto", quantity: 1 },
        { productId: 4, variantId: 9, size: "G", color: "Preto", quantity: 1 },
      ] },
    })).rejects.toThrow("injected reservation failure");
    expect(await attemptStatus("mysql-reserve-rollback-0001")).toBeNull();
    expect(await readInventory(8)).toMatchObject({ reservedStock: 0 });
    expect(await readInventory(9)).toMatchObject({ reservedStock: 0 });
  });

  it("releases inventory on definitive provider failure but retains it after an ambiguous response", async () => {
    await expect(createStockCheckout({
      enabled: true, store,
      provider: provider(async () => { throw new StockProviderError("synthetic definitive failure", true); }),
      request: checkoutRequest("mysql-provider-definite-0001"),
    })).rejects.toThrow("synthetic definitive failure");
    expect(await attemptStatus("mysql-provider-definite-0001")).toMatchObject({ status: "released" });
    expect(await readInventory(8)).toMatchObject({ reservedStock: 0 });

    const keys: string[] = [];
    const ambiguousProvider = {
      calls: 0,
      supportsIdempotencyKey: true,
      async createPayment(input: { orderId: string; amountCents: number; idempotencyKey: string }) {
        keys.push(input.idempotencyKey);
        if (this.calls++ === 0) throw new Error("synthetic timeout after request write");
        return { paymentId: "synthetic-ambiguous-payment", checkoutUrl: "https://sandbox.invalid/replay" };
      },
    };
    await expect(createStockCheckout({ enabled: true, store, provider: ambiguousProvider, request: checkoutRequest("mysql-provider-ambiguous-0001") }))
      .rejects.toMatchObject({ code: "CHECKOUT_PROVIDER_OUTCOME_UNKNOWN" });
    expect(await readInventory(8)).toMatchObject({ reservedStock: 1 });
    const retry = await createStockCheckout({ enabled: true, store, provider: ambiguousProvider, request: checkoutRequest("mysql-provider-ambiguous-0001") });
    expect(keys[0]).toBe(keys[1]);
    expect(retry.paymentId).toBe("synthetic-ambiguous-payment");
  });

  it("consumes a paid reservation once even when separate confirmation events repeat", async () => {
    const checkout = await createStockCheckout({ enabled: true, store, provider: provider(), request: checkoutRequest("mysql-confirm-twice-0001") });
    for (const eventId of ["mysql-paid-event-1", "mysql-paid-event-2"]) {
      expect(await sendWebhook({
        store, eventId, orderId: checkout.orderId, paymentId: checkout.paymentId, status: "paid",
        amountCents: checkout.amountCents, payload: { id: eventId, payment: checkout.paymentId, status: "paid" },
      })).toBe("processed");
    }
    expect(await attemptStatus("mysql-confirm-twice-0001")).toMatchObject({ status: "paid" });
    expect(await readInventory(8)).toMatchObject({ stock: 0, reservedStock: 0 });
  });

  it("serializes concurrent duplicate deliveries and ignores later out-of-order events", async () => {
    const checkout = await createStockCheckout({ enabled: true, store, provider: provider(), request: checkoutRequest("mysql-webhook-concurrent-0001") });
    const paid = {
      store, eventId: "mysql-webhook-concurrent-event", orderId: checkout.orderId, paymentId: checkout.paymentId,
      status: "paid" as const, amountCents: checkout.amountCents, payload: { id: "mysql-webhook-concurrent-event", status: "paid" },
    };
    const duplicateResults = await Promise.all([sendWebhook(paid), sendWebhook(paid)]);
    expect(duplicateResults.sort()).toEqual(["duplicate", "processed"]);
    expect(await sendWebhook({ ...paid, eventId: "mysql-webhook-late-pending", status: "pending", payload: { id: "mysql-webhook-late-pending", status: "pending" } })).toBe("processed");
    expect(await sendWebhook({ ...paid, eventId: "mysql-webhook-late-failed", status: "failed", payload: { id: "mysql-webhook-late-failed", status: "failed" } })).toBe("conflict");
    expect(await attemptStatus("mysql-webhook-concurrent-0001")).toMatchObject({ status: "paid" });
    expect(await readInventory(8)).toMatchObject({ stock: 0, reservedStock: 0 });
  });

  it("rejects conflicting webhook content for a previously claimed event", async () => {
    const checkout = await createStockCheckout({ enabled: true, store, provider: provider(), request: checkoutRequest("mysql-webhook-conflict-0001") });
    const base = { signatureVerified: true, store, eventId: "mysql-webhook-event-conflict", orderId: checkout.orderId, paymentId: checkout.paymentId, status: "failed" as const, amountCents: checkout.amountCents };
    expect(await sendWebhook({ ...base, payload: { id: base.eventId, status: "failed" } })).toBe("processed");
    expect(await sendWebhook({ ...base, payload: { id: base.eventId, status: "paid" } })).toBe("conflict");
    expect(await attemptStatus("mysql-webhook-conflict-0001")).toMatchObject({ status: "released" });
  });

  it("releases a cancelled payment exactly once", async () => {
    const checkout = await createStockCheckout({ enabled: true, store, provider: provider(), request: checkoutRequest("mysql-cancel-release-0001") });
    const event = { signatureVerified: true, store, eventId: "mysql-cancel-event", orderId: checkout.orderId, paymentId: checkout.paymentId, status: "failed" as const, amountCents: checkout.amountCents, payload: { id: "mysql-cancel-event", status: "cancelled" } };
    expect(await sendWebhook({ ...event, store })).toBe("processed");
    expect(await sendWebhook(event)).toBe("duplicate");
    expect(await attemptStatus("mysql-cancel-release-0001")).toMatchObject({ status: "released" });
    expect(await readInventory(8)).toMatchObject({ stock: 1, reservedStock: 0 });
  });

  it("expires only never-submitted reservations in bounded idempotent batches", async () => {
    await seedReservedAttempt("mysql-expire-never-started-01", 9);
    await seedReservedAttempt("mysql-expire-never-started-02", 9);
    await forceAttemptExpired("mysql-expire-never-started-01");
    await forceAttemptExpired("mysql-expire-never-started-02");

    const first = await expireStockReservations(store, 1);
    expect(first.releasedAttemptIds).toHaveLength(1);
    expect(first.reconciliationAttemptIds).toHaveLength(0);
    expect(await readInventory(9)).toMatchObject({ stock: 2, reservedStock: 1 });
    const second = await expireStockReservations(store, 1);
    expect(second.releasedAttemptIds).toHaveLength(1);
    expect(await readInventory(9)).toMatchObject({ stock: 2, reservedStock: 0 });
    expect(await expireStockReservations(store, 1)).toEqual({ releasedAttemptIds: [], reconciliationAttemptIds: [] });
  });

  it("coordinates simultaneous expiry workers and makes released stock sellable exactly once", async () => {
    await seedReservedAttempt("mysql-expire-workers-stock-sale-01", 8);
    await forceAttemptExpired("mysql-expire-workers-stock-sale-01");
    const [workerA, workerB] = await Promise.all([
      expireStockReservations(store, 10),
      expireStockReservations(store, 10),
    ]);
    expect(workerA.releasedAttemptIds.length + workerB.releasedAttemptIds.length).toBe(1);
    expect(await readInventory(8)).toMatchObject({ stock: 1, reservedStock: 0 });
    const replacement = await createStockCheckout({
      enabled: true, store, provider: provider(), request: checkoutRequest("mysql-expire-workers-new-sale-01", 8),
    });
    expect(replacement.replayed).toBe(false);
    expect(await readInventory(8)).toMatchObject({ stock: 1, reservedStock: 1 });
    await expect(createStockCheckoutDomain({
      enabled: true, ownerUserId: 82, store, provider: provider(), request: checkoutRequest("mysql-expire-workers-oversell-01", 8),
    })).rejects.toMatchObject({ code: "CHECKOUT_STOCK_INSUFFICIENT" });
    expect(await readInventory(8)).toMatchObject({ stock: 1, reservedStock: 1 });
  });

  it("releases this owner's expired unstarted attempt before accepting a replacement cart", async () => {
    await seedReservedAttempt("mysql-owner-expired-attempt-0001", 9);
    await forceAttemptExpired("mysql-owner-expired-attempt-0001");
    const payments = provider();
    const replacement = await createStockCheckout({
      enabled: true, store, provider: payments, request: checkoutRequest("mysql-owner-expired-attempt-0002", 9),
    });
    expect(replacement.replayed).toBe(false);
    expect(await attemptStatus("mysql-owner-expired-attempt-0001")).toMatchObject({ status: "released" });
    expect(await readInventory(9)).toMatchObject({ reservedStock: 1 });
    expect(payments.calls).toHaveLength(1);
  });

  it("keeps an expired provider-created attempt reserved and blocks a duplicate pending reconciliation", async () => {
    const payments = provider();
    await createStockCheckout({
      enabled: true, store, provider: payments, request: checkoutRequest("mysql-owner-uncertain-expiry-0001", 9),
    });
    await forceAttemptExpired("mysql-owner-uncertain-expiry-0001");
    await expect(createStockCheckout({
      enabled: true, store, provider: payments, request: checkoutRequest("mysql-owner-uncertain-expiry-0002", 9),
    })).rejects.toMatchObject({ code: "CHECKOUT_ATTEMPT_NOT_REUSABLE" });
    expect(await attemptStatus("mysql-owner-uncertain-expiry-0001")).toMatchObject({ status: "reserved", providerState: "created" });
    expect(payments.calls).toHaveLength(1);
    expect(await readInventory(9)).toMatchObject({ reservedStock: 1 });
  });

  it("flags creating, ambiguous and provider-pending attempts for reconciliation without releasing stock", async () => {
    await seedReservedAttempt("mysql-expire-ambiguous-0001", 8);
    await seedReservedAttempt("mysql-expire-pending-00001", 9);
    await store.transaction(async tx => {
      expect(await tx.beginProviderAttempt("mysql-expire-ambiguous-0001", true)).toBe(true);
      await tx.markProviderAmbiguous("mysql-expire-ambiguous-0001");
      expect(await tx.beginProviderAttempt("mysql-expire-pending-00001", true)).toBe(true);
      await tx.recordPayment("mysql-expire-pending-00001", "pending-payment-1", null);
    });
    await forceAttemptExpired("mysql-expire-ambiguous-0001");
    await forceAttemptExpired("mysql-expire-pending-00001");

    const result = await expireStockReservations(store, 10);
    expect(result.releasedAttemptIds).toHaveLength(0);
    expect(new Set(result.reconciliationAttemptIds)).toEqual(new Set(["mysql-expire-ambiguous-0001", "mysql-expire-pending-00001"]));
    expect(await readInventory(8)).toMatchObject({ stock: 1, reservedStock: 1 });
    expect(await readInventory(9)).toMatchObject({ stock: 2, reservedStock: 1 });
    expect(await attemptStatus("mysql-expire-ambiguous-0001")).toMatchObject({ status: "reserved", providerState: "ambiguous" });
    expect(await attemptStatus("mysql-expire-pending-00001")).toMatchObject({ status: "reserved", providerState: "created" });
  });

  it("serializes payment confirmation against expiration and never releases a confirmed payment", async () => {
    const orderId = await seedReservedAttempt("mysql-expire-payment-race-001", 8);
    await store.transaction(async tx => {
      expect(await tx.beginProviderAttempt("mysql-expire-payment-race-001", true)).toBe(true);
      await tx.recordPayment("mysql-expire-payment-race-001", "race-payment-1", null);
    });
    await forceAttemptExpired("mysql-expire-payment-race-001");
    const event = {
      signatureVerified: true, store, eventId: "mysql-expire-paid-event", orderId,
      paymentId: "race-payment-1", status: "paid" as const, amountCents: 12900, payload: { id: "mysql-expire-paid-event" },
    };
    const [, webhookResult] = await Promise.all([
      expireStockReservations(store, 10),
      sendWebhook(event),
    ]);
    expect(webhookResult).toBe("processed");
    expect(await attemptStatus("mysql-expire-payment-race-001")).toMatchObject({ status: "paid" });
    expect(await readInventory(8)).toMatchObject({ stock: 0, reservedStock: 0 });
    const [active] = await pool.execute<(Record<string, unknown> & { total: number })[]>(
      "SELECT COUNT(*) AS total FROM stockReservations WHERE attemptId = 'mysql-expire-payment-race-001' AND status = 'active'",
    );
    expect(Number(active[0].total)).toBe(0);
  });

  it("persists and recovers the pre-provider interruption state after a new pool is created", async () => {
    await seedReservedAttempt("mysql-expire-process-restart-01", 8);
    await pool.end();
    pool = createPool({ host, port, user, password, database, connectionLimit: 12, waitForConnections: true, queueLimit: 0 });
    const exclusive = createExclusiveStore(pool);
    store = createMysqlStockCheckoutStore(pool, {
      reservationTtlSeconds: 900,
      reserveExclusiveQuota: (connection, claim) => exclusive.reserveForCheckoutInTransaction(connection, claim),
    });
    await forceAttemptExpired("mysql-expire-process-restart-01");
    const result = await expireStockReservations(store, 1);
    expect(result.releasedAttemptIds).toEqual(["mysql-expire-process-restart-01"]);
    expect(await attemptStatus("mysql-expire-process-restart-01")).toMatchObject({ status: "released", providerState: "not_started" });
    expect(await readInventory(8)).toMatchObject({ stock: 1, reservedStock: 0 });
    await expect(store.transaction(tx => tx.beginProviderAttempt("mysql-expire-process-restart-01", true))).resolves.toBe(false);
  });

  it("verifies a webhook signature before decoding or touching MySQL", async () => {
    let decodeCalls = 0;
    const before = await pool.execute("SELECT COUNT(*) AS total FROM stockWebhookEvents");
    await expect(processSignedStockWebhook({
      rawBody: "synthetic-invalid-signature",
      headers: { "asaas-access-token": "synthetic-invalid" },
      store,
      boundary: {
        verifySignature: async () => false,
        decodeSignedEvent: () => { decodeCalls++; throw new Error("must not decode unverified data"); },
      },
    })).rejects.toMatchObject({ code: "WEBHOOK_SIGNATURE_INVALID" });
    const after = await pool.execute("SELECT COUNT(*) AS total FROM stockWebhookEvents");
    expect(decodeCalls).toBe(0);
    expect(before[0]).toEqual(after[0]);
  });

  it("correlates a signed webhook by order if provider payment persistence was interrupted", async () => {
    const orderId = await seedReservedAttempt("mysql-webhook-recovery-order-01", 8);
    await store.transaction(async tx => {
      expect(await tx.beginProviderAttempt("mysql-webhook-recovery-order-01", true)).toBe(true);
      await tx.markProviderAmbiguous("mysql-webhook-recovery-order-01");
    });
    const event = {
      eventId: "mysql-webhook-recovery-event", orderId,
      paymentId: "recovered-payment-1", status: "paid" as const, amountCents: 12900,
      payload: { id: "mysql-webhook-recovery-event", externalReference: orderId },
    };
    const result = await sendWebhook(event);
    expect(result).toBe("processed");
    expect(await attemptStatus("mysql-webhook-recovery-order-01")).toMatchObject({ status: "paid", paymentId: "recovered-payment-1" });
    expect(await readInventory(8)).toMatchObject({ stock: 0, reservedStock: 0 });
  });

  it("ignores pending events after payment and rejects a later failure without regressing state", async () => {
    const checkout = await createStockCheckout({ enabled: true, store, provider: provider(), request: checkoutRequest("mysql-webhook-ordering-001") });
    const common = { signatureVerified: true, store, orderId: checkout.orderId, paymentId: checkout.paymentId, amountCents: checkout.amountCents };
    expect(await sendWebhook({ ...common, eventId: "mysql-order-paid", status: "paid", payload: { id: "mysql-order-paid" } })).toBe("processed");
    expect(await sendWebhook({ ...common, eventId: "mysql-order-pending-late", status: "pending", payload: { id: "mysql-order-pending-late" } })).toBe("processed");
    expect(await sendWebhook({ ...common, eventId: "mysql-order-failed-late", status: "failed", payload: { id: "mysql-order-failed-late" } })).toBe("conflict");
    expect(await attemptStatus("mysql-webhook-ordering-001")).toMatchObject({ status: "paid" });
    expect(await readInventory(8)).toMatchObject({ stock: 0, reservedStock: 0 });
  });

  it("rolls back payment status and inventory decrement if consumption fails mid-transaction", async () => {
    const checkout = await createStockCheckout({ enabled: true, store, provider: provider(), request: checkoutRequest("mysql-consume-rollback-0001") });
    const failingStore = wrapTransactionFault("consume-after-write");
    const event = { signatureVerified: true, store: failingStore, eventId: "mysql-consume-rollback-event", orderId: checkout.orderId, paymentId: checkout.paymentId, status: "paid" as const, amountCents: checkout.amountCents, payload: { id: "mysql-consume-rollback-event", status: "paid" } };
    await expect(sendWebhook(event)).rejects.toThrow("injected consumption failure");
    expect(await attemptStatus("mysql-consume-rollback-0001")).toMatchObject({ status: "reserved" });
    expect(await readInventory(8)).toMatchObject({ stock: 1, reservedStock: 1 });
    expect(await sendWebhook({ ...event, store })).toBe("processed");
    expect(await readInventory(8)).toMatchObject({ stock: 0, reservedStock: 0 });
  });

  it("replays persisted state after creating a new pool as if the process restarted", async () => {
    const payments = provider();
    const first = await createStockCheckout({ enabled: true, store, provider: payments, request: checkoutRequest("mysql-process-restart-0001") });
    await pool.end();
    pool = createPool({ host, port, user, password, database, connectionLimit: 12, waitForConnections: true, queueLimit: 0 });
    const exclusive = createExclusiveStore(pool);
    store = createMysqlStockCheckoutStore(pool, {
      reservationTtlSeconds: 900,
      reserveExclusiveQuota: (connection, claim) => exclusive.reserveForCheckoutInTransaction(connection, claim),
    });
    const replay = await createStockCheckout({ enabled: true, store, provider: payments, request: checkoutRequest("mysql-process-restart-0001") });
    expect(replay).toMatchObject({ orderId: first.orderId, paymentId: first.paymentId, amountCents: 12900, replayed: true });
    expect(await readInventory(8)).toMatchObject({ stock: 1, reservedStock: 1 });
  });
});
