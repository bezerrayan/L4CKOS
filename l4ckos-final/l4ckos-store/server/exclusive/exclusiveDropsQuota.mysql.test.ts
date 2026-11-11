import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPool, type Pool } from "mysql2/promise";
import express from "express";
import { createServer, type Server } from "node:http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import { drizzle as drizzleMysql } from "drizzle-orm/mysql2";
import superjson from "superjson";
import { appRouter } from "../routers";
import { setStockLocalHarnessDb } from "../db";
import { ENV } from "../_core/env";
import { configureStockCheckoutRuntimeForLocalHarness, createContext } from "../_core/context";
import { sdk } from "../_core/sdk";
import { COOKIE_NAME } from "../../shared/const";
import { createStockCheckoutRuntime } from "../stock/stockCheckoutRuntime";
import { createExclusiveStore } from "./store";
import { configureExclusiveStoreForLocalHarness } from "./runtime";
import { canonicalizeSeedVariants } from "../stock/testing/canonicalizeSeedVariants";

/**
 * Hard quota enforcement of exclusive drops at the transactional STOCK checkout (the cart is only a soft, non-financial guard),
 * including a pre-order product inside a drop. Disposable loopback MySQL 9.7.2 + a simulated payment adapter only; no Asaas.
 * Runs through scripts/run-stock-mysql-tests.sh; skipped otherwise.
 */
const database = process.env.STOCK_MYSQL_DATABASE ?? "";
const host = process.env.STOCK_MYSQL_HOST ?? "";
const port = Number(process.env.STOCK_MYSQL_PORT ?? 0);
const user = process.env.STOCK_MYSQL_USER ?? "";
const password = process.env.STOCK_MYSQL_PASSWORD ?? "";
const delivery = {
  optionId: "local-plano-piloto" as const,
  address: { recipient: "Cliente Sintético", zipCode: "70000000", street: "Rua de Teste", number: "123", neighborhood: "Centro", city: "Brasília", state: "DF" },
};
const BATCH = 70;

let pool: Pool;
let httpServer: Server;
let baseUrl = "";
let providerCalls: Array<{ orderId: string }>;
let sessionTokens: Record<string, string>;
let now: Date;
let stockRuntime: ReturnType<typeof createStockCheckoutRuntime>;
const clock = () => now;

const client = (session: string) =>
  createTRPCProxyClient<typeof appRouter>({
    links: [httpBatchLink({ url: `${baseUrl}/api/trpc`, transformer: superjson, headers: { cookie: `${COOKIE_NAME}=${sessionTokens[session] ?? session}` } })],
  });
const owner = () => client("owner-81");
const other = () => client("other-82");
const third = () => client("third-84");
const admin = () => client("admin-83");
type Session = () => ReturnType<typeof client>;

const appCode = (error: unknown) => {
  const value = error as { data?: { appError?: { code?: string } }; shape?: { data?: { appError?: { code?: string } } } };
  return value?.data?.appError?.code ?? value?.shape?.data?.appError?.code;
};
const caught = async (promise: Promise<unknown>) => promise.then(() => null, e => e);
const count = async (sql: string) => Number(((await pool.query<any[]>(sql))[0] as any[])[0].n);

const TABLES = [
  "exclusiveNotificationOutbox", "exclusiveEvents", "exclusiveRedeemAttempts", "exclusiveGrantUsage", "exclusiveGrants",
  "exclusiveAccessRequests", "exclusiveDropProducts", "exclusiveDrops", "stockWebhookEvents", "stockReservations", "orderItems",
  "stockCheckoutItems", "stockCheckoutAttempts", "orders", "productVariants", "products", "productionBatchProducts", "productionBatches",
  "userAddresses", "users",
];

