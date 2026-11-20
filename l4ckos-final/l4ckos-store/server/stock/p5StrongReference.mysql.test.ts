import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPool, type Pool } from "mysql2/promise";
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
import { processSignedStockWebhook, type StockCheckoutStore } from "./stockCheckout";
import { createMysqlStockCheckoutStore } from "./mysqlStockCheckoutStore";
import { assessRecoveryEvidence } from "./supervisedRecoveryGuard";
import { queryReconciliationAlerts, summarizeReconciliationAlerts, recordReconciliationAlert } from "../payments/reconciliationAlerts";
import { claimReconciliationAlertForReview, listReconciliationAlerts, resolveReconciliationAlert, type AlertExecutor } from "../payments/reconciliationAlerts";
import { canonicalizeSeedVariants } from "./testing/canonicalizeSeedVariants";
import { checkout as legacyCheckout } from "../database/checkout";
import paymentRoutes from "../routes/paymentRoutes";
import shippingRoutes from "../routes/shippingRoutes";

const database = process.env.STOCK_MYSQL_DATABASE ?? "";
const host = process.env.STOCK_MYSQL_HOST ?? "";
const port = Number(process.env.STOCK_MYSQL_PORT ?? 0);

// Simulated Asaas "current state" endpoint. Never touches the network; the real getAsaasPayment is replaced.
let simulatedProviderPayment: Record<string, unknown> | null = null;
let simulatedProviderCalls: string[] = [];
let providerImpl: null | ((id: string) => Promise<any>) = null;
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
      if (providerImpl) return providerImpl(paymentId);
      if (!simulatedProviderPayment) throw new Error("SIMULATED_PROVIDER_UNAVAILABLE");
      return simulatedProviderPayment;
    }),
  };
});
const user = process.env.STOCK_MYSQL_USER ?? "";
const password = process.env.STOCK_MYSQL_PASSWORD ?? "";
const syntheticWebhookToken = "synthetic-stock-webhook-token-only";
const syntheticWebhookAccountId = "sandbox-account-p5-synthetic";
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
let providerCalls: Array<{ orderId: string; amountCents: number; idempotencyKey: string; externalReference?: string }>;
let providerCallEvidence: Array<{ openTransactions: number; referenceCommitted: number; externalReference: string | null }> = [];
let createPaymentImpl: null | ((input: any) => Promise<any>) = null;
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

