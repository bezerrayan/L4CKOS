import type { Pool } from "mysql2/promise";
import { getDb } from "../db";
import { createExclusiveStore, type ExclusiveStore } from "./store";

let injected: ExclusiveStore | undefined;

/** Same restriction as the STOCK harness: store injection is only possible against the disposable loopback database. */
export function configureExclusiveStoreForLocalHarness(store: ExclusiveStore | undefined): void {
  const host = process.env.STOCK_MYSQL_HOST ?? "";
  if (store && (process.env.NODE_ENV === "production" || process.env.STOCK_LOCAL_HARNESS !== "true" ||
      !/^(127\.0\.0\.1|localhost|::1)$/.test(host) || process.env.STOCK_MYSQL_DATABASE !== "l4ckos_stock_test")) {
    throw new Error("EXCLUSIVE_STORE_INJECTION_REQUIRES_DISPOSABLE_LOOPBACK_HARNESS");
  }
  injected = store;
}

let cached: { pool: Pool; store: ExclusiveStore } | undefined;

/** The application's own MySQL pool (drizzle's client). Returns null when no database is configured. */
export async function getExclusiveStore(): Promise<ExclusiveStore | null> {
  if (injected) return injected;
  const db = (await getDb()) as unknown as { $client?: Pool } | null;
  const pool = db?.$client;
  if (!pool || typeof pool.getConnection !== "function") return null;
  if (cached?.pool !== pool) cached = { pool, store: createExclusiveStore(pool) };
  return cached.store;
}
