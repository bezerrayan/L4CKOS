import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { productVariants } from "../../drizzle/schema";

describe("STOCK V1 isolated migration contract", () => {
  it("keeps unreviewed variants inactive in both Drizzle and SQL defaults", async () => {
    expect(productVariants.isActive.default).toBe(0);
    const sql = await readFile(resolve("database/migrations/stock-v1/0027_stock_v1_incremental.sql"), "utf8");
    const fixture = await readFile(resolve("server/stock/fixtures/mysql8-stock-schema.sql"), "utf8");
    expect(sql).toMatch(/ADD COLUMN isActive INT NOT NULL DEFAULT 0/i);
    expect(fixture).toMatch(/isActive INT NOT NULL DEFAULT 0/i);
  });

  it("remains separate from the broken Drizzle chain and contains no historical backfill", async () => {
    const sql = await readFile(resolve("database/migrations/stock-v1/0027_stock_v1_incremental.sql"), "utf8");
    const journal = await readFile(resolve("drizzle/meta/_journal.json"), "utf8");
    expect(sql).toMatch(/expected schema railway/i);
    expect(sql).toMatch(/partial prior STOCK DDL requires inspection/i);
    expect(sql).toMatch(/CREATE TABLE stockCheckoutAttempts/i);
    expect(sql).toMatch(/CREATE TABLE stockCheckoutItems/i);
    expect(sql).toMatch(/CREATE TABLE stockWebhookEvents/i);
    expect(sql).not.toMatch(/\bUPDATE\s+(orders|orderItems|stockReservations|productVariants)\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\s+(orders|orderItems|stockReservations|productVariants)\b/i);
    expect(journal).not.toContain("0027_stock_v1_incremental");
  });
});
