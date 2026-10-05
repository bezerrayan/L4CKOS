import type { Connection } from "mysql2/promise";
import { rows } from "./fingerprint";

export class SchemaError extends Error {
  constructor(public readonly code: string, public readonly evidence?: { operation: string; completedStatements: number; preFingerprint: string; observedFingerprint: string | null }) { super(code); }
}
export type LocalTarget = { url: string; socketPath?: string };
export function assertLocalSchemaTarget(target: LocalTarget, env: NodeJS.ProcessEnv = process.env) {
  let parsed: URL;
  try { parsed = new URL(target.url); } catch { throw new SchemaError("LOCAL_SCHEMA_TARGET_REQUIRED"); }
  if (env.L4CKOS_LOCAL_SCHEMA !== "1" || env.NODE_ENV === "production" || Object.keys(env).some(key => key.startsWith("RAILWAY_") && env[key]) ||
      parsed.protocol !== "mysql:" || parsed.search || parsed.hash || !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) ||
      !/^l4ckos_(test|local)_[a-z0-9_]+$/.test(parsed.pathname.slice(1)) ||
      (target.socketPath && !/^\/tmp\/l4ckos-[a-z0-9-]+\/mysqld\.sock$/.test(target.socketPath))) throw new SchemaError("LOCAL_SCHEMA_TARGET_REQUIRED");
}
export async function verifyLocalConnection(connection: Connection, target: LocalTarget) {
  assertLocalSchemaTarget(target);
  const expected = new URL(target.url);
  const actual = connection.config;
  if (actual.host !== expected.hostname || actual.database !== expected.pathname.slice(1) || Number(actual.port) !== Number(expected.port || 3306) ||
      (actual.socketPath || undefined) !== target.socketPath) throw new SchemaError("TARGET_CONNECTION_MISMATCH");
  const result = (await rows(connection, "SELECT VERSION() version, DATABASE() name, @@SESSION.foreign_key_checks fk, @@SESSION.sql_mode sqlMode, @@SESSION.autocommit autocommit"))[0];
  if (result.name !== expected.pathname.slice(1) || !/^8\.4\./.test(result.version) || Number(result.fk) !== 1 || Number(result.autocommit) !== 1 || !String(result.sqlMode).includes("STRICT_TRANS_TABLES")) throw new SchemaError("MYSQL_84_STRICT_TARGET_REQUIRED");
  await connection.query("SET time_zone = '+00:00'");
}
