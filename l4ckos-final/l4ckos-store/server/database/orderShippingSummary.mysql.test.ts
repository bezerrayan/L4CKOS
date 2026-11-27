import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, type Pool } from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { getOrdersByFilters, setStockLocalHarnessDb } from "../db";

/** Disposable loopback MySQL only. The query runs through the LEAST-PRIVILEGE runtime account; seeding uses the privileged setup account. */
const enabled = process.env.STOCK_LOCAL_HARNESS === "true" && /^(127\.0\.0\.1|localhost|::1)$/.test(process.env.STOCK_MYSQL_HOST ?? "") &&
  process.env.STOCK_MYSQL_DATABASE === "l4ckos_stock_test" && !!process.env.STOCK_SETUP_MYSQL_USER;
const cfg = (u: string, p: string) => ({ host: process.env.STOCK_MYSQL_HOST, port: Number(process.env.STOCK_MYSQL_PORT), user: u, password: p, database: process.env.STOCK_MYSQL_DATABASE, connectionLimit: 4 });

describe.skipIf(!enabled)("admin order list: freight summary (MySQL, least privilege)", () => {
  let runtime: Pool, setup: Pool;
  const ids: Record<string, number> = {};

  beforeAll(async () => {
    runtime = createPool(cfg(process.env.STOCK_MYSQL_USER!, process.env.STOCK_MYSQL_PASSWORD!));
    setup = createPool(cfg(process.env.STOCK_SETUP_MYSQL_USER!, process.env.STOCK_SETUP_MYSQL_PASSWORD!));
    setStockLocalHarnessDb(drizzle(runtime));
    const [u] = await setup.query<any>("INSERT INTO users (openId, name, email, loginMethod, role) VALUES (?, 'Cliente', ?, 'local', 'user')",
      [`ship-sum-${process.hrtime.bigint()}`, `ship-sum-${process.hrtime.bigint()}@example.invalid`]);
    const mkOrder = async (key: string) => {
      const [o] = await setup.query<any>("INSERT INTO orders (userId, status, paymentStatus, totalPrice, trackingCode, shippingRecipient, shippingZipCode, shippingStreet, shippingNumber, shippingNeighborhood, shippingCity, shippingState) VALUES (?, 'shipped', 'confirmed', 13962, 'BR1SYN', 'Cliente', '70000000', 'Rua', '1', 'Centro', 'Brasilia', 'DF')", [u.insertId]);
      ids[key] = o.insertId;
    };
    for (const key of ["carrier", "legacy", "malformed", "twice"]) await mkOrder(key);
    const audit = (orderId: number, metadata: string) => setup.query("INSERT INTO auditLogs (actorUserId, actorType, action, entity, entityId, metadata) VALUES (?, 'system', 'checkout.shipping_accepted.v1', 'order', ?, ?)", [u.insertId, String(orderId), metadata]);
    const accepted = (price: number, service: string) => JSON.stringify({ attemptId: "attempt-SECRET-0001", merchandiseCents: 11900, shipping: {
      version: 1, method: "carrier", optionId: "melhor-envio-1", carrier: "Correios", serviceId: "1", serviceName: service, quoteReference: "quote-ref-SECRET",
      providerQuoteId: "melhor-envio-1", currency: "BRL", shippingPriceCents: price, destinationZipCode: "70000000",
      address: { recipient: "Cliente", zipCode: "70000000", street: "Rua", number: "1", neighborhood: "Centro", city: "Brasilia", state: "DF" },
      package: { heightCm: 6, widthCm: 22, lengthCm: 32, weightGrams: 300 }, itemCount: 1, merchandiseSubtotalCents: 11900, quoteToken: "bearer-SECRET" } });
    await audit(ids.carrier, accepted(2062, "PAC"));
    await audit(ids.malformed, "{not-json");
    await audit(ids.twice, accepted(1000, "OLD"));
    await audit(ids.twice, accepted(2062, "PAC")); // newest wins
  });
  afterAll(async () => { setStockLocalHarnessDb(null); await runtime?.end(); await setup?.end(); });

  it("attaches carrier, service, price and parcel for an order with a freight record", async () => {
    const row = (await getOrdersByFilters()).find(o => o.id === ids.carrier)!;
    expect(row.shippingSummary).toEqual({ method: "carrier", carrier: "Correios", serviceName: "PAC", shippingPriceCents: 2062, package: { heightCm: 6, widthCm: 22, lengthCm: 32, weightGrams: 300 } });
    expect(row.trackingCode).toBe("BR1SYN");
  });

  it("legacy orders without a record and malformed records yield null (no error), newest record wins", async () => {
    const rows = await getOrdersByFilters();
    expect(rows.find(o => o.id === ids.legacy)!.shippingSummary).toBeNull();
    expect(rows.find(o => o.id === ids.malformed)!.shippingSummary).toBeNull();
    expect(rows.find(o => o.id === ids.twice)!.shippingSummary).toMatchObject({ serviceName: "PAC", shippingPriceCents: 2062 });
  });

  it("never exposes tokens, quote references, attempt ids or audit internals anywhere in the admin payload", async () => {
    const payload = JSON.stringify(await getOrdersByFilters());
    for (const leaked of ["SECRET", "quoteToken", "quoteReference", "providerQuoteId", "attemptId", "optionId", "metadata"]) expect(payload).not.toContain(leaked);
  });
});
