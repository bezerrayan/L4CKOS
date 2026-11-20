/**
 * Legacy `POST /api/payments/create-checkout`: exclusivity policy over EVERY persisted SKU of the product.
 *
 * Disposable-MySQL integration test. It is skipped unless L4CKOS_LEGACY_CHECKOUT_MYSQL_URL points at a loopback
 * `l4ckos_test_*` database that already carries the V6 + STOCK schema chain (see the legacy-checkout evidence notes).
 * Nothing here touches a remote database, Railway, Asaas or any other external service (axios is mocked and counted).
 */
import mysql from "mysql2/promise";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createVariantOptionKey } from "./database/productVariantIdentity";

const ax = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));
vi.mock("axios", () => ({ default: { create: () => ax, isAxiosError: () => false } }));

const url = process.env.L4CKOS_LEGACY_CHECKOUT_MYSQL_URL ?? "";
const suite = url ? describe : describe.skip;

type VariantSeed = { sku: string; isActive: 0 | 1; color: string; size: string };
type OrderSeed = { productName: string; variants: VariantSeed[]; purchasedIndex: number };

let conn: mysql.Connection;
let userId = 0;
const seeded: { orderId: number; productId: number; itemId: number; reservationId: number }[] = [];

async function seed({ productName, variants, purchasedIndex }: OrderSeed) {
  const [product] = await conn.query<any>(
    "INSERT INTO products (name, category, price, stock, salesMode) VALUES (?, 'fixture', 8990, 0, 'STOCK')", [productName]);
  const productId = Number(product.insertId);
  const variantIds: number[] = [];
  for (const variant of variants) {
    const [row] = await conn.query<any>(
      "INSERT INTO productVariants (productId, name, sku, price, stock, size, color, optionKey, isActive) VALUES (?,?,?,?,?,?,?,?,?)",
      [productId, `${variant.color} / ${variant.size}`, variant.sku, 8990, 5, variant.size, variant.color,
        createVariantOptionKey(variant.color, variant.size), variant.isActive]);
    variantIds.push(Number(row.insertId));
  }
  const bought = variants[purchasedIndex];
  const [order] = await conn.query<any>("INSERT INTO orders (userId, totalPrice) VALUES (?, 8990)", [userId]);
  const orderId = Number(order.insertId);
  const [item] = await conn.query<any>(
    `INSERT INTO orderItems (orderId, productId, quantity, unitPrice, totalPrice, variantId, productName, sku, size, color,
       salesModeAtPurchase, skuSnapshot, sizeSnapshot, colorSnapshot) VALUES (?,?,1,8990,8990,?,?,?,?,?,'STOCK',?,?,?)`,
    [orderId, productId, variantIds[purchasedIndex], productName, bought.sku, bought.size, bought.color, bought.sku, bought.size, bought.color]);
  const itemId = Number(item.insertId);
  const [reservation] = await conn.query<any>(
    `INSERT INTO stockReservations (orderId, userId, productId, quantity, status, expiresAt, variantId, orderItemId,
       skuSnapshot, sizeSnapshot, colorSnapshot, unitPriceCents)
     VALUES (?,?,?,1,'active', DATE_ADD(NOW(), INTERVAL 1 HOUR), ?, ?, ?, ?, ?, 8990)`,
    [orderId, userId, productId, variantIds[purchasedIndex], itemId, bought.sku, bought.size, bought.color]);
  const ref = { orderId, productId, itemId, reservationId: Number(reservation.insertId) };
  seeded.push(ref);
  return ref;
}

