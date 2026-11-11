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
import { getOrderById, getOrderByIdAndUser, setStockLocalHarnessDb } from "../db";
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
import { canonicalizeSeedVariants } from "./testing/canonicalizeSeedVariants";

const database = process.env.STOCK_MYSQL_DATABASE ?? "";
const host = process.env.STOCK_MYSQL_HOST ?? "";
const port = Number(process.env.STOCK_MYSQL_PORT ?? 0);
const user = process.env.STOCK_MYSQL_USER ?? "";
const password = process.env.STOCK_MYSQL_PASSWORD ?? "";
const syntheticWebhookToken = "synthetic-stock-webhook-token-only";
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

async function resetDatabase() {
  await pool.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const table of ["stockWebhookEvents", "stockReservations", "orderItems", "stockCheckoutItems", "stockCheckoutAttempts", "orders", "productVariants", "products", "userAddresses", "users"]) {
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
      provider: {
        supportsIdempotencyKey: true,
        async createPayment(input) {
          providerCalls.push(input);
          // unique per call (a sync push+length), so concurrent attempts never collide on the payment unique key
          return { paymentId: `pay-synthetic-${providerCalls.length}`, checkoutUrl: "https://sandbox.invalid/synthetic-checkout" };
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
    providerCalls = [];
    vi.stubEnv("PUBLIC_SITE_MODE", "store");
    vi.stubEnv("PUBLIC_CHECKOUT_ENABLED", "true");
    vi.stubEnv("ASAAS_WEBHOOK_TOKEN", syntheticWebhookToken);
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
      payment: { id: "pay-synthetic-1", externalReference: created.orderId, status: "RECEIVED", value: 129, currency: "BRL" },
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
      payment: { id: "pay-synthetic-1", externalReference: created.orderId, status: "RECEIVED", value: 129, currency: "BRL" },
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
      provider: {
        supportsIdempotencyKey: true,
        async createPayment(input) {
          providerCalls.push(input);
          return { paymentId: "pay-synthetic-1", checkoutUrl: "https://sandbox.invalid/synthetic-checkout" };
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
    const body = (value: number) => ({ id: "evt-replay-paid-1", event: "PAYMENT_RECEIVED", payment: { id: "pay-synthetic-1", externalReference: created.orderId, status: "RECEIVED", value, currency: "BRL" } });
    const attemptStatus = async () => ((await pool.execute<(Record<string, unknown> & { status: string })[]>("SELECT status FROM stockCheckoutAttempts WHERE attemptId = 'stock-replay-attempt-0001'"))[0][0]?.status);
    const ledger = async () => Number(((await pool.execute<(Record<string, unknown> & { n: number })[]>("SELECT COUNT(*) AS n FROM stockWebhookEvents"))[0][0])?.n);

    // 1. Nothing was attested at an authenticated delivery: a bare DB envelope is NOT accepted.
    const bare = await processWebhookEnvelope(body(129));
    expect(bare.status).toBe(503);
    expect(bare.body).toMatchObject({ reason: "stock_replay_requires_authenticated_delivery" });
    expect([await attemptStatus(), await ledger()]).toEqual(["reserved", 0]);

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
    const claimed = async () => Number(((await pool.query<(Record<string, unknown> & { n: number })[]>("SELECT COALESCE(SUM(i.quantity),0) AS n FROM orderItems i JOIN orders o ON o.id=i.orderId WHERE i.productionBatchId = 70 AND i.salesModeAtPurchase='PREORDER' AND o.status <> 'cancelled'"))[0] as any)[0].n);
    const variantStock = async () => ((await pool.query<(Record<string, unknown> & { stock: number; reservedStock: number })[]>("SELECT stock, reservedStock FROM productVariants WHERE id IN (21,22) ORDER BY id"))[0] as any[]).map(r => [Number(r.stock), Number(r.reservedStock)]);
    const webhook = (eventId: string, event: string, status: string, orderId: string, paymentId: string, value: number) =>
      fetch(`${baseUrl}/webhook/asaas`, { method: "POST", headers: { "content-type": "application/json", "asaas-access-token": syntheticWebhookToken }, body: JSON.stringify({ id: eventId, event, payment: { id: paymentId, externalReference: orderId, status, value, currency: "BRL" } }) });

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
      const failed = await webhook("evt-pre-refused-1", "PAYMENT_REFUSED", "REFUSED", a.orderId, "pay-synthetic-1", 258);
      expect(failed.status).toBe(200);
      expect(await claimed()).toBe(0);
      const b = await buy("other-82", "xiv-preorder-release-attempt-0003", 2);
      expect(b).toMatchObject({ status: "pending" });
      const paid = await webhook("evt-pre-paid-1", "PAYMENT_RECEIVED", "RECEIVED", b.orderId, "pay-synthetic-2", 258);
      expect(paid.status).toBe(200);
      const [orderRows] = await pool.query<(Record<string, unknown> & { status: string })[]>("SELECT status FROM orders WHERE id = ?", [b.orderId]);
      expect(orderRows[0].status).toBe("paid");
      expect(await claimed()).toBe(2);
      expect(await variantStock()).toEqual([[0, 0], [0, 0]]);
      await expect(buy("admin-83", "xiv-preorder-release-attempt-0004", 1)).rejects.toMatchObject({ data: { appError: { code: "STOCK_UNAVAILABLE" } } });
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
      payment: { id: "pay-synthetic-1", externalReference: created.orderId, status: "RECEIVED", value: 129, currency: "BRL" },
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