describe.skipIf(!process.env.STOCK_MYSQL_HOST)("P5 strong reference + reconciliation alerts + supervised guard (MySQL 9.7.2 disposable only, simulated Asaas)", () => {
  beforeAll(async () => {
    assertSyntheticTarget();
    pool = createPool({ host, port, user, password, database, connectionLimit: Number(process.env.RV_POOL ?? 8) });
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
      exclusiveStore: createExclusiveStore(pool),
      shipping: { secret: SHIPPING_SECRET, quote: fakeShippingQuote },
      provider: {
        supportsIdempotencyKey: true,
        async createPayment(input) {
          // Evidence captured AT the provider call: the strong reference must already be committed, and no transaction may be open.
          if (observerPool) {
            const [open] = await observerPool.query<any[]>("SELECT COUNT(*) AS n FROM information_schema.innodb_trx WHERE trx_mysql_thread_id <> CONNECTION_ID()");
            const [ref] = input.externalReference ? await pool.query<any[]>("SELECT COUNT(*) AS n FROM auditLogs WHERE action='stock.payment_reference.v1' AND correlationId=?", [input.externalReference]) : [[{ n: -1 }]];
            providerCallEvidence.push({ openTransactions: Number(open[0].n), referenceCommitted: Number(ref[0].n), externalReference: input.externalReference ?? null });
          }
          providerCalls.push(input);
          if (createPaymentImpl) { const r = await createPaymentImpl(input); if (r) return r; }
          // unique per call (a sync push+length), so concurrent attempts never collide on the payment unique key
          const [owners] = await pool.query<any[]>("SELECT userId FROM orders WHERE id=?", [input.orderId]);
          const customerId = Number(owners[0]?.userId) === 82 ? "cus_synthetic_other_82" : "cus_synthetic_owner_81";
          return { paymentId: paymentIdFor(input.idempotencyKey), customerId, checkoutUrl: "https://sandbox.invalid/synthetic-checkout" };
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
    simulatedProviderPayment = null;
    simulatedProviderCalls = [];
    providerImpl = null;
    providerObservedOpenTransactions = [];
    providerCalls = [];
    providerCallEvidence = [];
    createPaymentImpl = null;
    paymentIds.clear();
    vi.stubEnv("PUBLIC_SITE_MODE", "store");
    vi.stubEnv("PUBLIC_CHECKOUT_ENABLED", "true");
    vi.stubEnv("ASAAS_WEBHOOK_TOKEN", syntheticWebhookToken);
    vi.stubEnv("ASAAS_WEBHOOK_ACCOUNT_ID", syntheticWebhookAccountId);
  });

  // ---------------------------------------------------------------- financial-recovery helpers
  const post = async (body: unknown, token = syntheticWebhookToken) => { const t0 = Date.now(); const dbg = process.env.STOCK_ROOT_PASSWORD && process.env.FR_DEBUG_LOCKS ? setTimeout(async () => { try { const root = await createPool({ host, port, user: "root", password: process.env.STOCK_ROOT_PASSWORD, database, connectionLimit: 1 }); const [w] = await root.query<any[]>("SELECT r.trx_mysql_thread_id waiting_thread, r.trx_query waiting_query, b.trx_mysql_thread_id blocking_thread, b.trx_query blocking_query, b.trx_state blocking_state, TIMESTAMPDIFF(SECOND,b.trx_started,NOW()) blocking_age FROM performance_schema.data_lock_waits w JOIN information_schema.innodb_trx r ON r.trx_id=w.REQUESTING_ENGINE_TRANSACTION_ID JOIN information_schema.innodb_trx b ON b.trx_id=w.BLOCKING_ENGINE_TRANSACTION_ID"); const [l] = await root.query<any[]>("SELECT thread_id, object_name, index_name, lock_type, lock_mode, lock_status, lock_data FROM performance_schema.data_locks WHERE object_schema=DATABASE() ORDER BY thread_id"); const [pl] = await root.query<any[]>("SELECT id, command, time, state, LEFT(info,120) info FROM information_schema.processlist WHERE db=DATABASE()"); console.log("LOCKDEBUG " + JSON.stringify({ waits: w, locks: l.slice(0, 40), processlist: pl })); await root.end(); } catch (e) { console.log("LOCKDEBUG-ERR " + (e as Error).message); } }, 8000) : undefined; const r = await post0(body, token); if (dbg) clearTimeout(dbg); console.log(`TIMING ${(body as any).event} ${(body as any).id} ${Date.now() - t0}ms status=${r.status}`); return r; };
  const post0 = (body: unknown, token = syntheticWebhookToken) => fetch(`${baseUrl}/webhook/asaas`, {
    method: "POST", headers: { "content-type": "application/json", "asaas-access-token": token }, body: JSON.stringify(body),
  }).then(async r => ({ status: r.status, body: await r.json().catch(() => null) as Record<string, unknown> | null }));
  const hook = (id: string, event: string, status: string, orderId: string | number, paymentId: string, extra: Record<string, unknown> = {}) =>
    ({ id, event, ...(process.env.ASAAS_WEBHOOK_ACCOUNT_ID ? { account: { id: process.env.ASAAS_WEBHOOK_ACCOUNT_ID } } : {}),
      payment: { id: paymentId, externalReference: String(orderId), status, value: 129, currency: "BRL", billingType: "PIX", ...extra } });
  const authoritativePayment = (id: string, externalReference: string, customer: string, extra: Record<string, unknown> = {}) => ({
    id, externalReference, status: "RECEIVED", deleted: false, value: 129, currency: "BRL", customer, billingType: "PIX", ...extra,
  });
  const useProviderPayments = (...payments: Record<string, unknown>[]) => {
    const byId = new Map(payments.map(payment => [String(payment.id), payment]));
    providerImpl = async id => {
      const payment = byId.get(id);
      if (!payment) throw Object.assign(new Error("SIMULATED_PROVIDER_PAYMENT_NOT_FOUND"), { providerStatus: 404 });
      return payment;
    };
  };
  const ev = (label: string, value: unknown) => console.log(`EVIDENCE ${label} ${JSON.stringify(value)}`);
  const create = async (attemptId: string, session = "owner-81") => {
    const created = await httpClient(session).stockCheckout.create.mutate({ attemptId, items: [{ productId: 4, variantId: 8, quantity: 1 }], delivery: syntheticDelivery });
    const [a] = (await pool.execute<any[]>("SELECT paymentId FROM stockCheckoutAttempts WHERE attemptId=?", [attemptId]))[0];
    return { orderId: String(created.orderId), paymentId: String(a.paymentId), attemptId };
  };
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

  // ======================================================= independent review helpers
  const root = () => observerPool!;
  const timed = async <T,>(f: () => Promise<T>) => { const t = Date.now(); const r = await f(); return { r, ms: Date.now() - t }; };
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  let metricsOn = false;
  async function lm() {
    if (!metricsOn) { await root().query("SET GLOBAL innodb_monitor_enable='lock_timeouts'"); await root().query("SET GLOBAL innodb_monitor_enable='lock_deadlocks'"); metricsOn = true; }
    const m = async (n: string) => Number((await root().query<any[]>("SELECT COUNT AS c FROM information_schema.INNODB_METRICS WHERE NAME=?", [n]))[0][0]?.c ?? 0);
    const w = Number((await root().query<any[]>("SHOW GLOBAL STATUS LIKE 'Innodb_row_lock_waits'"))[0][0].Value);
    return { timeouts: await m("lock_timeouts"), deadlocks: await m("lock_deadlocks"), waits: w };
  }
  async function guarded<T>(label: string, f: () => Promise<T>) {
    const a = await lm(); const out = await f(); const b = await lm();
    const d = { timeouts: b.timeouts - a.timeouts, deadlocks: b.deadlocks - a.deadlocks, rowLockWaits: b.waits - a.waits };
    ev("LOCKS " + label, d); return { out, d };
  }
  async function extraUser(id: number) {
    await pool.execute("INSERT IGNORE INTO users (id, openId, name, email, role) VALUES (?,?,?,?, 'user')", [id, `synthetic-extra-${id}`, `Extra ${id}`, `extra${id}@example.invalid`]);
    sessionTokens[`u${id}`] = await sdk.createSessionToken(`synthetic-extra-${id}`, { name: `Extra ${id}`, sessionVersion: 1 });
    return `u${id}`;
  }
  // Samples who waits for whom (requesting vs blocking statement, object, lock mode) while `f` runs.
  async function sampleWaits<T>(f: () => Promise<T>) {
    const seen = new Map<string, number>(); let on = true;
    const q = `SELECT CONCAT(rs.CURRENT_SCHEMA,'|',COALESCE(LEFT(REPLACE(rs.SQL_TEXT,'\n',' '),90),'?')) AS req, COALESCE(LEFT(REPLACE(bs.SQL_TEXT,'\n',' '),90),'(idle/finished stmt)') AS blk,
       r.OBJECT_NAME AS obj, r.INDEX_NAME AS idx, r.LOCK_MODE AS rmode, b.LOCK_MODE AS bmode, r.LOCK_DATA AS rdata
      FROM performance_schema.data_lock_waits w
      JOIN performance_schema.data_locks r ON r.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID AND r.ENGINE=w.ENGINE
      JOIN performance_schema.data_locks b ON b.ENGINE_LOCK_ID=w.BLOCKING_ENGINE_LOCK_ID AND b.ENGINE=w.ENGINE
      LEFT JOIN performance_schema.threads rt ON rt.THREAD_ID=r.THREAD_ID LEFT JOIN performance_schema.events_statements_current rs ON rs.THREAD_ID=rt.THREAD_ID
      LEFT JOIN performance_schema.threads bt ON bt.THREAD_ID=b.THREAD_ID LEFT JOIN performance_schema.events_statements_current bs ON bs.THREAD_ID=bt.THREAD_ID
      WHERE r.OBJECT_SCHEMA=DATABASE()`;
    const loop = (async () => { while (on) { try { const [rows] = await root().query<any[]>(q); for (const x of rows) { const k = `${x.obj}.${x.idx} req[${x.rmode}] ${String(x.req).split("|")[1]} <= blk[${x.bmode}] ${x.blk}`; seen.set(k, (seen.get(k) ?? 0) + 1); } } catch {} await sleep(15); } })();
    try { return { out: await f(), waits: [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12) }; } finally { on = false; await loop; }
  }
  const setStock = (n: number) => pool.execute("UPDATE productVariants SET stock=? WHERE id=8", [n]);
  async function inv(initial: number) {
    const [[v]] = await pool.query<any[]>("SELECT stock, reservedStock FROM productVariants WHERE id=8");
    const [[a]] = await pool.query<any[]>("SELECT COALESCE(SUM(quantity),0) q FROM stockReservations WHERE variantId=8 AND status='active'");
    const [[c]] = await pool.query<any[]>("SELECT COALESCE(SUM(quantity),0) q FROM stockReservations WHERE variantId=8 AND status='consumed'");
    const r = { stock: Number(v.stock), reserved: Number(v.reservedStock), active: Number(a.q), consumed: Number(c.q) };
    expect(r.stock).toBeGreaterThanOrEqual(0);
    expect(r.reserved).toBe(r.active);                    // no leak / no double release
    expect(initial - r.stock).toBe(r.consumed);           // every unit debited has exactly one consumed reservation
    return r;
  }
  // Redeliver until no transient 503 remains (what the provider does); returns the final statuses.
  async function drain(bodies: any[], rounds = 8) {
    let pending = bodies;
    const final: any[] = [];
    for (let i = 0; i < rounds && pending.length; i++) {
      const rs = await Promise.all(pending.map(b => post0(b)));
      const next: any[] = [];
      rs.forEach((r, k) => { if (r.status === 503) next.push(pending[k]); else final.push({ id: pending[k].id, ...r }); });
      pending = next; if (pending.length) await sleep(60);
    }
    return { final, stuck: pending.map(p => p.id) };
  }
  const auditCount = async (action: string) => Number((await pool.query<any[]>("SELECT COUNT(*) n FROM auditLogs WHERE action=?", [action]))[0][0].n);
  const setReviewEnv = () => {
    const keys = ["NODE_ENV", "RAILWAY_PROJECT_ID", "RAILWAY_ENVIRONMENT_ID", "RAILWAY_SERVICE_ID", "ASAAS_WEBHOOK_RECOVERY_MODE"];
    const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
    process.env.NODE_ENV = "production"; process.env.RAILWAY_PROJECT_ID = "2bb90c8e-eb65-43ee-826b-f93750f0499c";
    process.env.RAILWAY_ENVIRONMENT_ID = "15545eee-bc02-4b70-afc4-19a5db9e6f46"; process.env.RAILWAY_SERVICE_ID = "9f1c7705-f2f9-48cf-b957-8f63a6bba4db";
    process.env.ASAAS_WEBHOOK_RECOVERY_MODE = "review_only";
    return () => { for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };
  };

  // ======================================================= P5 helpers
  const STRONG = /^L4CKOS-STOCK-ATTEMPT:v1:[A-Za-z0-9_-]{32}$/;
  const refOf = async (attemptId: string) => {
    const [rows] = await pool.query<any[]>("SELECT correlationId FROM auditLogs WHERE action='stock.payment_reference.v1' AND entityId=? ORDER BY id", [attemptId]);
    return rows.map(r => String(r.correlationId));
  };
  const alerts = async () => (await pool.query<any[]>("SELECT id, dedupeKey, type, orderId, payload, status, sentAt, nextAttemptAt, lockedBy, leaseExpiresAt, createdAt FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1' ORDER BY id"))[0];
  const alertKinds = async () => (await alerts()).map((a: any) => JSON.parse(a.payload).kind);
  const poolExec = (): AlertExecutor => async (q, p) => { const [r] = await pool.query(q, p as any[]); return Array.isArray(r) ? { rows: r as any[], affectedRows: 0 } : { rows: [], affectedRows: Number((r as any).affectedRows ?? 0) }; };
  async function withTrigger<T>(name: string, table: string, when: string, cond: string, f: () => Promise<T>) {
    await root().query(`DROP TRIGGER IF EXISTS ${name}`);
    await root().query(`CREATE TRIGGER ${name} BEFORE ${when} ON ${table} FOR EACH ROW BEGIN IF ${cond} THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='p5 injected failure'; END IF; END`);
    try { return await f(); } finally { await root().query(`DROP TRIGGER IF EXISTS ${name}`); }
  }
  const createRaw = async (attemptId: string, session = "owner-81") => {
    try { return { ok: true as const, ...(await create(attemptId, session)) }; }
    catch (error) { return { ok: false as const, error: String((error as Error).message) }; }
  };
  // Provider created the charge but the local paymentId write failed: an attempt with a strong reference and NO paymentId.
  const createUnlinked = async (attemptId: string, session = "owner-81") => {
    const failed = await withTrigger("p5_trg_pay", "stockCheckoutAttempts", "UPDATE", "NEW.paymentId IS NOT NULL AND OLD.paymentId IS NULL", () => createRaw(attemptId, session));
    expect(failed.ok).toBe(false);
    const [row] = (await pool.query<any[]>("SELECT orderId FROM stockCheckoutAttempts WHERE attemptId=?", [attemptId]))[0];
    return { attemptId, orderId: String(row.orderId), ref: (await refOf(attemptId))[0] };
  };
  const orderPending = async (orderId: string) => (await snap("-", orderId)).order;

  it("documented Asaas payload without payment.currency confirms only after preflight proves account, charge, reference, value, BRL and customer; extra fields and late events stay idempotent", async () => {
    const previousAccountId = process.env.ASAAS_WEBHOOK_ACCOUNT_ID;
    process.env.ASAAS_WEBHOOK_ACCOUNT_ID = "sandbox-account-synthetic-1";
    try {
      await setStock(1);
      const customerId = "cus_synthetic_owner_81";
      createPaymentImpl = async () => ({ paymentId: "pay-official-shape-001", customerId, checkoutUrl: "https://sandbox.invalid/checkout" });
      const created = await create("p5-official-payload-attempt-0001");
      const [reference] = await refOf(created.attemptId);
      providerImpl = async id => ({ id, externalReference: reference, status: "RECEIVED", deleted: false,
        value: 129, currency: "BRL", customer: customerId, billingType: "PIX" });
      const asOfficialShape = (event: string, id: string) => ({
        id, event, dateCreated: "2026-11-15 12:00:00",
        account: { id: "sandbox-account-synthetic-1", ownerId: null, futureAccountField: "ignored" },
        payment: {
          object: "payment", id: created.paymentId, dateCreated: "2026-11-15", customer: customerId,
          value: 129, netValue: 127.81, externalReference: reference, billingType: "PIX", status: "RECEIVED",
          futureProviderField: { safeToIgnore: true },
        },
      });
      const first = await post0(asOfficialShape("PAYMENT_RECEIVED", "evt-official-received-001"));
      expect(first.status).toBe(200);
      expect(await inv(1)).toEqual({ stock: 0, reserved: 0, active: 0, consumed: 1 });
      expect(providerObservedOpenTransactions.at(-1)).toBe(0);

      // A late CONFIRMED event for the same paid charge is a second event ID;
      // it must not debit the reservation again.
      const late = await post0(asOfficialShape("PAYMENT_CONFIRMED", "evt-official-confirmed-late-001"));
      expect(late.status).toBe(200);
      expect(await inv(1)).toEqual({ stock: 0, reserved: 0, active: 0, consumed: 1 });
      expect(simulatedProviderCalls).toEqual([created.paymentId]); // non-settling CONFIRMED is not an authoritative payment proof
      expect(providerObservedOpenTransactions).toEqual([0]);
      expect((await post0(asOfficialShape("PAYMENT_CONFIRMED", "evt-official-confirmed-late-001"))).status).toBe(200);
      expect(simulatedProviderCalls).toHaveLength(1); // duplicate inbox event short-circuits provider IO
    } finally {
      if (previousAccountId === undefined) delete process.env.ASAAS_WEBHOOK_ACCOUNT_ID;
      else process.env.ASAAS_WEBHOOK_ACCOUNT_ID = previousAccountId;
    }
  });

  it("missing account identity or payment identity is durably quarantined without provider requery or stock mutation", async () => {
    const previousAccountId = process.env.ASAAS_WEBHOOK_ACCOUNT_ID;
    delete process.env.ASAAS_WEBHOOK_ACCOUNT_ID;
    try {
      await setStock(1);
      const customerId = "cus_synthetic_owner_81";
      createPaymentImpl = async () => ({ paymentId: "pay-official-shape-002", customerId, checkoutUrl: "https://sandbox.invalid/checkout" });
      const created = await create("p5-official-payload-unverified-0001");
      const [reference] = await refOf(created.attemptId);
      const unverified: any = hook("evt-official-unverified-001", "PAYMENT_RECEIVED", "RECEIVED", reference, created.paymentId);
      delete unverified.account;
      delete unverified.payment.currency;
      // The account is absent and no currency is fabricated from the Asaas default.
      const response = await post0(unverified);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ reconciliationRequired: true, financialMutation: false, stockMutation: false });
      expect(simulatedProviderCalls).toHaveLength(0);
      const state = await snap(created.attemptId, created.orderId);
      expect(state.order).toMatchObject({ status: "pending", paymentStatus: "unconfirmed" });
      expect(state.variant).toEqual({ stock: 1, reserved: 1 });
      expect(await alertKinds()).toEqual(["ASAAS_WEBHOOK_FINANCIAL_EXCEPTION"]);

      const missingId: any = { ...unverified, id: "evt-official-missing-payment-id-001", account: { id: "sandbox-account-synthetic-1" }, payment: { ...unverified.payment } };
      delete missingId.payment.id;
      process.env.ASAAS_WEBHOOK_ACCOUNT_ID = "sandbox-account-synthetic-1";
      expect((await post0(missingId)).status).toBe(200);
      expect(simulatedProviderCalls).toHaveLength(0);
      expect((await snap(created.attemptId, created.orderId)).order).toMatchObject({ status: "pending", paymentStatus: "unconfirmed" });
      expect(await alerts()).toHaveLength(2);
    } finally {
      if (previousAccountId === undefined) delete process.env.ASAAS_WEBHOOK_ACCOUNT_ID;
      else process.env.ASAAS_WEBHOOK_ACCOUNT_ID = previousAccountId;
    }
  });

  it("P1-A STOCK PAYMENT_RECEIVED with currency absent in webhook and provider read requires pinned BRL account plus exact attempt/customer binding", async () => {
    const accountId = "sandbox-account-synthetic-p1a";
    const previousAccountId = process.env.ASAAS_WEBHOOK_ACCOUNT_ID;
    const previousAccountCurrency = process.env.ASAAS_WEBHOOK_ACCOUNT_CURRENCY;
    process.env.ASAAS_WEBHOOK_ACCOUNT_ID = accountId;
    process.env.ASAAS_WEBHOOK_ACCOUNT_CURRENCY = "BRL";
    try {
      await setStock(1);
      const customerId = "cus_p1a_owner_81";
      createPaymentImpl = async () => ({ paymentId: "pay-p1a-stock-001", customerId, checkoutUrl: "https://sandbox.invalid/checkout" });
      const created = await create("p1a-stock-missing-currency-0001");
      const [reference] = await refOf(created.attemptId);
      providerImpl = async id => ({ id, externalReference: reference, status: "RECEIVED", deleted: false, value: 129, customer: customerId, billingType: "PIX" });
      const body: any = {
        id: "evt-p1a-stock-missing-currency-001", event: "PAYMENT_RECEIVED", dateCreated: "2026-11-15 12:00:00",
        account: { id: accountId, ownerId: null },
        payment: { object: "payment", id: created.paymentId, dateCreated: "2026-11-15", customer: customerId,
          value: 129, netValue: 127.81, externalReference: reference, billingType: "PIX", status: "RECEIVED" },
      };
      expect(body.payment).not.toHaveProperty("currency");
      expect((await post0(body)).status).toBe(200);
      expect(await inv(1)).toEqual({ stock: 0, reserved: 0, active: 0, consumed: 1 });
      expect((await snap(created.attemptId, created.orderId)).order).toMatchObject({ status: "paid", paymentStatus: "confirmed" });
      expect(simulatedProviderCalls).toEqual([created.paymentId]);
      expect(providerObservedOpenTransactions).toEqual([0]);
      expect(await alerts()).toHaveLength(0);
    } finally {
      if (previousAccountId === undefined) delete process.env.ASAAS_WEBHOOK_ACCOUNT_ID;
      else process.env.ASAAS_WEBHOOK_ACCOUNT_ID = previousAccountId;
      if (previousAccountCurrency === undefined) delete process.env.ASAAS_WEBHOOK_ACCOUNT_CURRENCY;
      else process.env.ASAAS_WEBHOOK_ACCOUNT_CURRENCY = previousAccountCurrency;
    }
  });

  it.each([
    { label: "GET reports cash receipt for a PIX attempt", webhookBillingType: "PIX", providerBillingType: "RECEIVED_IN_CASH" },
    { label: "GET reports another billing type for a PIX attempt", webhookBillingType: "PIX", providerBillingType: "CREDIT_CARD" },
    { label: "webhook and GET disagree", webhookBillingType: "RECEIVED_IN_CASH", providerBillingType: "PIX" },
    { label: "authoritative billingType is missing", webhookBillingType: "PIX", providerBillingType: undefined },
    { label: "authoritative billingType is invalid", webhookBillingType: "PIX", providerBillingType: "UNDEFINED" },
    { label: "webhook billingType is missing", webhookBillingType: undefined, providerBillingType: "PIX" },
    { label: "webhook billingType is invalid", webhookBillingType: "UNDEFINED", providerBillingType: "PIX" },
  ])("P5 PIX settlement fails closed when $label", async ({ label, webhookBillingType, providerBillingType }) => {
    const accountId = syntheticWebhookAccountId;
    const customerId = "cus_synthetic_owner_81";
    await setStock(1);
    createPaymentImpl = async () => ({ paymentId: `pay-rcash-${label.replaceAll(/[^a-z0-9]+/gi, "-")}`, customerId, checkoutUrl: "https://sandbox.invalid/checkout" });
    const created = await create(`rcash-attempt-${label.replaceAll(/[^a-z0-9]+/gi, "-")}`);
    const [reference] = await refOf(created.attemptId);
    providerImpl = async id => ({ id, externalReference: reference, status: "RECEIVED", deleted: false,
      value: 129, currency: "BRL", customer: customerId,
      ...(providerBillingType === undefined ? {} : { billingType: providerBillingType }) });
    const body: any = hook(`evt-rcash-${label.replaceAll(/[^a-z0-9]+/gi, "-")}`, "PAYMENT_RECEIVED", "RECEIVED", reference, created.paymentId,
      webhookBillingType === undefined ? {} : { billingType: webhookBillingType });
    if (webhookBillingType === undefined) delete body.payment.billingType;

    const response = await post0(body);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ reconciliationRequired: true, financialMutation: false, stockMutation: false });
    const state = await snap(created.attemptId, created.orderId);
    expect(state.attempt.status).toBe("reserved");
    expect(state.order).toMatchObject({ status: "pending", paymentStatus: "unconfirmed" });
    expect(state.variant).toEqual({ stock: 1, reserved: 1 });
    expect(state.reservations).toEqual(["active"]);
    expect(await alertKinds()).toEqual(["ASAAS_WEBHOOK_FINANCIAL_EXCEPTION"]);
    expect(simulatedProviderCalls).toEqual([created.paymentId]);
    const [audit] = (await pool.query<any[]>("SELECT metadata FROM auditLogs WHERE action='payment.webhook_reconciliation_required.v1'"))[0];
    expect(JSON.parse(audit.metadata)).toMatchObject({
      reason: "PROVIDER_BILLING_TYPE_MISMATCH", observedBillingType: webhookBillingType ?? null,
      providerObservedBillingType: providerBillingType ?? null, financialMutation: false, stockMutation: false,
    });
    expect((await post0(body)).body).toMatchObject({ reason: "duplicate_event" });
    expect(simulatedProviderCalls).toEqual([created.paymentId]);
    expect(await alerts()).toHaveLength(1);
  });

  // ======================================================= E1 + B: strong reference
  it("E1 strong reference: unique per attempt, server-generated, persisted+committed BEFORE the provider call, no open transaction at the call", async () => {
    await setStock(5);
    const a = await create("p5-e1-attempt-0000000001"), b = await create("p5-e1-attempt-0000000002", "other-82");
    const [ra] = await refOf(a.attemptId), [rb] = await refOf(b.attemptId);
    expect(ra).toMatch(STRONG); expect(rb).toMatch(STRONG); expect(ra).not.toBe(rb);
    expect((await refOf(a.attemptId))).toHaveLength(1);
    expect(providerCalls.map(c => c.externalReference).sort()).toEqual([ra, rb].sort());
    expect(providerCallEvidence).toHaveLength(2);
    for (const e of providerCallEvidence) { expect(e.referenceCommitted).toBe(1); expect(e.openTransactions).toBe(0); expect(e.externalReference).toMatch(STRONG); }
    // The reference contains a fixed prefix plus exactly one random token; a random suffix can coincidentally equal the order ID.
    expect(ra.slice("L4CKOS-STOCK-ATTEMPT:v1:".length)).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(ra.length).toBeLessThan(191);
    ev("E1", { ra, rb, providerCallEvidence });
  });

  it("E2 retry of provider creation reuses the SAME reference (no second token, no second audit row)", async () => {
    let calls = 0;
    createPaymentImpl = async () => { calls += 1; if (calls === 1) throw new Error("network down"); return null; };
    const first = await createRaw("p5-e2-attempt-0000000001");
    expect(first.ok).toBe(false);
    const second = await createRaw("p5-e2-attempt-0000000001");
    expect(second.ok).toBe(true);
    const refs = await refOf("p5-e2-attempt-0000000001");
    expect(refs).toHaveLength(1);
    expect(providerCalls).toHaveLength(2);
    expect(providerCalls[0].externalReference).toBe(refs[0]); expect(providerCalls[1].externalReference).toBe(refs[0]);
  });

  it("E3 provider replied but paymentId was NOT persisted: strong-referenced paid event stays fail-closed (divergence + durable alert), order untouched, guard says eligible-for-review only", async () => {
    await setStock(1);
    createPaymentImpl = async () => ({ paymentId: "pay-provider-created-e3", customerId: "cus_synthetic_owner_81", checkoutUrl: "https://sandbox.invalid/checkout" });
    const attemptId = "p5-e3-attempt-0000000001";
    const failed = await withTrigger("p5_trg_pay", "stockCheckoutAttempts", "UPDATE", "NEW.paymentId IS NOT NULL AND OLD.paymentId IS NULL", () => createRaw(attemptId));
    expect(failed.ok).toBe(false);
    const [row] = (await pool.query<any[]>("SELECT orderId, status, providerState, paymentId FROM stockCheckoutAttempts WHERE attemptId=?", [attemptId]))[0];
    expect(row.paymentId).toBeNull();
    const [reference] = await refOf(attemptId); expect(reference).toMatch(STRONG);
    const orderId = String(row.orderId);
    useProviderPayments(authoritativePayment("pay-provider-created-e3", reference, "cus_synthetic_owner_81"));
    const paid = hook("evt-p5-e3-paid", "PAYMENT_RECEIVED", "RECEIVED", reference, "pay-provider-created-e3");
    const r = await post0(paid);
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ reason: "payment_reconciliation_required", reconciliationRequired: true, financialMutation: false, stockMutation: false });
    const s = await snap(attemptId, orderId);
    expect(s.order).toMatchObject({ status: "pending", paymentStatus: "unconfirmed" });
    expect(s.variant).toEqual({ stock: 1, reserved: 1 }); expect(s.audit).toEqual([]);
    const [[observation]] = await pool.query<any[]>("SELECT metadata FROM auditLogs WHERE action='payment.webhook_reconciliation_required.v1'");
    expect(JSON.parse(observation.metadata)).toMatchObject({ reason: "PROVIDER_PAYMENT_BINDING_UNVERIFIED", attemptId, paymentId: "pay-provider-created-e3", financialMutation: false, stockMutation: false });
    const al = await alerts(); expect(al).toHaveLength(1);
    expect(JSON.parse(al[0].payload)).toMatchObject({ kind: "ASAAS_WEBHOOK_FINANCIAL_EXCEPTION", category: "order_attempt_payment_inconsistent", attemptId, paymentId: "pay-provider-created-e3", financialMutation: false });
    expect(al[0].status).toBe("pending");
    // redelivery: 200 duplicate, still exactly one alert and one divergence
    expect((await post0(paid)).status).toBe(200);
    expect(await alerts()).toHaveLength(1);
    // The guard only ASSESSES. With a legitimate strong reference + all bindings it is eligible for a human-approved review; it changes nothing.
    const evidence = {
      attempt: { attemptId, ownerUserId: 81, orderId: Number(orderId), status: "reserved", providerState: "ambiguous", paymentId: null, amountCents: 12900, currency: "BRL",
        createdAt: "2026-11-15T10:00:00.000Z", providerAttemptStartedAt: "2026-11-15T10:00:03.000Z", paymentReference: reference, expectedCustomerId: null,
        expectedBuyerIdentityDigest: "d".repeat(64), expectedProviderAccount: "sandbox-account-1", reservationExpiresAt: "2026-11-15T10:30:00.000Z" },
      payment: { id: "pay-provider-created-e3", customerId: "cus_x1", externalReference: reference, valueCents: 12900, currency: "BRL", status: "RECEIVED",
        dateCreated: "2026-11-15T10:00:04.000Z", paidAt: "2026-11-15T10:01:00.000Z", providerAccount: "sandbox-account-1" },
      providerReadAt: "2026-11-15T10:02:00.000Z", buyerIdentityDigestFromCurrentCustomer: "d".repeat(64), paymentMappedToOtherAttempt: false,
      localProjection: { orderOwnerUserId: 81, orderStatus: "pending", reservation: "active", amountCents: 12900 },
      event: { eventId: "evt-p5-e3-paid", payloadHash: "a".repeat(64), paymentId: "pay-provider-created-e3", externalReference: reference, amountCents: 12900, type: "PAYMENT_RECEIVED", persisted: true },
      divergence: { open: true, kind: "PAYMENT_WITHOUT_CORRELATION", eventId: "evt-p5-e3-paid" },
      approval: { approvalReference: "FIN-2026-0099", justification: "Conciliação aprovada pelo financeiro." },
    } as const;
    const verdict = assessRecoveryEvidence(evidence as any, { requestedByUserId: 83, approvedByUserId: 84, isConfiguredAdmin: id => id === 83 || id === 84 });
    expect(verdict).toMatchObject({ decision: "eligible_for_supervised_review", automaticAction: false });
    const after = await snap(attemptId, orderId);
    expect(after).toEqual(s); // nothing changed by the assessment
  });

  it("E4 restore with reused orderId: a pre-restore charge (numeric reference with the OLD payment id, or the OLD strong reference) never confirms the NEW attempt", async () => {
    await setStock(3);
    let createdPayments = 0;
    createPaymentImpl = async () => {
      createdPayments += 1;
      return createdPayments === 1
        ? { paymentId: "pay-old-before-restore", customerId: "cus_synthetic_owner_81", checkoutUrl: "https://sandbox.invalid/checkout" }
        : { paymentId: "pay-new-after-restore", customerId: "cus_synthetic_other_82", checkoutUrl: "https://sandbox.invalid/checkout" };
    };
    const oldAttempt = await create("p5-e4-old-attempt-000001");
    const [oldRef] = await refOf(oldAttempt.attemptId);
    const oldPaymentId = oldAttempt.paymentId, oldOrderId = oldAttempt.orderId;
    // "restore": database rewound to before the old attempt existed (AUTO_INCREMENT restarts, orderId is reused)
    await resetDatabase(); paymentIds.clear(); await setStock(3);
    const fresh = await create("p5-e4-new-attempt-000001", "other-82");
    expect(fresh.orderId).toBe(oldOrderId); // reused numeric order id
    const [freshRef] = await refOf(fresh.attemptId); expect(freshRef).not.toBe(oldRef);
    useProviderPayments(
      authoritativePayment(oldPaymentId, oldOrderId, "cus_synthetic_owner_81"),
      authoritativePayment(fresh.paymentId, freshRef, "cus_synthetic_other_82"),
    );
    const before = await snap(fresh.attemptId, fresh.orderId);
    // (a) old charge still carries the numeric reference of the reused id and its OLD payment id
    const a = await post0(hook("evt-p5-e4-num", "PAYMENT_RECEIVED", "RECEIVED", oldOrderId, oldPaymentId));
    // (b) old charge carries the OLD strong reference (unknown after the restore)
    const b = await post0(hook("evt-p5-e4-strong", "PAYMENT_RECEIVED", "RECEIVED", oldRef, oldPaymentId));
    // (c) numeric reference carrying the NEW attempt's own, durably linked payment id: that IS this attempt's charge (paymentId is the
    //     binding), so it follows the normal path; the OLD charge (a) and the OLD strong reference (b) are the dangerous ones.
    const c = { status: 200 };
    ev("E4", { a, b, c });
    expect([a.status, b.status, c.status]).toEqual([200, 200, 200]);
    const after = await snap(fresh.attemptId, fresh.orderId);
    expect(after.order).toMatchObject({ status: "pending", paymentStatus: "unconfirmed" });
    expect(after.variant).toEqual(before.variant); expect(after.attempt.status).toBe("reserved");
    const kinds = await alertKinds();
    expect(kinds).toContain("STOCK_REFERENCE_RECONCILIATION"); // unknown old strong reference
    expect(kinds).toContain("ASAAS_WEBHOOK_FINANCIAL_EXCEPTION"); // provider proves the numeric order now belongs to a different customer
  });

  it("E5 another buyer's charge cannot confirm: foreign paymentId with my strong reference, my paymentId with foreign strong reference", async () => {
    await setStock(5);
    const mine = await create("p5-e5-mine-00000000001"), theirs = await create("p5-e5-theirs-0000000001", "other-82");
    const [myRef] = await refOf(mine.attemptId), [theirRef] = await refOf(theirs.attemptId);
    useProviderPayments(
      authoritativePayment("pay-of-somebody-else", myRef, "cus_synthetic_owner_81"),
      authoritativePayment(mine.paymentId, myRef, "cus_synthetic_owner_81"),
      authoritativePayment(theirs.paymentId, theirRef, "cus_synthetic_other_82"),
    );
    const r1 = await post0(hook("evt-p5-e5-1", "PAYMENT_RECEIVED", "RECEIVED", myRef, "pay-of-somebody-else"));          // my ref, unknown payment id
    const r2 = await post0(hook("evt-p5-e5-2", "PAYMENT_RECEIVED", "RECEIVED", theirRef, mine.paymentId));                 // their ref, my payment id
    const r3 = await post0(hook("evt-p5-e5-3", "PAYMENT_RECEIVED", "RECEIVED", myRef, theirs.paymentId));                  // my ref, their payment id
    expect([r1.status, r2.status, r3.status]).toEqual([200, 200, 200]);
    for (const x of [mine, theirs]) expect((await snap(x.attemptId, x.orderId)).order).toMatchObject({ status: "pending", paymentStatus: "unconfirmed" });
    expect((await readVariantInventory(8))).toMatchObject({ stock: 5, reservedStock: 2 });
    const kinds = await alertKinds();
    expect(kinds).toEqual(["ASAAS_WEBHOOK_FINANCIAL_EXCEPTION", "ASAAS_WEBHOOK_FINANCIAL_EXCEPTION", "ASAAS_WEBHOOK_FINANCIAL_EXCEPTION"]);
    // wrong-amount on the right charge is a divergence too, not a payment
    const r4 = await post0(hook("evt-p5-e5-4", "PAYMENT_RECEIVED", "RECEIVED", myRef, mine.paymentId, { value: 1 }));
    expect(r4.status).toBe(200); expect((await snap(mine.attemptId, mine.orderId)).order).toMatchObject({ status: "pending" });
    expect(await alertKinds()).toEqual(Array(4).fill("ASAAS_WEBHOOK_FINANCIAL_EXCEPTION")); // authoritative amount mismatch is quarantined before stock processing
  });

  it("E6 audit/alert failure fails closed: injected persistence failure => 503 (never 200); redelivery completes one durable audit and one alert", async () => {
    await setStock(5);
    const c = await create("p5-e6-attempt-0000000001");
    const [ref] = await refOf(c.attemptId);
    const c2PaymentId = "pay-unknown-e6b";
    useProviderPayments(
      authoritativePayment("pay-unknown-e6", ref, "cus_synthetic_owner_81"),
    );
    const body = hook("evt-p5-e6", "PAYMENT_RECEIVED", "RECEIVED", ref, "pay-unknown-e6");
    const bad = await withTrigger("p5_trg_alert", "notificationOutbox", "INSERT", "NEW.type='financial-reconciliation-alert-v1'", () => post0(body));
    expect(bad.status).toBe(503);
    expect(await alerts()).toHaveLength(0);
    expect(Number((await pool.query<any[]>("SELECT COUNT(*) n FROM auditLogs WHERE action='payment.webhook_reconciliation_required.v1'"))[0][0].n)).toBe(0); // audit+alert roll back together while delivery stays retryable
    expect((await inbox()).find((x: any) => x.eventId === "evt-p5-e6")).toMatchObject({ state: "failed" });
    const ok = await post0(body);
    expect(ok.status).toBe(200);
    expect(await alerts()).toHaveLength(1);
    expect(Number((await pool.query<any[]>("SELECT COUNT(*) n FROM auditLogs WHERE action='payment.webhook_reconciliation_required.v1'"))[0][0].n)).toBe(1);
    // audit-row failure must also fail closed
    const c2 = await create("p5-e6-attempt-0000000002", "other-82"); const [ref2] = await refOf(c2.attemptId);
    useProviderPayments(
      authoritativePayment("pay-unknown-e6", ref, "cus_synthetic_owner_81"),
      authoritativePayment(c2PaymentId, ref2, "cus_synthetic_other_82"),
    );
    const body2 = hook("evt-p5-e6b", "PAYMENT_RECEIVED", "RECEIVED", ref2, c2PaymentId);
    const bad2 = await withTrigger("p5_trg_audit", "auditLogs", "INSERT", "NEW.action='payment.webhook_reconciliation_required.v1'", () => post0(body2));
    expect(bad2.status).toBe(503); expect(await alerts()).toHaveLength(1);
    expect(Number((await pool.query<any[]>("SELECT COUNT(*) n FROM auditLogs WHERE action='payment.webhook_reconciliation_required.v1'"))[0][0].n)).toBe(1);
    expect((await post0(body2)).status).toBe(200); expect(await alerts()).toHaveLength(2);
    expect(Number((await pool.query<any[]>("SELECT COUNT(*) n FROM auditLogs WHERE action='payment.webhook_reconciliation_required.v1'"))[0][0].n)).toBe(2);
  });

  it("E7 duplicate and concurrent alerts: 12 concurrent distinct events of the SAME divergence + redeliveries => exactly one logical alert", async () => {
    createPaymentImpl = async () => ({ paymentId: "pay-unlinked-e7", customerId: "cus_synthetic_owner_81", checkoutUrl: "https://sandbox.invalid/checkout" });
    await setStock(3); const c = await createUnlinked("p5-e7-attempt-0000000001"); const ref = c.ref;
    useProviderPayments(authoritativePayment("pay-unlinked-e7", ref, "cus_synthetic_owner_81"));
    const bodies = Array.from({ length: 12 }, (_, i) => hook(`evt-p5-e7-${i}`, "PAYMENT_RECEIVED", "RECEIVED", ref, "pay-unlinked-e7"));
    const d = await drain(bodies, 12);
    expect(d.stuck).toEqual([]);
    expect(d.final.every((x: any) => x.status === 200)).toBe(true);
    const al = await alerts();
    expect(al).toHaveLength(1);
    await drain(bodies, 2); // redeliver everything
    expect(await alerts()).toHaveLength(1);
    expect(new Set((await alerts()).map((a: any) => a.dedupeKey)).size).toBe(1);
    expect((await snap(c.attemptId, c.orderId)).order).toMatchObject({ status: "pending" });
  });

  it("E8 interrupted review is recoverable without duplicates: pending -> in_review (lease) -> stale -> re-claimed -> resolved; wrong reviewer cannot resolve; nothing external is sent", async () => {
    createPaymentImpl = async () => ({ paymentId: "pay-unlinked-e8", customerId: "cus_synthetic_owner_81", checkoutUrl: "https://sandbox.invalid/checkout" });
    await setStock(3); const c = await createUnlinked("p5-e8-attempt-0000000001"); const ref = c.ref;
    useProviderPayments(authoritativePayment("pay-unlinked-e8", ref, "cus_synthetic_owner_81"));
    await post0(hook("evt-p5-e8", "PAYMENT_RECEIVED", "RECEIVED", ref, "pay-unlinked-e8"));
    const [a] = await alerts(); expect(a.status).toBe("pending");
    expect(new Date(a.nextAttemptAt).getUTCFullYear()).toBe(2037); // parked: no delivery worker can claim it
    const x = poolExec();
    expect((await listReconciliationAlerts(x))[0]).toMatchObject({ state: "pending", category: "order_attempt_payment_inconsistent", attemptRef: expect.stringContaining("…"), paymentRef: expect.stringContaining("…") });
    expect(await claimReconciliationAlertForReview(x, a.id, "operator.one", 60)).toBe("claimed");
    expect(await claimReconciliationAlertForReview(x, a.id, "operator.two", 60)).toBe("not_claimable");   // live lease
    expect((await listReconciliationAlerts(x))[0].state).toBe("in_review");
    await pool.execute("UPDATE notificationOutbox SET leaseExpiresAt = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 MINUTE) WHERE id=?", [a.id]); // reviewer died
    expect((await listReconciliationAlerts(x))[0].state).toBe("pending");
    expect(await resolveReconciliationAlert(x, a.id, "operator.one")).toBe("not_resolvable"); // lease expired
    expect(await claimReconciliationAlertForReview(x, a.id, "operator.two", 60)).toBe("claimed");
    expect(await resolveReconciliationAlert(x, a.id, "operator.one")).toBe("not_resolvable");  // not the lease holder
    expect(await resolveReconciliationAlert(x, a.id, "operator.two")).toBe("resolved");
    expect((await listReconciliationAlerts(x))[0].state).toBe("resolved");
    expect(await alerts()).toHaveLength(1);
    // resolving an alert does not touch money, stock or the order
    expect((await snap(c.attemptId, c.orderId)).order).toMatchObject({ status: "pending", paymentStatus: "unconfirmed" });
    expect(await readVariantInventory(8)).toMatchObject({ stock: 3, reservedStock: 1 });
    // a redelivery of the same divergence does not reopen or duplicate it
    await post0(hook("evt-p5-e8b", "PAYMENT_RECEIVED", "RECEIVED", ref, "pay-unlinked-e8"));
    expect(await alerts()).toHaveLength(1);
    expect((await listReconciliationAlerts(x))[0].state).toBe("resolved");
  });

  it("E9 PAYMENT_DELETED after 404 and after three provider failures: durable audit AND alert, single of each, 200 only afterwards", async () => {
    await setStock(5); const c = await create("p5-e9-attempt-0000000001"); const [ref] = await refOf(c.attemptId);
    providerImpl = async () => { throw Object.assign(new Error("Request failed with status code 404"), { providerStatus: 404 }); };
    const del = hook("evt-p5-e9-del", "PAYMENT_DELETED", "DELETED", ref, c.paymentId, { deleted: true });
    const r = await post0(del);
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ reason: "payment_reconciliation_required", reconciliationRequired: true });
    let al = await alerts(); expect(al).toHaveLength(1);
    expect(JSON.parse(al[0].payload)).toMatchObject({ kind: "PAYMENT_DELETED_PREFLIGHT_ESCALATED", category: "provider_state_unavailable", reason: "PROVIDER_404" });
    expect((await post0(del)).status).toBe(200); expect(await alerts()).toHaveLength(1);
    // three transient failures
    const c2 = await create("p5-e9-attempt-0000000002", "other-82"); const [ref2] = await refOf(c2.attemptId);
    providerImpl = async () => { throw new Error("ETIMEDOUT"); };
    const del2 = hook("evt-p5-e9-del2", "PAYMENT_DELETED", "DELETED", ref2, c2.paymentId, { deleted: true });
    expect([(await post0(del2)).status, (await post0(del2)).status]).toEqual([503, 503]);
    expect(await alerts()).toHaveLength(1);
    expect((await post0(del2)).status).toBe(200);
    expect(await alerts()).toHaveLength(2);
    for (const x of [c, c2]) expect((await snap(x.attemptId, x.orderId)).attempt.status).toBe("reserved"); // fail closed: nothing released
    // alert failure => no 200
  });

  // ======================================================= invariants, compatibility, normal flow
  it("E10 normal flow with a strong reference: paid event confirms exactly once; stock/reservation invariants hold; redelivery and out-of-order are no-ops", async () => {
    await setStock(3);
    const c = await create("p5-e10-attempt-000000001"); const [ref] = await refOf(c.attemptId);
    useProviderPayments(authoritativePayment(c.paymentId, ref, "cus_synthetic_owner_81"));
    expect((await post0(hook("evt-p5-e10-created", "PAYMENT_CREATED", "PENDING", ref, c.paymentId))).status).toBe(200);
    const paid = hook("evt-p5-e10-paid", "PAYMENT_RECEIVED", "RECEIVED", ref, c.paymentId);
    const rs = await Promise.all([post0(paid), post0(paid), post0(hook("evt-p5-e10-conf", "PAYMENT_CONFIRMED", "CONFIRMED", ref, c.paymentId))]);
    const dr = await drain([paid, hook("evt-p5-e10-conf", "PAYMENT_CONFIRMED", "CONFIRMED", ref, c.paymentId)], 6);
    expect(dr.stuck).toEqual([]);
    const s = await snap(c.attemptId, c.orderId);
    expect(s.attempt.status).toBe("paid"); expect(s.order).toMatchObject({ status: "paid", paymentStatus: "confirmed" });
    expect(s.variant).toEqual({ stock: 2, reserved: 0 }); expect(s.reservations).toEqual(["consumed"]);
    expect(await alerts()).toHaveLength(0);
    await inv(3);
    ev("E10", { rs: rs.map(r => r.status) });
  });

  it("E11 historical compatibility: an attempt WITHOUT a strong reference and with a persisted paymentId still processes numeric-reference events as before", async () => {
    await setStock(3);
    const c = await create("p5-e11-attempt-000000001");
    await pool.execute("DELETE FROM auditLogs WHERE action='stock.payment_reference.v1' AND entityId=?", [c.attemptId]); // historical attempt shape
    expect(await refOf(c.attemptId)).toHaveLength(0);
    useProviderPayments(authoritativePayment(c.paymentId, c.orderId, "cus_synthetic_owner_81"));
    const r = await post0(hook("evt-p5-e11-paid", "PAYMENT_RECEIVED", "RECEIVED", c.orderId, c.paymentId));
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ handled: true });
    const s = await snap(c.attemptId, c.orderId);
    expect(s.attempt.status).toBe("paid"); expect(s.variant).toEqual({ stock: 2, reserved: 0 });
    // historical attempt WITHOUT paymentId + numeric reference: still never adopted
    const h = await create("p5-e11-attempt-000000002", "other-82");
    await pool.execute("DELETE FROM auditLogs WHERE action='stock.payment_reference.v1' AND entityId=?", [h.attemptId]);
    await pool.execute("UPDATE stockCheckoutAttempts SET paymentId=NULL, providerState='ambiguous' WHERE attemptId=?", [h.attemptId]);
    await pool.execute("UPDATE orders SET stockPaymentId=NULL WHERE id=?", [h.orderId]);
    useProviderPayments(
      authoritativePayment(c.paymentId, c.orderId, "cus_synthetic_owner_81"),
      authoritativePayment(h.paymentId, h.orderId, "cus_synthetic_other_82"),
    );
    const r2 = await post0(hook("evt-p5-e11-hist", "PAYMENT_RECEIVED", "RECEIVED", h.orderId, h.paymentId));
    expect(r2.status).toBe(200); expect(r2.body).toMatchObject({ reason: "stock_event_conflict" });
    expect((await snap(h.attemptId, h.orderId)).order).toMatchObject({ status: "pending", paymentStatus: "unconfirmed" });
    expect(await alertKinds()).toEqual(["PAYMENT_WITHOUT_CORRELATION"]);
  });

  it("E12 no payment is ever confirmed on insufficient evidence: every held scenario leaves orders pending, stock reserved and no consumed reservation", async () => {
    await setStock(10);
    const cs = [] as Array<{ orderId: string; attemptId: string; paymentId: string; ref: string }>;
    for (let i = 0; i < 4; i += 1) { const c = await create(`p5-e12-attempt-00000000${i}`, i % 2 ? "other-82" : "owner-81").catch(async () => { await pool.execute("UPDATE stockCheckoutAttempts SET status='released' WHERE ownerUserId=?", [i % 2 ? 82 : 81]); return create(`p5-e12-attempt-00000000${i}`, i % 2 ? "other-82" : "owner-81"); }); cs.push({ ...c, ref: (await refOf(c.attemptId))[0] }); }
    const [a] = cs;
    const probes = [
      hook("evt-p5-e12-1", "PAYMENT_RECEIVED", "RECEIVED", a.ref, "pay-nobody"),
      hook("evt-p5-e12-2", "PAYMENT_RECEIVED", "RECEIVED", a.orderId, "pay-nobody-2"),
      hook("evt-p5-e12-3", "PAYMENT_RECEIVED", "RECEIVED", a.ref, a.paymentId, { currency: "USD" }),
      hook("evt-p5-e12-4", "PAYMENT_RECEIVED", "RECEIVED", "L4CKOS-STOCK-ATTEMPT:v1:" + "A".repeat(31), a.paymentId),
      hook("evt-p5-e12-5", "PAYMENT_PENDING", "PENDING", a.ref, a.paymentId),
    ];
    for (const p of probes) await post0(p);
    const [[consumed]] = await pool.query<any[]>("SELECT COUNT(*) n FROM stockReservations WHERE status='consumed'");
    const [[paidAttempts]] = await pool.query<any[]>("SELECT COUNT(*) n FROM stockCheckoutAttempts WHERE status='paid'");
    expect(Number(consumed.n)).toBe(0); expect(Number(paidAttempts.n)).toBe(0);
    expect(await readVariantInventory(8)).toMatchObject({ stock: 10, reservedStock: cs.length });
  });

  // ======================================================= V2: read-only endpoint, listing, sanitization, idempotency
  const seedAlert = (kind: string, n: number) => recordReconciliationAlert(poolExec(), { kind, subject: { attemptId: `seed-attempt-${kind}-${n}-0000000000`, paymentId: `pay-seed-${kind}-${n}-123456789` }, providerEventId: `evt-seed-${kind}-${n}`, reason: kind });
  const forceCreatedAt = (id: number, secondsAgo: number) => pool.execute("UPDATE notificationOutbox SET createdAt = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? SECOND) WHERE id=?", [secondsAgo, id]);

  it("E13 filters are applied BEFORE the limit (old P1 cases are not hidden behind 30 newer P3 rows)", async () => {
    const x = poolExec();
    for (let i = 0; i < 3; i += 1) await seedAlert("PAYMENT_WITHOUT_CORRELATION", i);
    for (let i = 0; i < 30; i += 1) await seedAlert("STOCK_OVERDUE_OBSERVED", i);
    const p1 = await queryReconciliationAlerts(x, { priority: "P1", limit: 2 });
    expect(p1.items).toHaveLength(2); expect(p1.items.every(i => i.priority === "P1" && i.category === "payment_without_correlation")).toBe(true);
    expect(p1.nextCursor).not.toBeNull();
    const rest = await queryReconciliationAlerts(x, { priority: "P1", limit: 2, cursor: p1.nextCursor });
    expect(rest.items).toHaveLength(1); expect(rest.nextCursor).toBeNull();
    expect((await queryReconciliationAlerts(x, { category: "observation_requires_review", limit: 100 })).items).toHaveLength(30);
    // state filter before limit: resolve the OLDEST alert, then ask for resolved with limit 1
    const [oldest] = await alerts();
    expect(await claimReconciliationAlertForReview(x, oldest.id, "operator.one", 60)).toBe("claimed");
    expect((await queryReconciliationAlerts(x, { state: "in_review", limit: 1 })).items.map(i => i.id)).toEqual([oldest.id]);
    expect(await resolveReconciliationAlert(x, oldest.id, "operator.one")).toBe("resolved");
    expect((await queryReconciliationAlerts(x, { state: "resolved", limit: 1 })).items.map(i => i.id)).toEqual([oldest.id]);
    const pending = await queryReconciliationAlerts(x, { state: "pending", limit: 100 });
    expect(pending.items.some(i => i.id === oldest.id)).toBe(false); expect(pending.items).toHaveLength(32);
  });

  it("E14 pagination is deterministic (keyset by id): no duplicates/gaps, stable under concurrent inserts between pages", async () => {
    const x = poolExec();
    for (let i = 0; i < 33; i += 1) await seedAlert("STOCK_OVERDUE_OBSERVED", i);
    const seen: number[] = []; let cursor: number | null = null; let pages = 0;
    while (true) {
      const page = await queryReconciliationAlerts(x, { limit: 10, cursor });
      seen.push(...page.items.map(i => i.id)); pages += 1;
      if (pages === 1) await seedAlert("STOCK_OVERDUE_OBSERVED", 999); // inserted between page 1 and 2
      if (page.nextCursor === null) break; cursor = page.nextCursor;
    }
    expect(pages).toBe(4); expect(new Set(seen).size).toBe(seen.length); expect(seen).toHaveLength(33);
    expect([...seen].sort((a, b) => b - a)).toEqual(seen);
    expect((await queryReconciliationAlerts(x, { limit: 10 })).items).toEqual((await queryReconciliationAlerts(x, { limit: 10 })).items);
    expect((await queryReconciliationAlerts(x, { limit: 1000 })).items.length).toBeLessThanOrEqual(100); // hard cap
  });

  it("E15 projection is sanitized: truncated ids, no payload/metadata/PII, ages and states computed by the database clock", async () => {
    const x = poolExec();
    await seedAlert("PAYMENT_WITHOUT_CORRELATION", 1);
    const [row] = await alerts(); await forceCreatedAt(row.id, 7200);
    const { items } = await queryReconciliationAlerts(x, {});
    const view = items[0] as any; const json = JSON.stringify(items);
    expect(Object.keys(view).sort()).toEqual(["ageSeconds", "attemptRef", "category", "detectedAt", "id", "kind", "orderId", "paymentRef", "priority", "reasonText", "reviewer", "state"].sort());
    expect(json).not.toContain("pay-seed-PAYMENT_WITHOUT_CORRELATION-1-123456789"); expect(json).not.toContain("seed-attempt-PAYMENT_WITHOUT_CORRELATION-1-0000000000");
    expect(json).not.toMatch(/payload|metadata|financialMutation|email|cpf|@/i);
    expect(view.paymentRef).toMatch(/^.{4,8}…[^…]{3,6}$/); expect(view.priority).toBe("P1"); expect(view.state).toBe("pending");
    expect(view.ageSeconds).toBeGreaterThanOrEqual(7190); expect(view.ageSeconds).toBeLessThan(7300); expect(typeof view.reasonText).toBe("string");
    const sum = await summarizeReconciliationAlerts(x);
    expect(sum).toMatchObject({ pending: 1, inReview: 0, resolved: 0, openByPriority: { P1: 1, P2: 0, P3: 0 } }); expect(sum.oldestOpenAgeSeconds).toBeGreaterThanOrEqual(7190);
  });

  it("E16 admin endpoints are read-only and admin-only (owner => FORBIDDEN, anonymous => UNAUTHORIZED); no mutation procedure is exposed; nothing changes", async () => {
    await seedAlert("PAYMENT_WITHOUT_CORRELATION", 1); await seedAlert("STOCK_OVERDUE_OBSERVED", 2);
    const before = JSON.stringify(await alerts());
    const admin: any = adminHttpClient("admin-83");
    const list = await admin.admin.reconciliationAlertsList.query({ limit: 10 });
    expect(list.items).toHaveLength(2); expect(list.nextCursor).toBeNull();
    expect(await admin.admin.reconciliationAlertsList.query({ priority: "P1" })).toMatchObject({ items: [expect.objectContaining({ category: "payment_without_correlation" })] });
    expect(await admin.admin.reconciliationAlertsSummary.query()).toMatchObject({ pending: 2, openByPriority: { P1: 1, P3: 1 } });
    await expect((adminHttpClient("owner-81") as any).admin.reconciliationAlertsList.query({})).rejects.toThrow(/FORBIDDEN|permiss|admin/i);
    await expect((adminHttpClient("owner-81") as any).admin.reconciliationAlertsSummary.query()).rejects.toThrow();
    await expect((adminHttpClient("") as any).admin.reconciliationAlertsList.query({})).rejects.toThrow();
    await expect(admin.admin.reconciliationAlertsList.query({ limit: 101 })).rejects.toThrow();
    await expect(admin.admin.reconciliationAlertsList.query({ state: "bogus" })).rejects.toThrow();
    const procs = Object.keys((appRouter as any)._def.procedures).filter(k => k.startsWith("admin.reconciliationAlerts"));
    expect(procs.sort()).toEqual(["admin.reconciliationAlertsList", "admin.reconciliationAlertsSummary"]);
    expect(JSON.stringify(await alerts())).toBe(before);
  });

  it("E17 the provider idempotency key is bound to the attempt's strong reference: a reused orderId after a restore gets a DIFFERENT key", async () => {
    await setStock(3);
    const first = await create("p5-e17-attempt-0000000001");
    const [ref1] = await refOf(first.attemptId);
    expect(providerCalls[0].idempotencyKey).toBe(`stock:${first.orderId}:${ref1.split(":").pop()}`);
    await resetDatabase(); paymentIds.clear(); providerCalls = []; await setStock(3);
    const second = await create("p5-e17-attempt-0000000002");
    expect(second.orderId).toBe(first.orderId); // numeric id reused
    const [ref2] = await refOf(second.attemptId);
    expect(providerCalls[0].idempotencyKey).toBe(`stock:${second.orderId}:${ref2.split(":").pop()}`);
    expect(providerCalls[0].idempotencyKey).not.toBe(`stock:${first.orderId}:${ref1.split(":").pop()}`);
    expect(ref1).not.toBe(ref2);
  });
});