async function snapshot(orderId: number) {
  const [orders] = await conn.query<any[]>("SELECT * FROM orders WHERE id=?", [orderId]);
  const [reservations] = await conn.query<any[]>("SELECT * FROM stockReservations WHERE orderId=? ORDER BY id", [orderId]);
  const [items] = await conn.query<any[]>("SELECT * FROM orderItems WHERE orderId=? ORDER BY id", [orderId]);
  const [claims] = await conn.query<any[]>(
    "SELECT id FROM auditLogs WHERE action='checkout.external_creation_requested' AND entityId=?", [String(orderId)]);
  const [[totals]] = await conn.query<any[]>(
    "SELECT (SELECT COUNT(*) FROM orders) orders, (SELECT COUNT(*) FROM stockReservations) reservations, (SELECT COUNT(*) FROM auditLogs) audits");
  return { orders, reservations, items, claims: claims.length, totals: { ...totals } };
}

async function callHandler(orderId: number) {
  const { createCheckoutHandler } = await import("./controllers/paymentController");
  const req = { authUser: { id: userId }, body: { orderId, redirectUrl: "https://staging.example.invalid/return", billingTypes: ["PIX"] }, ip: "local" };
  let status = 0; let body: any;
  const res = { status(code: number) { status = code; return this; }, json(value: unknown) { body = value; return this; } };
  await createCheckoutHandler(req as any, res as any);
  return { status, body, code: body?.error?.code ?? body?.code };
}

