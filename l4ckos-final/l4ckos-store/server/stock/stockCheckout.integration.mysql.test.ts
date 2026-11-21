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
import { productionSummary, saveBatch } from "../database/productionBatches";
import { processSignedStockWebhook, type StockCheckoutStore } from "./stockCheckout";
import { createMysqlStockCheckoutStore } from "./mysqlStockCheckoutStore";
import { canonicalizeSeedVariants } from "./testing/canonicalizeSeedVariants";
import { checkout as legacyCheckout } from "../database/checkout";
import paymentRoutes from "../routes/paymentRoutes";
import shippingRoutes from "../routes/shippingRoutes";

const providerSimulator = vi.hoisted(() => ({
  payments: new Map<string, Record<string, unknown> & { orderId: string }>(),
  unavailable: false,
}));
vi.mock("../services/asaasService", async importOriginal => {
  const original = await importOriginal<typeof import("../services/asaasService")>();
  return {
    ...original,
    getAsaasPayment: vi.fn(async (paymentId: string) => {
      if (providerSimulator.unavailable) throw Object.assign(new Error("SYNTHETIC_PROVIDER_UNAVAILABLE"), { providerStatus: 503 });
      const payment = providerSimulator.payments.get(paymentId);
      if (!payment) throw Object.assign(new Error("SYNTHETIC_PROVIDER_PAYMENT_NOT_FOUND"), { providerStatus: 404 });
      const { orderId: _orderId, ...current } = payment;
      return current;
    }),
  };
});

const database = process.env.STOCK_MYSQL_DATABASE ?? "";
const host = process.env.STOCK_MYSQL_HOST ?? "";
const port = Number(process.env.STOCK_MYSQL_PORT ?? 0);
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

