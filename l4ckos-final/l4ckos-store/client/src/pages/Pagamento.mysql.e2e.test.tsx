// @vitest-environment jsdom
import "../test/setupDom";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { createPool, type Pool } from "mysql2/promise";
import { drizzle as drizzleMysql } from "drizzle-orm/mysql2";
import express from "express";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import superjson from "superjson";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { MemoryRouter } from "react-router-dom";
import { appRouter } from "../../../server/routers";
import { setStockLocalHarnessDb } from "../../../server/db";
import { configureStockCheckoutRuntimeForLocalHarness, createContext } from "../../../server/_core/context";
import { createStockCheckoutRuntime } from "../../../server/stock/stockCheckoutRuntime";
import { trpc } from "../lib/trpc";
import { CartProvider } from "../contexts/CartContext";
import { seedCart, cartItem, product, variant } from "../test/fixtures";
import Pagamento from "./Pagamento";

vi.mock("../contexts/UserContext", () => ({
  useUser: () => ({
    user: { id: 81, name: "Cliente Sintético", email: "stock-customer@example.invalid", role: "user" },
    isAuthenticated: true,
  }),
}));

vi.mock("../lib/csrf", () => ({
  csrfFetch: (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init),
  getCsrfToken: async () => "synthetic-csrf-token",
}));

const dbHost = process.env.STOCK_MYSQL_HOST ?? "";
const dbPort = Number(process.env.STOCK_MYSQL_PORT ?? 0);
const dbName = process.env.STOCK_MYSQL_DATABASE ?? "";
const dbUser = process.env.STOCK_MYSQL_USER ?? "";
const dbPassword = process.env.STOCK_MYSQL_PASSWORD ?? "";
const webhookToken = "synthetic-ui-e2e-webhook-token";
const delivery = {
  id: "local-plano-piloto",
  label: "Entrega local - Plano Piloto",
  description: "Agendamento",
  price: 0,
  minDays: 1,
  maxDays: 2,
};

let pool: Pool;
let server: Server;
let baseUrl = "";
let providerCalls = 0;
let nativeFetch: typeof fetch;

function assertDisposableDatabase() {
  if (!/^(127\.0\.0\.1|localhost|::1)$/.test(dbHost)) throw new Error("STOCK_MYSQL_HOST must be loopback");
  if (dbName !== "l4ckos_stock_test" || dbUser !== "stock_test" || process.env.STOCK_LOCAL_HARNESS !== "true") {
    throw new Error("STOCK MySQL E2E target is not the disposable database");
  }
  if (!Number.isInteger(dbPort) || dbPort < 1 || dbPort > 65535 || !dbPassword) throw new Error("Missing disposable MySQL connection parameters");
}

async function resetDatabase() {
  await pool.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const table of ["stockWebhookEvents", "stockReservations", "orderItems", "stockCheckoutItems", "stockCheckoutAttempts", "orders", "productVariants", "products", "userPaymentMethods", "userProfiles", "userAddresses", "users"]) {
    await pool.query(`TRUNCATE TABLE \`${table}\``);
  }
  await pool.query("SET FOREIGN_KEY_CHECKS = 1");
  await pool.execute("INSERT INTO users (id, openId, name, email, role) VALUES (81, 'synthetic-owner-81', 'Cliente Sintético', 'stock-customer@example.invalid', 'user')");
  await pool.execute("INSERT INTO products (id, name, price, stock, category) VALUES (4, 'Synthetic STOCK shirt', 12900, 1, 'camisetas')");
  await pool.execute("INSERT INTO productVariants (id, productId, sku, size, color, price, stock, reservedStock, isActive) VALUES (8, 4, 'TSHIRT-BLK-M', 'M', 'Preto', 12900, 1, 0, 1)");
}

