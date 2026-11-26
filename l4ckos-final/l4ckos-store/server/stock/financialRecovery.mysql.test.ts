import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPool, type Pool } from "mysql2/promise";
import { sql } from "drizzle-orm";
import express from "express";
import { createServer, type Server } from "node:http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import { drizzle as drizzleMysql } from "drizzle-orm/mysql2";
import superjson from "superjson";
import { appRouter } from "../routers";
import { getOrderById, getOrderByIdAndUser, setStockLocalHarnessDb, updateOrderAndReserveDeliveredEmailEvents } from "../db";
import { ENV } from "../_core/env";
import { configureStockCheckoutRuntimeForLocalHarness, createContext } from "../_core/context";
import { asaasWebhookHandler, createAsaasWebhookHandler, processWebhookEnvelope } from "../controllers/paymentController";
import { attestAuthenticatedIngress } from "../payments/ingressProvenance";
import { sdk } from "../_core/sdk";
import { COOKIE_NAME } from "../../shared/const";
import { createStockCheckoutRuntime } from "./stockCheckoutRuntime";
import { createExclusiveStore } from "../exclusive/store";
import { configureExclusiveStoreForLocalHarness } from "../exclusive/runtime";
import { createStockCheckout, processSignedStockWebhook, type StockCheckoutStore } from "./stockCheckout";
import { createMysqlStockCheckoutStore } from "./mysqlStockCheckoutStore";
import { inWebhookTransaction } from "../database/webhookTransaction";
import { createAsaasStockWebhookBoundary } from "./asaasStockWebhookBoundary";
import { canonicalizeSeedVariants } from "./testing/canonicalizeSeedVariants";
import { checkout as legacyCheckout } from "../database/checkout";
import paymentRoutes from "../routes/paymentRoutes";
import shippingRoutes from "../routes/shippingRoutes";

const database = process.env.STOCK_MYSQL_DATABASE ?? "";
const host = process.env.STOCK_MYSQL_HOST ?? "";
const port = Number(process.env.STOCK_MYSQL_PORT ?? 0);

// Simulated Asaas "current state" endpoint. Never touches the network; the real getAsaasPayment is replaced.
const simulatedProviderPayments = new Map<string, Record<string, unknown>>();
const simulatedProviderOrderIds = new Map<string, string>();
const simulatedProviderReferences = new Map<string, string>();
const unavailableProviderPaymentIds = new Set<string>();
let simulatedProviderCalls: string[] = [];
let providerObservedOpenTransactions: number[] = [];
vi.mock("../services/asaasService", async importOriginal => {
  const original = await importOriginal<typeof import("../services/asaasService")>();
  return {
    ...original,
    getAsaasPayment: vi.fn(async (paymentId: string) => {
      simulatedProviderCalls.push(paymentId);
      if (observerPool) {
        const [rows] = await observerPool.query<any[]>(
          "SELECT COUNT(*) AS n FROM information_schema.innodb_trx WHERE trx_mysql_thread_id <> CONNECTION_ID()",
        );
        providerObservedOpenTransactions.push(Number(rows[0]?.n ?? 0));
      }
      const payment = simulatedProviderPayments.get(paymentId);
      if (!payment || unavailableProviderPaymentIds.has(paymentId)) throw new Error("SIMULATED_PROVIDER_UNAVAILABLE");
      return payment;
    }),
  };
});
const user = process.env.STOCK_MYSQL_USER ?? "";
const password = process.env.STOCK_MYSQL_PASSWORD ?? "";
const syntheticWebhookToken = "synthetic-stock-webhook-token-only";
const syntheticGateEnvKeys = [
  "NODE_ENV",
  "RAILWAY_PROJECT_ID",
  "RAILWAY_ENVIRONMENT_ID",
  "RAILWAY_SERVICE_ID",
  "STAGING_SYNTHETIC_BUYER_GATE_ENABLED",
  "STAGING_SYNTHETIC_BUYER_IDS",
] as const;
const originalSyntheticGateEnv = Object.fromEntries(syntheticGateEnvKeys.map(key => [key, process.env[key]]));
const syntheticAdminEmail = ENV.adminEmails[0] ?? "admin@local.dev";
const syntheticDelivery = {
  optionId: "local-plano-piloto" as const,
  address: {
    recipient: "Cliente Sintético",
    zipCode: "70000000",
    street: "Rua de Teste",
    number: "123",
    complement: "Apto 4",
    neighborhood: "Centro",
    city: "Brasília",
    state: "DF",
  },
};

function assertSyntheticTarget() {
  if (!/^(127\.0\.0\.1|localhost|::1)$/.test(host)) throw new Error("STOCK_MYSQL_HOST must be loopback");
  if (database !== "l4ckos_stock_test" || user !== "stock_test" || process.env.STOCK_LOCAL_HARNESS !== "true") throw new Error("STOCK MySQL test identity is not disposable");
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !password) throw new Error("Missing local synthetic MySQL connection parameters");
}

let pool: Pool;
let observerPool: Pool | undefined;
let httpServer: Server;
let baseUrl = "";
let runtime: ReturnType<typeof createStockCheckoutRuntime>;
const SHIPPING_SECRET = "synthetic-shipping-signing-secret-at-least-32-bytes";
let shippingQuoteCalls: Array<{ cep: string; itemCount: number; subtotal: number }> = [];
let shippingQuoteResult: { options: Array<{ id: string; label: string; description: string; price: number; minDays: number | null; maxDays: number | null }>; source: "melhor-envio" | "fallback-local" | "mixed" | "unavailable" } = { options: [], source: "unavailable" };
const fakeShippingQuote = async (input: { cep: string; itemCount: number; subtotal: number }) => { shippingQuoteCalls.push(input); return shippingQuoteResult; };
// Like the real provider, a repeated idempotency key returns the SAME payment; distinct keys get distinct payments.
const paymentIds = new Map<string, string>();
const paymentIdFor = (key: string) => { if (!paymentIds.has(key)) paymentIds.set(key, `pay-synthetic-${paymentIds.size + 1}`); return paymentIds.get(key)!; };
let providerCalls: Array<{ orderId: string; amountCents: number; idempotencyKey: string }>;
let sessionTokens: Record<string, string>;

function httpClient(session: string, endpoint = "/api/trpc") {
  return createTRPCProxyClient<typeof stockCheckoutRouter>({
    links: [httpBatchLink({
      url: `${baseUrl}${endpoint}`,
      transformer: superjson,
      headers: { cookie: `${COOKIE_NAME}=${sessionTokens?.[session] ?? session}` },
    })],
  });
}

function adminHttpClient(session: string) {
  return createTRPCProxyClient<typeof appRouter>({
    links: [httpBatchLink({
      url: `${baseUrl}/api/trpc`,
      transformer: superjson,
      headers: { cookie: `${COOKIE_NAME}=${sessionTokens?.[session] ?? session}` },
    })],
  });
}

async function readVariantInventory(variantId: number) {
  const [rows] = await pool.query<(Record<string, unknown> & { stock: number; reservedStock: number })[]>(
    "SELECT stock, reservedStock FROM productVariants WHERE id = ?", [variantId],
  );
  return rows[0];
}

async function resetDatabase() {
  await pool.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const table of ["notificationOutbox", "payments", "auditLogs", "stockWebhookEvents", "stockReservations", "orderItems", "stockCheckoutItems", "stockCheckoutAttempts", "orders", "productVariants", "products", "userAddresses", "users"]) {
    await pool.query("TRUNCATE TABLE " + table);
  }
  await pool.query("SET FOREIGN_KEY_CHECKS = 1");
  await pool.execute("INSERT INTO users (id, openId, name, email, role) VALUES (81, 'synthetic-owner-81', 'STOCK Customer', 'stock-customer@example.invalid', 'user'), (82, 'synthetic-other-82', 'Other Customer', 'other-customer@example.invalid', 'user'), (83, 'synthetic-admin-83', 'Synthetic Admin', ?, 'admin')", [syntheticAdminEmail]);
  await pool.execute("INSERT INTO userAddresses (userId, label, recipient, zipCode, street, number, complement, neighborhood, city, state, isDefault) VALUES (81, 'Principal', 'Perfil Original', '70000000', 'Rua Original', '10', NULL, 'Centro', 'Brasília', 'DF', 1)");
  await pool.execute("INSERT INTO products (id, name, category, price, stock) VALUES (4, 'Synthetic STOCK shirt', 'camisetas', 12900, 0)");
  await pool.execute("INSERT INTO productVariants (id, productId, name, sku, size, color, price, stock, reservedStock, isActive) VALUES (8, 4, 'TSHIRT-BLK-M', 'TSHIRT-BLK-M', 'M', 'Preto', 12900, 1, 0, 1)");
  await canonicalizeSeedVariants(pool);
}

