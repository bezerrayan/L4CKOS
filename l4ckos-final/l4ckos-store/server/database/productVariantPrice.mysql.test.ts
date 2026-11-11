import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mysql2/promise";
import type * as CatalogDatabase from "../db";

const host = process.env.STOCK_MYSQL_HOST ?? "";
const port = Number(process.env.STOCK_MYSQL_PORT ?? 0);
const user = process.env.STOCK_MYSQL_USER ?? "";
const password = process.env.STOCK_MYSQL_PASSWORD ?? "";
const database = process.env.STOCK_MYSQL_DATABASE ?? "";
const disposableTarget = /^(127\.0\.0\.1|localhost|::1)$/.test(host) &&
  database === "l4ckos_stock_test" && user === "stock_test" &&
  Number.isInteger(port) && port > 0 && port < 65536 && password.length > 0;

describe.skipIf(!host)("variant inherited price persistence on disposable MySQL 9.7.2", () => {
  let catalog: typeof CatalogDatabase;
  let pool: Pool | undefined;
  let productId: number | undefined;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    if (!disposableTarget) throw new Error("MYSQL_VARIANT_PRICE_TEST_REQUIRES_DISPOSABLE_LOOPBACK_TARGET");
    process.env.NODE_ENV = "test";
    process.env.APP_ENV = "local-test";
    process.env.L4CKOS_LOCAL_DB_EXCEPTION = "disposable-loopback";
    process.env.DATABASE_URL = `mysql://stock_test:${encodeURIComponent(password)}@${host}:${port}/${database}`;

    catalog = await import("../db");
    const connection = await catalog.getMysqlPool();
    if (!connection) throw new Error("MYSQL_VARIANT_PRICE_TEST_DATABASE_UNAVAILABLE");
    pool = connection;
    const [rows] = await pool.query<Array<{ version: string; databaseName: string; currentUser: string }>>(
      "SELECT VERSION() AS version, DATABASE() AS databaseName, CURRENT_USER() AS currentUser",
    );
    if (!String(rows[0]?.version).startsWith("9.7.2") || rows[0]?.databaseName !== database || !String(rows[0]?.currentUser).startsWith("stock_test@")) {
      throw new Error("MYSQL_VARIANT_PRICE_TEST_TARGET_MISMATCH");
    }
  });

  afterAll(async () => {
    if (productId && pool) {
      await pool.execute("DELETE FROM productVariants WHERE productId = ?", [productId]);
      await pool.execute("DELETE FROM products WHERE id = ?", [productId]);
    }
    if (pool) await pool.end();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it("snapshots inherited prices on create and update, preserves the CHECK, and never reprices later", async () => {
    if (!pool) throw new Error("MYSQL_VARIANT_PRICE_TEST_DATABASE_UNAVAILABLE");
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const created = await catalog.createProductWithCatalog({
      product: { name: `Synthetic variant pricing ${suffix}`, category: "camisetas", price: 12000, stock: 0 },
      images: [],
      variants: [
        { name: `Inherited M ${suffix}`, color: "Preto", size: "M", sku: `PRICE-INHERIT-M-${suffix}`, price: null, stock: 2, isActive: true },
        { name: `Explicit G ${suffix}`, color: "Preto", size: "G", sku: `PRICE-EXPLICIT-G-${suffix}`, price: 14500, stock: 2, isActive: true },
      ],
    });
    productId = created.productId;
    const [initialRows] = await pool.execute<Array<{ id: number; size: string; price: number }>>(
      "SELECT id, size, price FROM productVariants WHERE productId = ? ORDER BY size",
      [productId],
    );
    expect(initialRows).toEqual([
      expect.objectContaining({ size: "G", price: 14500 }),
      expect.objectContaining({ size: "M", price: 12000 }),
    ]);

    const inherited = initialRows.find(row => row.size === "M");
    if (!inherited) throw new Error("MYSQL_VARIANT_PRICE_TEST_FIXTURE_MISSING");
    const updated = await catalog.updateProductWithCatalog({
      id: productId,
      product: { price: 13500 },
      variants: [{ id: inherited.id, price: null }],
    });
    expect(updated.success).toBe(true);
    expect(updated.variants).toContainEqual(expect.objectContaining({ id: inherited.id, price: 13500 }));

    await expect(pool.execute("UPDATE productVariants SET price = NULL WHERE id = ?", [inherited.id]))
      .rejects.toMatchObject({ code: "ER_CHECK_CONSTRAINT_VIOLATED" });

    await catalog.updateProductWithCatalog({ id: productId, product: { price: 15000 } });
    const [afterBasePriceChange] = await pool.execute<Array<{ price: number }>>(
      "SELECT price FROM productVariants WHERE id = ?",
      [inherited.id],
    );
    expect(afterBasePriceChange[0]?.price).toBe(13500);
  });
});