async function resetDatabase() {
  await pool.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const table of TABLES) await pool.query(`TRUNCATE TABLE ${table}`).catch(() => undefined);
  await pool.query("SET FOREIGN_KEY_CHECKS = 1");
  const adminEmail = ENV.adminEmails[0] ?? "admin@local.dev";
  await pool.execute(
    `INSERT INTO users (id, openId, name, email, role) VALUES (81, 'synthetic-owner-81', 'Um', 'um@example.invalid', 'user'),
       (82, 'synthetic-other-82', 'Dois', 'dois@example.invalid', 'user'), (83, 'synthetic-admin-83', 'Admin', ?, 'admin'),
       (84, 'synthetic-third-84', 'Tres', 'tres@example.invalid', 'user')`,
    [adminEmail],
  );
  await pool.execute(
    `INSERT INTO productionBatches (id, name, status, salesOpenAt, salesCloseAt, estimatedShippingStart, estimatedShippingEnd, estimatedManufacturingStart, estimatedManufacturingEnd, minimumQuantity, maximumQuantity)
       VALUES (?, 'Lote XIV Bis #1', 'OPEN', '2020-01-01 00:00:00', NULL, '2027-02-01 00:00:00', '2027-02-20 00:00:00', '2026-12-10', '2027-01-20', 0, 3)`,
    [BATCH],
  );
  await pool.execute(
    `INSERT INTO products (id, name, category, price, stock, salesMode) VALUES (4, 'Camiseta Clã XIV Bis', 'camisetas', 12900, 0, 'STOCK'),
       (6, 'Camiseta XIV Bis (pré-venda)', 'camisetas', 12900, 0, 'PREORDER')`,
  );
  await pool.execute(
    `INSERT INTO productVariants (id, productId, name, sku, size, color, price, stock, reservedStock, isActive) VALUES
       (8, 4, 'XIV-M', 'XIV-M', 'M', 'Preto', 12900, 20, 0, 1), (9, 4, 'XIV-G', 'XIV-G', 'G', 'Preto', 12900, 20, 0, 1), (10, 4, 'XIV-GG', 'XIV-GG', 'GG', 'Preto', 12900, 20, 0, 1),
       (21, 6, 'PRE-M', 'XIV-PRE-M', 'M', 'Preto', 12900, 0, 0, 1), (22, 6, 'PRE-G', 'XIV-PRE-G', 'G', 'Preto', 12900, 0, 0, 1)`,
  );
  await canonicalizeSeedVariants(pool);
  await pool.execute("INSERT INTO productionBatchProducts (productionBatchId, productId) VALUES (?, 6)", [BATCH]);
}

const createDrop = (productIds: number[]) =>
  admin().exclusiveDrops.admin.saveDrop.mutate({
    slug: "xiv-bis-cla", name: "Clã XIV Bis × L4CKOS", description: "Edição exclusiva", timezone: "America/Sao_Paulo",
    requestStartsAt: "2026-11-01T00:00:00-03:00", requestEndsAt: "2026-11-25T23:59:00-03:00",
    purchaseStartsAt: "2026-11-20T09:00:00-03:00", purchaseEndsAt: "2026-11-30T12:00:00-03:00",
    isPublic: true, requiresAuthorization: true, defaultUnitLimit: 1, status: "published", productIds,
  } as never);

async function unlock(session: Session, unitLimit: number) {
  const request = await session().exclusiveDrops.requestAccess.mutate({ dropId: 1 });
  const approved = await admin().exclusiveDrops.admin.approve.mutate({ requestId: request.requestId, unitLimit, expiresAt: "2026-11-30T12:00:00-03:00" });
  await session().exclusiveDrops.redeemCode.mutate({ code: approved.code });
  return approved;
}

const buy = (session: Session, attemptId: string, variantId: number, quantity = 1, productId = 4) =>
  session().stockCheckout.create.mutate({ attemptId, items: [{ productId, variantId, quantity }], delivery } as never);

const webhook = (orderId: string, paymentId: string, amountCents: number, status: "paid" | "failed", eventId: string) =>
  stockRuntime.receiveWebhook({
    rawBody: "synthetic",
    headers: { "asaas-access-token": "synthetic-local-signature" },
    boundary: {
      verifySignature: async () => true,
      decodeSignedEvent: () => ({ eventId, orderId, paymentId, status, amountCents, payload: { source: "synthetic-test" } }),
    },
  });

