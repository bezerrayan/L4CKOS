import mysql, { type Connection } from "mysql2/promise";
import http from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  claimPaymentCreation,
  completePaymentCreation,
  createCheckoutOrderAtomically,
  getCheckoutByAttempt,
  markNotificationFailed,
  markPaymentCreationUnknown,
  processAsaasPaymentEvent,
} from "./db";
import { buildCheckoutFingerprint } from "./services/checkoutIntegrity";
import { quoteShippingDetailed } from "./services/shippingService";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim() || "";
const canRunDatabaseTests = /(?:^|[/:_-])test(?:[/?_-]|$)/i.test(testDatabaseUrl);
let connection: Connection;

async function cleanDatabase() {
  for (const table of ["notificationOutbox", "paymentEvents", "payments", "stockReservations", "orderItems", "orders", "productVariants", "products", "coupons", "auditLogs", "users"]) {
    await connection.query(`DELETE FROM \`${table}\``);
  }
}

async function seedProduct(options: { stock?: number; variant?: boolean } = {}) {
  const stock = options.stock ?? 1;
  const [userResult] = await connection.query<any>("INSERT INTO users (openId, name, email) VALUES (?, ?, ?)", [`p0-user-${crypto.randomUUID()}`, "Cliente P0", "p0@example.test"]);
  const [productResult] = await connection.query<any>("INSERT INTO products (name, category, price, stock, optionColors, optionSizes) VALUES (?, ?, ?, ?, ?, ?)", ["Camiseta original", "vestuario", 9990, stock, options.variant ? JSON.stringify(["Verde"]) : null, options.variant ? JSON.stringify(["M"]) : null]);
  const userId = Number(userResult.insertId);
  const productId = Number(productResult.insertId);
  let variantId: number | null = null;
  if (options.variant) {
    const [variantResult] = await connection.query<any>("INSERT INTO productVariants (productId, name, sku, size, color, optionKey, price, stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [productId, "Camiseta Verde M", "CAM-VERDE-M", "M", "Verde", "size:m|color:verde", 10990, stock]);
    variantId = Number(variantResult.insertId);
  }
  return { userId, productId, variantId };
}

function checkoutInput(seed: Awaited<ReturnType<typeof seedProduct>>, overrides: Record<string, unknown> = {}) {
  const checkoutAttemptId = crypto.randomUUID();
  const items = [{ productId: seed.productId, variantId: seed.variantId, quantity: 1 }];
  return {
    userId: seed.userId,
    checkoutAttemptId,
    checkoutFingerprint: buildCheckoutFingerprint({
      userId: seed.userId,
      method: "PIX",
      items,
      shipping: { cep: "70000000", optionId: "local-plano-piloto" },
      shippingAddress: { recipient: "Cliente P0" },
    }),
    method: "PIX" as const,
    items,
    shippingCents: 0,
    shippingAddress: { recipient: "Cliente P0", zipCode: "70000000", street: "Rua Teste", number: "1", neighborhood: "Centro", city: "Brasília", state: "DF" },
    ...overrides,
  };
}

async function createAsaasMock(mode: "success" | "fail-before-create" | "timeout-after-create") {
  const state = {
    customerPosts: 0,
    paymentPosts: 0,
    paymentGets: 0,
    failureInjected: false,
    charges: new Map<string, any>(),
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    if (req.method === "GET" && url.pathname === "/v3/payments") {
      state.paymentGets += 1;
      const reference = url.searchParams.get("externalReference") || "";
      const payment = state.charges.get(reference);
      send(200, { data: payment ? [payment] : [] });
      return;
    }
    if (req.method === "POST" && url.pathname === "/v3/customers") {
      state.customerPosts += 1;
      send(200, { id: `cus-local-${state.customerPosts}` });
      return;
    }
    if (req.method === "POST" && url.pathname === "/v3/payments") {
      state.paymentPosts += 1;
      let raw = "";
      for await (const chunk of req) raw += String(chunk);
      const body = JSON.parse(raw || "{}") as { externalReference?: string; value?: number; customer?: string; billingType?: string };
      if (!state.failureInjected && mode === "fail-before-create") {
        state.failureInjected = true;
        send(503, { errors: [{ description: "falha local antes de criar" }] });
        return;
      }
      const payment = {
        id: `pay-local-${state.paymentPosts}`,
        externalReference: body.externalReference,
        value: body.value,
        customer: body.customer,
        billingType: body.billingType,
        invoiceUrl: "http://asaas.local/invoice",
        pixQrCode: "local-qr",
        pixCopyPaste: "local-pix-copy",
        status: "PENDING",
      };
      state.charges.set(String(body.externalReference || ""), payment);
      if (!state.failureInjected && mode === "timeout-after-create") {
        state.failureInjected = true;
        res.socket?.destroy();
        return;
      }
      send(200, payment);
      return;
    }
    send(404, { message: "not found" });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Mock Asaas did not bind a TCP port");
  return {
    state,
    baseUrl: `http://127.0.0.1:${address.port}/v3`,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

function createCheckoutCaller(userId: number) {
  const now = new Date();
  const ctx: TrpcContext = {
    user: {
      id: userId,
      openId: `p0-user-${userId}`,
      name: "Cliente P0",
      email: "p0@example.test",
      cpf: null,
      phone: null,
      asaasCustomerId: null,
      loginMethod: "local",
      role: "user",
      isVip: 0,
      isBlocked: 0,
      sessionVersion: 1,
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    },
    req: { protocol: "http", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
  return appRouter.createCaller(ctx);
}

function externalCheckoutInput(seed: Awaited<ReturnType<typeof seedProduct>>) {
  return {
    checkoutAttemptId: crypto.randomUUID(),
    method: "PIX" as const,
    items: [{ productId: seed.productId, variantId: seed.variantId, quantity: 1 }],
    shipping: { cep: "70000000", optionId: "local-plano-piloto" },
    shippingAddress: { recipient: "Cliente P0", zipCode: "70000000", street: "Rua Teste", number: "1", neighborhood: "Centro", city: "Brasília", state: "DF" },
    customer: { name: "Cliente P0", email: "p0@example.test", cpfCnpj: "12345678909" },
  };
}

describe.runIf(canRunDatabaseTests)("P0 order/payment integrity (MySQL integration)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    connection = await mysql.createConnection(testDatabaseUrl);
    const [rows] = await connection.query<any[]>("SELECT DATABASE() AS name");
    if (!/test/i.test(String(rows[0]?.name || ""))) throw new Error("Refusing to run destructive P0 tests outside a test database");
  });
  beforeEach(cleanDatabase);
  afterAll(async () => connection?.end());

  it("1. criação de pedido persiste orderItems", async () => {
    const seed = await seedProduct();
    const result = await createCheckoutOrderAtomically(checkoutInput(seed));
    const [rows] = await connection.query<any[]>("SELECT * FROM orderItems WHERE orderId = ?", [result.order.id]);
    expect(rows).toHaveLength(1);
  });

  it("2. preço antigo permanece no histórico", async () => {
    const seed = await seedProduct();
    const result = await createCheckoutOrderAtomically(checkoutInput(seed));
    await connection.query("UPDATE products SET price = 11990 WHERE id = ?", [seed.productId]);
    const [rows] = await connection.query<any[]>("SELECT unitPrice FROM orderItems WHERE orderId = ?", [result.order.id]);
    expect(rows[0].unitPrice).toBe(9990);
  });

  it("3. tamanho e cor permanecem no histórico", async () => {
    const seed = await seedProduct({ variant: true });
    const result = await createCheckoutOrderAtomically(checkoutInput(seed));
    await connection.query("UPDATE productVariants SET size = 'G', color = 'Azul', sku = 'NOVO' WHERE id = ?", [seed.variantId]);
    const [rows] = await connection.query<any[]>("SELECT size, color, sku FROM orderItems WHERE orderId = ?", [result.order.id]);
    expect(rows[0]).toMatchObject({ size: "M", color: "Verde", sku: "CAM-VERDE-M" });
  });

  it("4. variante inválida é rejeitada", async () => {
    const seed = await seedProduct({ variant: true });
    const other = await seedProduct({ variant: true });
    await expect(createCheckoutOrderAtomically(checkoutInput(seed, { items: [{ productId: seed.productId, variantId: other.variantId, quantity: 1 }] }))).rejects.toThrow("VARIANT_PRODUCT_MISMATCH");
  });

  it("5. quantidade maior que estoque é rejeitada", async () => {
    const seed = await seedProduct({ stock: 1 });
    await expect(createCheckoutOrderAtomically(checkoutInput(seed, { items: [{ productId: seed.productId, variantId: null, quantity: 2 }] }))).rejects.toThrow("INSUFFICIENT_PRODUCT_STOCK");
  });

  it("6. duas compras simultâneas da última unidade", async () => {
    const seed = await seedProduct({ stock: 1 });
    const results = await Promise.allSettled([
      createCheckoutOrderAtomically(checkoutInput(seed)),
      createCheckoutOrderAtomically(checkoutInput(seed)),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    const [products] = await connection.query<any[]>("SELECT stock FROM products WHERE id = ?", [seed.productId]);
    const [orders] = await connection.query<any[]>("SELECT id FROM orders WHERE userId = ?", [seed.userId]);
    const [reservations] = await connection.query<any[]>("SELECT status, quantity FROM stockReservations WHERE userId = ?", [seed.userId]);
    expect(products[0].stock).toBe(0);
    expect(orders).toHaveLength(1);
    expect(reservations).toHaveLength(1);
    expect(reservations[0]).toMatchObject({ status: "active", quantity: 1 });
  });

  it("7. estoque nunca negativo", async () => {
    const seed = await seedProduct({ stock: 1 });
    await Promise.allSettled([createCheckoutOrderAtomically(checkoutInput(seed)), createCheckoutOrderAtomically(checkoutInput(seed))]);
    const [rows] = await connection.query<any[]>("SELECT stock FROM products WHERE id = ?", [seed.productId]);
    expect(rows[0].stock).toBeGreaterThanOrEqual(0);
  });

  it("8. checkout idêntico repetido retorna mesmo pedido", async () => {
    const seed = await seedProduct();
    const input = checkoutInput(seed);
    const first = await createCheckoutOrderAtomically(input);
    const second = await createCheckoutOrderAtomically(input);
    expect(second.order.id).toBe(first.order.id);
    expect(second.reused).toBe(true);
  });

  it("9. checkout repetido não cria segunda cobrança", async () => {
    const seed = await seedProduct();
    const result = await createCheckoutOrderAtomically(checkoutInput(seed));
    expect(await claimPaymentCreation(result.payment!.id)).toBe(true);
    expect(await claimPaymentCreation(result.payment!.id)).toBe(false);
  });

  it("10. webhook duplicado sequencial", async () => {
    const seed = await seedProduct();
    const checkout = await createCheckoutOrderAtomically(checkoutInput(seed));
    const event = { providerEventId: "evt-sequential", eventType: "PAYMENT_CONFIRMED", externalReference: checkout.payment!.externalReference, amountCents: checkout.payment!.amount, sanitizedPayload: "{}" };
    expect((await processAsaasPaymentEvent(event)).duplicate).toBe(false);
    expect((await processAsaasPaymentEvent(event)).duplicate).toBe(true);
  });

  it("11. webhook duplicado concorrente", async () => {
    const seed = await seedProduct();
    const checkout = await createCheckoutOrderAtomically(checkoutInput(seed));
    const event = { providerEventId: "evt-concurrent", eventType: "PAYMENT_CONFIRMED", externalReference: checkout.payment!.externalReference, amountCents: checkout.payment!.amount, sanitizedPayload: "{}" };
    const results = await Promise.all([processAsaasPaymentEvent(event), processAsaasPaymentEvent(event)]);
    expect(results.filter(result => !result.duplicate)).toHaveLength(1);
  });

  it("12. pagamento dentro da reserva", async () => {
    const seed = await seedProduct();
    const checkout = await createCheckoutOrderAtomically(checkoutInput(seed));
    const result = await processAsaasPaymentEvent({ providerEventId: "evt-in-time", eventType: "PAYMENT_CONFIRMED", externalReference: checkout.payment!.externalReference, amountCents: checkout.payment!.amount, sanitizedPayload: "{}" });
    expect(result.conflict).toBe(false);
    const [orders] = await connection.query<any[]>("SELECT fulfillmentStatus FROM orders WHERE id = ?", [checkout.order.id]);
    expect(orders[0].fulfillmentStatus).toBe("ready");
  });

  it("13. pagamento após reserva expirada", async () => {
    const seed = await seedProduct();
    const checkout = await createCheckoutOrderAtomically(checkoutInput(seed));
    await connection.query("UPDATE stockReservations SET expiresAt = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE orderId = ?", [checkout.order.id]);
    const result = await processAsaasPaymentEvent({ providerEventId: "evt-late", eventType: "PAYMENT_CONFIRMED", externalReference: checkout.payment!.externalReference, amountCents: checkout.payment!.amount, sanitizedPayload: "{}" });
    expect(result.reason).toBe("PAYMENT_CONFIRMED_WITHOUT_STOCK");
    const [orders] = await connection.query<any[]>("SELECT fulfillmentStatus, fulfillmentIssue FROM orders WHERE id = ?", [checkout.order.id]);
    const [payments] = await connection.query<any[]>("SELECT status FROM payments WHERE id = ?", [checkout.payment!.id]);
    const [products] = await connection.query<any[]>("SELECT stock FROM products WHERE id = ?", [seed.productId]);
    const [reservations] = await connection.query<any[]>("SELECT status FROM stockReservations WHERE orderId = ?", [checkout.order.id]);
    const [audits] = await connection.query<any[]>("SELECT action FROM auditLogs WHERE entity = 'order' AND entityId = ?", [String(checkout.order.id)]);
    expect(orders[0]).toMatchObject({ fulfillmentStatus: "inventory_exception", fulfillmentIssue: "PAYMENT_CONFIRMED_WITHOUT_STOCK" });
    expect(payments[0].status).toBe("confirmed");
    expect(products[0].stock).toBe(1);
    expect(reservations[0].status).toBe("released");
    expect(audits.map(row => row.action)).toContain("payment_confirmed_inventory_exception");
  });

  it("14. paymentId Asaas duplicado", async () => {
    const first = await createCheckoutOrderAtomically(checkoutInput(await seedProduct()));
    const second = await createCheckoutOrderAtomically(checkoutInput(await seedProduct()));
    await completePaymentCreation(first.payment!.id, { providerPaymentId: "pay-unique" });
    await expect(completePaymentCreation(second.payment!.id, { providerPaymentId: "pay-unique" })).rejects.toThrow();
  });

  it("15. evento financeiro duplicado", async () => {
    const checkout = await createCheckoutOrderAtomically(checkoutInput(await seedProduct()));
    const base = { eventType: "PAYMENT_CONFIRMED", externalReference: checkout.payment!.externalReference, amountCents: checkout.payment!.amount, sanitizedPayload: "{}" };
    await processAsaasPaymentEvent({ ...base, providerEventId: "evt-fin-1" });
    await processAsaasPaymentEvent({ ...base, providerEventId: "evt-fin-2" });
    const [outbox] = await connection.query<any[]>("SELECT * FROM notificationOutbox WHERE paymentId = ?", [checkout.payment!.id]);
    expect(outbox).toHaveLength(1);
  });

  it("16. rollback quando criação interna do pedido falha", async () => {
    const seed = await seedProduct();
    await expect(createCheckoutOrderAtomically(checkoutInput(seed, { items: [{ productId: 2147483647, variantId: null, quantity: 1 }] }))).rejects.toThrow("PRODUCT_NOT_FOUND");
    const [orders] = await connection.query<any[]>("SELECT * FROM orders");
    expect(orders).toHaveLength(0);
  });

  it("17. Asaas falha depois da criação interna", async () => {
    const checkout = await createCheckoutOrderAtomically(checkoutInput(await seedProduct()));
    expect(await claimPaymentCreation(checkout.payment!.id)).toBe(true);
    await markPaymentCreationUnknown(checkout.payment!.id);
    const persisted = await getCheckoutByAttempt(checkout.order.checkoutAttemptId!, checkout.order.userId);
    expect(persisted?.order.id).toBe(checkout.order.id);
    expect(persisted?.payment?.creationStatus).toBe("unknown");
  });

  it("concorrência ampliada: estoque 5 com 20 compradores", async () => {
    const seed = await seedProduct({ stock: 5 });
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => createCheckoutOrderAtomically(checkoutInput(seed))),
    );
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(5);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(15);
    const [products] = await connection.query<any[]>("SELECT stock FROM products WHERE id = ?", [seed.productId]);
    const [orders] = await connection.query<any[]>("SELECT id FROM orders WHERE userId = ?", [seed.userId]);
    const [reservations] = await connection.query<any[]>("SELECT status, quantity FROM stockReservations WHERE userId = ?", [seed.userId]);
    expect(products[0].stock).toBe(0);
    expect(orders).toHaveLength(5);
    expect(reservations).toHaveLength(5);
    expect(reservations.every(row => row.status === "active" && row.quantity === 1)).toBe(true);
  });

  it("idempotência concorrente: 10 tentativas iguais criam um único agregado", async () => {
    const seed = await seedProduct({ stock: 10 });
    const input = checkoutInput(seed);
    const results = await Promise.all(Array.from({ length: 10 }, () => createCheckoutOrderAtomically(input)));
    expect(new Set(results.map(result => result.order.id)).size).toBe(1);
    const [orders] = await connection.query<any[]>("SELECT id FROM orders WHERE checkoutAttemptId = ?", [input.checkoutAttemptId]);
    const [items] = await connection.query<any[]>("SELECT id FROM orderItems WHERE orderId = ?", [orders[0].id]);
    const [payments] = await connection.query<any[]>("SELECT id FROM payments WHERE orderId = ?", [orders[0].id]);
    const [reservations] = await connection.query<any[]>("SELECT id FROM stockReservations WHERE orderId = ?", [orders[0].id]);
    expect(orders).toHaveLength(1);
    expect(items).toHaveLength(1);
    expect(payments).toHaveLength(1);
    expect(reservations).toHaveLength(1);
  });

  it("idempotência rejeita o mesmo checkoutAttemptId com fingerprint divergente", async () => {
    const seed = await seedProduct({ stock: 3 });
    const input = checkoutInput(seed);
    await createCheckoutOrderAtomically(input);
    await expect(createCheckoutOrderAtomically({ ...input, checkoutFingerprint: "f".repeat(64) })).rejects.toThrow("CHECKOUT_IDEMPOTENCY_CONFLICT");
  });

  it("webhook concorrente: 20 entregas geram um evento, auditoria e outbox", async () => {
    const checkout = await createCheckoutOrderAtomically(checkoutInput(await seedProduct()));
    const event = { providerEventId: "evt-20x", eventType: "PAYMENT_CONFIRMED", externalReference: checkout.payment!.externalReference, amountCents: checkout.payment!.amount, sanitizedPayload: "{}" };
    const results = await Promise.all(Array.from({ length: 20 }, () => processAsaasPaymentEvent(event)));
    expect(results.filter(result => !result.duplicate)).toHaveLength(1);
    const [events] = await connection.query<any[]>("SELECT * FROM paymentEvents WHERE providerEventId = 'evt-20x'");
    const [outbox] = await connection.query<any[]>("SELECT * FROM notificationOutbox WHERE paymentId = ?", [checkout.payment!.id]);
    const [audits] = await connection.query<any[]>("SELECT * FROM auditLogs WHERE action = 'payment_webhook_processed' AND entityId = ?", [String(checkout.payment!.id)]);
    const [reservations] = await connection.query<any[]>("SELECT status FROM stockReservations WHERE orderId = ?", [checkout.order.id]);
    expect(events).toHaveLength(1);
    expect(outbox).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(reservations).toHaveLength(1);
    expect(reservations[0].status).toBe("consumed");
  });

  it("eventos financeiros fora de ordem não rebaixam received para confirmed", async () => {
    let checkout = await createCheckoutOrderAtomically(checkoutInput(await seedProduct()));
    const base = { externalReference: checkout.payment!.externalReference, amountCents: checkout.payment!.amount, sanitizedPayload: "{}" };
    await processAsaasPaymentEvent({ ...base, providerEventId: "evt-received-first", eventType: "PAYMENT_RECEIVED" });
    await processAsaasPaymentEvent({ ...base, providerEventId: "evt-confirmed-second", eventType: "PAYMENT_CONFIRMED" });
    let [rows] = await connection.query<any[]>("SELECT status FROM payments WHERE id = ?", [checkout.payment!.id]);
    expect(rows[0].status).toBe("received");

    await cleanDatabase();
    checkout = await createCheckoutOrderAtomically(checkoutInput(await seedProduct()));
    const reverse = { externalReference: checkout.payment!.externalReference, amountCents: checkout.payment!.amount, sanitizedPayload: "{}" };
    await processAsaasPaymentEvent({ ...reverse, providerEventId: "evt-confirmed-first", eventType: "PAYMENT_CONFIRMED" });
    await processAsaasPaymentEvent({ ...reverse, providerEventId: "evt-received-second", eventType: "PAYMENT_RECEIVED" });
    [rows] = await connection.query<any[]>("SELECT status FROM payments WHERE id = ?", [checkout.payment!.id]);
    expect(rows[0].status).toBe("received");
  });

  it("outbox failed preserva o pagamento e a notificação para retry futuro", async () => {
    const checkout = await createCheckoutOrderAtomically(checkoutInput(await seedProduct()));
    await processAsaasPaymentEvent({ providerEventId: "evt-outbox", eventType: "PAYMENT_CONFIRMED", externalReference: checkout.payment!.externalReference, amountCents: checkout.payment!.amount, sanitizedPayload: "{}" });
    await markNotificationFailed(checkout.payment!.id, "smtp indisponível");
    const [paymentRows] = await connection.query<any[]>("SELECT status FROM payments WHERE id = ?", [checkout.payment!.id]);
    const [outboxRows] = await connection.query<any[]>("SELECT status, attempts, lastError FROM notificationOutbox WHERE paymentId = ?", [checkout.payment!.id]);
    expect(paymentRows[0].status).toBe("confirmed");
    expect(outboxRows[0]).toMatchObject({ status: "failed", attempts: 1, lastError: "smtp indisponível" });
  });

  it("10 requisições externas idênticas retornam um pedido e uma cobrança", async () => {
    const mock = await createAsaasMock("success");
    const oldApiUrl = process.env.ASAAS_API_URL;
    const oldApiKey = process.env.ASAAS_API_KEY;
    const oldShippingToken = process.env.MELHOR_ENVIO_TOKEN;
    process.env.ASAAS_API_URL = mock.baseUrl;
    process.env.ASAAS_API_KEY = "sandbox-local-key";
    delete process.env.MELHOR_ENVIO_TOKEN;
    try {
      const seed = await seedProduct({ stock: 1 });
      const input = externalCheckoutInput(seed);
      const caller = createCheckoutCaller(seed.userId);
      const results = await Promise.all(Array.from({ length: 10 }, () => caller.orders.createAsaasCharge(input)));
      expect(new Set(results.map(result => result.orderId)).size).toBe(1);
      expect(new Set(results.map(result => result.paymentId)).size).toBe(1);
      const [orders] = await connection.query<any[]>("SELECT id FROM orders WHERE checkoutAttemptId = ?", [input.checkoutAttemptId]);
      const [items] = await connection.query<any[]>("SELECT id FROM orderItems WHERE orderId = ?", [orders[0].id]);
      const [payments] = await connection.query<any[]>("SELECT id FROM payments WHERE orderId = ?", [orders[0].id]);
      expect(orders).toHaveLength(1);
      expect(items).toHaveLength(1);
      expect(payments).toHaveLength(1);
      expect(mock.state.paymentPosts).toBe(1);
      expect(mock.state.charges.size).toBe(1);
    } finally {
      await mock.close();
      if (oldApiUrl === undefined) delete process.env.ASAAS_API_URL; else process.env.ASAAS_API_URL = oldApiUrl;
      if (oldApiKey === undefined) delete process.env.ASAAS_API_KEY; else process.env.ASAAS_API_KEY = oldApiKey;
      if (oldShippingToken === undefined) delete process.env.MELHOR_ENVIO_TOKEN; else process.env.MELHOR_ENVIO_TOKEN = oldShippingToken;
    }
  });

  it("externalReference é única e determinística por pedido", async () => {
    const first = await createCheckoutOrderAtomically(checkoutInput(await seedProduct()));
    const second = await createCheckoutOrderAtomically(checkoutInput(await seedProduct()));
    expect(first.payment!.externalReference).toBe(`L4CKOS-ORDER-${first.order.id}`);
    expect(second.payment!.externalReference).toBe(`L4CKOS-ORDER-${second.order.id}`);
    expect(second.payment!.externalReference).not.toBe(first.payment!.externalReference);
  });

  it("eventos failed e refunded preservam estados financeiros explícitos", async () => {
    let checkout = await createCheckoutOrderAtomically(checkoutInput(await seedProduct()));
    await processAsaasPaymentEvent({ providerEventId: "evt-failed", eventType: "PAYMENT_FAILED", externalReference: checkout.payment!.externalReference, amountCents: checkout.payment!.amount, sanitizedPayload: "{}" });
    let [rows] = await connection.query<any[]>("SELECT status FROM payments WHERE id = ?", [checkout.payment!.id]);
    expect(rows[0].status).toBe("failed");

    await cleanDatabase();
    checkout = await createCheckoutOrderAtomically(checkoutInput(await seedProduct()));
    const base = { externalReference: checkout.payment!.externalReference, amountCents: checkout.payment!.amount, sanitizedPayload: "{}" };
    await processAsaasPaymentEvent({ ...base, providerEventId: "evt-paid-before-refund", eventType: "PAYMENT_RECEIVED" });
    await processAsaasPaymentEvent({ ...base, providerEventId: "evt-refunded", eventType: "PAYMENT_REFUNDED" });
    [rows] = await connection.query<any[]>("SELECT status, refundedAt FROM payments WHERE id = ?", [checkout.payment!.id]);
    expect(rows[0].status).toBe("refunded");
    expect(rows[0].refundedAt).toBeTruthy();
  });

  it("falha Asaas antes da cobrança mantém o agregado e retry não cria outro pedido", async () => {
    const mock = await createAsaasMock("fail-before-create");
    const oldApiUrl = process.env.ASAAS_API_URL;
    const oldApiKey = process.env.ASAAS_API_KEY;
    const oldShippingToken = process.env.MELHOR_ENVIO_TOKEN;
    process.env.ASAAS_API_URL = mock.baseUrl;
    process.env.ASAAS_API_KEY = "sandbox-local-key";
    delete process.env.MELHOR_ENVIO_TOKEN;
    try {
      const seed = await seedProduct({ stock: 1 });
      const caller = createCheckoutCaller(seed.userId);
      const input = externalCheckoutInput(seed);
      await expect(caller.orders.createAsaasCharge(input)).rejects.toThrow();
      const afterFailure = await getCheckoutByAttempt(input.checkoutAttemptId, seed.userId);
      expect(afterFailure?.payment?.creationStatus).toBe("unknown");

      const retry = await caller.orders.createAsaasCharge(input);
      expect(retry.orderId).toBe(afterFailure?.order.id);
      const [orders] = await connection.query<any[]>("SELECT id FROM orders WHERE checkoutAttemptId = ?", [input.checkoutAttemptId]);
      const [items] = await connection.query<any[]>("SELECT id FROM orderItems WHERE orderId = ?", [retry.orderId]);
      const [payments] = await connection.query<any[]>("SELECT providerPaymentId, creationStatus FROM payments WHERE orderId = ?", [retry.orderId]);
      expect(orders).toHaveLength(1);
      expect(items).toHaveLength(1);
      expect(payments).toHaveLength(1);
      expect(payments[0].creationStatus).toBe("created");
      expect(mock.state.charges.size).toBe(1);
      expect(mock.state.paymentPosts).toBe(2);
    } finally {
      await mock.close();
      if (oldApiUrl === undefined) delete process.env.ASAAS_API_URL; else process.env.ASAAS_API_URL = oldApiUrl;
      if (oldApiKey === undefined) delete process.env.ASAAS_API_KEY; else process.env.ASAAS_API_KEY = oldApiKey;
      if (oldShippingToken === undefined) delete process.env.MELHOR_ENVIO_TOKEN; else process.env.MELHOR_ENVIO_TOKEN = oldShippingToken;
    }
  });

  it("timeout após criação Asaas reconcilia externalReference sem segunda cobrança", async () => {
    const mock = await createAsaasMock("timeout-after-create");
    const oldApiUrl = process.env.ASAAS_API_URL;
    const oldApiKey = process.env.ASAAS_API_KEY;
    const oldShippingToken = process.env.MELHOR_ENVIO_TOKEN;
    process.env.ASAAS_API_URL = mock.baseUrl;
    process.env.ASAAS_API_KEY = "sandbox-local-key";
    delete process.env.MELHOR_ENVIO_TOKEN;
    try {
      const seed = await seedProduct({ stock: 1 });
      const caller = createCheckoutCaller(seed.userId);
      const input = externalCheckoutInput(seed);
      await expect(caller.orders.createAsaasCharge(input)).rejects.toThrow();
      expect(mock.state.charges.size).toBe(1);
      expect(mock.state.paymentPosts).toBe(1);

      const retry = await caller.orders.createAsaasCharge(input);
      const [orders] = await connection.query<any[]>("SELECT id FROM orders WHERE checkoutAttemptId = ?", [input.checkoutAttemptId]);
      const [payments] = await connection.query<any[]>("SELECT providerPaymentId, externalReference, creationStatus FROM payments WHERE orderId = ?", [retry.orderId]);
      expect(orders).toHaveLength(1);
      expect(payments).toHaveLength(1);
      expect(payments[0]).toMatchObject({ providerPaymentId: "pay-local-1", creationStatus: "created" });
      expect(payments[0].externalReference).toBe(`L4CKOS-ORDER-${retry.orderId}`);
      expect(mock.state.paymentPosts).toBe(1);
      expect(mock.state.paymentGets).toBeGreaterThanOrEqual(2);
    } finally {
      await mock.close();
      if (oldApiUrl === undefined) delete process.env.ASAAS_API_URL; else process.env.ASAAS_API_URL = oldApiUrl;
      if (oldApiKey === undefined) delete process.env.ASAAS_API_KEY; else process.env.ASAAS_API_KEY = oldApiKey;
      if (oldShippingToken === undefined) delete process.env.MELHOR_ENVIO_TOKEN; else process.env.MELHOR_ENVIO_TOKEN = oldShippingToken;
    }
  });
});

it("18. frete externo indisponível para CEP fora da entrega local", async () => {
  const originalToken = process.env.MELHOR_ENVIO_TOKEN;
  const originalPrefixes = process.env.LOCAL_DELIVERY_CEP_PREFIXES;
  delete process.env.MELHOR_ENVIO_TOKEN;
  process.env.LOCAL_DELIVERY_CEP_PREFIXES = "700,701";
  try {
    const result = await quoteShippingDetailed({ cep: "01310930", itemCount: 1, subtotal: 99.9 });
    expect(result.options).toEqual([]);
    expect(result.warning).toContain("Frete indisponível");
  } finally {
    if (originalToken === undefined) delete process.env.MELHOR_ENVIO_TOKEN;
    else process.env.MELHOR_ENVIO_TOKEN = originalToken;
    if (originalPrefixes === undefined) delete process.env.LOCAL_DELIVERY_CEP_PREFIXES;
    else process.env.LOCAL_DELIVERY_CEP_PREFIXES = originalPrefixes;
  }
});

it("frete local explícito funciona sem Melhor Envio", async () => {
  const originalToken = process.env.MELHOR_ENVIO_TOKEN;
  const originalPrefixes = process.env.LOCAL_DELIVERY_CEP_PREFIXES;
  delete process.env.MELHOR_ENVIO_TOKEN;
  process.env.LOCAL_DELIVERY_CEP_PREFIXES = "700,701";
  try {
    const result = await quoteShippingDetailed({
      cep: "70000000",
      itemCount: 1,
      subtotal: 99.9,
      address: { city: "Brasília", state: "DF" },
    });
    expect(result.options.map(option => option.id)).toContain("local-plano-piloto");
  } finally {
    if (originalToken === undefined) delete process.env.MELHOR_ENVIO_TOKEN;
    else process.env.MELHOR_ENVIO_TOKEN = originalToken;
    if (originalPrefixes === undefined) delete process.env.LOCAL_DELIVERY_CEP_PREFIXES;
    else process.env.LOCAL_DELIVERY_CEP_PREFIXES = originalPrefixes;
  }
});

it("configuração local vazia falha de maneira segura", async () => {
  const originalToken = process.env.MELHOR_ENVIO_TOKEN;
  const originalPrefixes = process.env.LOCAL_DELIVERY_CEP_PREFIXES;
  delete process.env.MELHOR_ENVIO_TOKEN;
  process.env.LOCAL_DELIVERY_CEP_PREFIXES = "";
  try {
    const result = await quoteShippingDetailed({ cep: "70000000", itemCount: 1, subtotal: 99.9 });
    expect(result.options).toEqual([]);
  } finally {
    if (originalToken === undefined) delete process.env.MELHOR_ENVIO_TOKEN;
    else process.env.MELHOR_ENVIO_TOKEN = originalToken;
    if (originalPrefixes === undefined) delete process.env.LOCAL_DELIVERY_CEP_PREFIXES;
    else process.env.LOCAL_DELIVERY_CEP_PREFIXES = originalPrefixes;
  }
});
