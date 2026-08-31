import "dotenv/config";
import { createWriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import mysql from "mysql2/promise";

const read = name => String(process.env[name] ?? "").trim();
function noGo(stage, message, details) {
  console.error(JSON.stringify({ decision: "NO-GO", stage, message, details }, null, 2));
  process.exit(1);
}

if (read("APP_ENV") !== "staging") noGo("safety", "APP_ENV must be staging");
if (read("MAINTENANCE_MODE") !== "true" || read("CHECKOUT_ENABLED") !== "false" || read("OPERATIONAL_JOBS_ENABLED") !== "false") {
  noGo("safety", "migration requires MAINTENANCE_MODE=true, CHECKOUT_ENABLED=false and OPERATIONAL_JOBS_ENABLED=false");
}

const migrationArg = process.argv[2] || "";
if (!/^\d{4}_[a-z0-9_]+\.sql$/.test(migrationArg)) noGo("safety", "pass one reviewed migration filename, for example 0015_schema_drift_alignment.sql");
const migrationPath = path.resolve("drizzle", migrationArg);
const preflightPath = path.resolve(read("PREFLIGHT_FILE") || "scripts/preflight-schema-drift.sql");
const databaseUrl = read("DATABASE_URL");
const parsed = new URL(databaseUrl);
const database = parsed.pathname.replace(/^\//, "");
if (parsed.hostname !== read("EXPECTED_DATABASE_HOST") || database !== read("EXPECTED_DATABASE_NAME")) noGo("safety", "database target mismatch");
if (!/staging/i.test(database) || parsed.hostname === read("PRODUCTION_DATABASE_HOST") || database === read("PRODUCTION_DATABASE_NAME")) noGo("safety", "production-like database target refused");

const multiStatementUrl = new URL(databaseUrl);
multiStatementUrl.searchParams.set("multipleStatements", "true");
const connection = await mysql.createConnection(multiStatementUrl.toString());
try {
  const preflightSql = await readFile(preflightPath, "utf8");
  const [sets] = await connection.query(preflightSql);
  const rows = sets.flatMap(value => Array.isArray(value) ? value : []);
  const blockers = rows.filter(row => String(row.classification || "").toUpperCase() === "BLOCKER");
  if (blockers.length) noGo("preflight", "preflight returned blockers", blockers);

  const backupDir = path.resolve(read("STAGING_BACKUP_DIR") || "/tmp/l4ckos-staging-migration-backups");
  await mkdir(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `${database}-${new Date().toISOString().replace(/[:.]/g, "-")}.sql`);
  const dumpArgs = ["--single-transaction", "--quick", "--routines", "--triggers", "--host", parsed.hostname, "--port", parsed.port || "3306", "--user", decodeURIComponent(parsed.username), database];
  await new Promise((resolve, reject) => {
    const output = createWriteStream(backupPath, { flags: "wx", mode: 0o600 });
    const child = spawn("mysqldump", dumpArgs, { env: { ...process.env, MYSQL_PWD: decodeURIComponent(parsed.password) }, stdio: ["ignore", "pipe", "pipe"] });
    let error = "";
    child.stderr.on("data", chunk => { error += chunk.toString(); });
    child.stdout.pipe(output);
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error(`mysqldump exit ${code}: ${error.slice(0, 500)}`)));
  }).catch(error => noGo("backup", "SQL backup failed", { message: error.message }));

  const raw = await readFile(migrationPath, "utf8");
  const statements = raw.replace(/-->\s*statement-breakpoint/g, "").split(/;\s*(?:\r?\n|$)/).map(value => value.trim()).filter(Boolean);
  const applied = [];
  for (let index = 0; index < statements.length; index += 1) {
    try {
      await connection.query(statements[index]);
      const [warnings] = await connection.query("SHOW WARNINGS");
      if (warnings.length) noGo("migration", "statement emitted warnings; stop and inspect physical state", { statement: index + 1, warnings, backupPath });
      applied.push(index + 1);
    } catch (error) {
      noGo("migration", "statement failed; do not continue automatically", { lastAppliedStatement: applied.at(-1) || null, failedStatement: index + 1, backupPath, errorType: error.code || error.name, message: error.sqlMessage || error.message });
    }
  }
  await connection.end();

  const drift = spawnSync(process.execPath, ["scripts/check-schema-drift.mjs"], { cwd: process.cwd(), env: process.env, encoding: "utf8" });
  if (drift.status !== 0) noGo("drift", "post-migration schema drift check failed", { backupPath, output: drift.stdout, error: drift.stderr });

  const readyUrl = new URL("/ready", read("STAGING_BACKEND_URL") || read("API_PUBLIC_URL"));
  const response = await fetch(readyUrl, { signal: AbortSignal.timeout(10_000) }).catch(error => noGo("readiness", "readiness request failed", { message: error.message }));
  const readiness = await response.json().catch(() => ({}));
  if (response.status !== 200 || readiness.ok !== true) noGo("readiness", "backend is not ready after migration", { status: response.status, readiness, backupPath });

  console.log(JSON.stringify({ decision: "GO", stage: "migration", migration: migrationArg, preflight: { blockers: 0, rows: rows.length }, backupPath, appliedStatements: applied, drift: "clean", readiness: 200 }, null, 2));
} catch (error) {
  await connection.end().catch(() => undefined);
  noGo("unexpected", "gate failed; do not continue automatically", { errorType: error instanceof Error ? error.name : "unknown", message: error instanceof Error ? error.message : "unknown" });
}