describe.skipIf(!process.env.STOCK_MYSQL_HOST)("Pagamento UI → tRPC → MySQL 9.7.2 (disposable only)", () => {
  beforeAll(async () => {
    assertDisposableDatabase();
    nativeFetch = globalThis.fetch.bind(globalThis);
    pool = createPool({ host: dbHost, port: dbPort, user: dbUser, password: dbPassword, database: dbName, connectionLimit: 8 });
    setStockLocalHarnessDb(drizzleMysql(pool));
    const [identity] = await pool.query<(Record<string, unknown> & { version: string })[]>("SELECT VERSION() AS version");
    if (!String(identity[0]?.version).startsWith("9.7.2")) throw new Error("MySQL version must be 9.7.2 for this E2E");

    const [productsTable] = await pool.execute<(Record<string, unknown> & { tableCount: number })[]>(
      "SELECT COUNT(*) AS tableCount FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'products'",
    );
    if (Number(productsTable[0]?.tableCount) === 0) {
      const schema = await readFile(resolve("server/stock/fixtures/mysql8-stock-schema.sql"), "utf8");
      for (const statement of schema.split(";").map(part => part.trim()).filter(Boolean)) await pool.query(statement);
    }
    const [productColumns] = await pool.execute<(Record<string, unknown> & { columnName: string })[]>(
      "SELECT COLUMN_NAME AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'products'",
    );
    const columns = new Set(productColumns.map(column => column.columnName));
    if (!columns.has("price")) await pool.query("ALTER TABLE products ADD COLUMN price INT NOT NULL DEFAULT 0");
    if (!columns.has("stock")) await pool.query("ALTER TABLE products ADD COLUMN stock INT NOT NULL DEFAULT 0");
    if (!columns.has("category")) await pool.query("ALTER TABLE products ADD COLUMN category VARCHAR(100) NOT NULL DEFAULT 'camisetas'");
    await pool.query(`CREATE TABLE IF NOT EXISTS userProfiles (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, userId INT NOT NULL, phone VARCHAR(32) NULL,
      createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE IF NOT EXISTS userPaymentMethods (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, userId INT NOT NULL, label VARCHAR(100) NOT NULL,
      holderName VARCHAR(255) NOT NULL, brand VARCHAR(80) NOT NULL, last4 VARCHAR(4) NOT NULL,
      expiry VARCHAR(8) NOT NULL, isDefault INT NOT NULL DEFAULT 0,
      createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB`);

    const runtime = createStockCheckoutRuntime({
      pool,
      provider: {
        supportsIdempotencyKey: true,
        async createPayment() {
          providerCalls += 1;
          return { paymentId: "pay-ui-e2e-1", checkoutUrl: "https://sandbox.invalid/ui-e2e" };
        },
      },
    });
    configureStockCheckoutRuntimeForLocalHarness(runtime);

    const app = express();
    app.use(express.json({ limit: "64kb" }));
    app.post("/api/shipping/quote", (_req, res) => res.json({ options: [delivery], source: "fallback-local" }));
    app.get("/api/cep/:cep", (_req, res) => res.json({ logradouro: "Rua de Teste", bairro: "Centro", localidade: "Brasília", uf: "DF" }));
    app.use("/api/trpc", createExpressMiddleware({
      router: appRouter,
      createContext: async options => ({
        ...await createContext(options),
        user: { id: 81, openId: "synthetic-owner-81", name: "Cliente Sintético", email: "stock-customer@example.invalid", role: "user", isBlocked: 0, sessionVersion: 1 } as any,
      }),
    }));
    app.post("/webhook/asaas", (await import("../../../server/controllers/paymentController")).asaasWebhookHandler);
    server = createServer(app);
    await new Promise<void>(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("UI E2E server did not bind to loopback");
    baseUrl = `http://127.0.0.1:${address.port}`;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const requested = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      return nativeFetch(new URL(`${requested.pathname}${requested.search}`, baseUrl), init);
    });
  }, 30_000);

  beforeEach(async () => {
    await resetDatabase();
    providerCalls = 0;
    vi.stubEnv("PUBLIC_SITE_MODE", "store");
    vi.stubEnv("PUBLIC_CHECKOUT_ENABLED", "true");
    vi.stubEnv("ASAAS_WEBHOOK_TOKEN", webhookToken);
    window.localStorage.clear();
    seedCart([cartItem({
      product: product({
        id: 4,
        name: "Synthetic STOCK shirt",
        price: 129,
        stock: 1,
        variantCatalogPresent: true,
        variants: [variant({ id: 8, productId: 4, stock: 1, price: 12900 })],
      }),
      variantId: 8,
      selectedOptions: { cor: "Preto", tamanho: "M" },
    })]);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    configureStockCheckoutRuntimeForLocalHarness(undefined);
    if (server) await new Promise<void>(resolveClose => server.close(() => resolveClose()));
    if (pool && process.env.STOCK_LOCAL_HARNESS === "true") setStockLocalHarnessDb(null);
    if (pool) await pool.end();
  });

  it("completes a synthetic purchase from the checkout UI through backend, MySQL, and Asaas webhook", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const trpcClient = trpc.createClient({
      links: [httpBatchLink({
        url: `${baseUrl}/api/trpc`,
        transformer: superjson,
        headers: {},
      })],
    });
    render(
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <CartProvider><MemoryRouter initialEntries={["/checkout"]}><Pagamento /></MemoryRouter></CartProvider>
        </QueryClientProvider>
      </trpc.Provider>,
    );

    await user.type(screen.getByLabelText(/CPF ou CNPJ/), "12345678909");
    await user.type(screen.getByLabelText(/^CEP/), "70040010");
    expect(await screen.findByRole("button", { name: /Entrega local - Plano Piloto/ }, { timeout: 5000 })).toBeTruthy();
    await user.type(screen.getByLabelText(/^Número/), "10");
    await waitFor(() => expect((screen.getByRole("button", { name: /Finalizar compra/ }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole("button", { name: /Finalizar compra/ }));
    expect(await screen.findByText("Aguardando confirmação do pagamento", {}, { timeout: 5000 })).toBeTruthy();
    expect(providerCalls).toBe(1);

    const [createdRows] = await pool.execute<(Record<string, unknown> & { attemptId: string; amountCents: number; status: string })[]>(
      "SELECT attemptId, orderId, amountCents, status FROM stockCheckoutAttempts WHERE ownerUserId = 81",
    );
    expect(createdRows).toHaveLength(1);
    expect(createdRows[0]).toMatchObject({ amountCents: 12900, status: "reserved" });
    const [reservedRows] = await pool.execute<(Record<string, unknown> & { stock: number; reservedStock: number })[]>(
      "SELECT stock, reservedStock FROM productVariants WHERE id = 8",
    );
    expect(reservedRows[0]).toMatchObject({ stock: 1, reservedStock: 1 });

    const paidEvent = JSON.stringify({
      id: "evt-ui-e2e-paid-1",
      event: "PAYMENT_RECEIVED",
      payment: { id: "pay-ui-e2e-1", externalReference: String(createdRows[0]?.orderId), status: "RECEIVED", value: 129, currency: "BRL" },
    });
    const webhookResponse = await nativeFetch(`${baseUrl}/webhook/asaas`, {
      method: "POST",
      headers: { "content-type": "application/json", "asaas-access-token": webhookToken },
      body: paidEvent,
    });
    expect(webhookResponse.status).toBe(200);
    await user.click(await screen.findByRole("button", { name: "Atualizar status" }));
    expect(await screen.findByText("Pagamento aprovado", {}, { timeout: 5000 })).toBeTruthy();
    expect(providerCalls).toBe(1);

    const [finalRows] = await pool.execute<(Record<string, unknown> & { stock: number; reservedStock: number })[]>(
      "SELECT stock, reservedStock FROM productVariants WHERE id = 8",
    );
    expect(finalRows[0]).toMatchObject({ stock: 0, reservedStock: 0 });
    const [ledgerRows] = await pool.execute<(Record<string, unknown> & { eventCount: number })[]>(
      "SELECT COUNT(*) AS eventCount FROM stockWebhookEvents WHERE eventId = 'evt-ui-e2e-paid-1'",
    );
    expect(Number(ledgerRows[0]?.eventCount)).toBe(1);
    expect(screen.getByRole("link", { name: "Ver meus pedidos" })).toBeTruthy();
  }, 30_000);
});
