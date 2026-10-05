import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { assertLocalSchemaTarget, SchemaError } from "../database/schema/safety";

// No .env loading, custom config, flags or remote override. Drizzle config reads this same URL.
try {
  if (process.argv.length !== 2 || process.env.L4CKOS_LOCAL_MYSQL_SOCKET) throw new SchemaError("LOCAL_DB_PUSH_ARGUMENTS_REQUIRED");
  assertLocalSchemaTarget({ url: process.env.DATABASE_URL || "" });
  const root = fileURLToPath(new URL("../", import.meta.url));
  const result = spawnSync(process.execPath, [path.join(root, "node_modules/drizzle-kit/bin.cjs"), "push", "--config", path.join(root, "drizzle.config.ts")], { cwd: root, env: process.env, stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} catch { console.error("LOCAL_DB_PUSH_REQUIRED"); process.exitCode = 1; }
