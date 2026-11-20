import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkout, checkoutItemSchema, CheckoutError, type CheckoutInput } from "./checkout";
import { createVariantOptionKey } from "./productVariantIdentity";

afterEach(() => vi.unstubAllEnvs());

function makeInput(productId = 41): CheckoutInput {
  return {
    userId: 27,
    checkoutAttemptId: "a20485ea-35f8-4ea3-85dd-4084f593e695",
    method: "PIX",
    items: [{ productId, variantId: 101, quantity: 1, color: "Preto", size: "M" }],
    shipping: { cep: "70000000", optionId: "local" },
    shippingAddress: {
      recipient: "Comprador sintético", zipCode: "70000000", street: "Rua de teste", number: "1",
      neighborhood: "Centro", city: "Brasília", state: "DF",
    },
    customer: { name: "Comprador sintético", cpfCnpj: "11144477735" },
  };
}

function enableTestCheckout() {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("APP_ENV", "");
  vi.stubEnv("EMAIL_ENV", "");
  vi.stubEnv("PUBLIC_SITE_MODE", "store");
  vi.stubEnv("PUBLIC_CHECKOUT_ENABLED", "true");
  vi.stubEnv("ASAAS_WEBHOOK_RECOVERY_MODE", "off");
}

function makeConnection(input: CheckoutInput, variants: Array<Record<string, unknown>>, replay = false, productName = "Camiseta comum") {
  let insertId = 700;
  const statements: string[] = [];
  const writes: string[] = [];
  const product = {
    id: 41, name: productName, salesMode: "STOCK", price: 8990, stock: 12,
    optionSizes: JSON.stringify(["M"]), optionColors: JSON.stringify(["Preto"]), imageUrl: null,
  };
  const normalizedItems = input.items.map(item => checkoutItemSchema.parse(item));
  const fingerprint = createHash("sha256").update(JSON.stringify({ ...input, items: normalizedItems })).digest("hex");
  const saved = {
    payment: { paymentId: "synthetic-payment", customerId: "synthetic-customer", invoiceUrl: "https://example.invalid/synthetic" },
    totalPrice: 8990,
    items: [{ productId: 41, variantId: 101, productName: product.name, salesModeAtPurchase: "STOCK", quantity: 1, unitPrice: 8990, totalPrice: 8990 }],
    description: "synthetic checkout",
  };
  const connection = {
    query: vi.fn(async (sql: string, _values: unknown[] = []) => {
      statements.push(sql);
      if (/^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)) writes.push(sql);
      if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }], []];
      if (sql.includes("RELEASE_LOCK")) return [[{ released: 1 }], []];
      if (sql.startsWith("SET ")) return [{ affectedRows: 0 }, []];
      if (sql.includes("checkoutAttemptId=?")) {
        return [replay ? [{ id: 901, checkoutFingerprint: fingerprint, status: "pending" }] : [], []];
      }
      if (sql.includes("action='checkout.charge_created'")) {
        return [replay ? [{ metadata: JSON.stringify(saved) }] : [], []];
      }
      if (sql.includes("SELECT * FROM products WHERE id=?") || sql.includes("SELECT name FROM products WHERE id=?")) {
        return [[product], []];
      }
      if (sql.includes("SELECT * FROM productVariants WHERE productId=? ORDER BY id") || sql.includes("SELECT sku FROM productVariants WHERE productId=? ORDER BY id")) {
        return [variants, []];
      }
      if (sql.includes("SELECT stock, reservedStock FROM productVariants WHERE id=? FOR UPDATE")) {
        const variant = variants.find(row => Number(row.id) === Number(_values[0]));
        return [variant ? [{ stock: variant.stock, reservedStock: variant.reservedStock ?? 0 }] : [], []];
      }
      if (sql.includes("SUM(quantity),0) n FROM stockReservations")) return [[{ n: 0 }], []];
      if (sql.includes("SELECT paymentStatus FROM orders WHERE id=? FOR UPDATE")) return [[{ paymentStatus: "unconfirmed" }], []];
      if (sql.includes("SELECT eventId FROM asaasWebhookEvents")) return [[], []];
      if (/^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)) return [{ insertId: ++insertId, affectedRows: 1 }, []];
      throw new Error(`Unexpected synthetic checkout SQL: ${sql}`);
    }),
    beginTransaction: vi.fn(async () => undefined),
    commit: vi.fn(async () => undefined),
    rollback: vi.fn(async () => undefined),
  };
  return { connection, statements, writes, product };
}

function activeVariant(overrides: Record<string, unknown> = {}) {
  return {
    id: 101, productId: 41, name: "Preto M", isActive: 1, color: "Preto", size: "M",
    sku: "COMMON-BLACK-M", optionKey: createVariantOptionKey("Preto", "M"), price: 8990, stock: 12,
    ...overrides,
  };
}

function adapters() {
  return {
    quote: vi.fn(async () => ({ options: [{ id: "local", label: "Local", price: 0 }] })),
    charge: vi.fn(async () => ({ paymentId: "synthetic-payment", customerId: "synthetic-customer", invoiceUrl: null } as any)),
  };
}

