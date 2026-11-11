import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type Queryable = { query: (sql: string) => Promise<unknown> };

/**
 * TEST SUPPORT ONLY. Applies the isolated V6-aware STOCK candidate
 * (database/migrations/stock-v1/v6/0027_stock_v1_on_v6_lineage.sql) to a DISPOSABLE database that was just built
 * from the V6 release lineage. The mysql CLI `DELIMITER` directives are client-side, so statements are split on `$$`.
 * The file's `railway` schema guard is rebound to the throw-away database name, never loosened: it still refuses any
 * other schema. Never point this at a remote database.
 */
export async function applyStockV6Migration(connection: Queryable, databaseName: string): Promise<void> {
  if (!/^l4ckos_[a-z0-9_]+$/.test(databaseName)) throw new Error("STOCK_V6_TEST_DB_NAME_REQUIRED");
  const source = await readFile(resolve("database/migrations/stock-v1/v6/0027_stock_v1_on_v6_lineage.sql"), "utf8");
  if (!source.includes("DATABASE() <> 'railway'")) throw new Error("STOCK_V6_GUARD_NOT_FOUND");
  const bound = source.replace("DATABASE() <> 'railway'", `DATABASE() <> '${databaseName}'`);
  const body = bound.split("\n").filter(line => !/^\s*DELIMITER\b/.test(line)).join("\n");
  for (const statement of body.split("$$").map(part => part.trim()).filter(part => part && !/^(--[^\n]*\n?)+$/.test(part))) {
    await connection.query(statement);
  }
}

type RowsQueryable = { query: (sql: string) => Promise<unknown> };

/**
 * TEST SUPPORT ONLY: exact inverse of the V6-aware STOCK candidate on a DISPOSABLE database, so a suite that must observe
 * the pure V6 lineage (fingerprint, backup/restore manifest v5) can do so after other tests applied STOCK. Not a
 * production rollback procedure (that needs a restorable backup); it is a no-op when STOCK is not applied.
 */
export async function rollbackStockV6Migration(connection: RowsQueryable, databaseName: string): Promise<void> {
  if (!/^l4ckos_[a-z0-9_]+$/.test(databaseName)) throw new Error("STOCK_V6_TEST_DB_NAME_REQUIRED");
  const result = (await connection.query(
    "SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'productVariants' AND column_name = 'reservedStock'",
  )) as unknown as [Array<{ n: number | string }>] | Array<{ n: number | string }>;
  const rows = (Array.isArray(result[0]) ? result[0] : result) as Array<{ n: number | string }>;
  if (Number(rows[0]?.n) === 0) return;
  for (const statement of [
    "ALTER TABLE stockReservations DROP FOREIGN KEY stockReservations_attempt_fk",
    "DROP TABLE stockCheckoutItems",
    "DROP TABLE stockCheckoutAttempts",
    "DROP TABLE stockWebhookEvents",
    "ALTER TABLE stockReservations DROP INDEX stockReservations_attempt_variant_unique, DROP INDEX stockReservations_user_product_idx, DROP INDEX stockReservations_variant_status_idx, DROP INDEX stockReservations_attempt_status_idx, DROP COLUMN attemptId, DROP COLUMN skuSnapshot, DROP COLUMN sizeSnapshot, DROP COLUMN colorSnapshot, DROP COLUMN unitPriceCents",
    "ALTER TABLE orders DROP INDEX orders_stockAttempt_unique, DROP INDEX orders_stockPayment_unique, DROP COLUMN stockAttemptId, DROP COLUMN stockPaymentId, DROP COLUMN shippingOptionId",
    "ALTER TABLE orderItems DROP COLUMN skuSnapshot, DROP COLUMN sizeSnapshot, DROP COLUMN colorSnapshot",
    "ALTER TABLE productVariants DROP CONSTRAINT productVariants_stock_bounds_check, DROP CONSTRAINT productVariants_active_identity_check, DROP INDEX productVariants_sku_unique, DROP COLUMN reservedStock",
  ]) await connection.query(statement);
}

/**
 * TEST SUPPORT ONLY, for hand-assembled fixture schemas (not a full V6 lineage): adds just the STOCK columns the
 * integrated Drizzle models select, without keys/constraints/tables. The real structure is proven by the full-lineage
 * suites (run-v6-chain-mysql97-test.sh and the V6 financial suites that apply the real candidate).
 */
export async function addStockColumnsToFixture(connection: RowsQueryable): Promise<void> {
  const exists = async (table: string) => {
    const result = (await connection.query(`SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '${table}'`)) as unknown as [Array<{ n: number | string }>] | Array<{ n: number | string }>;
    const rows = (Array.isArray(result[0]) ? result[0] : result) as Array<{ n: number | string }>;
    return Number(rows[0]?.n) > 0;
  };
  const alters: Array<[string, string]> = [
    ["orders", "ADD COLUMN stockAttemptId VARCHAR(120) NULL, ADD COLUMN stockPaymentId VARCHAR(120) NULL, ADD COLUMN shippingOptionId VARCHAR(120) NULL"],
    ["orderItems", "ADD COLUMN skuSnapshot VARCHAR(120) NULL, ADD COLUMN sizeSnapshot VARCHAR(60) NULL, ADD COLUMN colorSnapshot VARCHAR(60) NULL"],
    ["stockReservations", "ADD COLUMN attemptId VARCHAR(120) NULL, ADD COLUMN skuSnapshot VARCHAR(120) NULL, ADD COLUMN sizeSnapshot VARCHAR(60) NULL, ADD COLUMN colorSnapshot VARCHAR(60) NULL, ADD COLUMN unitPriceCents INT NULL"],
    ["productVariants", "ADD COLUMN reservedStock INT NOT NULL DEFAULT 0"],
  ];
  for (const [table, ddl] of alters) if (await exists(table)) await connection.query(`ALTER TABLE ${table} ${ddl}`);
}
