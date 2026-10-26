import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkout, checkoutItemSchema, type CheckoutInput } from "./checkout";

afterEach(() => vi.unstubAllEnvs());

function makeInput(): CheckoutInput {
  return {
    userId: 27,
    checkoutAttemptId: "a20485ea-35f8-4ea3-85dd-4084f593e695",
    method: "PIX",
    items: [{ productId: 4, quantity: 1 }],
    shipping: { cep: "70000000", optionId: "local" },
    shippingAddress: {
      recipient: "Comprador sintético",
      zipCode: "70000000",
      street: "Rua de teste",
      number: "1",
      neighborhood: "Centro",
      city: "Brasília",
      state: "DF",
    },
    customer: { name: "Comprador sintético", cpfCnpj: "11144477735", email: "buyer@example.invalid" },
  };
}

function makeConnection(onQuery: (sql: string, values: unknown[]) => unknown) {
  const queries: string[] = [];
  const connection = {
    query: vi.fn(async (sql: string, values: unknown[] = []) => {
      queries.push(sql);
      if (sql.startsWith("SET ")) return [{ affectedRows: 0 }, []];
      return [onQuery(sql, values), []];
    }),
    beginTransaction: vi.fn(async () => undefined),
    commit: vi.fn(async () => undefined),
    rollback: vi.fn(async () => undefined),
  };
  return { connection, queries };
}

function attemptFingerprint(input: CheckoutInput) {
  const items = input.items.map(item => checkoutItemSchema.parse(item));
  return createHash("sha256").update(JSON.stringify({ ...input, items })).digest("hex");
}