/** Nothing observable may exist for a rejected attempt. */
async function expectNoTrace(before: { orders: number; attempts: number; usage: number; calls: number; reserved: number }) {
  expect(await count("SELECT COUNT(*) AS n FROM orders")).toBe(before.orders);
  expect(await count("SELECT COUNT(*) AS n FROM stockCheckoutAttempts")).toBe(before.attempts);
  expect(await count("SELECT COALESCE(SUM(units),0) AS n FROM exclusiveGrantUsage")).toBe(before.usage);
  expect(await count("SELECT COALESCE(SUM(reservedStock),0) AS n FROM productVariants")).toBe(before.reserved);
  expect(providerCalls).toHaveLength(before.calls);
}
const snapshot = async () => ({
  orders: await count("SELECT COUNT(*) AS n FROM orders"),
  attempts: await count("SELECT COUNT(*) AS n FROM stockCheckoutAttempts"),
  usage: await count("SELECT COALESCE(SUM(units),0) AS n FROM exclusiveGrantUsage"),
  reserved: await count("SELECT COALESCE(SUM(reservedStock),0) AS n FROM productVariants"),
  calls: providerCalls.length,
});
const viewer = async (session: Session) => {
  const view = await session().exclusiveDrops.forProduct.query({ productId: 6 });
  return view.exclusive ? view.viewer : null;
};
const batchClaimed = () =>
  count(`SELECT COALESCE(SUM(i.quantity),0) AS n FROM orderItems i JOIN orders o ON o.id=i.orderId WHERE i.productionBatchId = ${BATCH} AND i.salesModeAtPurchase='PREORDER' AND o.status <> 'cancelled'`);