describe("public exclusive-product checkout policy", () => {
  it("allows an ordinary product through the direct STOCK checkout path", async () => {
    enableTestCheckout();
    const input = makeInput();
    const { connection, writes } = makeConnection(input, [activeVariant()]);
    const provider = adapters();

    await expect(checkout(connection as any, input, provider as any)).resolves.toMatchObject({ replayed: false, orderId: 701 });
    expect(writes.some(sql => sql.includes("INSERT INTO orders"))).toBe(true);
    expect(provider.charge).toHaveBeenCalledOnce();
  });

  it("rechecks exclusive SKUs after quote under transaction locks", async () => {
    enableTestCheckout();
    const input = makeInput();
    const variants: Array<Record<string, unknown>> = [activeVariant()];
    const { connection, writes } = makeConnection(input, variants);
    const provider = adapters();
    provider.quote.mockImplementation(async () => {
      variants.push({ ...activeVariant({ id: 102, sku: "14B-DROP-BR-G", isActive: 0, color: "Branco", size: "G", optionKey: createVariantOptionKey("Branco", "G") }) });
      return { options: [{ id: "local", label: "Local", price: 0 }] };
    });

    await expect(checkout(connection as any, input, provider as any)).rejects.toMatchObject({
      code: "CHECKOUT_PRODUCT_REQUIRES_AUTHORIZATION",
    });
    expect(connection.beginTransaction).toHaveBeenCalledOnce();
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(writes).toEqual([]);
    expect(provider.charge).not.toHaveBeenCalled();
  });

  it.each([
    ["restricted product name", "Clã 14 Bis", [activeVariant()]],
    ["Roman numeral collaboration name", "Clã XIV Bis", [activeVariant()]],
    ["accent and punctuation collaboration alias", "CLAN-XIV-BIS", [activeVariant()]],
    ["QA-STAGING label with an ordinary direct variant", "[QA-STAGING] Synthetic QA", [activeVariant()]],
    ["QA-STAGING label with a QA-marked direct variant", "[QA-STAGING] Synthetic QA", [activeVariant({ sku: "QA-PRE-M-01" })]],
    ["selected exclusive SKU", "Camiseta comum", [activeVariant({ sku: "14B-DROP-PT-M" })]],
    ["Roman numeral exclusive SKU", "Camiseta comum", [activeVariant({ sku: "XIV-BIS-DROP-M" })]],
    ["accented exclusive SKU", "Camiseta comum", [activeVariant({ sku: "CLÃ-XIV-BIS-GG" })]],
    ["mixed catalog with ordinary selected SKU", "Camiseta comum", [activeVariant(), { ...activeVariant({ id: 102, sku: "14B-DROP-BR-G", isActive: 1, color: "Branco", size: "G", optionKey: createVariantOptionKey("Branco", "G") }) }]],
    ["inactive exclusive SKU alongside ordinary selected SKU", "Camiseta comum", [activeVariant(), { ...activeVariant({ id: 102, sku: "14B-DROP-BR-G", isActive: 0, color: "Branco", size: "G", optionKey: createVariantOptionKey("Branco", "G") }) }]],
  ] as const)("blocks direct checkout for %s before commercial writes or provider calls", async (_scenario, productName, variants) => {
    enableTestCheckout();
    const input = makeInput();
    const rows = variants.map(row => ({ ...row, productId: 41 }));
    const { connection, statements, writes } = makeConnection(input, rows, false, productName);
    const provider = adapters();

    await expect(checkout(connection as any, input, provider as any)).rejects.toMatchObject({
      code: "CHECKOUT_PRODUCT_REQUIRES_AUTHORIZATION",
    });
    expect(writes).toEqual([]);
    expect(provider.quote).not.toHaveBeenCalled();
    expect(provider.charge).not.toHaveBeenCalled();
    expect(statements.some(sql => sql.includes("FROM productVariants WHERE productId=?"))).toBe(true);
  });

  it("revalidates current catalog policy before returning an idempotent payment replay", async () => {
    enableTestCheckout();
    const input = makeInput();
    const { connection, statements, writes } = makeConnection(input, [
      activeVariant(),
      { ...activeVariant({ id: 102, sku: "14B-DROP-BR-G", isActive: 0, color: "Branco", size: "G", optionKey: createVariantOptionKey("Branco", "G") }) },
    ], true);
    const provider = adapters();

    await expect(checkout(connection as any, input, provider as any)).rejects.toMatchObject({
      code: "CHECKOUT_PRODUCT_REQUIRES_AUTHORIZATION",
    });
    expect(statements.some(sql => sql.includes("FROM productVariants WHERE productId=?"))).toBe(true);
    expect(writes).toEqual([]);
    expect(provider.charge).not.toHaveBeenCalled();
  });

  it("rechecks QA classification under product locks after the shipping quote", async () => {
    enableTestCheckout();
    const input = makeInput();
    const { connection, writes, product } = makeConnection(input, [activeVariant()]);
    const provider = adapters();
    provider.quote.mockImplementation(async () => {
      product.name = "[QA-STAGING] Reclassified during checkout";
      return { options: [{ id: "local", label: "Local", price: 0 }] };
    });

    await expect(checkout(connection as any, input, provider as any)).rejects.toMatchObject({
      code: "CHECKOUT_PRODUCT_REQUIRES_AUTHORIZATION",
    });
    expect(provider.quote).toHaveBeenCalledOnce();
    expect(provider.charge).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    expect(connection.rollback).toHaveBeenCalledOnce();
  });
});