suite("legacy create-checkout: every persisted SKU is covered by the exclusivity policy", () => {
  const prior = { ...process.env };
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    conn = await mysql.createConnection(url);
    // Complete customer data (synthetic CPF) so that, without the fix, the route would proceed to the provider.
    const [user] = await conn.query<any>("INSERT INTO users (openId, name, email, cpf, phone) VALUES (?, 'Legacy fixture', 'legacy.fixture@example.invalid', '52998224725', '61999990000')", [`legacy-${Date.now()}`]);
    userId = Number(user.insertId);
    vi.resetModules();
  });
  beforeEach(() => {
    vi.stubEnv("PUBLIC_SITE_MODE", "store");
    vi.stubEnv("PUBLIC_CHECKOUT_ENABLED", "true");
    vi.stubEnv("CORS_ORIGINS", "https://staging.example.invalid");
    vi.stubEnv("EMAIL_ENV", "");
    ax.post.mockReset(); ax.get.mockReset();
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  afterAll(async () => {
    await conn?.end();
    process.env.DATABASE_URL = prior.DATABASE_URL;
  });

  const blockedScenarios: [string, OrderSeed][] = [
    ["generic name + ordinary purchased SKU + INACTIVE 14B variant", {
      productName: "Camiseta comum A", purchasedIndex: 0,
      variants: [{ sku: "CAM-A-PT-M", isActive: 1, color: "Preto", size: "M" }, { sku: "14B-CAM-A-BR-G", isActive: 0, color: "Branco", size: "G" }] }],
    ["generic name + ordinary purchased SKU + ACTIVE 14B variant (mixed SKUs)", {
      productName: "Camiseta comum B", purchasedIndex: 0,
      variants: [{ sku: "CAM-B-PT-M", isActive: 1, color: "Preto", size: "M" }, { sku: "14B-CAM-B-BR-G", isActive: 1, color: "Branco", size: "G" }] }],
    ["restricted name with ordinary SKUs", {
      productName: "Camiseta Clã 14 Bis", purchasedIndex: 0,
      variants: [{ sku: "CAM-C-PT-M", isActive: 1, color: "Preto", size: "M" }] }],
  ];

  it.each(blockedScenarios)("blocks the whole product before any provider call or durable claim: %s", async (_label, scenario) => {
    const { orderId } = await seed(scenario);
    const before = await snapshot(orderId);

    const result = await callHandler(orderId);

    expect(result.status).toBe(403);
    expect(result.code).toBe("CHECKOUT_PRODUCT_REQUIRES_AUTHORIZATION");
    expect(JSON.stringify(result.body)).not.toMatch(/14b|sku|variant/i); // no internal detail is revealed
    expect(ax.get).not.toHaveBeenCalled();
    expect(ax.post).not.toHaveBeenCalled();
    const after = await snapshot(orderId);
    expect(after.claims).toBe(0);
    expect(after).toEqual(before); // no order/reservation/audit row was created or changed
  });

  it("re-checks under the transaction locks: a restricted SKU added after the pre-check is still refused, with no claim", async () => {
    const ref = await seed({
      productName: "Camiseta comum D", purchasedIndex: 0,
      variants: [{ sku: "CAM-D-PT-M", isActive: 1, color: "Preto", size: "M" }] });
    // The race: the 14B SKU appears after the route-level check but before the durable claim.
    await conn.query(
      "INSERT INTO productVariants (productId, name, sku, price, stock, size, color, optionKey, isActive) VALUES (?,?,?,?,?,?,?,?,0)",
      [ref.productId, "Branco / G", "14B-CAM-D-BR-G", 8990, 0, "G", "Branco", createVariantOptionKey("Branco", "G")]);
    const before = await snapshot(ref.orderId);

    const db = await import("./db");
    await expect(db.reserveExternalCheckoutCreation(ref.orderId, userId)).rejects.toMatchObject({ code: "CHECKOUT_PRODUCT_REQUIRES_AUTHORIZATION" });

    const after = await snapshot(ref.orderId);
    expect(after.claims).toBe(0);
    expect(after).toEqual(before);
  });

  it("controller race: a SKU added after the initial read is refused before Asaas and leaves no durable claim", async () => {
    const ref = await seed({
      productName: "Camiseta comum F", purchasedIndex: 0,
      variants: [{ sku: "CAM-F-PT-M", isActive: 1, color: "Preto", size: "M" }],
    });
    vi.stubEnv("ASAAS_API_KEY", "$aact_hmlg_synthetic-local-key");
    vi.stubEnv("ASAAS_API_URL", "https://api-sandbox.asaas.com/v3");
    vi.stubEnv("ASAAS_ENV", "sandbox");
    const db = await import("./db");
    const originalPolicy = db.isLegacyCheckoutOrderRestricted.bind(db);
    let inserted = false;
    vi.spyOn(db, "isLegacyCheckoutOrderRestricted").mockImplementation(async orderId => {
      const initialResult = await originalPolicy(orderId);
      if (orderId === ref.orderId && !inserted) {
        inserted = true;
        await conn.query(
          "INSERT INTO productVariants (productId, name, sku, price, stock, size, color, optionKey, isActive) VALUES (?,?,?,?,?,?,?,?,0)",
          [ref.productId, "Branco / G", "14B-CAM-F-BR-G", 8990, 0, "G", "Branco", createVariantOptionKey("Branco", "G")],
        );
      }
      return initialResult;
    });
    const before = await snapshot(ref.orderId);

    const result = await callHandler(ref.orderId);

    expect(inserted).toBe(true);
    expect(result.status).toBe(403);
    expect(result.code).toBe("CHECKOUT_PRODUCT_REQUIRES_AUTHORIZATION");
    expect(ax.get).not.toHaveBeenCalled();
    expect(ax.post).not.toHaveBeenCalled();
    expect(await snapshot(ref.orderId)).toEqual(before);
  });

  it("control: an ordinary product with no 14B SKU is not blocked by the policy (claim is recorded)", async () => {
    const ref = await seed({
      productName: "Camiseta comum E", purchasedIndex: 0,
      variants: [{ sku: "CAM-E-PT-M", isActive: 1, color: "Preto", size: "M" }, { sku: "CAM-E-BR-G", isActive: 0, color: "Branco", size: "G" }] });
    const db = await import("./db");
    await expect(db.reserveExternalCheckoutCreation(ref.orderId, userId)).resolves.toMatchObject({ id: ref.orderId });
    expect((await snapshot(ref.orderId)).claims).toBe(1);
  });

  it("fails closed when the policy cannot be verified (unknown order/product): no provider call", async () => {
    const db = await import("./db");
    await expect(db.isLegacyCheckoutOrderRestricted(987654321)).rejects.toThrow();
  });
});