describe.skipIf(!process.env.STOCK_MYSQL_HOST)("STOCK mounted tRPC integration (MySQL 9.7.2 disposable only)", () => {
  beforeAll(async () => {
    assertSyntheticTarget();
    pool = createPool({ host, port, user, password, database, connectionLimit: 8 });
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
          providerCalls.push(input);
          // unique per call (a sync push+length), so concurrent attempts never collide on the payment unique key
          const paymentId = paymentIdFor(input.idempotencyKey);
          const customerId = "cus-synthetic-stock-customer";
          providerSimulator.payments.set(paymentId, {
            id: paymentId, orderId: input.orderId, externalReference: input.externalReference ?? input.orderId,
            value: input.amountCents / 100, currency: "BRL", customer: customerId, billingType: "PIX", status: "PENDING", deleted: false,
          });
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
    app.post("/webhook/asaas", (req, _res, next) => {
      const payment = req.body?.payment;
      const current = typeof payment?.id === "string" ? providerSimulator.payments.get(payment.id) : undefined;
      if (current) {
        // Test fixtures historically used the order id as a placeholder. Emit
        // the actual provider reference from the simulated charge instead.
        if (String(payment.externalReference ?? "") === current.orderId) payment.externalReference = current.externalReference;
        if (typeof payment.status === "string") current.status = payment.status;
        if (req.body?.event === "PAYMENT_DELETED") current.deleted = payment.deleted === true;
      }
      req.body.account ??= { id: "account-synthetic-stock" };
      next();
    }, asaasWebhookHandler);
    app.post("/webhook-asaas-runtime-absent", createAsaasWebhookHandler(() => undefined));
    httpServer = createServer(app);
    await new Promise<void>(resolveListen => httpServer.listen(0, "127.0.0.1", resolveListen));
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("Synthetic HTTP harness did not bind TCP loopback");
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 30_000);

  beforeEach(async () => {
    await resetDatabase();
    providerCalls = [];
    paymentIds.clear();
    providerSimulator.payments.clear();
    providerSimulator.unavailable = false;
    vi.stubEnv("PUBLIC_SITE_MODE", "store");
    vi.stubEnv("PUBLIC_CHECKOUT_ENABLED", "true");
    vi.stubEnv("ASAAS_WEBHOOK_TOKEN", syntheticWebhookToken);
    vi.stubEnv("ASAAS_WEBHOOK_ACCOUNT_ID", "account-synthetic-stock");
    vi.stubEnv("ASAAS_WEBHOOK_ACCOUNT_CURRENCY", "BRL");
  });

  it("gates direct STOCK and legacy API calls to the configured synthetic buyer before any side effect", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RAILWAY_PROJECT_ID", "66faf690-a068-40d1-b85c-cb5d8595560a");
    vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "5335340d-311c-47e9-9713-6e5a86969c88");
    vi.stubEnv("RAILWAY_SERVICE_ID", "d66762a4-422a-4656-94a1-502215a27aa2");
    vi.stubEnv("STAGING_SYNTHETIC_BUYER_GATE_ENABLED", "true");
    vi.stubEnv("STAGING_SYNTHETIC_BUYER_IDS", "81");
    shippingQuoteCalls = [];
    shippingQuoteResult = { options: [{ id: "melhor-envio-1", label: "Fixture", description: "Fixture", price: 1, minDays: 1, maxDays: 1 }], source: "melhor-envio" };

    const request = { items: [{ productId: 4, variantId: 8, quantity: 1 }], address: syntheticDelivery.address };
    await expect(httpClient("other-82").stockCheckout.quoteShipping.mutate(request))
      .rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    await expect(httpClient("other-82").stockCheckout.create.mutate({
      attemptId: "stock-gate-denied-0001", items: request.items, delivery: syntheticDelivery,
    })).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    await expect(httpClient("anonymous").stockCheckout.create.mutate({
      attemptId: "stock-gate-anon-0001", items: request.items, delivery: syntheticDelivery,
    })).rejects.toMatchObject({ data: { code: "UNAUTHORIZED" } });
    await expect(httpClient("other-82").stockCheckout.create.mutate({
      attemptId: "stock-gate-spoof-0001", userId: 81, items: request.items, delivery: syntheticDelivery,
    } as never)).rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });

    const legacyClient = adminHttpClient("other-82");
    await expect(legacyClient.orders.createAsaasCharge.mutate({
      checkoutAttemptId: "9434467d-2687-46e7-b5b6-d076d3bfe456", method: "PIX",
      items: [{ productId: 4, variantId: 8, size: "M", color: "Preto", quantity: 1 }],
      shipping: { cep: "70000000", optionId: "local-plano-piloto" }, shippingAddress: syntheticDelivery.address,
      customer: { name: "Other Customer", cpfCnpj: "11144477735", email: "other-customer@example.invalid" },
    } as never)).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    await expect(legacyClient.orders.validateCoupon.mutate({
      code: "SYNTHETIC", items: request.items, shipping: { cep: "70000000", optionId: "test" },
    } as never)).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    const cookie = `${COOKIE_NAME}=${sessionTokens["other-82"]}`;
    const customer = await fetch(`${baseUrl}/api/payments/create-customer`, {
      method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ cpf: "11144477735" }),
    });
    expect(customer.status).toBe(403);
    const legacyRest = await fetch(`${baseUrl}/api/payments/create-checkout`, {
      method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({}),
    });
    expect(legacyRest.status).toBe(403);
    const shipping = await fetch(`${baseUrl}/api/shipping/quote`, {
      method: "POST", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ cep: "70000000", itemCount: 1, subtotal: 129 }),
    });
    expect(shipping.status).toBe(403);
    const anonymousShipping = await fetch(`${baseUrl}/api/shipping/quote`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ cep: "70000000", itemCount: 1, subtotal: 129 }),
    });
    expect(anonymousShipping.status).toBe(401);

    expect(shippingQuoteCalls).toHaveLength(0);
    expect(providerCalls).toHaveLength(0);
    for (const table of ["orders", "orderItems", "stockReservations", "stockCheckoutAttempts"]) {
      const [rows] = await pool.query<(Record<string, unknown> & { n: number })[]>(`SELECT COUNT(*) AS n FROM ${table}`);
      expect(Number(rows[0].n), table).toBe(0);
    }

    for (const key of syntheticGateEnvKeys) vi.stubEnv(key, originalSyntheticGateEnv[key]);
  });

  async function buyLegacyVariant(attemptId: string, chargeCalls: string[] = [], variantId = 8) {
    const connection = await pool.getConnection();
    try {
      return await legacyCheckout(connection, {
        userId: 81,
        checkoutAttemptId: attemptId,
        method: "PIX",
        items: [{ productId: 4, variantId, size: variantId === 8 ? "M" : "G", color: "Preto", quantity: 1 }],
        shipping: { cep: "70000000", optionId: "local-plano-piloto" },
        shippingAddress: syntheticDelivery.address,
        customer: { name: "STOCK Customer", cpfCnpj: "11144477735", email: "stock-customer@example.invalid" },
      }, {
        quote: async () => ({ options: [{ id: "local-plano-piloto", label: "Fixture", price: 0 }] }),
        charge: async ({ orderId }) => {
          chargeCalls.push(`order-${orderId}`);
          return { method: "PIX", customerId: `customer-${orderId}`, paymentId: `legacy-payment-${orderId}`,
            invoiceUrl: null, pixQrCode: null, pixCopyPaste: null, bankSlipUrl: null,
            digitableLine: null, nossoNumero: null, billingType: "PIX" };
        },
      });
    } finally {
      connection.release();
    }
  }

  it("does not let legacy reserve a variant already held by STOCK", async () => {
    const stock = await httpClient("owner-81").stockCheckout.create.mutate({
      attemptId: "stock-wins-cross-path-0001", items: [{ productId: 4, variantId: 8, quantity: 1 }], delivery: syntheticDelivery,
    });
    let financialCalls = 0;
    const connection = await pool.getConnection();
    try {
      await expect(legacyCheckout(connection, {
        userId: 81, checkoutAttemptId: "ad65be9d-2f28-4a0a-b383-63ef7fc0a1b2", method: "PIX",
        items: [{ productId: 4, variantId: 8, size: "M", color: "Preto", quantity: 1 }],
        shipping: { cep: "70000000", optionId: "local-plano-piloto" }, shippingAddress: syntheticDelivery.address,
        customer: { name: "STOCK Customer", cpfCnpj: "11144477735", email: "stock-customer@example.invalid" },
      }, {
        quote: async () => ({ options: [{ id: "local-plano-piloto", label: "Fixture", price: 0 }] }),
        charge: async ({ orderId }) => { financialCalls++; return { method: "PIX", customerId: `customer-${orderId}`, paymentId: `legacy-payment-${orderId}`, invoiceUrl: null, pixQrCode: null, pixCopyPaste: null, bankSlipUrl: null, digitableLine: null, nossoNumero: null, billingType: "PIX" }; },
      })).rejects.toMatchObject({ code: "CHECKOUT_STOCK_INSUFFICIENT" });
    } finally { connection.release(); }
    expect(financialCalls).toBe(0);
    expect(providerCalls).toHaveLength(1);
    expect(stock.status).toBe("pending");
    expect(await readVariantInventory(8)).toMatchObject({ stock: 1, reservedStock: 1 });
    const [rows] = await pool.query<(Record<string, unknown> & { n: number })[]>("SELECT COUNT(*) AS n FROM stockReservations WHERE variantId=8 AND status='active'");
    expect(Number(rows[0].n)).toBe(1);
  });

  it("REPRO: rejects legacy after the STOCK ledger expires but its payment is held for reconciliation", async () => {
    const attemptId = "stock-expired-payment-held-0001";
    const stock = await httpClient("owner-81").stockCheckout.create.mutate({
      attemptId, items: [{ productId: 4, variantId: 8, quantity: 1 }], delivery: syntheticDelivery,
    });
    expect(stock.status).toBe("pending");

    await pool.execute(
      "UPDATE stockCheckoutAttempts SET reservationExpiresAt = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE attemptId = ?",
      [attemptId],
    );
    await pool.execute(
      "UPDATE stockReservations SET expiresAt = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE attemptId = ? AND status = 'active'",
      [attemptId],
    );
    const expiry = await createMysqlStockCheckoutStore(pool).transaction(tx => tx.expireDueReservations(20));
    expect(expiry.releasedAttemptIds).toEqual([]);
    expect(expiry.reconciliationAttemptIds).toEqual([attemptId]);

    const [attemptRows] = await pool.execute<(Record<string, unknown> & {
      status: string; providerState: string; reconciliationRequiredAt: Date | null;
    })[]>("SELECT status, providerState, reconciliationRequiredAt FROM stockCheckoutAttempts WHERE attemptId = ?", [attemptId]);
    const [reservationRows] = await pool.execute<(Record<string, unknown> & {
      status: string; expiresAt: Date;
    })[]>("SELECT status, expiresAt FROM stockReservations WHERE attemptId = ?", [attemptId]);
    expect(attemptRows[0]).toMatchObject({ status: "reserved", providerState: "created" });
    expect(attemptRows[0]?.reconciliationRequiredAt).not.toBeNull();
    expect(reservationRows[0]?.status).toBe("active");
    const [expiredRows] = await pool.execute<(Record<string, unknown> & { expired: number })[]>(
      "SELECT (expiresAt <= UTC_TIMESTAMP(3)) AS expired FROM stockReservations WHERE attemptId = ?",
      [attemptId],
    );
    expect(Number(expiredRows[0]?.expired)).toBe(1);
    expect(await readVariantInventory(8)).toMatchObject({ stock: 1, reservedStock: 1 });

    const legacyFinancialCalls: string[] = [];
    await expect(buyLegacyVariant("ad65be9d-2f28-4a0a-b383-63ef7fc0a1b8", legacyFinancialCalls))
      .rejects.toMatchObject({ code: "CHECKOUT_STOCK_INSUFFICIENT" });
    expect(legacyFinancialCalls).toHaveLength(0);
    expect(providerCalls).toHaveLength(1); // only the original synthetic STOCK payment
    expect(await readVariantInventory(8)).toMatchObject({ stock: 1, reservedStock: 1 });
    const [orders] = await pool.execute<(Record<string, unknown> & { n: number })[]>(
      "SELECT COUNT(*) AS n FROM orders WHERE stockAttemptId IS NULL",
    );
    expect(Number(orders[0].n)).toBe(0); // no legacy order was created
  });

  it("does not let STOCK reserve a variant already held by legacy", async () => {
    const chargeCalls: string[] = [];
    const attemptId = "ad65be9d-2f28-4a0a-b383-63ef7fc0a1b3";
    const legacy = await buyLegacyVariant(attemptId, chargeCalls);
    const replay = await buyLegacyVariant(attemptId, chargeCalls);
    expect(replay.replayed).toBe(true);
    expect(replay.orderId).toBe(legacy.orderId);
    expect(chargeCalls).toHaveLength(1);
    const stockPaymentsBefore = providerCalls.length;
    await expect(httpClient("other-82").stockCheckout.create.mutate({
      attemptId: "stock-loses-cross-path-0001", items: [{ productId: 4, variantId: 8, quantity: 1 }], delivery: syntheticDelivery,
    })).rejects.toMatchObject({ data: { appError: { code: "STOCK_UNAVAILABLE" } } });
    expect(providerCalls).toHaveLength(stockPaymentsBefore);
    expect(await readVariantInventory(8)).toMatchObject({ stock: 1, reservedStock: 0 });
    const [rows] = await pool.query<(Record<string, unknown> & { n: number })[]>("SELECT COUNT(*) AS n FROM stockReservations WHERE variantId=8 AND status='active'");
    expect(Number(rows[0].n)).toBe(1);
  });

  it("lets STOCK claim the unit after a legacy reservation is cancelled or expires", async () => {
    const cancelled = await buyLegacyVariant("ad65be9d-2f28-4a0a-b383-63ef7fc0a1b5");
    await updateOrderAndReserveDeliveredEmailEvents(cancelled.orderId, { status: "cancelled" }, 81);
    const [cancelledReservation] = await pool.query<(Record<string, unknown> & { status: string })[]>(
      "SELECT status FROM stockReservations WHERE orderId = ?", [cancelled.orderId],
    );
    expect(cancelledReservation[0]?.status).toBe("released");
    const afterCancel = await httpClient("owner-81").stockCheckout.create.mutate({
      attemptId: "stock-after-legacy-cancel-0001", items: [{ productId: 4, variantId: 8, quantity: 1 }], delivery: syntheticDelivery,
    });
    expect(afterCancel.status).toBe("pending");

    await resetDatabase();
    providerCalls = [];
    const expired = await buyLegacyVariant("ad65be9d-2f28-4a0a-b383-63ef7fc0a1b6");
    await pool.execute("UPDATE stockReservations SET expiresAt = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE orderId = ?", [expired.orderId]);
    const afterExpiry = await httpClient("owner-81").stockCheckout.create.mutate({
      attemptId: "stock-after-legacy-expiry-0001", items: [{ productId: 4, variantId: 8, quantity: 1 }], delivery: syntheticDelivery,
    });
    expect(afterExpiry.status).toBe("pending");
    const [rows] = await pool.query<(Record<string, unknown> & { active: number })[]>(
      "SELECT COUNT(*) AS active FROM stockReservations WHERE variantId=8 AND status='active' AND expiresAt>UTC_TIMESTAMP(3)",
    );
    expect(Number(rows[0].active)).toBe(1);
  });

  it("allows a different variant with available stock while the first variant is held", async () => {
    await pool.execute("INSERT INTO productVariants (id, productId, name, sku, size, color, price, stock, reservedStock, isActive) VALUES (9, 4, 'TSHIRT-BLK-G', 'TSHIRT-BLK-G', 'G', 'Preto', 14900, 2, 0, 1)");
    await canonicalizeSeedVariants(pool);
    await httpClient("owner-81").stockCheckout.create.mutate({
      attemptId: "stock-cross-variant-held-0001", items: [{ productId: 4, variantId: 8, quantity: 1 }], delivery: syntheticDelivery,
    });
    const legacy = await buyLegacyVariant("ad65be9d-2f28-4a0a-b383-63ef7fc0a1b7", [], 9);
    expect(legacy.replayed).not.toBe(true);
    expect(await readVariantInventory(8)).toMatchObject({ stock: 1, reservedStock: 1 });
    expect(await readVariantInventory(9)).toMatchObject({ stock: 2, reservedStock: 0 });
    const [rows] = await pool.query<(Record<string, unknown> & { variantId: number; total: number })[]>(
      "SELECT variantId, COUNT(*) AS total FROM stockReservations WHERE status='active' GROUP BY variantId ORDER BY variantId",
    );
    expect(rows.map(row => [Number(row.variantId), Number(row.total)])).toEqual([[8, 1], [9, 1]]);
  });

  it("serializes a legacy and STOCK race for the last variant unit", async () => {
    const results = await Promise.allSettled([
      buyLegacyVariant("ad65be9d-2f28-4a0a-b383-63ef7fc0a1b4"),
      httpClient("other-82").stockCheckout.create.mutate({
        attemptId: "stock-cross-path-race-0001", items: [{ productId: 4, variantId: 8, quantity: 1 }], delivery: syntheticDelivery,
      }),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    const [rows] = await pool.query<(Record<string, unknown> & { active: number; stock: number; reservedStock: number; legacyReserved: number })[]>(
      "SELECT (SELECT COUNT(*) FROM stockReservations WHERE variantId=8 AND status='active') AS active, (SELECT COALESCE(SUM(quantity),0) FROM stockReservations WHERE variantId=8 AND attemptId IS NULL AND status='active' AND expiresAt>UTC_TIMESTAMP(3)) AS legacyReserved, v.stock, v.reservedStock FROM productVariants v WHERE v.id=8",
    );
    expect(Number(rows[0].active)).toBe(1);
    expect(Number(rows[0].stock) - Number(rows[0].reservedStock) - Number(rows[0].legacyReserved)).toBe(0);
    // If legacy won, its charge must be the only external financial action; if STOCK won, its provider is called once.
    expect(providerCalls.length + Number(results[0].status === "fulfilled")).toBe(1);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    configureStockCheckoutRuntimeForLocalHarness(undefined);
    if (httpServer) await new Promise<void>(resolveClose => httpServer.close(() => resolveClose()));
    if (pool && process.env.STOCK_LOCAL_HARNESS === "true") setStockLocalHarnessDb(null);
    if (pool) await pool.end();
  });

  it("runs checkout over authenticated HTTP, accepts a signed synthetic webhook, and resumes paid state", async () => {
    const owner = httpClient("owner-81");
    // V6 storefront contract: variants come from the server's sellable catalog, not from the product DTO.
    const catalog = await owner.products.sellableVariants.query(4);
    expect(catalog).toMatchObject({ productId: 4, hasVariants: true, publicPurchaseAllowed: true });
    expect(catalog.variants).toEqual([expect.objectContaining({ variantId: 8, size: "M", color: "Preto", available: true, availableUnits: 1, price: 12900 })]);
    const request = { attemptId: "stock-e2e-attempt-0001", items: [{ productId: 4, variantId: 8, quantity: 1 }], delivery: syntheticDelivery };
    const missingDelivery = { attemptId: request.attemptId, items: request.items };
    await expect(owner.stockCheckout.create.mutate(missingDelivery as never))
      .rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });
    await expect(owner.stockCheckout.create.mutate({ ...request, delivery: { ...syntheticDelivery, address: { ...syntheticDelivery.address, street: " " } } as never }))
      .rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });
    await expect(owner.stockCheckout.create.mutate({ ...request, delivery: { ...syntheticDelivery, address: { ...syntheticDelivery.address, zipCode: "74000000" } } }))
      .rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });
    expect(providerCalls).toHaveLength(0);
    const created = await owner.stockCheckout.create.mutate(request);
    expect(created).toMatchObject({ status: "pending", amountCents: 12900, replayed: false });
    expect(providerCalls).toHaveLength(1);
    await expect(owner.stockCheckout.create.mutate({ ...request, attemptId: "stock-e2e-insufficient-0001" }))
      .rejects.toMatchObject({ data: { appError: { code: "CHECKOUT_ATTEMPT_NOT_REUSABLE" } } });

    const [reservedRows] = await pool.execute<(Record<string, unknown> & { reservedStock: number })[]>("SELECT reservedStock FROM productVariants WHERE id = 8");
    expect(Number(reservedRows[0]?.reservedStock)).toBe(1);

    const replay = await owner.stockCheckout.create.mutate(request);
    expect(replay.replayed).toBe(true);
    expect(providerCalls).toHaveLength(1);
    await expect(owner.stockCheckout.create.mutate({
      ...request,
      delivery: { ...syntheticDelivery, address: { ...syntheticDelivery.address, recipient: "Outro Destinatário" } },
    })).rejects.toMatchObject({ data: { code: "CONFLICT" } });
    await expect(adminHttpClient("admin-83").admin.orderUpdate.mutate({ orderId: Number(created.orderId), status: "shipped" }))
      .rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });

    await expect(httpClient("other-82").stockCheckout.resume.query({ attemptId: request.attemptId })).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    await expect(httpClient("anonymous").stockCheckout.resume.query({ attemptId: request.attemptId })).rejects.toMatchObject({ data: { code: "UNAUTHORIZED" } });
    await expect(owner.stockCheckout.create.mutate({ ...request, items: [{ ...request.items[0], price: 1 }] } as never)).rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });

    const webhookBody = JSON.stringify({
      id: "evt-synthetic-paid-1",
      event: "PAYMENT_RECEIVED",
      payment: { id: "pay-synthetic-1", externalReference: created.orderId, status: "RECEIVED", value: 129, currency: "BRL", billingType: "PIX" },
    });
    const invalidWebhook = await fetch(`${baseUrl}/webhook/asaas`, { method: "POST", headers: { "content-type": "application/json", "asaas-access-token": "invalid" }, body: webhookBody });
    expect(invalidWebhook.status).toBe(401);
    const deliver = () => fetch(`${baseUrl}/webhook/asaas`, { method: "POST", headers: { "content-type": "application/json", "asaas-access-token": syntheticWebhookToken }, body: webhookBody });
    const [validWebhook, duplicateWebhook] = await Promise.all([deliver(), deliver()]);
    // V6 durable inbox: a CONCURRENT duplicate hits the row lock (NOWAIT) and gets a retryable 503; the provider redelivers.
    // Exactly one delivery wins, nothing else is allowed, and the sequential redelivery is an acknowledged duplicate.
    const concurrent = [validWebhook.status, duplicateWebhook.status].sort();
    expect(concurrent[0] === 200 && (concurrent[1] === 200 || concurrent[1] === 503)).toBe(true);
    expect((await deliver()).status).toBe(200);
    const [ledgerRows] = await pool.execute<(Record<string, unknown> & { count: number })[]>("SELECT COUNT(*) AS count FROM stockWebhookEvents WHERE eventId = 'evt-synthetic-paid-1'");
    expect(Number(ledgerRows[0]?.count)).toBe(1);
    const latePending = await fetch(`${baseUrl}/webhook/asaas`, { method: "POST", headers: { "content-type": "application/json", "asaas-access-token": syntheticWebhookToken }, body: JSON.stringify({ id: "evt-synthetic-late-pending", event: "PAYMENT_CREATED", payment: { id: "pay-synthetic-1", externalReference: created.orderId, status: "PENDING", value: 129, currency: "BRL" } }) });
    const lateFailed = await fetch(`${baseUrl}/webhook/asaas`, { method: "POST", headers: { "content-type": "application/json", "asaas-access-token": syntheticWebhookToken }, body: JSON.stringify({ id: "evt-synthetic-late-failed", event: "PAYMENT_REFUSED", payment: { id: "pay-synthetic-1", externalReference: created.orderId, status: "REFUSED", value: 129, currency: "BRL" } }) });
    expect(latePending.status).toBe(200);
    expect(lateFailed.status).toBe(200);

    const resumed = await owner.stockCheckout.resume.query({ attemptId: request.attemptId });
    expect(resumed).toMatchObject({ status: "paid", orderId: created.orderId, amountCents: 12900 });
    await expect(owner.stockCheckout.resumeLatest.query()).resolves.toMatchObject({ attemptId: request.attemptId, status: "paid" });
    const [inventoryRows] = await pool.execute<(Record<string, unknown> & { stock: number; reservedStock: number })[]>("SELECT stock, reservedStock FROM productVariants WHERE id = 8");
    expect(inventoryRows[0]).toMatchObject({ stock: 0, reservedStock: 0 });
    const [adminOrders] = await pool.execute<(Record<string, unknown> & { id: number; userId: number; status: string; paymentStatus: string; stockAttemptId: string; stockPaymentId: string; productName: string; variantId: number; skuSnapshot: string; sizeSnapshot: string; colorSnapshot: string })[]>(
      `SELECT o.id, o.userId, o.status, o.paymentStatus, o.stockAttemptId, o.stockPaymentId,
              p.name AS productName, r.variantId, r.skuSnapshot, r.sizeSnapshot, r.colorSnapshot
         FROM orders o
         JOIN users u ON u.id = o.userId
         LEFT JOIN stockReservations r ON r.orderId = o.id
         LEFT JOIN products p ON p.id = r.productId
        WHERE o.stockAttemptId = ?`,
      [request.attemptId],
    );
    expect(adminOrders).toHaveLength(1);
    expect(adminOrders[0]).toMatchObject({ id: Number(created.orderId), userId: 81, status: "paid", paymentStatus: "confirmed", stockAttemptId: request.attemptId, stockPaymentId: "pay-synthetic-1", productName: "Synthetic STOCK shirt", variantId: 8, skuSnapshot: "TSHIRT-BLK-M", sizeSnapshot: "M", colorSnapshot: "Preto" });
    const [adminItems] = await pool.execute<(Record<string, unknown> & { productId: number; variantId: number; skuSnapshot: string; sizeSnapshot: string; colorSnapshot: string; unitPrice: number; totalPrice: number; quantity: number })[]>(
      "SELECT productId, variantId, skuSnapshot, sizeSnapshot, colorSnapshot, unitPrice, totalPrice, quantity FROM orderItems WHERE orderId = ?",
      [created.orderId],
    );
    expect(adminItems).toEqual([expect.objectContaining({ productId: 4, variantId: 8, skuSnapshot: "TSHIRT-BLK-M", sizeSnapshot: "M", colorSnapshot: "Preto", unitPrice: 12900, totalPrice: 12900, quantity: 1 })]);
    const admin = adminHttpClient("admin-83");
    const listed = await admin.admin.ordersList.query();
    const listedOrder = listed.find(order => order.id === Number(created.orderId));
    expect(listedOrder).toMatchObject({
      userId: 81,
      customerName: "STOCK Customer",
      customerEmail: "stock-customer@example.invalid",
      totalPrice: 12900,
      status: "paid",
      paymentStatus: "confirmed",
      shippingOptionId: "local-plano-piloto",
      shippingAddress: { recipient: "Cliente Sintético", zipCode: "70000000", street: "Rua de Teste", number: "123", complement: "Apto 4", neighborhood: "Centro", city: "Brasília", state: "DF", source: "order" },
      // V6 admin DTO: ONE line per purchased item (reservations are linked through orderItemId, not listed twice).
      items: [expect.objectContaining({ productId: 4, productName: "Synthetic STOCK shirt", sku: "TSHIRT-BLK-M", size: "M", color: "Preto", quantity: 1, productPrice: 12900, status: "purchased" })],
    });
    expect(listedOrder?.items).toHaveLength(1);
    await expect(adminHttpClient("owner-81").admin.ordersList.query()).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    const adminDetail = await getOrderById(Number(created.orderId));
    expect(adminDetail).toMatchObject({ shippingRecipient: "Cliente Sintético", shippingStreet: "Rua de Teste", shippingOptionId: "local-plano-piloto" });
    expect(await getOrderByIdAndUser(Number(created.orderId), 81)).toMatchObject({ userId: 81 });
    expect(await getOrderByIdAndUser(Number(created.orderId), 82)).toBeUndefined();
    await pool.execute("UPDATE userAddresses SET recipient = 'Perfil Editado', street = 'Rua Alterada' WHERE userId = 81");
    const listedAfterProfileEdit = await admin.admin.ordersList.query();
    expect(listedAfterProfileEdit.find(order => order.id === Number(created.orderId))?.shippingAddress).toMatchObject({ recipient: "Cliente Sintético", street: "Rua de Teste", source: "order" });
    const [foreignVisibleOrders] = await pool.execute<(Record<string, unknown> & { total: number })[]>(
      "SELECT COUNT(*) AS total FROM orders WHERE id = ? AND userId = 82",
      [created.orderId],
    );
    expect(Number(foreignVisibleOrders[0]?.total)).toBe(0);
  });

  it("rolls back webhook, inventory consumption, and admin projection together when projection fails, then recovers on retry", async () => {
    const owner = httpClient("owner-81");
    const request = { attemptId: "stock-e2e-projection-fault-01", items: [{ productId: 4, variantId: 8, quantity: 1 }], delivery: syntheticDelivery };
    const created = await owner.stockCheckout.create.mutate(request);
    const body = JSON.stringify({
      id: "evt-synthetic-recovery-1",
      event: "PAYMENT_RECEIVED",
      payment: { id: "pay-synthetic-1", externalReference: created.orderId, status: "RECEIVED", value: 129, currency: "BRL", billingType: "PIX" },
    });
    const store = createMysqlStockCheckoutStore(pool);
    const failingProjectionStore: StockCheckoutStore = {
      findAttemptForOwner: (...args) => store.findAttemptForOwner(...args),
      transaction: work => store.transaction(tx => work({
        ...tx,
        async markPaid(...args) {
          await tx.markPaid(...args);
          throw new Error("injected administrative projection failure");
        },
      })),
    };
    const normalized = {
      eventId: "evt-synthetic-recovery-1",
      orderId: created.orderId,
      paymentId: "pay-synthetic-1",
      status: "paid" as const,
      amountCents: 12900,
      payload: JSON.parse(body),
    };
    await expect(processSignedStockWebhook({
      rawBody: body,
      headers: {},
      store: failingProjectionStore,
      boundary: { verifySignature: async () => true, decodeSignedEvent: () => normalized },
    })).rejects.toThrow("injected administrative projection failure");
    const [pendingAttempt] = await pool.execute<(Record<string, unknown> & { status: string })[]>("SELECT status FROM stockCheckoutAttempts WHERE attemptId = ?", [request.attemptId]);
    expect(pendingAttempt[0]?.status).toBe("reserved");
    const [activeReservation] = await pool.execute<(Record<string, unknown> & { total: number })[]>("SELECT COUNT(*) AS total FROM stockReservations WHERE attemptId = ? AND status = 'active'", [request.attemptId]);
    expect(Number(activeReservation[0]?.total)).toBe(1);
    const [unprojectedOrder] = await pool.execute<(Record<string, unknown> & { status: string; paymentStatus: string; stockPaymentId: string | null })[]>("SELECT status, paymentStatus, stockPaymentId FROM orders WHERE stockAttemptId = ?", [request.attemptId]);
    expect(unprojectedOrder[0]).toMatchObject({ status: "pending", paymentStatus: "unconfirmed", stockPaymentId: "pay-synthetic-1" });
    const [claimedEvent] = await pool.execute<(Record<string, unknown> & { total: number })[]>("SELECT COUNT(*) AS total FROM stockWebhookEvents WHERE eventId = 'evt-synthetic-recovery-1'");
    expect(Number(claimedEvent[0]?.total)).toBe(0);
    await pool.end();
    pool = createPool({ host, port, user, password, database, connectionLimit: 8 });
    setStockLocalHarnessDb(drizzleMysql(pool));
    runtime = createStockCheckoutRuntime({
      pool,
      exclusiveStore: createExclusiveStore(pool),
      shipping: { secret: SHIPPING_SECRET, quote: fakeShippingQuote },
      provider: {
        supportsIdempotencyKey: true,
        async createPayment(input) {
          providerCalls.push(input);
          const paymentId = paymentIdFor(input.idempotencyKey);
          const customerId = "cus-synthetic-stock-customer";
          providerSimulator.payments.set(paymentId, {
            id: paymentId, orderId: input.orderId, externalReference: input.externalReference ?? input.orderId,
            value: input.amountCents / 100, currency: "BRL", customer: customerId, billingType: "PIX", status: "PENDING", deleted: false,
          });
          return { paymentId, customerId, checkoutUrl: "https://sandbox.invalid/synthetic-checkout" };
        },
      },
    });
    configureStockCheckoutRuntimeForLocalHarness(runtime);
    const retried = await fetch(`${baseUrl}/webhook/asaas`, { method: "POST", headers: { "content-type": "application/json", "asaas-access-token": syntheticWebhookToken }, body });
    expect(retried.status).toBe(200);
    const [recoveredOrder] = await pool.execute<(Record<string, unknown> & { status: string; paymentStatus: string })[]>("SELECT status, paymentStatus FROM orders WHERE stockAttemptId = ?", [request.attemptId]);
    expect(recoveredOrder[0]).toMatchObject({ status: "paid", paymentStatus: "confirmed" });
  });

  it("internal replay of a stored STOCK event needs verified ingress provenance: unauthenticated, tampered or token-rotated events are never processed", async () => {
    const owner = httpClient("owner-81");
    const created = await owner.stockCheckout.create.mutate({ attemptId: "stock-replay-attempt-0001", items: [{ productId: 4, variantId: 8, quantity: 1 }], delivery: syntheticDelivery });
    const paymentId = created.paymentId!;
    const current = providerSimulator.payments.get(paymentId)!;
    current.status = "RECEIVED";
    const body = (value: number, billingType: string | null = "PIX", id = "evt-replay-paid-1") => ({ id, event: "PAYMENT_RECEIVED", account: { id: "account-synthetic-stock" }, payment: { id: paymentId, externalReference: current.externalReference, status: "RECEIVED", value, currency: "BRL", ...(billingType === null ? {} : { billingType }) } });
    const attemptStatus = async () => ((await pool.execute<(Record<string, unknown> & { status: string })[]>("SELECT status FROM stockCheckoutAttempts WHERE attemptId = 'stock-replay-attempt-0001'"))[0][0]?.status);
    const ledger = async () => Number(((await pool.execute<(Record<string, unknown> & { n: number })[]>("SELECT COUNT(*) AS n FROM stockWebhookEvents"))[0][0])?.n);
    const inboxCount = async (eventId: string) => Number(((await pool.execute<(Record<string, unknown> & { n: number })[]>("SELECT COUNT(*) AS n FROM asaasWebhookInbox WHERE eventId = ?", [eventId]))[0][0])?.n);

    // Missing billingType cannot bypass the authenticated-ingress gate by becoming a durable reconciliation ACK.
    const missingType = await processWebhookEnvelope(body(129, null, "evt-replay-missing-billing-type"));
    expect(missingType.status).toBe(503);
    expect(missingType.body).toMatchObject({ reason: "payment_replay_requires_authenticated_delivery", retryable: true });
    expect([await attemptStatus(), await ledger()]).toEqual(["reserved", 0]);
    expect(await inboxCount("evt-replay-missing-billing-type")).toBe(0);
    const [unauthenticatedAudit] = await pool.query<any[]>(
      "SELECT COUNT(*) AS n FROM auditLogs WHERE action = 'payment.webhook_reconciliation_required.v1' AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.eventId')) = ?",
      ["evt-replay-missing-billing-type"],
    );
    expect(Number(unauthenticatedAudit[0]?.n)).toBe(0);

    // 1. Nothing was attested at an authenticated delivery: a valid PIX-shaped bare DB envelope is NOT accepted.
    const bare = await processWebhookEnvelope(body(129));
    expect(bare.status).toBe(503);
    expect(bare.body).toMatchObject({ reason: "payment_replay_requires_authenticated_delivery", retryable: true });
    expect([await attemptStatus(), await ledger()]).toEqual(["reserved", 0]);
    expect(await inboxCount("evt-replay-paid-1")).toBe(0);

    // 2. Provenance for a DIFFERENT envelope (other amount) does not vouch for this one.
    expect(await attestAuthenticatedIngress(body(1))).toBe(true);
    expect((await processWebhookEnvelope(body(129))).status).toBe(503);
    expect(await attemptStatus()).toBe("reserved");

    // 3. Provenance written under another token does not verify after rotation.
    vi.stubEnv("ASAAS_WEBHOOK_TOKEN", "some-other-synthetic-token");
    expect(await attestAuthenticatedIngress(body(129))).toBe(true);
    vi.stubEnv("ASAAS_WEBHOOK_TOKEN", syntheticWebhookToken);
    expect((await processWebhookEnvelope(body(129))).status).toBe(503);
    expect(await attemptStatus()).toBe("reserved");

    // 4. A MAC written at an authenticated delivery (current token) over exactly this envelope: replay is processed once.
    expect(await attestAuthenticatedIngress(body(129))).toBe(true);
    const replayed = await processWebhookEnvelope(body(129));
    expect(replayed.status).toBe(200);
    expect([await attemptStatus(), await ledger()]).toEqual(["paid", 1]);
    expect((await processWebhookEnvelope(body(129))).status).toBe(200); // duplicate acknowledged, ledger unchanged
    expect(await ledger()).toBe(1);

    // 5. Without a configured token nothing can be verified.
    vi.stubEnv("ASAAS_WEBHOOK_TOKEN", "");
    expect((await processWebhookEnvelope({ ...body(129), id: "evt-replay-other" })).status).toBe(503);
  });

  describe("XIV Bis pre-order over STOCK: transactional production-batch capacity", () => {
    const BATCH = 70;
    async function seedPreorder(opts: { maximumQuantity: number | null; status?: string; salesCloseAt?: string | null } = { maximumQuantity: 3 }) {
      await pool.query("SET FOREIGN_KEY_CHECKS = 0");
      for (const t of ["productionBatchProducts", "productionBatches"]) await pool.query(`DELETE FROM ${t}`);
      await pool.query("DELETE FROM productVariants WHERE productId = 6"); await pool.query("DELETE FROM products WHERE id = 6");
      await pool.query("SET FOREIGN_KEY_CHECKS = 1");
      await pool.execute(
        "INSERT INTO productionBatches (id, name, status, salesOpenAt, salesCloseAt, estimatedShippingStart, estimatedShippingEnd, estimatedManufacturingStart, estimatedManufacturingEnd, minimumQuantity, maximumQuantity) VALUES (?, 'Lote XIV Bis #1', ?, '2020-01-01 00:00:00', ?, '2027-02-01 00:00:00', '2027-02-20 00:00:00', '2026-12-10', '2027-01-20', 0, ?)",
        [BATCH, opts.status ?? "OPEN", opts.salesCloseAt ?? null, opts.maximumQuantity],
      );
      // NO fictitious stock: the pre-order variants carry stock 0.
      await pool.execute("INSERT INTO products (id, name, category, price, stock, salesMode) VALUES (6, 'Camiseta Clã XIV Bis (pré-venda)', 'camisetas', 12900, 0, 'PREORDER')");
      await pool.execute("INSERT INTO productVariants (id, productId, name, sku, size, color, price, stock, reservedStock, isActive) VALUES (21, 6, 'XIV-M', 'XIV-PRE-M', 'M', 'Preto', 12900, 0, 0, 1), (22, 6, 'XIV-G', 'XIV-PRE-G', 'G', 'Preto', 12900, 0, 0, 1)");
      await canonicalizeSeedVariants(pool);
      await pool.execute("INSERT INTO productionBatchProducts (productionBatchId, productId) VALUES (?, 6)", [BATCH]);
    }
    const buy = (session: string, attemptId: string, quantity: number, variantId = 21) =>
      httpClient(session).stockCheckout.create.mutate({ attemptId, items: [{ productId: 6, variantId, quantity }], delivery: syntheticDelivery });
    const claimed = async () => Number(((await pool.query<(Record<string, unknown> & { n: number })[]>("SELECT COALESCE(SUM(i.quantity),0) AS n FROM orderItems i JOIN orders o ON o.id=i.orderId WHERE i.productionBatchId = 70 AND i.salesModeAtPurchase='PREORDER' AND (o.status <> 'cancelled' OR o.paymentStatus = 'confirmed')"))[0] as any)[0].n);
    const variantStock = async () => ((await pool.query<(Record<string, unknown> & { stock: number; reservedStock: number })[]>("SELECT stock, reservedStock FROM productVariants WHERE id IN (21,22) ORDER BY id"))[0] as any[]).map(r => [Number(r.stock), Number(r.reservedStock)]);
    const webhook = (eventId: string, event: string, status: string, orderId: string, paymentId: string, value: number) =>
      fetch(`${baseUrl}/webhook/asaas`, { method: "POST", headers: { "content-type": "application/json", "asaas-access-token": syntheticWebhookToken }, body: JSON.stringify({ id: eventId, event, payment: { id: paymentId, externalReference: orderId, status, value, currency: "BRL", billingType: "PIX" } }) });

    it("sells against batch capacity without touching variant stock, snapshotting the batch on the order item", async () => {
      await seedPreorder({ maximumQuantity: 3 });
      const catalog = await httpClient("owner-81").products.sellableVariants.query(6);
      expect(catalog.variants.map(v => v.availableUnits)).toEqual([null, null]); // unlimited per variant; capacity is the batch's
      const created = await buy("owner-81", "xiv-preorder-attempt-0001", 2);
      expect(created).toMatchObject({ status: "pending", amountCents: 25800 });
      expect(await variantStock()).toEqual([[0, 0], [0, 0]]);
      const [items] = await pool.query<(Record<string, unknown>)[]>("SELECT salesModeAtPurchase, productionBatchId, productionBatchNameAtPurchase, quantity, unitPrice, totalPrice, productName FROM orderItems");
      expect(items).toEqual([expect.objectContaining({ salesModeAtPurchase: "PREORDER", productionBatchId: BATCH, productionBatchNameAtPurchase: "Lote XIV Bis #1", quantity: 2, unitPrice: 12900, totalPrice: 25800 })]);
      const [reservations] = await pool.query<(Record<string, unknown> & { n: number })[]>("SELECT COUNT(*) AS n FROM stockReservations");
      expect(Number(reservations[0].n)).toBe(0);
      expect(await claimed()).toBe(2);
    });

    it("concurrent buyers racing for the last units: capacity is never exceeded", async () => {
      await seedPreorder({ maximumQuantity: 2 });
      // three DIFFERENT buyers at once, one unit each, two units available
      const results = await Promise.allSettled([buy("owner-81", "xiv-preorder-race-attempt-1", 1), buy("other-82", "xiv-preorder-race-attempt-2", 1), buy("admin-83", "xiv-preorder-race-attempt-3", 1, 22)]);
      const ok = results.filter(r => r.status === "fulfilled");
      const rejected = results.filter(r => r.status === "rejected") as PromiseRejectedResult[];
      expect(ok).toHaveLength(2);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toMatchObject({ data: { appError: { code: "STOCK_UNAVAILABLE" } } });
      expect(await claimed()).toBe(2);
      expect(await variantStock()).toEqual([[0, 0], [0, 0]]);
      // a full batch disappears from the public catalog
      expect((await httpClient("owner-81").products.sellableVariants.query(6)).variants).toEqual([]);
    });

    it("an over-capacity request rolls back completely (no order, attempt or item)", async () => {
      await seedPreorder({ maximumQuantity: 3 });
      await expect(buy("owner-81", "xiv-preorder-big-attempt-0001", 4)).rejects.toMatchObject({ data: { appError: { code: "STOCK_UNAVAILABLE" } } });
      for (const t of ["orders", "orderItems", "stockCheckoutAttempts", "stockCheckoutItems"]) {
        const [r] = await pool.query<(Record<string, unknown> & { n: number })[]>(`SELECT COUNT(*) AS n FROM ${t}`);
        expect(Number(r[0].n)).toBe(0);
      }
      expect(providerCalls).toHaveLength(0);
    });

    it("rejects a mixed STOCK/PREORDER cart at the public checkout API before any side effect", async () => {
      await seedPreorder({ maximumQuantity: 3 });
      await expect(httpClient("owner-81").stockCheckout.create.mutate({
        attemptId: "xiv-mixed-cart-api-0001",
        items: [
          { productId: 4, variantId: 8, quantity: 1 },
          { productId: 6, variantId: 21, quantity: 1 },
        ],
        delivery: syntheticDelivery,
      })).rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });
      for (const table of ["orders", "orderItems", "stockCheckoutAttempts", "stockCheckoutItems", "stockReservations"]) {
        const [rows] = await pool.query<(Record<string, unknown> & { n: number })[]>(`SELECT COUNT(*) AS n FROM ${table}`);
        expect(Number(rows[0].n), table).toBe(0);
      }
      expect(providerCalls).toHaveLength(0);
      expect(await variantStock()).toEqual([[0, 0], [0, 0]]);
      expect(await readVariantInventory(8)).toMatchObject({ stock: 1, reservedStock: 0 });
      expect(await claimed()).toBe(0);
    });

    it("keeps capacity held for a paid PREORDER cancelled without a refund", async () => {
      await seedPreorder({ maximumQuantity: 2 });
      const created = await buy("owner-81", "xiv-paid-cancel-hold-0001", 2);
      const receipt = await webhook("evt-xiv-paid-cancel-hold", "PAYMENT_RECEIVED", "RECEIVED", created.orderId, created.paymentId!, 258);
      expect(receipt.status).toBe(200);
      await updateOrderAndReserveDeliveredEmailEvents(Number(created.orderId), { status: "cancelled" }, 81);

      const [order] = await pool.query<(Record<string, unknown> & { status: string; paymentStatus: string })[]>(
        "SELECT status, paymentStatus FROM orders WHERE id = ?", [created.orderId],
      );
      expect(order[0]).toMatchObject({ status: "cancelled", paymentStatus: "confirmed" });
      const [audit] = await pool.query<(Record<string, unknown> & { metadata: string })[]>(
        "SELECT metadata FROM auditLogs WHERE action = 'order.cancelled' AND entityId = ?", [created.orderId],
      );
      expect(JSON.parse(audit[0].metadata)).toMatchObject({ refundExecuted: false, reconciliationRequired: true });
      expect(await claimed()).toBe(2);
      expect((await httpClient("owner-81").products.sellableVariants.query(6)).variants).toEqual([]);
      const adminConnection = await pool.getConnection();
      try {
        await expect(saveBatch(adminConnection as any, {
          id: BATCH,
          name: "Lote XIV Bis #1",
          salesOpenAt: null,
          salesCloseAt: null,
          estimatedShippingStart: "2027-02-01T00:00:00.000Z",
          estimatedShippingEnd: "2027-02-20T00:00:00.000Z",
          estimatedManufacturingStart: "2026-12-10",
          estimatedManufacturingEnd: "2027-01-20",
          minimumQuantity: 0,
          maximumQuantity: 1,
        }, 83)).rejects.toThrow("Máximo inferior à capacidade já comprometida.");
      } finally {
        adminConnection.release();
      }
      await expect(buy("other-82", "xiv-after-paid-cancel-0001", 1)).rejects.toMatchObject({ data: { appError: { code: "STOCK_UNAVAILABLE" } } });
      expect(providerCalls).toHaveLength(1);
      expect(await variantStock()).toEqual([[0, 0], [0, 0]]);
    });

    it("keeps batch summary totals consistent when PAYMENT_RECEIVED races the demand read", async () => {
      await seedPreorder({ maximumQuantity: 2 });
      const created = await buy("owner-81", "xiv-summary-race-attempt-01", 1);
      const originalQuery = pool.query.bind(pool);
      let interleaved = false;
      (pool as any).query = async (...args: any[]) => {
        const result = await (originalQuery as any)(...args);
        const statement = typeof args[0] === "string" ? args[0] : String(args[0]?.sql ?? "");
        if (!interleaved && statement.includes("FROM orderItems i JOIN orders o")) {
          interleaved = true;
          expect((await webhook("evt-xiv-summary-race", "PAYMENT_RECEIVED", "RECEIVED", created.orderId, created.paymentId!, 129)).status).toBe(200);
        }
        return result;
      };
      let first: Awaited<ReturnType<typeof productionSummary>>;
      try {
        first = await productionSummary(pool as any, BATCH);
      } finally {
        (pool as any).query = originalQuery;
      }
      expect(interleaved).toBe(true);
      expect(first!).toMatchObject({ pendingOrders: 1, pendingQuantity: 1, paidOrders: 0, confirmedQuantity: 0 });
      expect(await productionSummary(pool as any, BATCH)).toMatchObject({ pendingOrders: 0, pendingQuantity: 0, paidOrders: 1, confirmedQuantity: 1 });
      expect(await variantStock()).toEqual([[0, 0], [0, 0]]);
    });

    it("closing the batch (status or sales window) stops sales; an unlimited batch has no cap", async () => {
      await seedPreorder({ maximumQuantity: 3, status: "CLOSED" });
      await expect(buy("owner-81", "xiv-preorder-closed-attempt-1", 1)).rejects.toMatchObject({ data: { appError: { code: "STOCK_UNAVAILABLE" } } });
      await seedPreorder({ maximumQuantity: 3, salesCloseAt: "2021-01-01 00:00:00" });
      await expect(buy("owner-81", "xiv-preorder-window-attempt-1", 1)).rejects.toMatchObject({ data: { appError: { code: "STOCK_UNAVAILABLE" } } });
      await seedPreorder({ maximumQuantity: null });
      expect(await buy("owner-81", "xiv-preorder-unlimited-0001", 9)).toMatchObject({ status: "pending" });
      await pool.execute("UPDATE productionBatches SET status = 'CLOSED' WHERE id = ?", [BATCH]);
      await expect(buy("other-82", "xiv-preorder-closed-attempt-2", 1)).rejects.toMatchObject({ data: { appError: { code: "STOCK_UNAVAILABLE" } } });
      expect(providerCalls).toHaveLength(1);
    });

    it("a released attempt frees capacity; a paid one keeps it and consumes no variant stock", async () => {
      await seedPreorder({ maximumQuantity: 2 });
      const a = await buy("owner-81", "xiv-preorder-release-attempt-0001", 2);
      await expect(buy("other-82", "xiv-preorder-release-attempt-0002", 1)).rejects.toMatchObject({ data: { appError: { code: "STOCK_UNAVAILABLE" } } });
      const failed = await webhook("evt-pre-refused-1", "PAYMENT_REFUSED", "REFUSED", a.orderId, a.paymentId!, 258);
      expect(failed.status).toBe(200);
      expect(await claimed()).toBe(0);
      const b = await buy("other-82", "xiv-preorder-release-attempt-0003", 2);
      expect(b).toMatchObject({ status: "pending" });
      const paid = await webhook("evt-pre-paid-1", "PAYMENT_RECEIVED", "RECEIVED", b.orderId, b.paymentId!, 258);
      expect(paid.status).toBe(200);
      const [orderRows] = await pool.query<(Record<string, unknown> & { status: string })[]>("SELECT status FROM orders WHERE id = ?", [b.orderId]);
      expect(orderRows[0].status).toBe("paid");
      expect(await claimed()).toBe(2);
      expect(await variantStock()).toEqual([[0, 0], [0, 0]]);
      await expect(buy("admin-83", "xiv-preorder-release-attempt-0004", 1)).rejects.toMatchObject({ data: { appError: { code: "STOCK_UNAVAILABLE" } } });
    });

    it("late PAYMENT_RECEIVED after a cancelled PREORDER lot was reallocated is reconciled without confirming either order", async () => {
      await seedPreorder({ maximumQuantity: 1 });
      const cancelled = await buy("owner-81", "xiv-preorder-late-cancel-0001", 1);
      await expect(adminHttpClient("admin-83").admin.orderUpdate.mutate({ orderId: Number(cancelled.orderId), status: "cancelled" }))
        .rejects.toMatchObject({ data: { code: "CONFLICT" } });
      expect(await claimed()).toBe(1);
      await updateOrderAndReserveDeliveredEmailEvents(Number(cancelled.orderId), { status: "cancelled" }, 83);
      expect(await claimed()).toBe(0);

      const current = await buy("other-82", "xiv-preorder-late-next-0001", 1);
      expect(await claimed()).toBe(1);
      const late = await webhook("evt-xiv-preorder-late-cancel", "PAYMENT_RECEIVED", "RECEIVED", cancelled.orderId, cancelled.paymentId!, 129);
      expect(late.status).toBe(200);

      const [orders] = await pool.query<(Record<string, unknown> & { id: number; status: string; paymentStatus: string })[]>(
        "SELECT id, status, paymentStatus FROM orders ORDER BY id",
      );
      expect(orders).toEqual([
        { id: Number(cancelled.orderId), status: "cancelled", paymentStatus: "unconfirmed" },
        { id: Number(current.orderId), status: "pending", paymentStatus: "unconfirmed" },
      ]);
      const [divergences] = await pool.query<(Record<string, unknown> & { event: string })[]>(
        "SELECT event FROM auditLogs WHERE action = 'stock.reconciliation.required'",
      );
      expect(divergences).toHaveLength(1);
      const [alerts] = await pool.query<(Record<string, unknown> & { n: number })[]>(
        "SELECT COUNT(*) AS n FROM notificationOutbox WHERE type = 'financial-reconciliation-alert-v1' AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.providerEventId')) = ?",
        ["evt-xiv-preorder-late-cancel"],
      );
      expect(Number(alerts[0]?.n)).toBe(1);
      expect(await claimed()).toBe(1);
      expect(await variantStock()).toEqual([[0, 0], [0, 0]]);
      expect(providerCalls).toHaveLength(2);

      const duplicate = await webhook("evt-xiv-preorder-late-cancel", "PAYMENT_RECEIVED", "RECEIVED", cancelled.orderId, cancelled.paymentId!, 129);
      expect(duplicate.status).toBe(200);
      expect(await claimed()).toBe(1);
      expect(await variantStock()).toEqual([[0, 0], [0, 0]]);
    });

    it("accepts a late PREORDER receipt after expiry only while the batch capacity remains held", async () => {
      await seedPreorder({ maximumQuantity: 1 });
      const created = await buy("owner-81", "xiv-preorder-late-expiry-0001", 1);
      await pool.execute(
        "UPDATE stockCheckoutAttempts SET reservationExpiresAt = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE attemptId = ?",
        ["xiv-preorder-late-expiry-0001"],
      );
      const expiry = await createMysqlStockCheckoutStore(pool).transaction(tx => tx.expireDueReservations(20));
      expect(expiry).toEqual({ releasedAttemptIds: [], reconciliationAttemptIds: ["xiv-preorder-late-expiry-0001"] });
      expect(await claimed()).toBe(1);

      const received = await webhook("evt-xiv-preorder-late-expiry", "PAYMENT_RECEIVED", "RECEIVED", created.orderId, created.paymentId!, 129);
      expect(received.status).toBe(200);
      const [order] = await pool.query<(Record<string, unknown> & { status: string; paymentStatus: string })[]>(
        "SELECT status, paymentStatus FROM orders WHERE id = ?", [created.orderId],
      );
      expect(order[0]).toMatchObject({ status: "paid", paymentStatus: "confirmed" });
      expect(await claimed()).toBe(1);
      expect(await variantStock()).toEqual([[0, 0], [0, 0]]);
      const duplicate = await webhook("evt-xiv-preorder-late-expiry", "PAYMENT_RECEIVED", "RECEIVED", created.orderId, created.paymentId!, 129);
      expect(duplicate.status).toBe(200);
      expect(await claimed()).toBe(1);
      expect(await variantStock()).toEqual([[0, 0], [0, 0]]);
    });

    it("requires authoritative PAYMENT_RECEIVED after PAYMENT_CONFIRMED and keeps the lot reservation idempotent", async () => {
      await seedPreorder({ maximumQuantity: 2 });
      const created = await buy("owner-81", "xiv-preorder-confirmed-gate-01", 1);
      const confirmed = await webhook("evt-pre-confirmed-only", "PAYMENT_CONFIRMED", "CONFIRMED", created.orderId, created.paymentId!, 129);
      expect(confirmed.status).toBe(200);
      const [beforeReceived] = await pool.query<(Record<string, unknown> & { status: string })[]>("SELECT status FROM orders WHERE stockAttemptId = ?", ["xiv-preorder-confirmed-gate-01"]);
      expect(beforeReceived[0]?.status).toBe("pending");
      expect(await claimed()).toBe(1);

      const received = await webhook("evt-pre-received-after-confirmed", "PAYMENT_RECEIVED", "RECEIVED", created.orderId, created.paymentId!, 129);
      expect(received.status).toBe(200);
      const duplicate = await webhook("evt-pre-received-after-confirmed", "PAYMENT_RECEIVED", "RECEIVED", created.orderId, created.paymentId!, 129);
      expect(duplicate.status).toBe(200);
      const [afterReceived] = await pool.query<(Record<string, unknown> & { status: string })[]>("SELECT status FROM orders WHERE stockAttemptId = ?", ["xiv-preorder-confirmed-gate-01"]);
      expect(afterReceived[0]?.status).toBe("paid");
      expect(await claimed()).toBe(1);
      expect(await variantStock()).toEqual([[0, 0], [0, 0]]);
      const [events] = await pool.query<(Record<string, unknown> & { n: number })[]>("SELECT COUNT(*) AS n FROM stockWebhookEvents WHERE eventId IN ('evt-pre-confirmed-only','evt-pre-received-after-confirmed')");
      expect(Number(events[0]?.n)).toBe(2);
    });

    it.each(["CONFIRMED", "RECEIVED_IN_CASH"] as const)(
      "does not settle PIX PAYMENT_RECEIVED when the authoritative provider state is %s",
      async providerStatus => {
        await seedPreorder({ maximumQuantity: 2 });
        const created = await buy("owner-81", `xiv-preorder-authority-${providerStatus.toLowerCase()}-01`, 1);
        const providerPayment = providerSimulator.payments.get(created.paymentId!)!;
        providerPayment.status = providerStatus;
        const envelope = {
          id: `evt-xiv-authority-${providerStatus.toLowerCase()}`,
          event: "PAYMENT_RECEIVED",
          account: { id: "account-synthetic-stock" },
          // Deliberately omit status: this is an authenticated receipt event, while the GET state is controlled above.
          payment: { id: created.paymentId, externalReference: providerPayment.externalReference, value: 129, currency: "BRL", billingType: "PIX" },
        };
        const deliver = () => fetch(`${baseUrl}/webhook/asaas`, {
          method: "POST", headers: { "content-type": "application/json", "asaas-access-token": syntheticWebhookToken },
          body: JSON.stringify(envelope),
        });

        const first = await deliver();
        expect(first.status).toBe(200);
        expect(await first.json()).toMatchObject({ handled: false, reconciliationRequired: true, financialMutation: false, stockMutation: false });
        const [order] = await pool.query<(Record<string, unknown> & { status: string; paymentStatus: string })[]>(
          "SELECT status, paymentStatus FROM orders WHERE id = ?", [created.orderId],
        );
        const [attempt] = await pool.query<(Record<string, unknown> & { status: string })[]>(
          "SELECT status FROM stockCheckoutAttempts WHERE attemptId = ?", [`xiv-preorder-authority-${providerStatus.toLowerCase()}-01`],
        );
        expect(order[0]).toMatchObject({ status: "pending", paymentStatus: "unconfirmed" });
        expect(attempt[0]?.status).toBe("reserved");
        expect(await claimed()).toBe(1);
        expect(await variantStock()).toEqual([[0, 0], [0, 0]]);

        const [auditRows] = await pool.query<(Record<string, unknown> & { metadata: string })[]>(
          "SELECT metadata FROM auditLogs WHERE action = 'payment.webhook_reconciliation_required.v1'",
        );
        const audit = auditRows.map(row => JSON.parse(row.metadata)).find(row => row.eventId === envelope.id);
        expect(audit).toMatchObject({ reason: "PROVIDER_STATUS_NOT_RECEIVED", providerObservedStatus: providerStatus,
          reconciliationRequired: true, financialMutation: false, stockMutation: false });
        const [alerts] = await pool.query<(Record<string, unknown> & { payload: string })[]>(
          "SELECT payload FROM notificationOutbox WHERE type = 'financial-reconciliation-alert-v1'",
        );
        const alert = alerts.map(row => JSON.parse(row.payload)).find(row => row.providerEventId === envelope.id);
        expect(alert).toMatchObject({ observedStatus: providerStatus, financialMutation: false, stockMutation: false,
          category: "order_attempt_payment_inconsistent" });

        const duplicate = await deliver();
        expect(duplicate.status).toBe(200);
        expect(await claimed()).toBe(1);
        expect(await variantStock()).toEqual([[0, 0], [0, 0]]);
        const [alertCount] = await pool.query<(Record<string, unknown> & { n: number })[]>(
          "SELECT COUNT(*) AS n FROM notificationOutbox WHERE type = 'financial-reconciliation-alert-v1'",
        );
        expect(Number(alertCount[0]?.n)).toBe(1);
      },
    );

    it("keeps authoritative PENDING PAYMENT_RECEIVED retryable, then durably escalates without settling", async () => {
      await seedPreorder({ maximumQuantity: 2 });
      const created = await buy("owner-81", "xiv-preorder-authority-pending-01", 1);
      const providerPayment = providerSimulator.payments.get(created.paymentId!)!;
      providerPayment.status = "PENDING";
      const envelope = {
        id: "evt-xiv-authority-pending", event: "PAYMENT_RECEIVED", account: { id: "account-synthetic-stock" },
        payment: { id: created.paymentId, externalReference: providerPayment.externalReference, value: 129, currency: "BRL", billingType: "PIX" },
      };
      const deliver = () => fetch(`${baseUrl}/webhook/asaas`, {
        method: "POST", headers: { "content-type": "application/json", "asaas-access-token": syntheticWebhookToken },
        body: JSON.stringify(envelope),
      });

      for (const expectedAttempt of [1, 2]) {
        const retryable = await deliver();
        expect(retryable.status).toBe(503);
        expect(await retryable.json()).toMatchObject({ retryable: true, code: "PAYMENT_NOT_RECEIVED_YET" });
        const [inbox] = await pool.query<(Record<string, unknown> & { state: string; attempts: number; nextAttemptAt: Date | null })[]>(
          "SELECT state, attempts, nextAttemptAt FROM asaasWebhookInbox WHERE eventId = ?", [envelope.id],
        );
        expect(inbox[0]).toMatchObject({ state: "failed", attempts: expectedAttempt });
        expect(inbox[0]?.nextAttemptAt).not.toBeNull();
        const [order] = await pool.query<(Record<string, unknown> & { status: string; paymentStatus: string })[]>(
          "SELECT status, paymentStatus FROM orders WHERE id = ?", [created.orderId],
        );
        expect(order[0]).toMatchObject({ status: "pending", paymentStatus: "unconfirmed" });
        expect(await claimed()).toBe(1);
        expect(await variantStock()).toEqual([[0, 0], [0, 0]]);
        if (expectedAttempt === 1) {
          const premature = await deliver();
          expect(premature.status).toBe(503);
          expect(await premature.json()).toMatchObject({ code: "PAYMENT_PROVIDER_RETRY_BACKOFF", retryable: true });
          const [unchanged] = await pool.query<(Record<string, unknown> & { attempts: number })[]>(
            "SELECT attempts FROM asaasWebhookInbox WHERE eventId = ?", [envelope.id],
          );
          expect(unchanged[0]?.attempts).toBe(1);
        }
        await pool.execute("UPDATE asaasWebhookInbox SET nextAttemptAt = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE eventId = ?", [envelope.id]);
      }

      const escalated = await deliver();
      expect(escalated.status).toBe(200);
      expect(await escalated.json()).toMatchObject({ handled: false, reconciliationRequired: true, financialMutation: false, stockMutation: false });
      const [inbox] = await pool.query<(Record<string, unknown> & { state: string; attempts: number; nextAttemptAt: Date | null })[]>(
        "SELECT state, attempts, nextAttemptAt FROM asaasWebhookInbox WHERE eventId = ?", [envelope.id],
      );
      expect(inbox[0]).toMatchObject({ state: "processed", attempts: 3, nextAttemptAt: null });
      const [auditRows] = await pool.query<(Record<string, unknown> & { metadata: string })[]>(
        "SELECT metadata FROM auditLogs WHERE action = 'payment.provider_preflight_failure.v1'",
      );
      expect(auditRows.map(row => JSON.parse(row.metadata))).toEqual(expect.arrayContaining([
        expect.objectContaining({ eventId: envelope.id, providerObservedStatus: "PENDING", reason: "PROVIDER_STATUS_NOT_RECEIVED_RETRY_LIMIT", reconciliationRequired: true }),
      ]));
      const [alerts] = await pool.query<(Record<string, unknown> & { payload: string })[]>(
        "SELECT payload FROM notificationOutbox WHERE type = 'financial-reconciliation-alert-v1'",
      );
      expect(alerts.map(row => JSON.parse(row.payload))).toEqual(expect.arrayContaining([
        expect.objectContaining({ providerEventId: envelope.id, observedStatus: "PENDING", reason: "PROVIDER_STATUS_NOT_RECEIVED_RETRY_LIMIT" }),
      ]));
      const [order] = await pool.query<(Record<string, unknown> & { status: string; paymentStatus: string })[]>(
        "SELECT status, paymentStatus FROM orders WHERE id = ?", [created.orderId],
      );
      expect(order[0]).toMatchObject({ status: "pending", paymentStatus: "unconfirmed" });
      expect(await claimed()).toBe(1);
      expect(await variantStock()).toEqual([[0, 0], [0, 0]]);
    });

    it("serializes concurrent duplicate RECEIVED deliveries and applies the PIX settlement once", async () => {
      await seedPreorder({ maximumQuantity: 2 });
      const created = await buy("owner-81", "xiv-preorder-authority-race-01", 1);
      const providerPayment = providerSimulator.payments.get(created.paymentId!)!;
      providerPayment.status = "RECEIVED";
      const envelope = {
        id: "evt-xiv-authority-race", event: "PAYMENT_RECEIVED", account: { id: "account-synthetic-stock" },
        payment: { id: created.paymentId, externalReference: providerPayment.externalReference, value: 129, currency: "BRL", billingType: "PIX" },
      };
      const deliver = () => fetch(`${baseUrl}/webhook/asaas`, {
        method: "POST", headers: { "content-type": "application/json", "asaas-access-token": syntheticWebhookToken },
        body: JSON.stringify(envelope),
      });
      const concurrent = await Promise.all(Array.from({ length: 8 }, deliver));
      expect(concurrent.every(response => [200, 503].includes(response.status))).toBe(true);
      const retryResponses = await Promise.all(concurrent.filter(response => response.status === 503).map(() => deliver()));
      expect(retryResponses.every(response => response.status === 200)).toBe(true);
      const [order] = await pool.query<(Record<string, unknown> & { status: string; paymentStatus: string })[]>(
        "SELECT status, paymentStatus FROM orders WHERE id = ?", [created.orderId],
      );
      const [attempt] = await pool.query<(Record<string, unknown> & { status: string })[]>(
        "SELECT status FROM stockCheckoutAttempts WHERE attemptId = ?", ["xiv-preorder-authority-race-01"],
      );
      expect(order[0]).toMatchObject({ status: "paid", paymentStatus: "confirmed" });
      expect(attempt[0]?.status).toBe("paid");
      expect(await claimed()).toBe(1);
      expect(await variantStock()).toEqual([[0, 0], [0, 0]]);
      const [ledger] = await pool.query<(Record<string, unknown> & { n: number })[]>("SELECT COUNT(*) AS n FROM stockWebhookEvents WHERE eventId = ?", [envelope.id]);
      expect(Number(ledger[0]?.n)).toBe(1);
    });

    it("does not confirm an explicit-BRL PAYMENT_RECEIVED when provider proof is unavailable; retry succeeds", async () => {
      await seedPreorder({ maximumQuantity: 2 });
      const created = await buy("owner-81", "xiv-preorder-provider-fail-01", 1);
      const paymentId = created.paymentId!;
      const providerPayment = providerSimulator.payments.get(paymentId)!;
      const event = {
        id: "evt-pre-provider-retry", event: "PAYMENT_RECEIVED", account: { id: "account-synthetic-stock" },
        payment: { id: paymentId, externalReference: providerPayment.externalReference, value: 129, currency: "BRL", billingType: "PIX" },
      };
      providerSimulator.unavailable = true;
      const unavailable = await fetch(`${baseUrl}/webhook/asaas`, { method: "POST", headers: { "content-type": "application/json", "asaas-access-token": syntheticWebhookToken }, body: JSON.stringify(event) });
      expect(unavailable.status).toBe(503);
      const [pending] = await pool.query<(Record<string, unknown> & { orderStatus: string; attemptStatus: string })[]>("SELECT o.status AS orderStatus,a.status AS attemptStatus FROM orders o JOIN stockCheckoutAttempts a ON a.attemptId=o.stockAttemptId WHERE a.attemptId=?", ["xiv-preorder-provider-fail-01"]);
      expect(pending[0]).toMatchObject({ orderStatus: "pending", attemptStatus: "reserved" });
      expect(await claimed()).toBe(1);
      expect(await variantStock()).toEqual([[0, 0], [0, 0]]);

      providerSimulator.unavailable = false;
      providerPayment.status = "RECEIVED";
      // Advance the persisted retry schedule instead of sleeping through the
      // inbox's bounded backoff in this disposable database test.
      await pool.execute("UPDATE asaasWebhookInbox SET nextAttemptAt = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE eventId = ?", [event.id]);
      const retried = await fetch(`${baseUrl}/webhook/asaas`, { method: "POST", headers: { "content-type": "application/json", "asaas-access-token": syntheticWebhookToken }, body: JSON.stringify(event) });
      expect(retried.status).toBe(200);
      const [paid] = await pool.query<(Record<string, unknown> & { status: string })[]>("SELECT status FROM orders WHERE stockAttemptId=?", ["xiv-preorder-provider-fail-01"]);
      expect(paid[0]?.status).toBe("paid");
      expect(await claimed()).toBe(1);
    });
  });

  describe("carrier freight: signed quote, charged total and persisted snapshot", () => {
    const address = { recipient: "Cliente Sintético", zipCode: "01001000", street: "Praça da Sé", number: "10", complement: "Apto 4", neighborhood: "Sé", city: "São Paulo", state: "SP" };
    const items = [{ productId: 4, variantId: 8, quantity: 1 }];
    const sedex = { id: "melhor-envio-1", label: "SEDEX", description: "Correios", price: 31.9, minDays: 2, maxDays: 4 };
    const quote = async (session = "owner-81", req: Record<string, unknown> = { items, address }) => httpClient(session).stockCheckout.quoteShipping.mutate(req as never);
    const create = (attemptId: string, delivery: Record<string, unknown>, session = "owner-81") =>
      httpClient(session).stockCheckout.create.mutate({ attemptId, items, delivery } as never);
    const orderRow = async (orderId: string) => ((await pool.query<any[]>("SELECT totalPrice, shippingZipCode, shippingOptionId FROM orders WHERE id = ?", [orderId]))[0])[0];
    const ordersCount = async () => Number(((await pool.query<any[]>("SELECT COUNT(*) n FROM orders"))[0])[0].n);
    const rejectedWith = (promise: Promise<unknown>, code: string) => expect(promise).rejects.toMatchObject({ data: { appError: { code } } });

    beforeEach(() => { shippingQuoteCalls = []; shippingQuoteResult = { options: [sedex], source: "melhor-envio" }; });

    it("quotes server-side from the DB catalog (the client supplies only variants and quantities) and signs the terms", async () => {
      const result = await quote();
      expect(result.options).toHaveLength(1);
      expect(result.options[0]).toMatchObject({ optionId: "melhor-envio-1", priceCents: 3190, label: "SEDEX" });
      expect(shippingQuoteCalls).toEqual([{ cep: "01001000", itemCount: 1, subtotal: 129 }]); // subtotal from variants.price, not the client
      const [payload] = result.options[0].quoteToken.split(".");
      expect(Buffer.from(payload, "base64url").toString()).not.toContain("Praça da Sé"); // no raw address inside the token
      // client-supplied freight fields are rejected by the strict contract
      await expect(quote("owner-81", { items, address, priceCents: 1 })).rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });
      await expect(quote("anonymous")).rejects.toMatchObject({ data: { code: "UNAUTHORIZED" } });
    });

    it("charges merchandise + accepted freight, persists the acceptance snapshot, and the webhook must match the TOTAL", async () => {
      const [option] = (await quote()).options;
      const created = await create("stock-ship-attempt-0001", { optionId: option.optionId, quoteToken: option.quoteToken, address });
      expect(created).toMatchObject({ status: "pending", amountCents: 12900 + 3190 });
      expect(providerCalls).toMatchObject([{ amountCents: 16090 }]);
      expect(await orderRow(created.orderId)).toMatchObject({ totalPrice: 16090, shippingZipCode: "01001000", shippingOptionId: "melhor-envio-1" });
      const [attempts] = await pool.query<any[]>("SELECT amountCents FROM stockCheckoutAttempts");
      expect(Number(attempts[0].amountCents)).toBe(16090);
      const [audit] = await pool.query<any[]>("SELECT metadata FROM auditLogs WHERE action = 'checkout.shipping_accepted.v1' AND entityId = ?", [created.orderId]);
      expect(audit).toHaveLength(1);
      const snapshot = JSON.parse(audit[0].metadata);
      expect(snapshot).toMatchObject({ merchandiseCents: 12900, shipping: { method: "carrier", optionId: "melhor-envio-1", carrier: "Correios", serviceName: "SEDEX", shippingPriceCents: 3190, currency: "BRL", destinationZipCode: "01001000", itemCount: 1, merchandiseSubtotalCents: 12900, package: { heightCm: 6, widthCm: 22, lengthCm: 32, weightGrams: 300 }, address: { street: "Praça da Sé", city: "São Paulo" } } });
      expect(snapshot.shipping.quoteReference).toMatch(/^[0-9a-f-]{36}$/);
      expect(JSON.stringify(snapshot)).not.toContain(option.quoteToken);
      // the provider reports only the merchandise value: refused, never marked paid
      const wrong = await fetch(`${baseUrl}/webhook/asaas`, { method: "POST", headers: { "content-type": "application/json", "asaas-access-token": syntheticWebhookToken }, body: JSON.stringify({ id: "evt-ship-wrong", event: "PAYMENT_RECEIVED", payment: { id: created.paymentId, externalReference: created.orderId, status: "RECEIVED", value: 129, currency: "BRL", billingType: "PIX" } }) });
      expect(wrong.status === 200 ? (await wrong.json()).handled : false).toBe(false); // acknowledged as a conflict or refused: never processed
      expect((await pool.query<any[]>("SELECT status FROM stockCheckoutAttempts"))[0][0].status).toBe("reserved");
      const right = await fetch(`${baseUrl}/webhook/asaas`, { method: "POST", headers: { "content-type": "application/json", "asaas-access-token": syntheticWebhookToken }, body: JSON.stringify({ id: "evt-ship-right", event: "PAYMENT_RECEIVED", payment: { id: created.paymentId, externalReference: created.orderId, status: "RECEIVED", value: 160.9, currency: "BRL", billingType: "PIX" } }) });
      expect(right.status).toBe(200);
      expect((await pool.query<any[]>("SELECT status FROM stockCheckoutAttempts"))[0][0].status).toBe("paid");
    });

    it("rejects tampered, wrong-option, wrong-address, changed-cart, repriced and expired quotes before anything is created", async () => {
      const { issueStockShippingQuoteV1 } = await import("./stockShippingQuoteV1");
      const { stockShippingCartFingerprint } = await import("./stockCheckout");
      const [option] = (await quote()).options;
      const ok = { optionId: option.optionId, quoteToken: option.quoteToken, address };
      const flip = option.quoteToken.slice(0, -2) + (option.quoteToken.endsWith("AA") ? "BB" : "AA");
      const expired = issueStockShippingQuoteV1({ secret: SHIPPING_SECRET, address, cartFingerprint: stockShippingCartFingerprint([{ variantId: 8, unitPriceCents: 12900, quantity: 1 }]), itemCount: 1, merchandiseSubtotalCents: 12900, now: new Date(Date.now() - 3_600_000), terms: { method: "carrier", optionId: "melhor-envio-1", carrier: "Correios", serviceId: "1", serviceName: "SEDEX", providerQuoteId: "melhor-envio-1", shippingPriceCents: 3190, package: { heightCm: 6, widthCm: 22, lengthCm: 32, weightGrams: 300 } } });
      const foreign = issueStockShippingQuoteV1({ secret: "another-signing-secret-with-at-least-32-bytes!!", address, cartFingerprint: stockShippingCartFingerprint([{ variantId: 8, unitPriceCents: 12900, quantity: 1 }]), itemCount: 1, merchandiseSubtotalCents: 12900, terms: { method: "carrier", optionId: "melhor-envio-1", carrier: "Correios", serviceId: "1", serviceName: "SEDEX", providerQuoteId: "melhor-envio-1", shippingPriceCents: 1, package: { heightCm: 6, widthCm: 22, lengthCm: 32, weightGrams: 300 } } });
      await rejectedWith(create("stock-ship-bad-0001", { ...ok, quoteToken: flip }), "SHIPPING_QUOTE_REJECTED");
      await rejectedWith(create("stock-ship-bad-0002", { ...ok, optionId: "melhor-envio-2" }), "SHIPPING_QUOTE_REJECTED");
      await rejectedWith(create("stock-ship-bad-0003", { ...ok, address: { ...address, street: "Rua Outra" } }), "SHIPPING_QUOTE_REJECTED");
      await rejectedWith(create("stock-ship-bad-0004", { ...ok, quoteToken: expired.quoteToken }), "SHIPPING_QUOTE_REJECTED");
      await rejectedWith(create("stock-ship-bad-0005", { ...ok, quoteToken: foreign.quoteToken }), "SHIPPING_QUOTE_REJECTED"); // signed with another secret, price 1 cent
      await expect(httpClient("owner-81").stockCheckout.create.mutate({ attemptId: "stock-ship-bad-0006", items: [{ ...items[0], quantity: 2 }], delivery: ok } as never)).rejects.toMatchObject({ data: { appError: { code: "SHIPPING_QUOTE_REJECTED" } } });
      await pool.execute("UPDATE productVariants SET price = 13900, stock = 5 WHERE id = 8");
      await rejectedWith(create("stock-ship-bad-0007", ok), "SHIPPING_QUOTE_REJECTED");
      await expect(create("stock-ship-bad-0008", { ...ok, priceCents: 1 })).rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });
      expect(await ordersCount()).toBe(0);
      expect(providerCalls).toHaveLength(0);
    });

    it("carrier outage means no carrier option and no checkout; unsigned carrier delivery cannot be created", async () => {
      shippingQuoteResult = { options: [], source: "unavailable" };
      expect((await quote()).options).toEqual([]);
      await rejectedWith(create("stock-ship-nosig-0001", { optionId: "melhor-envio-1", quoteToken: "x".repeat(40), address }), "SHIPPING_QUOTE_REJECTED");
      expect(await ordersCount()).toBe(0);
    });

    it("concurrent identical submissions create one order and one charge", async () => {
      const [option] = (await quote()).options;
      const delivery = { optionId: option.optionId, quoteToken: option.quoteToken, address };
      const results = await Promise.allSettled(Array.from({ length: 5 }, () => create("stock-ship-race-0001", delivery)));
      const ok = results.filter(r => r.status === "fulfilled") as PromiseFulfilledResult<any>[];
      expect(ok.length).toBeGreaterThanOrEqual(1);
      for (const r of ok) expect(r.value).toMatchObject({ amountCents: 16090 });
      expect(new Set(ok.map(r => r.value.orderId)).size).toBe(1);
      // a concurrent duplicate may reach the provider again, but only with the SAME idempotency key (the provider dedupes it)
      expect(new Set(providerCalls.map(call => call.idempotencyKey)).size).toBe(1);
      expect(new Set(providerCalls.map(call => call.amountCents))).toEqual(new Set([16090]));
      expect(await ordersCount()).toBe(1);
      const [audit] = await pool.query<any[]>("SELECT COUNT(*) n FROM auditLogs WHERE action = 'checkout.shipping_accepted.v1' AND entityId = ?", [ok[0].value.orderId]);
      expect(Number(audit[0].n)).toBe(1);
    });
  });

  it("keeps the public gate ahead of all MySQL and provider work", async () => {
    vi.stubEnv("PUBLIC_SITE_MODE", "coming-soon");
    vi.stubEnv("PUBLIC_CHECKOUT_ENABLED", "false");
    await expect(httpClient("owner-81").stockCheckout.create.mutate({ attemptId: "stock-e2e-gate-00001", items: [{ productId: 4, variantId: 8, quantity: 1 }], delivery: syntheticDelivery }))
      .rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    expect(providerCalls).toHaveLength(0);
    const [rows] = await pool.execute<(Record<string, unknown> & { count: number })[]>("SELECT COUNT(*) AS count FROM stockCheckoutAttempts");
    expect(Number(rows[0]?.count)).toBe(0);
  });

  it("fails closed when the isolated HTTP context has no STOCK runtime", async () => {
    vi.stubEnv("PUBLIC_SITE_MODE", "store");
    vi.stubEnv("PUBLIC_CHECKOUT_ENABLED", "true");
    const offline = httpClient("owner-81", "/api/trpc-runtime-absent");
    await expect(offline.stockCheckout.create.mutate({ attemptId: "stock-runtime-absent-0001", items: [{ productId: 4, variantId: 8, quantity: 1 }], delivery: syntheticDelivery }))
      .rejects.toMatchObject({ data: { code: "SERVICE_UNAVAILABLE" } });
    await expect(offline.stockCheckout.resume.query({ attemptId: "stock-attempt-absent-00001" }))
      .rejects.toMatchObject({ data: { code: "SERVICE_UNAVAILABLE" } });
    await expect(offline.stockCheckout.resumeLatest.query())
      .rejects.toMatchObject({ data: { code: "SERVICE_UNAVAILABLE" } });
    expect(providerCalls).toHaveLength(0);

    const enabledOwner = httpClient("owner-81");
    const request = { attemptId: "stock-webhook-no-owner-0001", items: [{ productId: 4, variantId: 8, quantity: 1 }], delivery: syntheticDelivery };
    const created = await enabledOwner.stockCheckout.create.mutate(request);
    const eventBody = JSON.stringify({
      id: "evt-stock-no-owner",
      event: "PAYMENT_RECEIVED",
      payment: { id: "pay-synthetic-1", externalReference: created.orderId, status: "RECEIVED", value: 129, currency: "BRL", billingType: "PIX" },
    });
    const rejectedWebhook = await fetch(`${baseUrl}/webhook-asaas-runtime-absent`, {
      method: "POST",
      headers: { "content-type": "application/json", "asaas-access-token": syntheticWebhookToken },
      body: eventBody,
    });
    expect(rejectedWebhook.status).toBe(503);
    const [ledger] = await pool.execute<(Record<string, unknown> & { count: number })[]>("SELECT COUNT(*) AS count FROM stockWebhookEvents WHERE eventId = 'evt-stock-no-owner'");
    expect(Number(ledger[0]?.count)).toBe(0);
    const resumed = await enabledOwner.stockCheckout.resume.query({ attemptId: request.attemptId });
    expect(resumed.status).toBe("pending");
  });

  it("projects definitive payment cancellation and releases the reservation once", async () => {
    const owner = httpClient("owner-81");
    const request = { attemptId: "stock-e2e-cancel-terminal-01", items: [{ productId: 4, variantId: 8, quantity: 1 }], delivery: syntheticDelivery };
    const created = await owner.stockCheckout.create.mutate(request);
    const body = JSON.stringify({
      id: "evt-synthetic-failed-1",
      event: "PAYMENT_REFUSED",
      payment: { id: "pay-synthetic-1", externalReference: created.orderId, status: "REFUSED", value: 129, currency: "BRL" },
    });
    const failed = await fetch(`${baseUrl}/webhook/asaas`, { method: "POST", headers: { "content-type": "application/json", "asaas-access-token": syntheticWebhookToken }, body });
    expect(failed.status).toBe(200);
    const [orderRows] = await pool.execute<(Record<string, unknown> & { status: string; paymentStatus: string })[]>("SELECT status, paymentStatus FROM orders WHERE stockAttemptId = ?", [request.attemptId]);
    expect(orderRows[0]).toMatchObject({ status: "cancelled", paymentStatus: "unconfirmed" });
    const [reservationRows] = await pool.execute<(Record<string, unknown> & { status: string })[]>("SELECT status FROM stockReservations WHERE attemptId = ?", [request.attemptId]);
    expect(reservationRows[0]?.status).toBe("released");
    const [inventoryRows] = await pool.execute<(Record<string, unknown> & { stock: number; reservedStock: number })[]>("SELECT stock, reservedStock FROM productVariants WHERE id = 8");
    expect(inventoryRows[0]).toMatchObject({ stock: 1, reservedStock: 0 });
  });
});
