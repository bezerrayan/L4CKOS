import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import mysql from "mysql2/promise";

const read = name => String(process.env[name] ?? "").trim();
function noGo(message, details) {
  console.error(JSON.stringify({ decision: "NO-GO", stage: "provision", message, details }, null, 2));
  process.exit(1);
}

if (read("APP_ENV") !== "staging") noGo("APP_ENV must be staging");
const databaseUrl = read("DATABASE_URL");
if (!databaseUrl) noGo("DATABASE_URL is required");
const parsed = new URL(databaseUrl);
const database = parsed.pathname.replace(/^\//, "");
if (parsed.hostname !== read("EXPECTED_DATABASE_HOST") || database !== read("EXPECTED_DATABASE_NAME")) noGo("database target does not match EXPECTED_DATABASE_HOST/NAME");
if (!/staging/i.test(database) || parsed.hostname === read("PRODUCTION_DATABASE_HOST") || database === read("PRODUCTION_DATABASE_NAME")) noGo("production-like database target refused");

let connection;
try {
  connection = await mysql.createConnection(databaseUrl);
  const [[count]] = await connection.query("SELECT COUNT(*) total FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()");
  if (Number(count.total) !== 0) noGo("target database is not empty", { tables: Number(count.total) });

  const files = (await readdir(path.resolve("drizzle"))).filter(file => /^\d{4}_.+\.sql$/.test(file)).sort();
  const statements = [];
  for (const file of files) {
    const raw = await readFile(path.resolve("drizzle", file), "utf8");
    const sqlStatements = raw.replace(/-->\s*statement-breakpoint/g, "").split(/;\s*(?:\r?\n|$)/).map(value => value.trim()).filter(Boolean);
    for (let index = 0; index < sqlStatements.length; index += 1) {
      const startedAt = process.hrtime.bigint();
      await connection.query(sqlStatements[index]);
      const [warnings] = await connection.query("SHOW WARNINGS");
      if (warnings.length) noGo("migration emitted warnings", { file, statement: index + 1, warnings });
      statements.push({ file, statement: index + 1, elapsedMs: Number(Number(process.hrtime.bigint() - startedAt) / 1e6).toFixed(3) });
    }
  }
  await connection.end();
  connection = undefined;

  const drift = spawnSync(process.execPath, ["scripts/check-schema-drift.mjs"], { cwd: process.cwd(), env: process.env, encoding: "utf8" });
  if (drift.status !== 0) noGo("schema drift check failed", { exitCode: drift.status, output: drift.stdout, error: drift.stderr });

  let seed = "skipped";
  if (read("SEED_STAGING") === "true") {
    const seeded = spawnSync(process.execPath, ["scripts/seed-staging.mjs"], { cwd: process.cwd(), env: process.env, encoding: "utf8" });
    if (seeded.status !== 0) noGo("staging seed failed", { exitCode: seeded.status, output: seeded.stdout, error: seeded.stderr });
    seed = "applied";
  }

  console.log(JSON.stringify({ decision: "GO", stage: "provision", database, migrations: files, statementCount: statements.length, warnings: 0, drift: "clean", seed }, null, 2));
} catch (error) {
  if (connection) await connection.end().catch(() => undefined);
  noGo("provisioning failed; do not continue automatically", { errorType: error instanceof Error ? error.name : "unknown", message: error instanceof Error ? error.message : "unknown" });
}