describe.skipIf(!process.env.STOCK_MYSQL_HOST)("FINANCIAL RECOVERY P1-P5 (MySQL 9.7.2 disposable only)", () => {
  beforeAll(async () => {
    assertSyntheticTarget();
    pool = createPool({ host, port, user, password, database, connectionLimit: 8 });
    if (process.env.STOCK_ROOT_PASSWORD) {
      observerPool = createPool({ host, port, user: "root", password: process.env.STOCK_ROOT_PASSWORD, database, connectionLimit: 1 });
    }
    setStockLocalHarnessDb(drizzleMysql(pool));
    const [identity] = await pool.query<(Record<string, unknown> & { version: string; dbName: string; currentUser: string })[]>(
      "SELECT VERSION() AS version, DATABASE() AS dbName, CURRENT_USER() AS currentUser",
    );
    if (!String(identity[0]?.version).startsWith("9.7.2") || identity[0]?.dbName !== database || !String(identity[0]?.currentUser).startsWith("stock_test@")) {
      throw new Error("MySQL identity/version did not match the disposable test target");
    }
    const [existingSchema] = await pool.execute<(Record<string, unknown> & { tableCount: number })[]>(
      "SELECT COUNT(*) AS tableCount FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'products'",
    );
    if (Number(existingSchema[0]?.tableCount) === 0) {
      const schema = await readFile(resolve("server/stock/fixtures/mysql8-stock-schema.sql"), "utf8");
      for (const statement of schema.split(";").map(part => part.trim()).filter(Boolean)) await pool.query(statement);
    }
    // The integrated checkout consults the exclusive-drops guard, so the (isolated, unapplied) 0028 candidate must exist in the disposable DB.
    const exclusiveMigration = await readFile(resolve("database/migrations/exclusive-drops-v1/0028_exclusive_drops_candidate.sql"), "utf8");
    for (const statement of exclusiveMigration.split(";").map(part => part.trim()).filter(part => /CREATE TABLE/.test(part))) await pool.query(statement).catch(error => { if ((error as { errno?: number }).errno !== 1050) throw error; });
    configureExclusiveStoreForLocalHarness(createExclusiveStore(pool));
    sessionTokens = {
      "owner-81": await sdk.createSessionToken("synthetic-owner-81", { name: "STOCK Customer", sessionVersion: 1 }),
      "other-82": await sdk.createSessionToken("synthetic-other-82", { name: "Other Customer", sessionVersion: 1 }),
      "admin-83": await sdk.createSessionToken("synthetic-admin-83", { name: "Synthetic Admin", sessionVersion: 1 }),
    };
    runtime = createStockCheckoutRuntime({
      pool,
      cardCheckoutEnabled: true,
      exclusiveStore: createExclusiveStore(pool),
      shipping: { secret: SHIPPING_SECRET, quote: fakeShippingQuote },
      provider: {
        supportsIdempotencyKey: true,
        async createPayment(input) {
          providerCalls.push(input);
          // unique per call (a sync push+length), so concurrent attempts never collide on the payment unique key
          const paymentId = paymentIdFor(input.idempotencyKey);
          const [ownerRows] = await pool.query<any[]>("SELECT userId FROM orders WHERE id=?", [input.orderId]);
          const customerId = `cus-synthetic-${Number(ownerRows[0]?.userId ?? 0)}`;
          const externalReference = input.externalReference ?? input.orderId;
          simulatedProviderPayments.set(paymentId, {
            id: paymentId, externalReference, status: "PENDING", value: input.amountCents / 100,
            currency: "BRL", customer: customerId, billingType: "PIX", deleted: false,
          });
          simulatedProviderOrderIds.set(paymentId, input.orderId);
          simulatedProviderReferences.set(paymentId, externalReference);
          return { paymentId, customerId, checkoutUrl: "https://sandbox.invalid/synthetic-checkout" };
        },
      },
    });
    configureStockCheckoutRuntimeForLocalHarness(runtime);
    const app = express();
    app.use("/api/trpc", createExpressMiddleware({
      router: appRouter,
      createContext,
    }));
    app.use("/api/trpc-runtime-absent", createExpressMiddleware({
      router: appRouter,
      createContext: async options => ({ ...await createContext(options), stockCheckoutRuntime: undefined }),
    }));
    app.use(express.json({ limit: "64kb" }));
    app.use("/api/payments", paymentRoutes);
    app.use("/api/shipping", shippingRoutes);
    app.post("/webhook/asaas", asaasWebhookHandler);
    app.post("/webhook-asaas-runtime-absent", createAsaasWebhookHandler(() => undefined));
    httpServer = createServer(app);
    await new Promise<void>(resolveListen => httpServer.listen(0, "127.0.0.1", resolveListen));
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("Synthetic HTTP harness did not bind TCP loopback");
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 30_000);

  beforeEach(async () => {
    await resetDatabase();
    simulatedProviderPayments.clear();
    simulatedProviderOrderIds.clear();
    simulatedProviderReferences.clear();
    unavailableProviderPaymentIds.clear();
    simulatedProviderCalls = [];
    providerObservedOpenTransactions = [];
    providerCalls = [];
    paymentIds.clear();
    vi.stubEnv("PUBLIC_SITE_MODE", "store");
    vi.stubEnv("PUBLIC_CHECKOUT_ENABLED", "true");
    vi.stubEnv("ASAAS_WEBHOOK_TOKEN", syntheticWebhookToken);
    vi.stubEnv("ASAAS_WEBHOOK_ACCOUNT_ID", "account-financial-recovery-synthetic");
    vi.stubEnv("ASAAS_WEBHOOK_ACCOUNT_CURRENCY", "BRL");
  });

  // ---------------------------------------------------------------- financial-recovery helpers
  const post = async (body: unknown, token = syntheticWebhookToken) => { const t0 = Date.now(); const dbg = process.env.STOCK_ROOT_PASSWORD && process.env.FR_DEBUG_LOCKS ? setTimeout(async () => { try { const root = await createPool({ host, port, user: "root", password: process.env.STOCK_ROOT_PASSWORD, database, connectionLimit: 1 }); const [w] = await root.query<any[]>("SELECT r.trx_mysql_thread_id waiting_thread, r.trx_query waiting_query, b.trx_mysql_thread_id blocking_thread, b.trx_query blocking_query, b.trx_state blocking_state, TIMESTAMPDIFF(SECOND,b.trx_started,NOW()) blocking_age FROM performance_schema.data_lock_waits w JOIN information_schema.innodb_trx r ON r.trx_id=w.REQUESTING_ENGINE_TRANSACTION_ID JOIN information_schema.innodb_trx b ON b.trx_id=w.BLOCKING_ENGINE_TRANSACTION_ID"); const [l] = await root.query<any[]>("SELECT thread_id, object_name, index_name, lock_type, lock_mode, lock_status, lock_data FROM performance_schema.data_locks WHERE object_schema=DATABASE() ORDER BY thread_id"); const [pl] = await root.query<any[]>("SELECT id, command, time, state, LEFT(info,120) info FROM information_schema.processlist WHERE db=DATABASE()"); console.log("LOCKDEBUG " + JSON.stringify({ waits: w, locks: l.slice(0, 40), processlist: pl })); await root.end(); } catch (e) { console.log("LOCKDEBUG-ERR " + (e as Error).message); } }, 8000) : undefined; const r = await post0(body, token); if (dbg) clearTimeout(dbg); console.log(`TIMING ${(body as any).event} ${(body as any).id} ${Date.now() - t0}ms status=${r.status}`); return r; };
  const post0 = (body: unknown, token = syntheticWebhookToken) => {
    const event = body as { event?: string; payment?: { id?: string } };
    if (event.event === "PAYMENT_RECEIVED" && typeof event.payment?.id === "string") {
      const current = simulatedProviderPayments.get(event.payment.id);
      if (current) current.status = "RECEIVED";
    }
    return fetch(`${baseUrl}/webhook/asaas`, {
    method: "POST", headers: { "content-type": "application/json", "asaas-access-token": token }, body: JSON.stringify(body),
    }).then(async r => ({ status: r.status, body: await r.json().catch(() => null) as Record<string, unknown> | null }));
  };
  const hook = (id: string, event: string, status: string, orderId: string | number, paymentId: string, extra: Record<string, unknown> = {}) =>
    ({ id, event, account: { id: "account-financial-recovery-synthetic" }, payment: {
      id: paymentId,
      externalReference: simulatedProviderOrderIds.get(paymentId) === String(orderId)
        ? simulatedProviderReferences.get(paymentId) ?? String(orderId)
        : String(orderId),
      status, value: 129, currency: "BRL", billingType: "PIX", ...extra,
    } });
  const ev = (label: string, value: unknown) => console.log(`EVIDENCE ${label} ${JSON.stringify(value)}`);
  const create = async (attemptId: string, session = "owner-81") => {
    const created = await httpClient(session).stockCheckout.create.mutate({ attemptId, items: [{ productId: 4, variantId: 8, quantity: 1 }], delivery: syntheticDelivery });
    const [a] = (await pool.execute<any[]>("SELECT paymentId FROM stockCheckoutAttempts WHERE attemptId=?", [attemptId]))[0];
    return { orderId: String(created.orderId), paymentId: String(a.paymentId), attemptId };
  };
  it.each([2, 8, 10])("does not exhaust a %i-connection pool when webhook transactions enter STOCK", async connectionLimit => {
    const attemptCount = connectionLimit + 1;
    await pool.execute("UPDATE productVariants SET stock=?, reservedStock=0 WHERE id=8", [attemptCount]);
    const stockStore = createMysqlStockCheckoutStore(pool);
    const variant = await stockStore.transaction(tx => tx.findVariant(8));
    if (!variant) throw new Error("synthetic variant missing");
    const attempts: Array<{ attemptId: string; orderId: string; paymentId: string }> = [];
    for (let index = 0; index < attemptCount; index += 1) {
      const attemptId = `pool-cycle-${connectionLimit}-${String(index).padStart(3, "0")}`;
      const paymentId = `pool-pay-${connectionLimit}-${String(index).padStart(3, "0")}`;
      const snapshot = { id: variant.id, productId: variant.productId, sku: variant.sku, size: variant.size, color: variant.color,
        unitPriceCents: variant.unitPriceCents, quantity: 1, totalCents: variant.unitPriceCents };
      const orderId = await stockStore.transaction(async tx => {
        const id = await tx.createAttempt({ attemptId, ownerUserId: 81, fingerprint: String(index).padStart(64, "0"),
          orderId: "ignored-by-mysql-store", status: "reserved", providerState: "not_started", snapshots: [snapshot], amountCents: 12900 });
        if (!await tx.reserveVariant(8, 1, attemptId)) throw new Error("synthetic reservation failed");
        if (!await tx.beginProviderAttempt(attemptId, false)) throw new Error("synthetic provider start failed");
        await tx.recordPayment(attemptId, paymentId, "https://sandbox.invalid/checkout");
        return id;
      });
      attempts.push({ attemptId, orderId, paymentId });
    }
    const userIds = Array.from({ length: connectionLimit * 2 }, (_, index) => 1000 + connectionLimit * 20 + index);
    for (const id of userIds) await pool.execute("INSERT INTO users(id,openId,name,email,role) VALUES(?,?,?,?,'user')", [id, `pool-cycle-${connectionLimit}-${id}`, "Synthetic", `pool-${id}@example.invalid`]);

    const smallPool = createPool({ host, port, user, password, database, connectionLimit, waitForConnections: true });
    const smallDb = drizzleMysql(smallPool);
    const smallRuntime = createStockCheckoutRuntime({
      pool: smallPool,
      provider: { supportsIdempotencyKey: true, async createPayment() { throw new Error("PROVIDER_NOT_USED_BY_WEBHOOK"); } },
    });
    const callbackPool = (smallPool as unknown as { pool: { _allConnections: { length: number }; _connectionQueue: { length: number } } }).pool;
    let poolCycleFailure = false;
    const deliverConcurrently = async (events: Array<{ eventId: string; orderId: string; paymentId: string }>, users: number[]) => {
      let arrivals = 0;
      let openGate!: () => void;
      let allAtGate!: () => void;
      const gate = new Promise<void>(resolve => { openGate = resolve; });
      const allReady = new Promise<void>(resolve => { allAtGate = resolve; });
      const bounded = async <T>(promise: Promise<T>, code: string): Promise<T> => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(code)), 5000); })]);
        } finally { if (timer) clearTimeout(timer); }
      };
      const tasks = events.map((event, index) => smallDb.transaction(tx => inWebhookTransaction(tx as any, async () => {
        await tx.execute(sql`SELECT id FROM users WHERE id=${users[index]} FOR UPDATE`);
        arrivals += 1;
        if (arrivals === connectionLimit) allAtGate();
        await gate;
        return smallRuntime.receiveWebhook({
          rawBody: JSON.stringify({ id: event.eventId, event: "PAYMENT_RECEIVED", payment: {
            id: event.paymentId, externalReference: event.orderId, status: "RECEIVED", value: 129, currency: "BRL",
          } }),
          headers: { "asaas-access-token": syntheticWebhookToken }, boundary: createAsaasStockWebhookBoundary(),
        });
      }, [])));
      let timedOut = false;
      try {
        await bounded(allReady, "POOL_BARRIER_TIMEOUT");
        expect(callbackPool._allConnections.length).toBe(connectionLimit);
        openGate();
        let results: unknown[];
        try { results = await bounded(Promise.all(tasks), "POOL_CYCLE_TIMEOUT"); }
        catch (error) { timedOut = error instanceof Error && error.message === "POOL_CYCLE_TIMEOUT"; throw error; }
        return results;
      } catch (error) {
        poolCycleFailure = true;
        console.log(`POOL_EVIDENCE limit=${connectionLimit} timedOut=${timedOut} waiters=${callbackPool._connectionQueue.length} arrivals=${arrivals}`);
        const connections = (callbackPool as any)._allConnections.toArray() as Array<{ destroy(): void }>;
        connections.forEach(connection => connection.destroy());
        (callbackPool as any).end(() => undefined);
        throw error;
      } finally {
        openGate();
      }
    };

    try {
      const distinct = await deliverConcurrently(
        attempts.slice(0, connectionLimit).map((attempt, index) => ({ ...attempt, eventId: `pool-distinct-${connectionLimit}-${index}` })),
        userIds.slice(0, connectionLimit),
      );
      expect(distinct).toHaveLength(connectionLimit);
      expect(distinct.every(result => result === "processed")).toBe(true);
      const repeated = Array.from({ length: connectionLimit }, () => ({ ...attempts[connectionLimit], eventId: `pool-duplicate-${connectionLimit}` }));
      const duplicates = await deliverConcurrently(repeated, userIds.slice(connectionLimit));
      expect(duplicates.filter(result => result === "processed")).toHaveLength(1);
      expect(duplicates.filter(result => result === "duplicate")).toHaveLength(connectionLimit - 1);
      expect(await readVariantInventory(8)).toMatchObject({ stock: 0, reservedStock: 0 });
      const [paid] = (await pool.query<any[]>("SELECT COUNT(*) AS n FROM stockCheckoutAttempts WHERE status='paid'"))[0];
      expect(Number(paid.n)).toBe(attemptCount);
      expect(callbackPool._connectionQueue.length).toBe(0);
      const probe = await smallPool.getConnection();
      try { await probe.query("SELECT 1"); } finally { probe.release(); }
    } finally {
      if (!poolCycleFailure) await smallPool.end();
      await pool.execute("DELETE FROM users WHERE id>=? AND id<?", [1000 + connectionLimit * 20, 1000 + connectionLimit * 20 + connectionLimit * 2]);
    }
  }, 30000);
  const expireNow = async (attemptId: string) => {
    await pool.execute("UPDATE stockCheckoutAttempts SET reservationExpiresAt = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE attemptId = ?", [attemptId]);
    await pool.execute("UPDATE stockReservations SET expiresAt = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE attemptId = ? AND status = 'active'", [attemptId]);
    return createMysqlStockCheckoutStore(pool).transaction(tx => tx.expireDueReservations(20));
  };
  const trunc = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === "string" && v.length > 60 ? v.slice(0, 60) + "…" : v instanceof Date ? "<date>" : v]));
  async function snap(attemptId: string, orderId?: string) {
    const q = async (sql: string, p: unknown[] = []) => (await pool.execute<any[]>(sql, p))[0];
    const [attempt] = await q("SELECT status, providerState, paymentId, expiryReviewedAt IS NOT NULL AS expiryReviewed, reconciliationRequiredAt IS NOT NULL AS reconRequired FROM stockCheckoutAttempts WHERE attemptId=?", [attemptId]);
    const reservations = (await q("SELECT status FROM stockReservations WHERE attemptId=? ORDER BY id", [attemptId])).map(r => r.status);
    const [variant] = await q("SELECT stock, reservedStock FROM productVariants WHERE id=8");
    const [order] = orderId ? await q("SELECT status, paymentStatus FROM orders WHERE id=?", [orderId]) : [undefined];
    const ledger = (await q("SELECT eventId FROM stockWebhookEvents ORDER BY 1")).map(r => r.eventId);
    const audit = (await q("SELECT event FROM auditLogs WHERE action='stock.reconciliation.required' ORDER BY id")).map(r => r.event);
    return { attempt: attempt && { ...attempt, expiryReviewed: Number(attempt.expiryReviewed), reconRequired: Number(attempt.reconRequired) }, reservations, variant: { stock: Number(variant.stock), reserved: Number(variant.reservedStock) }, order, ledger, audit };
  }
  async function inbox() {
    try { return (await pool.query<any[]>("SELECT * FROM asaasWebhookInbox ORDER BY 1"))[0].map(trunc); } catch (e) { return `inbox-unreadable:${(e as Error).message}`; }
  }
  async function reconciliationAlert(eventId: string) {
    const [rows] = await pool.query<any[]>(`SELECT status,payload FROM notificationOutbox
      WHERE type='financial-reconciliation-alert-v1' AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.providerEventId'))=?`, [eventId]);
    return rows as Array<{ status: string; payload: string }>;
  }

  // ---------------------------------------------------------------- P1
  it("P1 PAYMENT_OVERDUE on a STOCK order: observed response, ledger/inbox, and no state change", async () => {
    const c = await create("fr-p1-overdue-0000001");
    const before = await snap(c.attemptId, c.orderId);
    const first = await post(hook("evt-p1-overdue-1", "PAYMENT_OVERDUE", "OVERDUE", c.orderId, c.paymentId));
    const second = await post(hook("evt-p1-overdue-1", "PAYMENT_OVERDUE", "OVERDUE", c.orderId, c.paymentId));
    const after = await snap(c.attemptId, c.orderId);
    const [audit] = await pool.execute<any[]>("SELECT action, entity, metadata FROM auditLogs WHERE action='payment.stock_overdue_observation.v1'");
    ev("P1.before", before); ev("P1.first", first); ev("P1.second(redelivery)", second); ev("P1.after", after); ev("P1.inbox", await inbox()); ev("P1.audit", audit);
    expect(first.status).toBe(200);
    expect(second.body).toMatchObject({ handled: false, reason: "duplicate_event" });
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0].metadata)).toMatchObject({ eventId: "evt-p1-overdue-1", event: "PAYMENT_OVERDUE", financialMutation: false, stockMutation: false, reconciliationRequired: true });
    expect({ ...after, ledger: before.ledger, audit: before.audit }).toEqual(before);   // no financial/stock/order effect
    expect(after.variant).toEqual({ stock: 1, reserved: 1 });
    expect(after.attempt).toMatchObject({ status: "reserved", providerState: "created" });
  });

  it("P1b PAYMENT_OVERDUE must be acknowledged as a non-financial observation (no retry loop, no state change)", async () => {
    const c = await create("fr-p1b-overdue-000001");
    const before = await snap(c.attemptId, c.orderId);
    const first = await post(hook("evt-p1b-overdue-1", "PAYMENT_OVERDUE", "OVERDUE", c.orderId, c.paymentId));
    const after = await snap(c.attemptId, c.orderId);
    ev("P1b", { first, after });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ handled: false, reason: "stock_overdue_observed", reconciliationRequired: true });
    expect(after).toEqual(before);
  });

  // ---------------------------------------------------------------- P2
  it("P2a payment AFTER TTL while the reservation is retained: accepted once, never double-debited", async () => {
    const c = await create("fr-p2a-late-paid-00001");
    const expiry = await expireNow(c.attemptId);
    expect(expiry).toEqual({ releasedAttemptIds: [], reconciliationAttemptIds: [c.attemptId] });
    const held = await snap(c.attemptId, c.orderId);
    ev("P2a.held-after-ttl", held);
    expect(held.variant).toEqual({ stock: 1, reserved: 1 });
    expect(held.reservations).toEqual(["active"]);
    const paid = await post(hook("evt-p2a-received", "PAYMENT_RECEIVED", "RECEIVED", c.orderId, c.paymentId));
    const dupSame = await post(hook("evt-p2a-received", "PAYMENT_RECEIVED", "RECEIVED", c.orderId, c.paymentId));
    const confirmedAfter = await post(hook("evt-p2a-confirmed", "PAYMENT_CONFIRMED", "CONFIRMED", c.orderId, c.paymentId));
    const overdueRecv = await post(hook("evt-p2a-overdue-recv", "PAYMENT_OVERDUE_RECEIVED", "RECEIVED", c.orderId, c.paymentId));
    const after = await snap(c.attemptId, c.orderId);
    ev("P2a", { paid, dupSame, confirmedAfter, overdueRecv, after });
    expect(paid.status).toBe(200); expect(paid.body).toMatchObject({ handled: true });
    expect(dupSame.body).toMatchObject({ reason: "duplicate_event" });
    expect(after.variant).toEqual({ stock: 0, reserved: 0 });           // exactly one unit debited
    expect(after.attempt).toMatchObject({ status: "paid" });
    expect(after.order).toMatchObject({ status: "paid", paymentStatus: "confirmed" });
    expect(after.reservations).toEqual(["consumed"]);
    expect(after.audit).toEqual([]);
  });

  it("P2b payment AFTER effective release: recorded as divergence, no consumption, no negative stock, no automatic refund/reactivation", async () => {
    const c = await create("fr-p2b-paid-after-rel-1");
    const refused = await post(hook("evt-p2b-refused", "PAYMENT_REFUSED", "REFUSED", c.orderId, c.paymentId));
    const released = await snap(c.attemptId, c.orderId);
    expect(released.variant).toEqual({ stock: 1, reserved: 0 });
    const concurrentLate = await Promise.all([
      post(hook("evt-p2b-late-received", "PAYMENT_RECEIVED", "RECEIVED", c.orderId, c.paymentId)),
      post(hook("evt-p2b-late-received-2", "PAYMENT_CONFIRMED", "CONFIRMED", c.orderId, c.paymentId)),
      post(hook("evt-p2b-late-received-3", "PAYMENT_OVERDUE_RECEIVED", "RECEIVED", c.orderId, c.paymentId)),
    ]);
    const late = concurrentLate[0];
    const lateDup = await post(hook("evt-p2b-late-received", "PAYMENT_RECEIVED", "RECEIVED", c.orderId, c.paymentId));
    const after = await snap(c.attemptId, c.orderId);
    ev("P2b", { refused, released, concurrentLate, lateDup, after });
    expect(concurrentLate.every(result => result.status === 200 && result.body?.reason === "stock_event_conflict")).toBe(true);
    expect(late).toMatchObject({ status: 200, body: { handled: false, reason: "stock_event_conflict" } });
    expect(after.variant).toEqual({ stock: 1, reserved: 0 });
    expect(after.order).toMatchObject({ status: "cancelled", paymentStatus: "unconfirmed" });   // money received, order stays cancelled
    expect(after.audit).toEqual(["PAID_AFTER_TERMINAL_FAILURE"]);                                      // exactly one open divergence (correlation-deduplicated)
  });

  // ---------------------------------------------------------------- P3
  it("P3 legacy cancellation of a STOCK order: what changes, what stays retained, and the later payment", async () => {
    const c = await create("fr-p3-legacy-cancel-001");
    const before = await snap(c.attemptId, c.orderId);
    await expect(adminHttpClient("admin-83").admin.orderUpdate.mutate({ orderId: Number(c.orderId), status: "cancelled" }))
      .rejects.toMatchObject({ data: { code: "CONFLICT" } });                                  // router guard
    const guarded = await snap(c.attemptId, c.orderId);
    expect(guarded).toEqual(before);
    let direct: unknown;
    try { direct = await updateOrderAndReserveDeliveredEmailEvents(Number(c.orderId), { status: "cancelled" }, 83); } catch (e) { direct = `THROWS:${(e as Error).message}`; }
    const afterCancel = await snap(c.attemptId, c.orderId);
    ev("P3.direct-db-call-result", typeof direct === "string" ? direct : "ok"); ev("P3.before", before); ev("P3.afterCancel", afterCancel);
    // Leak check: counter vs sum of active reservations.
    const [leak] = (await pool.query<any[]>(`SELECT v.id, v.reservedStock, COALESCE(SUM(r.quantity),0) AS activeSum FROM productVariants v LEFT JOIN stockReservations r ON r.variantId=v.id AND r.status='active' GROUP BY v.id HAVING v.reservedStock <> activeSum`))[0];
    ev("P3.leak-query", leak);
    // Can another buyer take the unit?
    const retry = await httpClient("other-82").stockCheckout.create.mutate({ attemptId: "fr-p3-other-buyer-0001", items: [{ productId: 4, variantId: 8, quantity: 1 }], delivery: syntheticDelivery }).then(r => ({ ok: true, r }), e => ({ ok: false, code: e?.data?.appError?.code ?? e?.data?.code }));
    ev("P3.second-buyer", retry);
    // Charge still payable at the provider: the payment arrives.
    const late = await post(hook("evt-p3-received", "PAYMENT_RECEIVED", "RECEIVED", c.orderId, c.paymentId));
    const afterPay = await snap(c.attemptId, c.orderId);
    ev("P3.latePay", late); ev("P3.afterPay", afterPay);
    expect(typeof direct).toBe("object");
  });

  // ---------------------------------------------------------------- P4
  it("P4-RED PAYMENT_DELETED while the provider's CURRENT state is restored/active must not release the unit", async () => {
    const c = await create("fr-p4-deleted-restored-1");
    simulatedProviderPayments.set(c.paymentId, { ...simulatedProviderPayments.get(c.paymentId), status: "PENDING", deleted: false });
    simulatedProviderCalls = [];
    providerObservedOpenTransactions = [];
    const del = await post(hook("evt-p4-deleted", "PAYMENT_DELETED", "DELETED", c.orderId, c.paymentId, { deleted: true }));
    const after = await snap(c.attemptId, c.orderId);
    ev("P4.red", { del, providerCalls: simulatedProviderCalls.length, after });
    expect(simulatedProviderCalls.length).toBeGreaterThan(0);             // current state was re-queried
    expect(providerObservedOpenTransactions).toEqual([0]);                 // provider I/O ran before any inbox transaction held locks
    expect(after.variant).toEqual({ stock: 1, reserved: 1 });             // still retained
    expect(after.attempt).toMatchObject({ status: "reserved" });
  });

  it("P4 ambiguous current provider binding keeps the reservation and records reconciliation", async () => {
    const c = await create("fr-p4-deleted-mismatch-01");
    simulatedProviderPayments.set(c.paymentId, { ...simulatedProviderPayments.get(c.paymentId), externalReference: "999999", status: "DELETED", deleted: true });
    const del = await post(hook("evt-p4-deleted-mismatch", "PAYMENT_DELETED", "DELETED", c.orderId, c.paymentId, { deleted: true }));
    const after = await snap(c.attemptId, c.orderId);
    const [audit] = await pool.execute<any[]>("SELECT metadata FROM auditLogs WHERE action='payment.stock_deleted_reconciliation.v1'");
    ev("P4.binding-ambiguous", { del, after, audit });
    expect(del.body).toMatchObject({ handled: false, reason: "stock_failure_not_confirmed", reconciliationRequired: true });
    expect(after.variant).toEqual({ stock: 1, reserved: 1 });
    expect(after.attempt).toMatchObject({ status: "reserved" });
    expect(JSON.parse(audit[0].metadata)).toMatchObject({ reason: "PROVIDER_BINDING_AMBIGUOUS", reconciliationRequired: true });
  });

  it("P4-GREEN PAYMENT_DELETED confirmed by the provider's current state still releases exactly once", async () => {
    const c = await create("fr-p4-deleted-confirmed1");
    simulatedProviderPayments.set(c.paymentId, { ...simulatedProviderPayments.get(c.paymentId), status: "DELETED", deleted: true });
    const del = await post(hook("evt-p4-del-ok", "PAYMENT_DELETED", "DELETED", c.orderId, c.paymentId, { deleted: true }));
    const dup = await post(hook("evt-p4-del-ok", "PAYMENT_DELETED", "DELETED", c.orderId, c.paymentId, { deleted: true }));
    const after = await snap(c.attemptId, c.orderId);
    ev("P4.green-legit", { del, dup, after });
    expect(after.variant).toEqual({ stock: 1, reserved: 0 });
    expect(after.attempt).toMatchObject({ status: "released", providerState: "definitive_failure" });
    expect(after.order).toMatchObject({ status: "cancelled" });
  });

  it("P4-provider-unavailable PAYMENT_DELETED fails closed and retryable (never releases blind)", async () => {
    const c = await create("fr-p4-deleted-unavail-01");
    unavailableProviderPaymentIds.add(c.paymentId);
    const del = await post(hook("evt-p4-del-unavail", "PAYMENT_DELETED", "DELETED", c.orderId, c.paymentId, { deleted: true }));
    const after = await snap(c.attemptId, c.orderId);
    ev("P4.unavailable", { del, after });
    expect(del.status).toBeGreaterThanOrEqual(500);
    expect(after.variant).toEqual({ stock: 1, reserved: 1 });
    const rows = await inbox();
    expect(rows.find((row: any) => row.eventId === "evt-p4-del-unavail")).toMatchObject({ state: "failed", errorCode: "PAYMENT_CURRENT_STATE_UNAVAILABLE" });
  });

  // ---------------------------------------------------------------- P4-CARD
  // Real Asaas PAYMENT_DELETED envelope for a hosted-card charge: no payment.currency, provider keeps status PENDING with deleted=true.
  const createCard = async (attemptId: string, session = "owner-81") => {
    const created = await httpClient(session).stockCheckout.create.mutate({ attemptId, paymentMethod: "CARD", items: [{ productId: 4, variantId: 8, quantity: 1 }], delivery: syntheticDelivery });
    const [a] = (await pool.execute<any[]>("SELECT paymentId FROM stockCheckoutAttempts WHERE attemptId=?", [attemptId]))[0];
    const paymentId = String(a.paymentId);
    simulatedProviderPayments.set(paymentId, { ...simulatedProviderPayments.get(paymentId), billingType: "CREDIT_CARD" });
    return { orderId: String(created.orderId), paymentId, attemptId };
  };
  const cardHook = (id: string, event: string, status: string, c: { orderId: string; paymentId: string }, extra: Record<string, unknown> = {}) =>
    hook(id, event, status, c.orderId, c.paymentId, { billingType: "CREDIT_CARD", currency: undefined, ...extra });
  const providerDeleted = (c: { paymentId: string }, over: Record<string, unknown> = {}) =>
    simulatedProviderPayments.set(c.paymentId, { ...simulatedProviderPayments.get(c.paymentId), status: "PENDING", deleted: true, ...over });

  it("P4-CARD deletion confirmed unpaid releases exactly once; duplicate and re-delivered events never change stock again", async () => {
    const c = await createCard("fr-p4card-deleted-ok-001");
    providerDeleted(c);
    const del = await post(cardHook("evt-p4card-del", "PAYMENT_DELETED", "PENDING", c, { deleted: true }));
    const afterDelete = await snap(c.attemptId, c.orderId);
    const dup = await post(cardHook("evt-p4card-del", "PAYMENT_DELETED", "PENDING", c, { deleted: true }));
    const redelivered = await post(cardHook("evt-p4card-del-2", "PAYMENT_DELETED", "PENDING", c, { deleted: true }));
    const afterReplays = await snap(c.attemptId, c.orderId);
    ev("P4card.green", { del, dup, redelivered, afterDelete, afterReplays });
    expect(del.status).toBe(200);
    expect(afterDelete.variant).toEqual({ stock: 1, reserved: 0 });
    expect(afterDelete.attempt).toMatchObject({ status: "released", providerState: "definitive_failure" });
    expect(afterDelete.reservations).toEqual(["released"]);
    expect(afterDelete.order).toMatchObject({ status: "cancelled" });
    expect(afterReplays.variant).toEqual(afterDelete.variant);
    expect(afterReplays.attempt).toEqual(afterDelete.attempt);
    expect(afterReplays.reservations).toEqual(afterDelete.reservations);
    expect(afterReplays.order).toEqual(afterDelete.order);
  });

  it("P4-CARD an already paid card order is preserved when a DELETED event arrives", async () => {
    const c = await createCard("fr-p4card-paid-first-001");
    simulatedProviderPayments.set(c.paymentId, { ...simulatedProviderPayments.get(c.paymentId), status: "CONFIRMED", confirmedDate: "2026-11-26" });
    const paid = await post(cardHook("evt-p4card-paid", "PAYMENT_CONFIRMED", "CONFIRMED", c));
    const afterPaid = await snap(c.attemptId, c.orderId);
    simulatedProviderPayments.set(c.paymentId, { ...simulatedProviderPayments.get(c.paymentId), deleted: true });
    const del = await post(cardHook("evt-p4card-paid-del", "PAYMENT_DELETED", "CONFIRMED", c, { deleted: true }));
    const afterDelete = await snap(c.attemptId, c.orderId);
    ev("P4card.paid-preserved", { paid, del, afterPaid, afterDelete });
    expect(afterPaid.order).toMatchObject({ status: "paid", paymentStatus: "confirmed" });
    expect(afterPaid.reservations).toEqual(["consumed"]);
    expect(afterDelete.order).toMatchObject({ status: "paid", paymentStatus: "confirmed" });
    expect(afterDelete.reservations).toEqual(["consumed"]);
    expect(afterDelete.variant).toEqual(afterPaid.variant);
    expect(afterDelete.attempt).toMatchObject({ status: "paid" });
  });

  it.each([
    ["risk analysis / authorization in progress", { status: "AWAITING_RISK_ANALYSIS" }],
    ["a payment date is already present", { status: "PENDING", paymentDate: "2026-11-26" }],
    ["a confirmation date is already present", { status: "PENDING", confirmedDate: "2026-11-26" }],
    ["a refund is recorded", { status: "PENDING", refunds: [{ id: "ref-1" }] }],
    ["the provider did not mark the charge as deleted", { status: "PENDING", deleted: false }],
  ] as const)("P4-CARD ambiguous provider state keeps the reservation and records reconciliation: %s", async (_label, over) => {
    const slug = String(_label).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    const c = await createCard(`fr-p4card-ambig-${slug}`);
    providerDeleted(c, over as Record<string, unknown>);
    const id = `evt-p4card-ambig-${slug}`;
    const del = await post(cardHook(id, "PAYMENT_DELETED", "PENDING", c, { deleted: true }));
    const after = await snap(c.attemptId, c.orderId);
    ev("P4card.ambiguous", { label: _label, del, after });
    expect(del.body).toMatchObject({ handled: false, reconciliationRequired: true });
    expect(after.variant).toEqual({ stock: 1, reserved: 1 });
    expect(after.attempt).toMatchObject({ status: "reserved", providerState: "created" });
    expect(after.reservations).toEqual(["active"]);
    expect(after.order).toMatchObject({ status: "pending" });
  });

  it("P4-CARD provider read failure fails closed and retryable; a later authenticated redelivery of the same event then reconciles once", async () => {
    const c = await createCard("fr-p4card-provider-fail-1");
    providerDeleted(c);
    unavailableProviderPaymentIds.add(c.paymentId);
    const id = "evt-p4card-unavail";
    const failed = await post(cardHook(id, "PAYMENT_DELETED", "PENDING", c, { deleted: true }));
    const whileDown = await snap(c.attemptId, c.orderId);
    expect(failed.status).toBeGreaterThanOrEqual(500);
    expect(whileDown.variant).toEqual({ stock: 1, reserved: 1 });
    expect((await inbox() as any[]).find((row: any) => row.eventId === id)).toMatchObject({ state: "failed", errorCode: "PAYMENT_CURRENT_STATE_UNAVAILABLE" });
    unavailableProviderPaymentIds.delete(c.paymentId);
    const retried = await post(cardHook(id, "PAYMENT_DELETED", "PENDING", c, { deleted: true }));
    const released = await snap(c.attemptId, c.orderId);
    const again = await post(cardHook(id, "PAYMENT_DELETED", "PENDING", c, { deleted: true }));
    const afterAgain = await snap(c.attemptId, c.orderId);
    ev("P4card.provider-retry", { failed, retried, again, whileDown, released });
    expect(retried.status).toBe(200);
    expect(released.variant).toEqual({ stock: 1, reserved: 0 });
    expect(released.order).toMatchObject({ status: "cancelled" });
    expect(afterAgain.variant).toEqual(released.variant);
    expect(afterAgain.attempt).toEqual(released.attempt);
  });

  it("P4-CARD a late confirmation after the deletion cannot consume stock or reopen the order", async () => {
    const c = await createCard("fr-p4card-late-confirm-01");
    providerDeleted(c);
    await post(cardHook("evt-p4card-late-del", "PAYMENT_DELETED", "PENDING", c, { deleted: true }));
    const released = await snap(c.attemptId, c.orderId);
    simulatedProviderPayments.set(c.paymentId, { ...simulatedProviderPayments.get(c.paymentId), status: "CONFIRMED", confirmedDate: "2026-11-26", deleted: false });
    const late = await post(cardHook("evt-p4card-late-confirm", "PAYMENT_CONFIRMED", "CONFIRMED", c));
    const after = await snap(c.attemptId, c.orderId);
    ev("P4card.late-confirm", { late, released, after });
    expect(released.variant).toEqual({ stock: 1, reserved: 0 });
    expect(after.variant).toEqual({ stock: 1, reserved: 0 });
    expect(after.reservations).toEqual(["released"]);
    expect(after.order).toMatchObject({ status: "cancelled" });
    expect(after.attempt).toMatchObject({ status: "released", providerState: "definitive_failure" });
  });

  it("P4-CARD concurrent deletion and confirmation deliveries never double-apply: stock is never consumed and never negative", async () => {
    const c = await createCard("fr-p4card-concurrent-001");
    providerDeleted(c);
    const [del, confirm] = await Promise.all([
      post(cardHook("evt-p4card-conc-del", "PAYMENT_DELETED", "PENDING", c, { deleted: true })),
      post(cardHook("evt-p4card-conc-confirm", "PAYMENT_CONFIRMED", "CONFIRMED", c)),
    ]);
    const after = await snap(c.attemptId, c.orderId);
    ev("P4card.concurrent", { del, confirm, after });
    expect(after.variant.stock).toBeGreaterThanOrEqual(0);
    expect(after.variant.reserved).toBeGreaterThanOrEqual(0);
    expect(after.order?.status).not.toBe("paid");
    expect(after.reservations).not.toContain("consumed");
    expect(after.variant).toEqual({ stock: 1, reserved: 0 });
  });

  it("P4-CARD a card refusal while the charge is still payable keeps the reservation", async () => {
    const c = await createCard("fr-p4card-refused-payable");
    simulatedProviderPayments.set(c.paymentId, { ...simulatedProviderPayments.get(c.paymentId), status: "PENDING", deleted: false });
    const refused = await post(cardHook("evt-p4card-refused", "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED", "PENDING", c));
    const after = await snap(c.attemptId, c.orderId);
    ev("P4card.refused-payable", { refused, after });
    expect(after.variant).toEqual({ stock: 1, reserved: 1 });
    expect(after.attempt).toMatchObject({ status: "reserved", providerState: "created" });
    expect(after.reservations).toEqual(["active"]);
    expect(after.order).toMatchObject({ status: "pending" });
  });

  it("P4-CARD-SWITCH a NEW card attempt is rejected by the real MySQL store before any write while the switch is off; PIX is unaffected", async () => {
    // Same composition the runtime uses (exclusive-drops quota guard), so PIX can run through it.
    const exclusive = createExclusiveStore(pool);
    const store = createMysqlStockCheckoutStore(pool, { reserveExclusiveQuota: (connection, claim) => exclusive.reserveForCheckoutInTransaction(connection, claim) });
    const createPayment = vi.fn(async () => ({ paymentId: "must-not-exist", checkoutUrl: "https://sandbox.invalid/never" }));
    const spy = { supportsIdempotencyKey: true, createPayment };
    const card = { attemptId: "fr-card-switch-off-000001", paymentMethod: "CARD", items: [{ productId: 4, variantId: 8, quantity: 1 }], delivery: syntheticDelivery };
    await expect(createStockCheckout({ enabled: true, store, provider: spy, request: card, ownerUserId: 81 }))
      .rejects.toMatchObject({ code: "CHECKOUT_CARD_DISABLED" });
    const [[attempts]] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM stockCheckoutAttempts");
    const [[orders]] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM orders");
    const [[variant]] = await pool.query<any[]>("SELECT stock, reservedStock FROM productVariants WHERE id=8");
    ev("P4card.switch-off", { attempts: Number(attempts.n), orders: Number(orders.n), variant, providerCalls: createPayment.mock.calls.length });
    expect(Number(attempts.n)).toBe(0);
    expect(Number(orders.n)).toBe(0);
    expect({ stock: Number(variant.stock), reserved: Number(variant.reservedStock) }).toEqual({ stock: 1, reserved: 0 });
    expect(createPayment).not.toHaveBeenCalled();
    // PIX through the same store and the same flags is not interrupted (and does call the provider).
    const pix = await createStockCheckout({ enabled: true, store, provider: spy, request: { ...card, attemptId: "fr-pix-switch-off-0000001", paymentMethod: "PIX" }, ownerUserId: 81 });
    expect(pix).toMatchObject({ replayed: false });
  });

  it("P4-oversell-chain DELETED(released) → unit resold → late RECEIVED of the first charge: stock never negative, divergence open", async () => {
    const a = await create("fr-p4-chain-first-00001");
    simulatedProviderPayments.set(a.paymentId, { ...simulatedProviderPayments.get(a.paymentId), status: "DELETED", deleted: true });
    await post(hook("evt-p4c-del", "PAYMENT_DELETED", "DELETED", a.orderId, a.paymentId, { deleted: true }));
    const b = await create("fr-p4-chain-second-0001", "other-82");
    const bPaid = await post(hook("evt-p4c-b-paid", "PAYMENT_RECEIVED", "RECEIVED", b.orderId, b.paymentId));
    const aLate = await post(hook("evt-p4c-a-paid", "PAYMENT_RECEIVED", "RECEIVED", a.orderId, a.paymentId));
    const sa = await snap(a.attemptId, a.orderId); const sb = await snap(b.attemptId, b.orderId);
    const lateAlert = await reconciliationAlert("evt-p4c-a-paid");
    ev("P4.chain", { bPaid, aLate, lateAlert, a: sa, b: sb });
    expect(sb.order).toMatchObject({ status: "paid" });
    expect(sa.order).toMatchObject({ status: "cancelled" });
    expect(sb.variant).toEqual({ stock: 0, reserved: 0 });                 // single unit, sold once
    expect(aLate.body).toMatchObject({ handled: false, reason: "payment_reconciliation_required", reconciliationRequired: true });
    expect(lateAlert).toHaveLength(1);                                     // the deleted charge is not reactivated; the late event is durably escalated
    expect(JSON.parse(lateAlert[0]!.payload)).toMatchObject({ providerEventId: "evt-p4c-a-paid", financialMutation: false, stockMutation: false });
  });

  // ---------------------------------------------------------------- P5
  it("P5 paid amount, external reference and currency mismatches cannot confirm an order", async () => {
    const a = await create("fr-p5-binding-mismatch-a1");
    await pool.execute("UPDATE productVariants SET stock = 2 WHERE id = 8");
    const b = await create("fr-p5-binding-mismatch-b1", "other-82");
    const wrongAmount = await post(hook("evt-p5-wrong-amount", "PAYMENT_RECEIVED", "RECEIVED", a.orderId, a.paymentId, { value: 128 }));
    const wrongReference = await post(hook("evt-p5-wrong-reference", "PAYMENT_RECEIVED", "RECEIVED", b.orderId, a.paymentId));
    const wrongCurrency = await post(hook("evt-p5-wrong-currency", "PAYMENT_RECEIVED", "RECEIVED", a.orderId, a.paymentId, { currency: "USD" }));
    const sa = await snap(a.attemptId, a.orderId); const sb = await snap(b.attemptId, b.orderId);
    ev("P5.binding-mismatches", { wrongAmount, wrongReference, wrongCurrency, a: sa, b: sb });
    expect(wrongAmount.body).toMatchObject({ handled: false, reason: "payment_reconciliation_required", reconciliationRequired: true, financialMutation: false, stockMutation: false });
    expect(wrongReference.body).toMatchObject({ handled: false, reason: "payment_reconciliation_required", reconciliationRequired: true, financialMutation: false, stockMutation: false });
    expect(wrongCurrency).toMatchObject({ status: 200, body: { reconciliationRequired: true, financialMutation: false, stockMutation: false } });
    const currencyAlerts = (await pool.query<any[]>(`SELECT payload,status FROM notificationOutbox
      WHERE type='financial-reconciliation-alert-v1' AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.providerEventId'))='evt-p5-wrong-currency'`))[0];
    expect(currencyAlerts).toHaveLength(1);
    expect(JSON.parse(currencyAlerts[0].payload)).toMatchObject({ kind: "ASAAS_WEBHOOK_FINANCIAL_EXCEPTION",
      providerEventId: "evt-p5-wrong-currency", reason: "WEBHOOK_CURRENCY_MISMATCH", financialMutation: false, stockMutation: false });
    for (const eventId of ["evt-p5-wrong-amount", "evt-p5-wrong-reference"]) {
      const alert = await reconciliationAlert(eventId);
      expect(alert).toHaveLength(1);
      expect(alert[0]!.status).toBe("pending");
      expect(JSON.parse(alert[0]!.payload)).toMatchObject({ providerEventId: eventId, financialMutation: false, stockMutation: false });
    }
    expect((await post(hook("evt-p5-wrong-currency", "PAYMENT_RECEIVED", "RECEIVED", a.orderId, a.paymentId, { currency: "USD" }))).status).toBe(200);
    expect((await pool.query<any[]>(`SELECT id FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1'
      AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.providerEventId'))='evt-p5-wrong-currency'`))[0]).toHaveLength(1);
    expect(sa.order).toMatchObject({ status: "pending", paymentStatus: "unconfirmed" });
    expect(sb.order).toMatchObject({ status: "pending", paymentStatus: "unconfirmed" });
  });

  it("P5 reconciliation queries detect expired-unresolved attempts, counter leaks and open divergences", async () => {
    const q = async (sql: string) => (await pool.query<any[]>(sql))[0];
    const expired = `SELECT attemptId, orderId, status, providerState, paymentId, expiryReviewedAt IS NOT NULL AS reviewed, reconciliationRequiredAt IS NOT NULL AS recon FROM stockCheckoutAttempts WHERE status='reserved' AND reservationExpiresAt <= UTC_TIMESTAMP(3)`;
    const leak = `SELECT v.id, v.reservedStock, COALESCE(SUM(r.quantity),0) AS activeSum FROM productVariants v LEFT JOIN stockReservations r ON r.variantId=v.id AND r.status='active' GROUP BY v.id HAVING v.reservedStock <> COALESCE(SUM(r.quantity),0)`;
    const diverg = `SELECT id, orderId, event, correlationId FROM auditLogs WHERE action='stock.reconciliation.required' ORDER BY id`;
    expect(await q(expired)).toEqual([]); expect(await q(leak)).toEqual([]); expect(await q(diverg)).toEqual([]);
    const a = await create("fr-p5-recon-expired-001");
    await expireNow(a.attemptId);
    const e1 = await q(expired);
    expect(e1).toHaveLength(1); expect(e1[0]).toMatchObject({ attemptId: a.attemptId, providerState: "created", reviewed: 1, recon: 1 });
    expect(await q(leak)).toEqual([]);                                     // legitimate retention is not a leak
    await pool.execute("UPDATE productVariants SET stock = 5, reservedStock = 3 WHERE id = 8");   // synthetic counter leak
    const l1 = await q(leak); expect(l1).toHaveLength(1); expect(l1[0]).toMatchObject({ id: 8, reservedStock: 3 }); expect(Number(l1[0].activeSum)).toBe(1);
    await pool.execute("UPDATE productVariants SET stock = 1, reservedStock = 1 WHERE id = 8");
    await post(hook("evt-p5-ref", "PAYMENT_REFUSED", "REFUSED", a.orderId, a.paymentId));
    await post(hook("evt-p5-late", "PAYMENT_RECEIVED", "RECEIVED", a.orderId, a.paymentId));
    const d = await q(diverg); expect(d).toHaveLength(1); expect(d[0]).toMatchObject({ event: "PAID_AFTER_TERMINAL_FAILURE", orderId: Number(a.orderId) });
    ev("P5.queries", { expired: e1, leak: l1, divergence: d });
  });

  it("P5 restore: AUTO_INCREMENT rolls back, orderId/externalReference is REUSED; late old charge cannot bind to a normal new attempt", async () => {
    let reusedKey = 0;
    const conn = await pool.getConnection();
    try {
      await conn.query("SET SESSION information_schema_stats_expiry = 0");
      const e = await create("fr-p5-reuse-old-000001");                    // created AFTER the backup; charge pay-… exists at the provider
      const tBackup = Number(e.orderId); reusedKey = tBackup;                                   // the dump (taken just before) recorded AUTO_INCREMENT = this value
      // --- simulate restoring the dump: rows after T_backup vanish, counter returns to the dumped value ---------------
      await conn.query("SET FOREIGN_KEY_CHECKS=0");
      for (const t of ["stockReservations", "orderItems", "stockCheckoutItems", "stockCheckoutAttempts", "payments"]) await conn.query(`DELETE FROM ${t}`);
      await conn.query("DELETE FROM orders"); await conn.query("DELETE FROM stockWebhookEvents");
      await conn.query("UPDATE productVariants SET reservedStock = 0 WHERE id = 8");
      await conn.query(`ALTER TABLE orders AUTO_INCREMENT = ${tBackup}`);
      await conn.query("SET FOREIGN_KEY_CHECKS=1");
    } finally { conn.release(); }
    paymentIds.set(`stock:${reusedKey}`, "pay-synthetic-NEW-77");
    const reused = await create("fr-p5-reuse-new-000001", "other-82");     // a DIFFERENT customer, new order, new charge
    const oldPaymentId = "pay-synthetic-1";
    expect(reused.paymentId).not.toBe(oldPaymentId);
    ev("P5.reuse", { reusedOrderId: reused.orderId, newPayment: reused.paymentId });
    const late = await post(hook("evt-p5-old-charge", "PAYMENT_RECEIVED", "RECEIVED", reused.orderId, oldPaymentId));
    const s = await snap(reused.attemptId, reused.orderId);
    const unknownReferenceAudit = (await pool.query<any[]>("SELECT metadata FROM auditLogs WHERE action='payment.stock_reference_unknown.v1' AND metadata LIKE ?", ["%evt-p5-old-charge%"]))[0];
    const unknownReferenceAlert = await reconciliationAlert("evt-p5-old-charge");
    ev("P5.old-charge-vs-normal-new-attempt", { late, unknownReferenceAudit, unknownReferenceAlert, s });
    expect(late.body).toMatchObject({ handled: false, reason: "stock_event_conflict", reconciliationRequired: true });
    expect(s.order).toMatchObject({ status: "pending" });
    expect(unknownReferenceAudit).toHaveLength(1);
    expect(JSON.parse(unknownReferenceAudit[0].metadata)).toMatchObject({ eventId: "evt-p5-old-charge", paymentId: oldPaymentId, reconciliationRequired: true, financialMutation: false, stockMutation: false });
    expect(unknownReferenceAlert).toHaveLength(1);
    expect(JSON.parse(unknownReferenceAlert[0]!.payload)).toMatchObject({ providerEventId: "evt-p5-old-charge", reason: "STRONG_REFERENCE_UNKNOWN", financialMutation: false, stockMutation: false });
  });

  it("P5 binding blocks an old charge when the restored attempt has no persisted paymentId and records a divergence", async () => {
    const e = await create("fr-p5h-old-0000000001");
    const old = { orderId: e.orderId, paymentId: e.paymentId };
    const tBackup = Number(old.orderId);
    await pool.query("SET FOREIGN_KEY_CHECKS=0");
    for (const t of ["stockReservations", "orderItems", "stockCheckoutItems", "stockCheckoutAttempts", "payments", "orders", "stockWebhookEvents"]) await pool.query(`DELETE FROM ${t}`);
    await pool.query("UPDATE productVariants SET reservedStock = 0 WHERE id = 8");
    await pool.query(`ALTER TABLE orders AUTO_INCREMENT = ${tBackup}`);
    await pool.query("SET FOREIGN_KEY_CHECKS=1");
    paymentIds.set(`stock:${old.orderId}`, "pay-synthetic-NEW-88");
    const n = await create("fr-p5h-new-0000000001", "other-82");
    expect(n.orderId).toBe(old.orderId);                                     // ID reuse
    // The new attempt crashed after sending its create call: ambiguous, no persisted paymentId (a legitimate state).
    await pool.execute("UPDATE stockCheckoutAttempts SET providerState='ambiguous', paymentId=NULL WHERE attemptId=?", [n.attemptId]);
    await pool.execute("UPDATE orders SET stockPaymentId=NULL WHERE id=?", [n.orderId]);   // crash before BOTH correlations were persisted
    const late = await post(hook("evt-p5h-old-charge", "PAYMENT_RECEIVED", "RECEIVED", n.orderId, old.paymentId));
    const s = await snap(n.attemptId, n.orderId);
    const unknownReferenceAudit = (await pool.query<any[]>("SELECT metadata FROM auditLogs WHERE action='payment.stock_reference_unknown.v1' AND metadata LIKE ?", ["%evt-p5h-old-charge%"]))[0];
    const unknownReferenceAlert = await reconciliationAlert("evt-p5h-old-charge");
    ev("P5.hazard", { late, unknownReferenceAudit, unknownReferenceAlert, s });
    expect(late.status).toBe(200);
    expect(late.body).toMatchObject({ handled: false, reason: "stock_event_conflict", reconciliationRequired: true });
    expect(s.order).toMatchObject({ status: "pending", paymentStatus: "unconfirmed" });
    expect(s.attempt).toMatchObject({ status: "reserved", paymentId: null });
    expect(s.variant).toEqual({ stock: 1, reserved: 1 });
    expect(unknownReferenceAudit).toHaveLength(1);
    expect(unknownReferenceAlert).toHaveLength(1);
  });

  it("P5 does not adopt even the legitimate payment when the ambiguous attempt has no persisted paymentId", async () => {
    const c = await create("fr-p5h-legit-unbound-000001");
    await pool.execute("UPDATE stockCheckoutAttempts SET providerState='ambiguous', paymentId=NULL WHERE attemptId=?", [c.attemptId]);
    await pool.execute("UPDATE orders SET stockPaymentId=NULL WHERE id=?", [c.orderId]);
    const event = await post(hook("evt-p5h-legit-unbound", "PAYMENT_RECEIVED", "RECEIVED", c.orderId, c.paymentId));
    const after = await snap(c.attemptId, c.orderId);
    ev("P5.legitimate-but-unbound", { event, after });
    expect(event).toMatchObject({ status: 200, body: { handled: false, reason: "stock_event_conflict" } });
    expect(after.order).toMatchObject({ status: "pending", paymentStatus: "unconfirmed" });
    expect(after.attempt).toMatchObject({ status: "reserved", providerState: "ambiguous", paymentId: null });
    expect(after.reservations).toEqual(["active"]);
    expect(after.variant).toEqual({ stock: 1, reserved: 1 });
    expect(after.audit).toContain("PAYMENT_WITHOUT_CORRELATION");
  });

  it("P5-MITIGATION durably quarantines a late charge after an order-id gap", async () => {
    const e = await create("fr-p5m-old-0000000001");
    const old = { orderId: e.orderId, paymentId: e.paymentId };
    await pool.query("SET FOREIGN_KEY_CHECKS=0");
    for (const t of ["stockReservations", "orderItems", "stockCheckoutItems", "stockCheckoutAttempts", "payments", "orders", "stockWebhookEvents"]) await pool.query(`DELETE FROM ${t}`);
    await pool.query("UPDATE productVariants SET reservedStock = 0 WHERE id = 8");
    await pool.query(`ALTER TABLE orders AUTO_INCREMENT = ${Number(old.orderId) + 1000}`);       // runbook step: max provider orderId + margin
    await pool.query("SET FOREIGN_KEY_CHECKS=1");
    const n = await create("fr-p5m-new-0000000001", "other-82");
    expect(n.orderId).not.toBe(old.orderId);
    await pool.execute("UPDATE stockCheckoutAttempts SET providerState='ambiguous', paymentId=NULL WHERE attemptId=?", [n.attemptId]);
    await pool.execute("UPDATE orders SET stockPaymentId=NULL WHERE id=?", [n.orderId]);   // crash before BOTH correlations were persisted
    const late = await post(hook("evt-p5m-old-charge", "PAYMENT_RECEIVED", "RECEIVED", old.orderId, old.paymentId));
    const s = await snap(n.attemptId, n.orderId);
    const unknownReferenceAudit = (await pool.query<any[]>("SELECT metadata FROM auditLogs WHERE action='payment.stock_reference_unknown.v1' AND metadata LIKE ?", ["%evt-p5m-old-charge%"]))[0];
    const unknownReferenceAlert = await reconciliationAlert("evt-p5m-old-charge");
    ev("P5.mitigation", { late, unknownReferenceAudit, unknownReferenceAlert, s });
    expect(late).toMatchObject({ status: 200, body: { handled: false, reason: "stock_event_conflict", reconciliationRequired: true } });
    expect(s.order).toMatchObject({ status: "pending" });
    expect(s.attempt).toMatchObject({ status: "reserved", providerState: "ambiguous", paymentId: null });
    expect(s.reservations).toEqual(["active"]);
    expect(s.variant).toEqual({ stock: 1, reserved: 1 });
    expect(unknownReferenceAudit).toHaveLength(1);
    expect(JSON.parse(unknownReferenceAudit[0].metadata)).toMatchObject({ eventId: "evt-p5m-old-charge", paymentId: old.paymentId, reconciliationRequired: true, financialMutation: false, stockMutation: false });
    expect(unknownReferenceAlert).toHaveLength(1);
    expect(unknownReferenceAlert[0]!.status).toBe("pending");
    expect(JSON.parse(unknownReferenceAlert[0]!.payload)).toMatchObject({ providerEventId: "evt-p5m-old-charge", paymentId: old.paymentId, reason: "STRONG_REFERENCE_UNKNOWN", financialMutation: false, stockMutation: false });
    expect(await post(hook("evt-p5m-old-charge", "PAYMENT_RECEIVED", "RECEIVED", old.orderId, old.paymentId))).toMatchObject({ status: 200, body: { reason: "duplicate_event" } });
    const [auditsAfterReplay] = await pool.execute<any[]>(
      "SELECT id FROM auditLogs WHERE action='payment.stock_reference_unknown.v1' AND metadata LIKE ?", ["%evt-p5m-old-charge%"],
    );
    const [alertsAfterReplay] = await pool.execute<any[]>(
      "SELECT id FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1' AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.providerEventId'))=?", ["evt-p5m-old-charge"],
    );
    expect(auditsAfterReplay).toHaveLength(1);
    expect(alertsAfterReplay).toHaveLength(1);
  });
});
