import type { ConnectionOptions } from "mysql2/promise";
import { resolveMysqlConnection } from "./mysqlConnection.mjs";

/**
 * Options for the application's DIRECT (non-pool) mysql2 connections: checkout, production batches and the backup job.
 * They go through the same per-environment policy as getDb(): production = pinned CA + hostname, staging = its own CA,
 * local = loopback disposable database only. A policy error propagates (fail-closed); nothing falls back to a bare URL.
 */
export function runtimeConnectionOptions(extra: ConnectionOptions = {}, env: Record<string, string | undefined> = process.env): ConnectionOptions {
  const url = env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_REQUIRED");
  const { options } = resolveMysqlConnection(url, env);
  return { ...(options as ConnectionOptions), ...extra };
}

/** TLS part only, for helpers that build their own option bag (openBackupConnection). */
export function runtimeTlsOptions(env: Record<string, string | undefined> = process.env): Pick<ConnectionOptions, "ssl"> {
  const url = env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_REQUIRED");
  const { options } = resolveMysqlConnection(url, env);
  return (options as ConnectionOptions).ssl ? { ssl: (options as ConnectionOptions).ssl } : {};
}
