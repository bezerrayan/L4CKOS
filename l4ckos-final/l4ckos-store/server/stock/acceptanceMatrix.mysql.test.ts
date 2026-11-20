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
import { deliverPaymentNotifications } from "../payments/paymentNotificationOutbox";
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


const emailSpy = vi.hoisted(() => ({ calls: [] as Array<{ fn: string; to: string | null }>, fail: false }));
vi.mock("../services/emailService.js", async importOriginal => {
  const original = await importOriginal<Record<string, unknown>>();
  const wrapped: Record<string, unknown> = { ...original };
  for (const [name, value] of Object.entries(original)) {
    if (!name.startsWith("send") || typeof value !== "function") continue;
    wrapped[name] = vi.fn(async (input: { customerEmail?: string } | undefined) => {
      emailSpy.calls.push({ fn: name, to: input?.customerEmail ?? null });
      if (emailSpy.fail) throw new Error("SYNTHETIC_EMAIL_PROVIDER_DOWN");
      return { id: "synthetic-email-id" };
    });
  }
  return wrapped;
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

describe.skipIf(!process.env.STOCK_MYSQL_HOST)("Commercial acceptance matrix A-J (MySQL 9.7.2 disposable only)", () => {
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


  const token = syntheticWebhookToken;
  const item = (quantity = 1) => [{ productId: 4, variantId: 8, quantity }];
  const mk = (attemptId: string, session = "owner-81") => httpClient(session).stockCheckout.create.mutate({ attemptId, items: item(), delivery: syntheticDelivery });
  const hook = (id: string, event: string, orderId: string, status: string, paymentId = "pay-synthetic-1") =>
    fetch(`${baseUrl}/webhook/asaas`, {
      method: "POST",
      headers: { "content-type": "application/json", "asaas-access-token": token },
      body: JSON.stringify({ id, event, payment: { id: paymentId, externalReference: orderId, status, value: 129, currency: "BRL", billingType: "PIX" } }),
    });
  const one = async <T = Record<string, any>>(sql: string, params: unknown[] = []) => { const [rows] = await pool.query<any[]>(sql, params); return rows[0] as T; };
  const inv = () => readVariantInventory(8);
  const orderRow = (attemptId: string) => one<{ id: number; status: string; paymentStatus: string; trackingCode: string | null }>("SELECT id, status, paymentStatus, trackingCode FROM orders WHERE stockAttemptId = ?", [attemptId]);

  beforeEach(() => { emailSpy.calls = []; emailSpy.fail = false; });

  it("A. approved purchase: PIX created -> signed PAYMENT_RECEIVED -> paid, stock settled, visible to admin, shippable with tracking", async () => {
    const created = await mk("accept-A-attempt-0001");
    expect(created).toMatchObject({ status: "pending", amountCents: 12900, replayed: false });
    expect(await inv()).toMatchObject({ stock: 1, reservedStock: 1 });
    expect((await hook("evt-A-paid", "PAYMENT_RECEIVED", created.orderId, "RECEIVED")).status).toBe(200);
    expect(await orderRow("accept-A-attempt-0001")).toMatchObject({ status: "paid", paymentStatus: "confirmed" });
    expect(await inv()).toMatchObject({ stock: 0, reservedStock: 0 });
    const admin = adminHttpClient("admin-83");
    const listed = (await admin.admin.ordersList.query()).find(order => order.id === Number(created.orderId));
    expect(listed).toMatchObject({ status: "paid", totalPrice: 12900, customerEmail: "stock-customer@example.invalid", shippingAddress: expect.objectContaining({ zipCode: "70000000", street: "Rua de Teste" }) });
    await admin.admin.orderUpdate.mutate({ orderId: Number(created.orderId), status: "processing" });
    await admin.admin.orderUpdate.mutate({ orderId: Number(created.orderId), status: "shipped", trackingCode: "BR123456789SYN" });
    expect(await orderRow("accept-A-attempt-0001")).toMatchObject({ status: "shipped", trackingCode: "BR123456789SYN" });
    expect(emailSpy.calls.map(c => c.fn)).toEqual(expect.arrayContaining(["sendOrderPreparingEmail", "sendShippingEmail"]));
  });

  it("B/I. PIX created but unpaid is never treated as paid and cannot be shipped by the admin", async () => {
    const created = await mk("accept-B-attempt-0001");
    expect((await hook("evt-B-created", "PAYMENT_CREATED", created.orderId, "PENDING")).status).toBe(200);
    expect(await orderRow("accept-B-attempt-0001")).toMatchObject({ status: "pending" });
    expect((await orderRow("accept-B-attempt-0001")).paymentStatus).not.toBe("confirmed");
    expect(await inv()).toMatchObject({ stock: 1, reservedStock: 1 });
    expect(await httpClient("owner-81").stockCheckout.resume.query({ attemptId: "accept-B-attempt-0001" })).toMatchObject({ status: "pending" });
    const admin = adminHttpClient("admin-83");
    for (const status of ["paid", "processing", "shipped", "delivered"] as const) {
      await expect(admin.admin.orderUpdate.mutate({ orderId: Number(created.orderId), status })).rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });
    }
    // a PAYMENT_RECEIVED whose authoritative provider state is still PENDING must not settle
    expect((await hook("evt-B-fake", "PAYMENT_RECEIVED", created.orderId, "PENDING")).status).not.toBe(500);
    expect(await orderRow("accept-B-attempt-0001")).toMatchObject({ status: "pending" });
    expect(await inv()).toMatchObject({ stock: 1, reservedStock: 1 });
  });

  it("C. refused payment releases the stock and lets the customer retry; an overdue (expired) PIX is only an observation, never a payment", async () => {
    const refused = await mk("accept-C-refused-0001");
    expect((await hook("evt-C-refused", "PAYMENT_REFUSED", refused.orderId, "REFUSED")).status).toBe(200);
    expect(await orderRow("accept-C-refused-0001")).toMatchObject({ status: "cancelled" });
    expect(await inv()).toMatchObject({ stock: 1, reservedStock: 0 });
    expect(await httpClient("owner-81").stockCheckout.resume.query({ attemptId: "accept-C-refused-0001" })).toMatchObject({ status: "failed", canStartNewAttempt: true });
    const retry = await mk("accept-C-retry-attempt-0001");
    expect(retry).toMatchObject({ status: "pending", replayed: false });
    paymentIds.clear();
    const overdue = await hook("evt-C-overdue", "PAYMENT_OVERDUE", retry.orderId, "OVERDUE", "pay-synthetic-2");
    expect(overdue.status).toBe(200);
    const row = await orderRow("accept-C-retry-attempt-0001");
    expect(row.status).not.toBe("paid");
    expect(row.paymentStatus).not.toBe("confirmed");
  });

  it("D. the same webhook delivered repeatedly, and the same payment under new event ids, settles once", async () => {
    const created = await mk("accept-D-attempt-0001");
    for (let i = 0; i < 3; i++) expect((await hook("evt-D-paid", "PAYMENT_RECEIVED", created.orderId, "RECEIVED")).status).toBe(200);
    expect((await hook("evt-D-paid-again", "PAYMENT_RECEIVED", created.orderId, "RECEIVED")).status).toBe(200);
    expect(await inv()).toMatchObject({ stock: 0, reservedStock: 0 });
    expect(Number((await one("SELECT COUNT(*) n FROM orders WHERE stockAttemptId = ?", ["accept-D-attempt-0001"])).n)).toBe(1);
    expect(Number((await one("SELECT COUNT(*) n FROM orderItems WHERE orderId = ?", [created.orderId])).n)).toBe(1);
    expect(Number((await one("SELECT COUNT(*) n FROM stockWebhookEvents WHERE eventId = 'evt-D-paid'")).n)).toBe(1);
    expect(Number((await one("SELECT COUNT(*) n FROM notificationOutbox WHERE type = 'payment-approved-email-v1' AND orderId = ?", [created.orderId])).n)).toBeLessThanOrEqual(1);
  });

  it("E. sold-out, inactive, mismatched and over-quantity variants cannot be bought; no charge is created", async () => {
    await mk("accept-E-first-attempt-01");
    await expect(mk("accept-E-second-attempt-1", "other-82")).rejects.toMatchObject({ data: { appError: { code: "STOCK_UNAVAILABLE" } } });
    expect(providerCalls).toHaveLength(1);
    expect(Number((await one("SELECT COUNT(*) n FROM orders")).n)).toBe(1);
    const other = httpClient("other-82");
    await pool.execute("UPDATE productVariants SET isActive = 0 WHERE id = 8");
    await expect(other.stockCheckout.create.mutate({ attemptId: "accept-E-inactive-attem1", items: item(), delivery: syntheticDelivery })).rejects.toBeTruthy();
    await pool.execute("UPDATE productVariants SET isActive = 1 WHERE id = 8");
    await expect(other.stockCheckout.create.mutate({ attemptId: "accept-E-wrong-product-1", items: [{ productId: 999, variantId: 8, quantity: 1 }], delivery: syntheticDelivery })).rejects.toBeTruthy();
    await expect(other.stockCheckout.create.mutate({ attemptId: "accept-E-wrong-size-0001", items: [{ productId: 4, variantId: 8, quantity: 1, size: "G", color: "Preto" }], delivery: syntheticDelivery })).rejects.toBeTruthy();
    await expect(other.stockCheckout.create.mutate({ attemptId: "accept-E-too-many-00001", items: item(5), delivery: syntheticDelivery })).rejects.toBeTruthy();
    expect(providerCalls).toHaveLength(1);
    expect(Number((await one("SELECT COUNT(*) n FROM orders")).n)).toBe(1);
  });

  it("F. when freight cannot be priced there is no carrier option and no charge for an out-of-territory address", async () => {
    shippingQuoteResult = { options: [], source: "unavailable" };
    const farAddress = { ...syntheticDelivery.address, zipCode: "01310100", city: "São Paulo", state: "SP" };
    const quoted = await httpClient("owner-81").stockCheckout.quoteShipping.mutate({ items: item(), address: farAddress } as never);
    expect(quoted.options).toEqual([]);
    await expect(httpClient("owner-81").stockCheckout.create.mutate({ attemptId: "accept-F-attempt-00001", items: item(), delivery: { optionId: "local-plano-piloto", address: farAddress } })).rejects.toBeTruthy();
    expect(providerCalls).toHaveLength(0);
    expect(Number((await one("SELECT COUNT(*) n FROM orders")).n)).toBe(0);
    expect(await inv()).toMatchObject({ stock: 1, reservedStock: 0 });
  });

  it("G. e-mail provider failure never undoes a settled payment, and a confirmation e-mail is queued for the customer", async () => {
    emailSpy.fail = true;
    const created = await mk("accept-G-attempt-0001");
    expect((await hook("evt-G-paid", "PAYMENT_RECEIVED", created.orderId, "RECEIVED")).status).toBe(200);
    expect(await orderRow("accept-G-attempt-0001")).toMatchObject({ status: "paid", paymentStatus: "confirmed" });
    expect(await inv()).toMatchObject({ stock: 0, reservedStock: 0 });
    // the customer must have a durable payment-approved notification (sent or still retryable), keyed by order
    const queued = Number((await one("SELECT COUNT(*) n FROM notificationOutbox WHERE type = 'payment-approved-email-v1' AND orderId = ?", [created.orderId])).n);
    expect(queued).toBe(1);
  });

  it("G2. the customer is e-mailed once when the payment is approved (no duplicate on redelivery)", async () => {
    const created = await mk("accept-G2-attempt-001");
    await hook("evt-G2-paid", "PAYMENT_RECEIVED", created.orderId, "RECEIVED");
    await hook("evt-G2-paid", "PAYMENT_RECEIVED", created.orderId, "RECEIVED");
    const approved = emailSpy.calls.filter(c => c.fn === "sendPaymentApprovedEmail" && c.to === "stock-customer@example.invalid");
    expect(approved).toHaveLength(1);
  });

  it("G3. Resend down after the commit: payment stays settled, the outbox row stays retryable, and a later worker pass sends exactly once", async () => {
    emailSpy.fail = true;
    const created = await mk("accept-G3-attempt-001");
    expect((await hook("evt-G3-paid", "PAYMENT_RECEIVED", created.orderId, "RECEIVED")).status).toBe(200);
    const row = () => one<{ status: string; attempts: number }>("SELECT status, attempts FROM notificationOutbox WHERE type = 'payment-approved-email-v1' AND orderId = ?", [created.orderId]);
    expect(await orderRow("accept-G3-attempt-001")).toMatchObject({ status: "paid" });
    expect(await row()).toMatchObject({ status: "failed", attempts: 1 });
    // workers disabled / provider still down: nothing else is sent and the row is not lost
    await pool.execute("UPDATE notificationOutbox SET nextAttemptAt = NOW() - INTERVAL 1 SECOND WHERE orderId = ?", [created.orderId]);
    emailSpy.fail = false;
    await deliverPaymentNotifications(5, Number(created.orderId), "payment-approved-email-v1");
    expect(await row()).toMatchObject({ status: "sent" });
    await deliverPaymentNotifications(5, Number(created.orderId), "payment-approved-email-v1");
    await hook("evt-G3-paid", "PAYMENT_RECEIVED", created.orderId, "RECEIVED");
    const ok = emailSpy.calls.filter(c => c.fn === "sendPaymentApprovedEmail");
    expect(ok).toHaveLength(2); // one failed attempt + one delivery; no third send after redelivery or a second worker pass
    expect(Number((await one("SELECT COUNT(*) n FROM notificationOutbox WHERE orderId = ?", [created.orderId])).n)).toBe(1);
  });

  it("G4. an outbox write failure inside the settlement transaction rolls the payment back (nothing half-settled); redelivery then settles once", async () => {
    const created = await mk("accept-G4-attempt-001");
    await pool.query("RENAME TABLE notificationOutbox TO notificationOutbox_hidden");
    try {
      const failed = await hook("evt-G4-paid", "PAYMENT_RECEIVED", created.orderId, "RECEIVED");
      expect(failed.status).toBeGreaterThanOrEqual(500);
    } finally {
      await pool.query("RENAME TABLE notificationOutbox_hidden TO notificationOutbox");
    }
    expect(await orderRow("accept-G4-attempt-001")).toMatchObject({ status: "pending" });
    expect(await inv()).toMatchObject({ stock: 1, reservedStock: 1 });
    expect(Number((await one("SELECT COUNT(*) n FROM stockWebhookEvents WHERE eventId = 'evt-G4-paid'")).n)).toBe(0);
    expect((await hook("evt-G4-paid", "PAYMENT_RECEIVED", created.orderId, "RECEIVED")).status).toBe(200);
    expect(await orderRow("accept-G4-attempt-001")).toMatchObject({ status: "paid" });
    expect(await inv()).toMatchObject({ stock: 0, reservedStock: 0 });
    expect(Number((await one("SELECT COUNT(*) n FROM notificationOutbox WHERE orderId = ?", [created.orderId])).n)).toBe(1);
  });

  it("J. Coming Soon and a closed checkout block purchase and freight before any database or provider work; restricted products stay unbuyable", async () => {
    vi.stubEnv("PUBLIC_SITE_MODE", "coming-soon");
    vi.stubEnv("PUBLIC_CHECKOUT_ENABLED", "false");
    await expect(mk("accept-J-closed-0000001")).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    vi.stubEnv("PUBLIC_SITE_MODE", "store");
    await expect(mk("accept-J-closed-0000002")).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    expect(providerCalls).toHaveLength(0);
    expect(Number((await one("SELECT COUNT(*) n FROM stockCheckoutAttempts")).n)).toBe(0);
    vi.stubEnv("PUBLIC_CHECKOUT_ENABLED", "true");
    await pool.execute("INSERT INTO products (id, name, category, price, stock) VALUES (40, 'Camiseta Clã XIV Bis', 'camisetas', 12900, 0), (41, '[QA-STAGING] Camiseta', 'camisetas', 12900, 0)");
    await pool.execute("INSERT INTO productVariants (id, productId, name, sku, size, color, price, stock, reservedStock, isActive) VALUES (40, 40, 'X', 'XIV-REST-M', 'M', 'Preto', 12900, 5, 0, 1), (41, 41, 'Q', 'QA-M', 'M', 'Preto', 12900, 5, 0, 1)");
    await canonicalizeSeedVariants(pool);
    const owner = httpClient("owner-81");
    for (const [productId, variantId, attemptId] of [[40, 40, "accept-J-restricted-001"], [41, 41, "accept-J-qa-product-001"]] as const) {
      await expect(owner.stockCheckout.create.mutate({ attemptId, items: [{ productId, variantId, quantity: 1 }], delivery: syntheticDelivery })).rejects.toBeTruthy();
    }
    expect(providerCalls).toHaveLength(0);
    expect(await readVariantInventory(40)).toMatchObject({ stock: 5, reservedStock: 0 });
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    configureStockCheckoutRuntimeForLocalHarness(undefined);
    if (httpServer) await new Promise<void>(resolveClose => httpServer.close(() => resolveClose()));
    if (pool && process.env.STOCK_LOCAL_HARNESS === "true") setStockLocalHarnessDb(null);
    if (pool) await pool.end();
  });

});
