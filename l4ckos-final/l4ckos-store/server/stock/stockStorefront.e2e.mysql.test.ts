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
import { asaasWebhookHandler, createAsaasWebhookHandler } from "../controllers/paymentController";
import { sdk } from "../_core/sdk";
import { COOKIE_NAME } from "../../shared/const";
import { createStockCheckoutRuntime } from "./stockCheckoutRuntime";
import { processSignedStockWebhook, type StockCheckoutStore } from "./stockCheckout";
import { createMysqlStockCheckoutStore } from "./mysqlStockCheckoutStore";
import { createStockCheckoutClient, type StockCartLine } from "../../client/src/stock/stockCheckoutClient";
import { describeStockAttempt, describeStockCheckoutError } from "../../client/src/stock/stockAttemptView";
import { stockCheckoutHttpRequestV1Schema } from "../../shared/stockCheckoutV1";

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
  await pool.execute("INSERT INTO products (id, name) VALUES (4, 'Synthetic STOCK shirt')");
  await pool.execute("INSERT INTO productVariants (id, productId, sku, size, color, price, stock, reservedStock, isActive) VALUES (8, 4, 'TSHIRT-BLK-M', 'M', 'Preto', 12900, 1, 0, 1)");
}

describe.skipIf(!process.env.STOCK_MYSQL_HOST)("Storefront STOCK client against the real server (MySQL 9.7.2 disposable only)", () => {
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
    sessionTokens = {
      "owner-81": await sdk.createSessionToken("synthetic-owner-81", { name: "STOCK Customer", sessionVersion: 1 }),
      "other-82": await sdk.createSessionToken("synthetic-other-82", { name: "Other Customer", sessionVersion: 1 }),
      "admin-83": await sdk.createSessionToken("synthetic-admin-83", { name: "Synthetic Admin", sessionVersion: 1 }),
    };
    runtime = createStockCheckoutRuntime({
      pool,
      provider: {
        supportsIdempotencyKey: true,
        async createPayment(input) {
          providerCalls.push(input);
          return { paymentId: "pay-synthetic-1", checkoutUrl: "https://sandbox.invalid/synthetic-checkout" };
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

  // ---- Frontend behavior against the real transactional server (no mocks of the server) ----
  const LINES: StockCartLine[] = [{ productId: 4, variantId: 8, quantity: 1, variants: [{ id: 8, productId: 4, size: "M", color: "Preto", active: true }] }];
  const memoryStorage = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  };
  const storefront = (session: string, storage = memoryStorage()) => {
    const http = httpClient(session) as unknown as ReturnType<typeof adminHttpClient>;
    return createStockCheckoutClient({
      enabled: true,
      storage,
      transport: {
        create: request => http.stockCheckout.create.mutate(stockCheckoutHttpRequestV1Schema.parse(request)),
        resume: attemptId => http.stockCheckout.resume.query({ attemptId }),
        resumeLatest: () => http.stockCheckout.resumeLatest.query(),
      },
    });
  };

  it("two devices of the same account starting the same purchase: one charge; the other is rejected, recovers the open attempt and stays blocked", async () => {
    const deviceA = storefront("owner-81");
    const deviceB = storefront("owner-81"); // separate storage = another browser/device, no shared attemptId
    const results = await Promise.allSettled([deviceA.create(LINES, syntheticDelivery), deviceB.create(LINES, syntheticDelivery)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r): r is PromiseRejectedResult => r.status === "rejected")!;
    expect(rejected.reason).toMatchObject({ data: { appError: { code: "CHECKOUT_ATTEMPT_NOT_REUSABLE" } } });
    expect(providerCalls).toHaveLength(1);

    // What the UI does next: treat it as an uncertain outcome and re-query.
    expect(describeStockCheckoutError(rejected.reason).outcomeUnknown).toBe(true);
    const loserClient = results[0].status === "rejected" ? deviceA : deviceB;
    const recovered = await loserClient.resume(LINES);
    expect(recovered.status).toBe("pending");
    expect(recovered.checkoutUrl).toBe("https://sandbox.invalid/synthetic-checkout");
    expect(describeStockAttempt(recovered).blocksCheckout).toBe(true);
    expect(providerCalls).toHaveLength(1);
  });

  it("a device that lost its storage resumes the open attempt from the server instead of creating a new charge", async () => {
    await storefront("owner-81").create(LINES, syntheticDelivery);
    const resumed = await storefront("owner-81").resume(LINES);
    expect(resumed.status).toBe("pending");
    expect(providerCalls).toHaveLength(1);
  });

  it("changing the address after the attempt exists is refused by the server (same or new attemptId): still one charge, UI is told to consult", async () => {
    const device = storefront("owner-81");
    await device.create(LINES, syntheticDelivery);
    const changed = { ...syntheticDelivery, address: { ...syntheticDelivery.address, number: "999" } };
    const sameId = await device.create(LINES, changed).catch(e => e);
    expect(sameId).toMatchObject({ data: { appError: { code: "CHECKOUT_ATTEMPT_NOT_REUSABLE" } } });
    const otherDevice = await storefront("owner-81").create(LINES, changed).catch(e => e);
    expect(otherDevice).toMatchObject({ data: { appError: { code: "CHECKOUT_ATTEMPT_NOT_REUSABLE" } } });
    expect(describeStockCheckoutError(otherDevice).outcomeUnknown).toBe(true);
    expect(providerCalls).toHaveLength(1);
  });

  it("another account never sees or resumes the owner's attempt, even with the owner's attemptId", async () => {
    const created = await storefront("owner-81").create(LINES, syntheticDelivery);
    await expect(storefront("other-82").resume(LINES)).rejects.toThrow("STOCK_ATTEMPT_NOT_FOUND_ON_SERVER");
    const http = httpClient("other-82") as unknown as ReturnType<typeof adminHttpClient>;
    await expect(http.stockCheckout.resume.query({ attemptId: created.attemptId })).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    expect(await http.stockCheckout.resumeLatest.query()).toBeNull();
  });

  it("an unauthenticated session gets UNAUTHORIZED and the UI never reads it as 'no attempt'", async () => {
    const anonymous = storefront("not-a-valid-session");
    const error = await anonymous.resume(LINES).catch(e => e);
    expect(error).toMatchObject({ data: { code: "UNAUTHORIZED" } });
    expect((error as Error).message).not.toMatch(/NOT_FOUND/);
    const created = await anonymous.create(LINES, syntheticDelivery).catch(e => e);
    expect(describeStockCheckoutError(created).message).toMatch(/sessão expirou/);
    expect(providerCalls).toHaveLength(0);
  });
});