describe("Coming Soon at the checkout transaction boundary", () => {
  it("blocks a new attempt before catalog/freight reads, transaction, order, reservation or charge", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PUBLIC_SITE_MODE", "coming-soon");
    const input = makeInput();
    const { connection, queries } = makeConnection(sql => {
      if (sql.includes("GET_LOCK")) return [{ acquired: 1 }];
      if (sql.includes("FROM orders WHERE checkoutAttemptId")) return [];
      if (sql.includes("RELEASE_LOCK")) return [{ released: 1 }];
      throw new Error(`Unexpected SQL while closed: ${sql}`);
    });
    const quote = vi.fn();
    const charge = vi.fn();

    await expect(checkout(connection as any, input, { quote: quote as any, charge: charge as any }))
      .rejects.toMatchObject({ name: "PublicStoreClosedError", code: "PUBLIC_STORE_CLOSED" });

    expect(queries.some(sql => /\b(INSERT|UPDATE|DELETE)\b/i.test(sql))).toBe(false);
    expect(connection.beginTransaction).not.toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(quote).not.toHaveBeenCalled();
    expect(charge).not.toHaveBeenCalled();
    expect(queries).toHaveLength(0);
  });

  it("does not return a previously completed payment URL while the store is closed", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PUBLIC_SITE_MODE", "coming-soon");
    const input = makeInput();
    const payment = { paymentId: "pay-existing", customerId: "cus-existing", invoiceUrl: "https://example.invalid/existing" };
    const saved = { payment, totalPrice: 12900, items: [], description: "Pedido já existente" };
    const { connection, queries } = makeConnection(sql => {
      if (sql.includes("GET_LOCK")) return [{ acquired: 1 }];
      if (sql.includes("FROM orders WHERE checkoutAttemptId")) {
        return [{ id: 81, checkoutFingerprint: attemptFingerprint(input), status: "pending" }];
      }
      if (sql.includes("FROM auditLogs")) return [{ metadata: JSON.stringify(saved) }];
      if (sql.includes("RELEASE_LOCK")) return [{ released: 1 }];
      throw new Error(`Unexpected SQL while replaying: ${sql}`);
    });
    const quote = vi.fn();
    const charge = vi.fn();

    await expect(checkout(connection as any, input, { quote: quote as any, charge: charge as any }))
      .rejects.toMatchObject({ name: "PublicStoreClosedError", code: "PUBLIC_STORE_CLOSED" });

    expect(queries.some(sql => /\b(INSERT|UPDATE|DELETE)\b/i.test(sql))).toBe(false);
    expect(queries).toHaveLength(0);
    expect(connection.beginTransaction).not.toHaveBeenCalled();
    expect(quote).not.toHaveBeenCalled();
    expect(charge).not.toHaveBeenCalled();
  });

  it("keeps an unresolved existing attempt in recovery-required state instead of starting a new charge", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PUBLIC_SITE_MODE", "coming-soon");
    const input = makeInput();
    const { connection, queries } = makeConnection(sql => {
      if (sql.includes("GET_LOCK")) return [{ acquired: 1 }];
      if (sql.includes("FROM orders WHERE checkoutAttemptId")) {
        return [{ id: 81, checkoutFingerprint: attemptFingerprint(input), status: "pending" }];
      }
      if (sql.includes("FROM auditLogs")) return [];
      if (sql.includes("RELEASE_LOCK")) return [{ released: 1 }];
      throw new Error(`Unexpected SQL for unresolved attempt: ${sql}`);
    });
    const quote = vi.fn();
    const charge = vi.fn();

    await expect(checkout(connection as any, input, { quote: quote as any, charge: charge as any }))
      .rejects.toMatchObject({ name: "PublicStoreClosedError", code: "PUBLIC_STORE_CLOSED" });

    expect(queries).toHaveLength(0);
    expect(connection.beginTransaction).not.toHaveBeenCalled();
    expect(quote).not.toHaveBeenCalled();
    expect(charge).not.toHaveBeenCalled();
    expect(queries.some(sql => /\b(INSERT|UPDATE|DELETE)\b/i.test(sql))).toBe(false);
  });

  it("keeps a production-mode staging store navigable while checkout is explicitly disabled", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PUBLIC_SITE_MODE", "store");
    vi.stubEnv("PUBLIC_CHECKOUT_ENABLED", "false");
    const { connection, queries } = makeConnection(() => { throw new Error("Checkout-disabled requests must stop before SQL"); });
    const quote = vi.fn();
    const charge = vi.fn();

    await expect(checkout(connection as any, makeInput(), { quote: quote as any, charge: charge as any }))
      .rejects.toMatchObject({ name: "PublicCheckoutDisabledError", code: "PUBLIC_CHECKOUT_DISABLED" });

    expect(queries).toHaveLength(0);
    expect(connection.beginTransaction).not.toHaveBeenCalled();
    expect(quote).not.toHaveBeenCalled();
    expect(charge).not.toHaveBeenCalled();
  });

  it("never replays a legacy v6 preorder payment even when STOCK checkout is enabled", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PUBLIC_SITE_MODE", "store");
    vi.stubEnv("PUBLIC_CHECKOUT_ENABLED", "true");
    const input = makeInput();
    const saved = {
      payment: { paymentId: "old-preorder-payment", customerId: "synthetic-customer" },
      totalPrice: 12900,
      items: [{ salesModeAtPurchase: "PREORDER", quantity: 1 }],
      description: "legacy preorder fixture",
    };
    const { connection, queries } = makeConnection(sql => {
      if (sql.includes("GET_LOCK")) return [{ acquired: 1 }];
      if (sql.includes("FROM orders WHERE checkoutAttemptId")) {
        return [{ id: 81, checkoutFingerprint: attemptFingerprint(input), status: "pending" }];
      }
      if (sql.includes("FROM auditLogs")) return [{ metadata: JSON.stringify(saved) }];
      if (sql.includes("RELEASE_LOCK")) return [{ released: 1 }];
      throw new Error(`Unexpected SQL while rejecting legacy preorder replay: ${sql}`);
    });
    const charge = vi.fn();

    await expect(checkout(connection as any, input, { quote: vi.fn() as any, charge: charge as any }))
      .rejects.toMatchObject({ code: "CHECKOUT_PREORDER_DISABLED" });

    expect(queries.some(sql => /\b(INSERT|UPDATE|DELETE)\b/i.test(sql))).toBe(false);
    expect(connection.beginTransaction).not.toHaveBeenCalled();
    expect(charge).not.toHaveBeenCalled();
  });

  it("permits the new-attempt path only when checkout is explicitly enabled", async () => {
    vi.stubEnv("NODE_ENV", "test");
    // Exercise the non-staging test default independently of the host's staging env.
    vi.stubEnv("APP_ENV", "");
    vi.stubEnv("EMAIL_ENV", "");
    vi.stubEnv("PUBLIC_SITE_MODE", "store");
    vi.stubEnv("PUBLIC_CHECKOUT_ENABLED", "true");
    const input = makeInput();
    const { connection, queries } = makeConnection(sql => {
      if (sql.includes("GET_LOCK")) return [{ acquired: 1 }];
      if (sql.includes("FROM orders WHERE checkoutAttemptId")) return [];
      if (sql.includes("FROM products WHERE id")) return [];
      if (sql.includes("RELEASE_LOCK")) return [{ released: 1 }];
      throw new Error(`Unexpected SQL in open-mode test: ${sql}`);
    });

    await expect(checkout(connection as any, input, { quote: vi.fn() as any, charge: vi.fn() as any }))
      .rejects.toMatchObject({ code: "CHECKOUT_PRODUCT_NOT_FOUND" });

    expect(queries.some(sql => sql.includes("FROM products WHERE id"))).toBe(true);
    expect(connection.beginTransaction).not.toHaveBeenCalled();
  });
});