describe.skipIf(!process.env.STOCK_MYSQL_HOST)("Drop quota at the STOCK checkout (MySQL 9.7.2 disposable only)", () => {
  beforeAll(async () => {
    if (!/^(127\.0\.0\.1|localhost|::1)$/.test(host) || database !== "l4ckos_stock_test" || user !== "stock_test" || process.env.STOCK_LOCAL_HARNESS !== "true") {
      throw new Error("STOCK MySQL test identity is not disposable");
    }
    pool = createPool({ host, port, user, password, database, connectionLimit: 12 });
    setStockLocalHarnessDb(drizzleMysql(pool));
    const [identity] = await pool.query<any[]>("SELECT VERSION() AS version, DATABASE() AS dbName");
    if (!String(identity[0]?.version).startsWith("9.7.2") || identity[0]?.dbName !== database) throw new Error("MySQL identity mismatch");
    sessionTokens = {
      "owner-81": await sdk.createSessionToken("synthetic-owner-81", { name: "Um", sessionVersion: 1 }),
      "other-82": await sdk.createSessionToken("synthetic-other-82", { name: "Dois", sessionVersion: 1 }),
      "admin-83": await sdk.createSessionToken("synthetic-admin-83", { name: "Admin", sessionVersion: 1 }),
      "third-84": await sdk.createSessionToken("synthetic-third-84", { name: "Tres", sessionVersion: 1 }),
    };
    stockRuntime = createStockCheckoutRuntime({
      pool,
      exclusiveStore: createExclusiveStore(pool, { now: clock }),
      provider: {
        supportsIdempotencyKey: true,
        async createPayment(input) {
          providerCalls.push(input);
          return { paymentId: `pay-${providerCalls.length}`, checkoutUrl: "https://sandbox.invalid/checkout" };
        },
      },
    });
    configureStockCheckoutRuntimeForLocalHarness(stockRuntime);
    configureExclusiveStoreForLocalHarness(createExclusiveStore(pool, { now: clock }));
    const app = express();
    app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));
    httpServer = createServer(app);
    await new Promise<void>(done => httpServer.listen(0, "127.0.0.1", done));
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("harness did not bind loopback");
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 30_000);

  beforeEach(async () => {
    await resetDatabase();
    providerCalls = [];
    now = new Date("2026-11-20T15:00:00.000Z");
    vi.stubEnv("PUBLIC_SITE_MODE", "store");
    vi.stubEnv("PUBLIC_CHECKOUT_ENABLED", "true");
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    configureExclusiveStoreForLocalHarness(undefined);
    if (pool) {
      await pool.query("SET FOREIGN_KEY_CHECKS = 0");
      for (const table of ["exclusiveNotificationOutbox", "exclusiveEvents", "exclusiveRedeemAttempts", "exclusiveGrantUsage", "exclusiveGrants", "exclusiveAccessRequests", "exclusiveDropProducts", "exclusiveDrops"]) {
        await pool.query(`DROP TABLE IF EXISTS ${table}`);
      }
      await pool.query("SET FOREIGN_KEY_CHECKS = 1");
    }
    configureStockCheckoutRuntimeForLocalHarness(undefined);
    if (httpServer) await new Promise<void>(done => httpServer.close(() => done()));
    if (pool) setStockLocalHarnessDb(null);
    if (pool) await pool.end();
  });

  it("1. quota 1 + two units in one attempt: rejected, and nothing exists afterwards (no order, attempt, payment, reservation or usage)", async () => {
    await createDrop([4]);
    await unlock(owner, 1);
    const before = await snapshot();
    expect(appCode(await caught(buy(owner, "quota-two-units-000001", 8, 2)))).toBe("EXCLUSIVE_QUOTA_EXCEEDED");
    expect(appCode(await caught(owner().stockCheckout.create.mutate({
      attemptId: "quota-two-lines-000001",
      items: [{ productId: 4, variantId: 8, quantity: 1 }, { productId: 4, variantId: 9, quantity: 1 }],
      delivery,
    } as never)))).toBe("EXCLUSIVE_QUOTA_EXCEEDED");
    await expectNoTrace(before);
    expect(await count("SELECT stock AS n FROM productVariants WHERE id = 8")).toBe(20);
  });

  it("2. quota 1 + one unit: accepted once, a payment is created once, the unit is consumed on payment", async () => {
    await createDrop([4]);
    await unlock(owner, 1);
    const created = await buy(owner, "quota-one-unit-0000001", 8, 1);
    expect(created.status).toBe("pending");
    expect(providerCalls).toHaveLength(1);
    expect(await count("SELECT COALESCE(SUM(units),0) AS n FROM exclusiveGrantUsage")).toBe(1);
    await webhook(created.orderId, "pay-1", created.amountCents, "paid", "quota-paid-event-1");
    expect(await count("SELECT COUNT(*) AS n FROM stockCheckoutAttempts WHERE status = 'paid'")).toBe(1);
    const view = await owner().exclusiveDrops.forProduct.query({ productId: 4 });
    expect(view.exclusive && view.viewer).toMatchObject({ unitLimit: 1, unitsConsumed: 1, unitsRemaining: 0 });
  });

  it("3. no authorization (never asked, pending, rejected): rejected before any order or payment", async () => {
    await createDrop([4]);
    const before = await snapshot();
    expect(appCode(await caught(buy(owner, "quota-noaccess-0000001", 8)))).toBe("EXCLUSIVE_ACCESS_REQUIRED");
    const request = await other().exclusiveDrops.requestAccess.mutate({ dropId: 1 });
    expect(appCode(await caught(buy(other, "quota-pending-0000001", 8)))).toBe("EXCLUSIVE_ACCESS_REQUIRED");
    await admin().exclusiveDrops.admin.reject.mutate({ requestId: request.requestId });
    expect(appCode(await caught(buy(other, "quota-rejected-000001", 8)))).toBe("EXCLUSIVE_ACCESS_REQUIRED");
    await expectNoTrace(before);
  });

  it("4. quota exceeded across separate orders (sequential, other size, other attempt id): second order refused, first untouched", async () => {
    await createDrop([4]);
    await unlock(owner, 1);
    const first = await buy(owner, "quota-seq-first-0000001", 8);
    const afterFirst = await snapshot();
    expect(appCode(await caught(buy(owner, "quota-seq-second-000001", 9)))).toBe("EXCLUSIVE_QUOTA_EXCEEDED");
    expect(appCode(await caught(buy(owner, "quota-seq-third-0000001", 10)))).toBe("EXCLUSIVE_QUOTA_EXCEEDED");
    await expectNoTrace(afterFirst);
    await webhook(first.orderId, "pay-1", first.amountCents, "paid", "quota-seq-paid-1");
    expect(appCode(await caught(buy(owner, "quota-seq-after-paid-01", 9)))).toBe("EXCLUSIVE_QUOTA_EXCEEDED"); // paid keeps consuming
    expect(await count("SELECT COUNT(*) AS n FROM orders")).toBe(1);
    expect(providerCalls).toHaveLength(1);
  });

  it("5. concurrent attempts share ONE quota: exactly `quota` succeed, the rest leave no trace", async () => {
    await createDrop([4]);
    await unlock(owner, 2);
    const attempts = Array.from({ length: 8 }, (_, index) =>
      buy(owner, `quota-race-${String(index).padStart(2, "0")}-0000001`, [8, 9, 10][index % 3]));
    const settled = await Promise.allSettled(attempts);
    const fulfilled = settled.filter(r => r.status === "fulfilled");
    for (const r of settled.filter((x): x is PromiseRejectedResult => x.status === "rejected")) {
      expect(["EXCLUSIVE_QUOTA_EXCEEDED", "CHECKOUT_ATTEMPT_NOT_REUSABLE"]).toContain(appCode(r.reason));
    }
    expect(fulfilled).toHaveLength(2);
    expect(await count("SELECT COUNT(*) AS n FROM orders")).toBe(2);
    expect(await count("SELECT COUNT(*) AS n FROM stockCheckoutAttempts")).toBe(2);
    expect(await count("SELECT COALESCE(SUM(units),0) AS n FROM exclusiveGrantUsage")).toBe(2);
    expect(await count("SELECT COALESCE(SUM(reservedStock),0) AS n FROM productVariants")).toBe(2);
    expect(providerCalls).toHaveLength(2);
  });

  it("5b. concurrent attempts by two customers consume their own quotas independently", async () => {
    await createDrop([4]);
    await unlock(owner, 1);
    await unlock(other, 1);
    const settled = await Promise.allSettled([
      buy(owner, "quota-own-a-00000000001", 8), buy(owner, "quota-own-a-00000000002", 9),
      buy(other, "quota-own-b-00000000001", 8), buy(other, "quota-own-b-00000000002", 9),
    ]);
    expect(settled.filter(r => r.status === "fulfilled")).toHaveLength(2);
    expect(await count("SELECT COUNT(DISTINCT grantId) AS n FROM exclusiveGrantUsage")).toBe(2);
    expect(await count("SELECT COALESCE(SUM(units),0) AS n FROM exclusiveGrantUsage")).toBe(2);
  });

  describe("6. a pre-order product inside a drop (batch capacity 3)", () => {
    it("quota and batch capacity are both enforced; rejections consume neither; variant stock is never used", async () => {
      await createDrop([6]);
      await unlock(owner, 1);
      await unlock(other, 2);
      await unlock(third, 1);
      const before = await snapshot();
      expect(appCode(await caught(buy(owner, "pre-quota-two-000000001", 21, 2, 6)))).toBe("EXCLUSIVE_QUOTA_EXCEEDED");
      await expectNoTrace(before);
      expect(await batchClaimed()).toBe(0);

      const a = await buy(owner, "pre-owner-one-00000001", 21, 1, 6);
      expect(a.status).toBe("pending");
      expect(await batchClaimed()).toBe(1);
      expect(appCode(await caught(buy(owner, "pre-owner-two-00000001", 22, 1, 6)))).toBe("EXCLUSIVE_QUOTA_EXCEEDED");
      expect(await batchClaimed()).toBe(1);

      const b = await buy(other, "pre-other-two-00000001", 22, 2, 6); // batch now full (1 + 2 = 3)
      expect(b.status).toBe("pending");
      expect(await batchClaimed()).toBe(3);

      const usageBefore = await count("SELECT COALESCE(SUM(units),0) AS n FROM exclusiveGrantUsage");
      const ordersBefore = await count("SELECT COUNT(*) AS n FROM orders");
      const callsBefore = providerCalls.length;
      expect(appCode(await caught(buy(third, "pre-third-over-0000001", 21, 1, 6)))).toBe("STOCK_UNAVAILABLE"); // authorised, quota free, batch full
      expect(await count("SELECT COALESCE(SUM(units),0) AS n FROM exclusiveGrantUsage")).toBe(usageBefore); // quota NOT consumed by the capacity failure
      expect(await count("SELECT COUNT(*) AS n FROM orders")).toBe(ordersBefore);
      expect(providerCalls).toHaveLength(callsBefore);
      expect(await batchClaimed()).toBe(3);
      expect(await count("SELECT COALESCE(SUM(stock + reservedStock),0) AS n FROM productVariants WHERE productId = 6")).toBe(0); // no fictitious stock
      const view = await third().exclusiveDrops.forProduct.query({ productId: 6 });
      expect(view.exclusive && view.viewer).toMatchObject({ unitsRemaining: 1, unitsReserved: 0 });
    });

    it("a failed payment releases batch capacity exactly once and a paid one keeps both capacity and quota (CURRENT policy: a refused payment keeps the drop quota held)", async () => {
      await createDrop([6]);
      await unlock(owner, 1);
      await unlock(other, 2);
      const a = await buy(owner, "pre-fail-owner-0000001", 21, 1, 6);
      const b = await buy(other, "pre-paid-other-0000001", 22, 2, 6);
      expect(await batchClaimed()).toBe(3);
      await webhook(b.orderId, "pay-2", b.amountCents, "paid", "pre-paid-event-0001");
      await webhook(a.orderId, "pay-1", a.amountCents, "failed", "pre-fail-event-0001");
      await webhook(a.orderId, "pay-1", a.amountCents, "failed", "pre-fail-event-0002"); // second delivery must not release twice
      expect(await batchClaimed()).toBe(2); // capacity: only the paid order remains
      expect(await count("SELECT COALESCE(SUM(stock + reservedStock),0) AS n FROM productVariants WHERE productId = 6")).toBe(0);
      expect(await viewer(other)).toMatchObject({ unitsConsumed: 2, unitsRemaining: 0 }); // paid: consumed
      // KNOWN GAP (backend): the refused attempt is released with providerState 'created', which COUNTED_UNITS_SQL keeps counting.
      expect(await viewer(owner)).toMatchObject({ unitsReserved: 1, unitsRemaining: 0 });
      expect(appCode(await caught(buy(owner, "pre-retry-owner-0000001", 21, 1, 6)))).toBe("EXCLUSIVE_QUOTA_EXCEEDED");
    });

    // Desired behaviour, tracked as a backend gap: a provider-confirmed refusal/cancellation should free the customer's drop quota just as it
    // frees stock and batch capacity. `it.fails` turns green->red when the backend is fixed, prompting to flip this into a normal test.
    it.fails("DESIRED: a refused/cancelled payment frees the customer's drop quota so they can retry", async () => {
      await createDrop([4]);
      await unlock(owner, 1);
      const a = await buy(owner, "gap-refused-owner-000001", 8, 1);
      await webhook(a.orderId, "pay-1", a.amountCents, "failed", "gap-refused-event-0001");
      expect((await buy(owner, "gap-retry-owner-0000001", 9, 1)).status).toBe("pending");
    });

    it("an expired UNSTARTED attempt frees quota and capacity; a provider-created one stays held until reconciliation", async () => {
      await createDrop([6]);
      await unlock(owner, 1);
      await unlock(other, 1);
      await buy(owner, "pre-sweep-owner-0000001", 21, 1, 6);
      await buy(other, "pre-sweep-other-0000001", 22, 1, 6);
      await pool.query("UPDATE stockCheckoutAttempts SET providerState = 'not_started', paymentId = NULL, checkoutUrl = NULL WHERE attemptId = 'pre-sweep-owner-0000001'");
      await pool.query("UPDATE stockCheckoutAttempts SET reservationExpiresAt = '2026-01-01 00:00:00.000'");
      const swept = await stockRuntime.expireReservations(50);
      expect(swept.releasedAttemptIds).toContain("pre-sweep-owner-0000001");
      expect(swept.releasedAttemptIds).not.toContain("pre-sweep-other-0000001");
      expect(swept.reconciliationAttemptIds).toContain("pre-sweep-other-0000001");
      expect(await batchClaimed()).toBe(1);
      expect(await viewer(owner)).toMatchObject({ unitsReserved: 0, unitsRemaining: 1 });
      expect(await viewer(other)).toMatchObject({ unitsReserved: 1, unitsRemaining: 0 });
    });
  });
});
