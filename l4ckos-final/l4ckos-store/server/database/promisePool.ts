import type { Pool } from "mysql2/promise";

type CallbackPool = { promise: () => Pool; getConnection: unknown };
const cache = new WeakMap<object, Pool>();

/**
 * Drizzle's `$client` is mysql2's callback-style Pool, but the STOCK checkout adapter and Exclusive Drops store use the
 * promise API (`await pool.getConnection()/execute()/query()`). Real deployments therefore need `.promise()`; test harnesses
 * inject promise pools directly and are passed through unchanged. Returns null when the client has no pool API.
 */
export function toPromisePool(client: unknown): Pool | null {
  if (!client || typeof client !== "object") return null;
  const cached = cache.get(client);
  if (cached) return cached;
  const candidate = client as Partial<CallbackPool> & Partial<Pool>;
  if (typeof candidate.getConnection !== "function") return null;
  const pool = typeof candidate.promise === "function" ? (candidate as CallbackPool).promise() : (client as Pool);
  cache.set(client, pool);
  return pool;
}
