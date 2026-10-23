import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, fstatSync } from "node:fs";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createConnection } from "mysql2/promise";
import { Readable, Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { canonical, readStructuralSchema, structuralHash } from "../database/schema/fingerprint";
import { createEnvelopeHeader, hashFile, authenticateEnvelope, decryptAuthenticatedStream, type BackupContext } from "./staging-backup-v2-crypto";

const TARGET = Object.freeze({ projectId: "2bb90c8e-eb65-43ee-826b-f93750f0499c", environmentId: "15545eee-bc02-4b70-afc4-19a5db9e6f46", mysqlServiceId: "bcda5d78-4a0d-4682-8659-8316847addb7", schema: "l4ckos_staging" });
const PRE = "0ba16c9b19b698d4933d0abad9a5e4679052fd2aaf78800da42d480e396ef5d2";
const RAILWAY = "/home/yan/.railway/bin/railway";
const MYSQL_IMAGE = "mysql:8.4.11";
const BACKUP_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EXPECTED_DIRTY = new Set([
  "database/migrations/runner.ts", "database/schema/governance.ts", "database/stagingV6/backupProof.ts", "database/stagingV6/executor.ts", "database/stagingV6/policy.ts", "database/stagingV6/railwayIdentity.ts", "database/stagingV6/remote.ts", "database/stagingV6/runtime.ts", "package.json",
  "docs/database/staging-backup-v2.md", "docs/database/staging-v6-remote-executor.md", "scripts/run-staging-backup-v2.sh", "scripts/staging-backup-v2-crypto.ts", "scripts/staging-backup-v2.ts", "scripts/staging-v6.ts", "scripts/test-staging-backup-v2-input-pty.py", "scripts/test-staging-backup-v2-mysql.ts",
  "server/database/stagingBackupV2.test.ts", "server/database/stagingV6Executor.mysql.test.ts", "server/database/stagingV6Executor.test.ts",
]);
export function assertReviewedRcCheckout() {
  const git = (args: string[]) => execFileSync("git", args, { cwd: BACKUP_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trimEnd();
  if (git(["rev-parse", "HEAD"]) !== "88daab3046f5351b6724ad51f69041b4fd896509") throw new Error("BACKUP_RC_SHA_MISMATCH");
  const prefix = `${path.relative(git(["rev-parse", "--show-toplevel"]), BACKUP_ROOT).split(path.sep).join("/")}/`;
  const paths = git(["status", "--porcelain", "--untracked-files=all"]).split("\n").filter(Boolean).map(row => row.slice(3).replace(prefix, ""));
  if (paths.some(file => !EXPECTED_DIRTY.has(file) || file.endsWith(".npmrc"))) throw new Error("BACKUP_UNREVIEWED_WORKTREE_CHANGE");
}

// Emits exactly one metadata JSON line, then a mysqldump stream. A global read lock
// remains held by the coprocess during inventory and export, so all counts match.
export const REMOTE_EXPORT = String.raw`set -Eeuo pipefail
test "\${RAILWAY_PROJECT_ID:-}" = "2bb90c8e-eb65-43ee-826b-f93750f0499c"
test "\${RAILWAY_ENVIRONMENT_ID:-}" = "15545eee-bc02-4b70-afc4-19a5db9e6f46"
test "\${RAILWAY_SERVICE_ID:-}" = "bcda5d78-4a0d-4682-8659-8316847addb7"
test -n "\${MYSQL_ROOT_PASSWORD:-}"
mysql_cmd() { MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --protocol=socket -uroot --database=l4ckos_staging --batch --skip-column-names --silent --init-command='SET SESSION group_concat_max_len=65535' "$@"; }
mysqldump_cmd() { MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump --protocol=socket -uroot --single-transaction --quick --lock-tables=false --routines --triggers --events --hex-blob --default-character-set=utf8mb4 --set-gtid-purged=OFF --column-statistics=0 --databases l4ckos_staging; }
coproc LOCKER { MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --protocol=socket -uroot --batch --skip-column-names --silent --unbuffered; }
lock_pid=$LOCKER_PID
cleanup() { printf 'UNLOCK TABLES;\nexit\n' >&"\${LOCKER[1]}" 2>/dev/null || true; wait "$lock_pid" 2>/dev/null || true; }
trap cleanup EXIT
printf 'FLUSH TABLES WITH READ LOCK;\nSELECT "L4CKOS_LOCK_ACQUIRED";\n' >&"\${LOCKER[1]}"
IFS= read -r lock_marker <&"\${LOCKER[0]}"
test "$lock_marker" = "L4CKOS_LOCK_ACQUIRED"
test "$(mysql_cmd -N -e 'SELECT VERSION()' | cut -d. -f1-2)" = "8.4"
test "$(mysql_cmd -N -e 'SELECT DATABASE()')" = "l4ckos_staging"
table_count=$(mysql_cmd -N -e "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='l4ckos_staging' AND TABLE_TYPE='BASE TABLE'")
view_count=$(mysql_cmd -N -e "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='l4ckos_staging' AND TABLE_TYPE='VIEW'")
noninnodb=$(mysql_cmd -N -e "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='l4ckos_staging' AND TABLE_TYPE='BASE TABLE' AND COALESCE(ENGINE,'') <> 'InnoDB'")
trigger_count=$(mysql_cmd -N -e "SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='l4ckos_staging'")
routine_count=$(mysql_cmd -N -e "SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA='l4ckos_staging'")
event_count=$(mysql_cmd -N -e "SELECT COUNT(*) FROM information_schema.EVENTS WHERE EVENT_SCHEMA='l4ckos_staging'")
test "$noninnodb" = "0"
test "$(mysql_cmd -N -e "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='l4ckos_staging' AND TABLE_NAME='_l4ckos_schema_migrations'")" = "1"
test "$(mysql_cmd -N -e "SELECT name FROM _l4ckos_schema_migrations ORDER BY id DESC LIMIT 1")" = "0023_asaas_webhook_inbox"
count_sql=$(mysql_cmd -N -e "SELECT CONCAT('SELECT JSON_OBJECT(', GROUP_CONCAT(CONCAT(QUOTE(TABLE_NAME), ', (SELECT COUNT(*) FROM ', CHAR(96), REPLACE(TABLE_NAME,CHAR(96),CONCAT(CHAR(96),CHAR(96))), CHAR(96), ')') ORDER BY TABLE_NAME SEPARATOR ','), ');') FROM information_schema.TABLES WHERE TABLE_SCHEMA='l4ckos_staging' AND TABLE_TYPE='BASE TABLE'")
row_counts=$(mysql_cmd -N -e "$count_sql")
definers=$(mysql_cmd -N -e "SELECT COALESCE(JSON_ARRAYAGG(CONCAT(kind,':',objectName,':',definer)),JSON_ARRAY()) FROM (SELECT 'VIEW' kind,TABLE_NAME objectName,DEFINER definer FROM information_schema.VIEWS WHERE TABLE_SCHEMA='l4ckos_staging' UNION ALL SELECT 'TRIGGER',TRIGGER_NAME,DEFINER FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='l4ckos_staging' UNION ALL SELECT ROUTINE_TYPE,ROUTINE_NAME,DEFINER FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA='l4ckos_staging' UNION ALL SELECT 'EVENT',EVENT_NAME,DEFINER FROM information_schema.EVENTS WHERE EVENT_SCHEMA='l4ckos_staging') backup_definers")
inventory=$(printf '{"tables":%s,"views":%s,"triggers":%s,"routines":%s,"events":%s,"nonInnoDbTables":%s}' "$table_count" "$view_count" "$trigger_count" "$routine_count" "$event_count" "$noninnodb")
printf '{"projectId":"%s","environmentId":"%s","mysqlServiceId":"%s","schema":"l4ckos_staging","mysqlVersion":"%s","ledgerTail":"0023_asaas_webhook_inbox","inventory":%s,"rowCounts":%s,"definers":%s}\n' "$RAILWAY_PROJECT_ID" "$RAILWAY_ENVIRONMENT_ID" "$RAILWAY_SERVICE_ID" "$(mysql_cmd -N -e 'SELECT VERSION()')" "$inventory" "$row_counts" "$definers"
mysqldump_cmd
`.replaceAll("\\$", "$");

function safeError(label: string): never { throw new Error(label); }
let diagnosticPhase = "capture_setup";
function safeDiagnosticCode(error: unknown) {
  if (error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message)) return error.message;
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]+$/.test(code) ? code : "UNCLASSIFIED_ERROR";
}
export function formatBackupDiagnostic(phase: string, code: string) {
  return JSON.stringify({ status: "STAGING_BACKUP_V2_FAILED", phase, code });
}
export function isValidBackupKeyHex(value: string) { return /^[a-fA-F0-9]{64}$/.test(value); }
function jsonDigest(value: unknown) { return createHash("sha256").update(canonical(value)).digest("hex"); }
export async function validateRestoredLedger(connection: Awaited<ReturnType<typeof createConnection>>) {
  const [ledger] = await connection.query<any[]>("SELECT name FROM _l4ckos_schema_migrations ORDER BY id");
  const ledgerTail = ledger.at(-1)?.name;
  if (ledgerTail !== "0023_asaas_webhook_inbox") safeError("ISOLATED_RESTORE_LEDGER_INVALID");
  const [executionStates] = await connection.query<any[]>("SELECT state FROM _l4ckos_schema_executions");
  if (executionStates.some(row => row.state !== "COMPLETED")) safeError("ISOLATED_RESTORE_LEDGER_PARTIAL_STATE");
  return ledgerTail as string;
}
function readKeyFromFd3() {
  return new Promise<string>((resolve, reject) => {
    let data = "";
    // Consume the inherited pipe itself. Reopening /dev/fd/3 can fail for a pipe
    // descriptor on Linux and obscures the actual key-input failure.
    try { if (!fstatSync(3).isFIFO()) throw new Error(); }
    catch { reject(new Error("INPUT_READ_FAILED")); return; }
    let input: ReturnType<typeof createReadStream>;
    try { input = createReadStream(null, { fd: 3, encoding: "utf8", autoClose: true }); }
    catch { reject(new Error("INPUT_READ_FAILED")); return; }
    input.on("data", chunk => {
      data += chunk;
      if (data.length > 256) { data = ""; input.destroy(); reject(new Error("INVALID_KEY_FORMAT")); }
    });
    input.on("error", () => { data = ""; reject(new Error("INPUT_READ_FAILED")); });
    input.on("end", () => {
      const key = data; data = "";
      if (!isValidBackupKeyHex(key)) return reject(new Error("INVALID_KEY_FORMAT"));
      resolve(key);
    });
  });
}

export async function verifyKeyInputOnly() {
  let key = await readKeyFromFd3();
  key = "";
  console.log(JSON.stringify({ status: "BACKUP_V2_KEY_INPUT_ACCEPTED", phase: "key_input_complete" }));
}

class ExportEncryptor extends Transform {
  private pending = Buffer.alloc(0);
  private cipher?: ReturnType<typeof createEnvelopeHeader>["cipher"];
  private metadata?: any;
  private hash = createHash("sha256");
  private plaintextHash = createHash("sha256");
  private nonceHex?: string;
  private contextSha256?: string;
  private tagHex?: string;
  constructor(private readonly keyHex: string, private readonly createdAt: string) { super(); }
  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
    try {
      if (!this.cipher) {
        this.pending = Buffer.concat([this.pending, chunk]);
        const newline = this.pending.indexOf(10);
        if (newline < 0) { if (this.pending.length > 128 * 1024) throw new Error("BACKUP_EXPORT_METADATA_INVALID"); return callback(); }
        this.metadata = JSON.parse(this.pending.subarray(0, newline).toString("utf8"));
        this.validateMetadata(this.metadata);
        const context: BackupContext = { sourceProjectId: TARGET.projectId, sourceEnvironmentId: TARGET.environmentId, sourceMysqlServiceId: TARGET.mysqlServiceId, sourceSchema: TARGET.schema, createdAt: this.createdAt, sourceFingerprint: PRE, inventory: this.metadata.inventory, mysqlVersion: this.metadata.mysqlVersion };
        const envelope = createEnvelopeHeader(context, this.keyHex); this.cipher = envelope.cipher;
        this.nonceHex = envelope.nonce.toString("hex");
        this.contextSha256 = createHash("sha256").update(envelope.contextBytes).digest("hex");
        this.push(envelope.header); this.hash.update(envelope.header);
        const remainder = this.pending.subarray(newline + 1); this.pending = Buffer.alloc(0);
        this.pushCipher(remainder);
        callback(); return;
      }
      this.pushCipher(chunk); callback();
    } catch { callback(new Error("BACKUP_EXPORT_METADATA_OR_STREAM_FAILED")); }
  }
  private pushCipher(chunk: Buffer) { if (!chunk.length) return; this.plaintextHash.update(chunk); const encrypted = this.cipher!.update(chunk); if (encrypted.length) { this.hash.update(encrypted); this.push(encrypted); } }
  private validateMetadata(value: any) {
    if (value?.projectId !== TARGET.projectId || value?.environmentId !== TARGET.environmentId || value?.mysqlServiceId !== TARGET.mysqlServiceId || value?.schema !== TARGET.schema || !/^8\.4\./.test(value.mysqlVersion || "") || value.ledgerTail !== "0023_asaas_webhook_inbox" || value.inventory?.tables !== 31 || value.inventory?.nonInnoDbTables !== 0) throw new Error("STAGING_EXPORT_IDENTITY_OR_INVENTORY_MISMATCH");
    for (const k of ["tables", "views", "triggers", "routines", "events", "nonInnoDbTables"]) if (!Number.isInteger(value.inventory[k]) || value.inventory[k] < 0) throw new Error("STAGING_EXPORT_INVENTORY_INVALID");
    if (!value.rowCounts || typeof value.rowCounts !== "object" || Object.values(value.rowCounts).some(n => !/^\d+$/.test(String(n))) || !Array.isArray(value.definers) || value.definers.some((item: unknown) => typeof item !== "string")) throw new Error("STAGING_EXPORT_ROW_COUNTS_INVALID");
  }
  _flush(callback: TransformCallback) {
    try {
      if (!this.cipher || !this.metadata) throw new Error("BACKUP_EXPORT_EMPTY");
      const final = this.cipher.final(); if (final.length) { this.hash.update(final); this.push(final); }
      const tag = this.cipher.getAuthTag(); this.hash.update(tag); this.push(tag);
      this.tagHex = tag.toString("hex");
      callback();
    } catch { callback(new Error("BACKUP_EXPORT_ENCRYPTION_FAILED")); }
  }
  result() { return { metadata: this.metadata, sha256: this.hash.digest("hex"), plaintextSha256: this.plaintextHash.digest("hex"), nonce: this.nonceHex!, tag: this.tagHex!, contextSha256: this.contextSha256! }; }
}

async function createIsolatedMysql(name: string, socketDir: string) {
  const run = spawnSync("docker", ["run", "--detach", "--rm", "--name", name, "--network", "none", "--tmpfs", "/var/lib/mysql:rw,nosuid,nodev,size=2g", "--mount", `type=bind,source=${socketDir},target=/run/mysqld`, "--env", "MYSQL_ALLOW_EMPTY_PASSWORD=yes", "--env", "MYSQL_ROOT_HOST=%", MYSQL_IMAGE, "--skip-networking", "--socket=/run/mysqld/mysqld.sock"], { encoding: "utf8", stdio: ["ignore", "ignore", "ignore"] });
  if (run.status !== 0) safeError("ISOLATED_MYSQL_START_FAILED");
  for (let i = 0; i < 90; i++) {
    const logs = spawnSync("docker", ["logs", name], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const initialized = `${logs.stdout || ""}${logs.stderr || ""}`.includes("MySQL init process done. Ready for start up.");
    const ping = initialized && spawnSync("docker", ["exec", name, "mysqladmin", "--protocol=socket", "--socket=/run/mysqld/mysqld.sock", "-uroot", "ping", "--silent"], { stdio: "ignore" }).status === 0;
    if (ping) return;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  safeError("ISOLATED_MYSQL_READY_TIMEOUT");
}
async function restoreAndValidate(artifact: string, keyHex: string, metadata: any, socketDir: string) {
  const name = `l4ckos-backup-v2-restore-${process.pid}`;
  await mkdir(socketDir, { recursive: true, mode: 0o700 }); await chmod(socketDir, 0o777);
  try {
    await createIsolatedMysql(name, socketDir);
    const load = spawn("docker", ["exec", "-i", name, "mysql", "--protocol=socket", "--socket=/run/mysqld/mysqld.sock", "-uroot", "--binary-mode"], { stdio: ["pipe", "ignore", "ignore"] });
    const loadClosed = new Promise<number | null>((resolve, reject) => { load.once("error", reject); load.once("close", resolve); });
    try { await decryptAuthenticatedStream(artifact, keyHex, load.stdin); }
    catch { load.kill("SIGTERM"); safeError("BACKUP_AUTHENTICATION_OR_RESTORE_FAILED"); }
    const loadCode = await loadClosed;
    if (loadCode !== 0) safeError("ISOLATED_RESTORE_FAILED");
    const connection = await createConnection({ socketPath: `${socketDir}/mysqld.sock`, user: "root", database: TARGET.schema, multipleStatements: false, timezone: "Z" });
    try {
      const [identityRows] = await connection.query<any[]>("SELECT VERSION() version, DATABASE() schemaName");
      if (!/^8\.4\./.test(identityRows[0].version) || identityRows[0].schemaName !== TARGET.schema) safeError("ISOLATED_RESTORE_IDENTITY_INVALID");
      const structural = await readStructuralSchema(connection);
      const fingerprint = structuralHash(structural);
      if (fingerprint !== PRE) safeError("ISOLATED_RESTORE_FINGERPRINT_MISMATCH");
      const [tables] = await connection.query<any[]>("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME");
      if (tables.length !== 31) safeError("ISOLATED_RESTORE_TABLE_COUNT_MISMATCH");
      const counts: Record<string, number> = {};
      for (const row of tables) {
        const table = String(row.TABLE_NAME).replace(/`/g, "``");
        const [result] = await connection.query<any[]>(`SELECT COUNT(*) n FROM \`${table}\``);
        counts[row.TABLE_NAME] = Number(result[0].n);
      }
      if (canonical(counts) !== canonical(metadata.rowCounts)) safeError("ISOLATED_RESTORE_ROW_COUNTS_MISMATCH");
      const ledgerTail = await validateRestoredLedger(connection);
      const fk = await foreignKeyViolations(connection);
      if (fk !== 0) safeError("ISOLATED_RESTORE_FOREIGN_KEY_VIOLATION");
      const objects = await connection.query<any[]>("SELECT (SELECT COUNT(*) FROM information_schema.VIEWS WHERE TABLE_SCHEMA=DATABASE()) views,(SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()) triggers,(SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=DATABASE()) routines,(SELECT COUNT(*) FROM information_schema.EVENTS WHERE EVENT_SCHEMA=DATABASE()) events");
      const actual = objects[0][0];
      if (["views", "triggers", "routines", "events"].some(k => Number(actual[k]) !== Number(metadata.inventory[k]))) safeError("ISOLATED_RESTORE_OBJECT_INVENTORY_MISMATCH");
      const [definerRows] = await connection.query<any[]>("SELECT CONCAT(kind,':',objectName,':',definer) objectDefiner FROM (SELECT 'VIEW' kind,TABLE_NAME objectName,DEFINER definer FROM information_schema.VIEWS WHERE TABLE_SCHEMA=DATABASE() UNION ALL SELECT 'TRIGGER',TRIGGER_NAME,DEFINER FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() UNION ALL SELECT ROUTINE_TYPE,ROUTINE_NAME,DEFINER FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=DATABASE() UNION ALL SELECT 'EVENT',EVENT_NAME,DEFINER FROM information_schema.EVENTS WHERE EVENT_SCHEMA=DATABASE()) backup_definers ORDER BY objectDefiner");
      if (canonical(definerRows.map(row => row.objectDefiner).sort()) !== canonical([...metadata.definers].sort())) safeError("ISOLATED_RESTORE_DEFINER_MISMATCH");
      const [accounts] = await connection.query<any[]>("SELECT user,host FROM mysql.user");
      const accountSet = new Set(accounts.map(row => `${row.user}@${row.host}`));
      if (definerRows.some(row => !accountSet.has(String(row.objectDefiner).slice(String(row.objectDefiner).lastIndexOf(":") + 1)))) safeError("ISOLATED_RESTORE_DEFINER_ACCOUNT_MISSING");
      const report = { schema: TARGET.schema, mysqlVersion: identityRows[0].version, fingerprint, tableCount: tables.length, ledgerTail, sourceRowCountDigest: jsonDigest(metadata.rowCounts), restoredRowCountDigest: jsonDigest(counts), definerDigest: jsonDigest(definerRows.map(row => row.objectDefiner).sort()), inventory: { tables: tables.length, ...actual }, foreignKeyViolations: fk };
      return { report, validationId: jsonDigest(report) };
    } finally { await connection.end(); }
  } finally {
    spawnSync("docker", ["rm", "--force", name], { stdio: "ignore" });
    await rm(socketDir, { recursive: true, force: true });
  }
}

async function foreignKeyViolations(connection: Awaited<ReturnType<typeof createConnection>>) {
  const [keys] = await connection.query<any[]>("SELECT TABLE_NAME tableName, CONSTRAINT_NAME constraintName, COLUMN_NAME columnName, REFERENCED_TABLE_NAME parentTable, REFERENCED_COLUMN_NAME parentColumn FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION");
  const groups = new Map<string, any[]>();
  for (const row of keys) { const id = `${row.tableName}\0${row.constraintName}`; groups.set(id, [...(groups.get(id) || []), row]); }
  let violations = 0;
  for (const group of groups.values()) {
    const child = `\`${String(group[0].tableName).replace(/`/g, "``")}\``;
    const parent = `\`${String(group[0].parentTable).replace(/`/g, "``")}\``;
    const join = group.map(row => `p.\`${String(row.parentColumn).replace(/`/g, "``")}\` = c.\`${String(row.columnName).replace(/`/g, "``")}\``).join(" AND ");
    const nonNull = group.map(row => `c.\`${String(row.columnName).replace(/`/g, "``")}\` IS NOT NULL`).join(" AND ");
    const [result] = await connection.query<any[]>(`SELECT COUNT(*) n FROM ${child} c LEFT JOIN ${parent} p ON ${join} WHERE ${nonNull} AND p.\`${String(group[0].parentColumn).replace(/`/g, "``")}\` IS NULL`);
    violations += Number(result[0].n);
  }
  return violations;
}

async function capture() {
  diagnosticPhase = "rc_checkout";
  assertReviewedRcCheckout();
  diagnosticPhase = "key_input";
  let keyHex = await readKeyFromFd3();
  const root = `${process.env.HOME}/.local/share/l4ckos-backups/staging-v2`;
  diagnosticPhase = "artifact_directory";
  await mkdir(root, { recursive: true, mode: 0o700 }); await chmod(root, 0o700);
  const createdAt = new Date().toISOString();
  const stamp = createdAt.replace(/[:.]/g, "-");
    const id = `l4ckos-staging-${stamp}-${randomBytes(4).toString("hex")}-v2`;
  const artifact = `${root}/${id}.enc`;
  const partial = `${artifact}.partial`;
  diagnosticPhase = "railway_ssh_start";
  const child = spawn(RAILWAY, ["ssh", "--project", TARGET.projectId, "--environment", TARGET.environmentId, "--service", TARGET.mysqlServiceId, "--", "bash", "-s"], { cwd: "/tmp", env: { PATH: "/home/yan/.railway/bin:/usr/local/bin:/usr/bin:/bin", HOME: process.env.HOME || "" }, stdio: ["pipe", "pipe", "ignore"] });
  child.stdin.end(REMOTE_EXPORT);
  const closed = new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  const transform = new ExportEncryptor(keyHex, createdAt);
  try {
    diagnosticPhase = "remote_export_pipeline";
    await pipeline(child.stdout, transform, createWriteStream(partial, { flags: "wx", mode: 0o600 }));
    diagnosticPhase = "remote_export_exit";
    const status = await closed;
    if (status !== 0) throw new Error("STAGING_EXPORT_COMMAND_FAILED");
    const result = transform.result();
    diagnosticPhase = "ciphertext_finalize";
    await rename(partial, artifact); await chmod(artifact, 0o600);
    diagnosticPhase = "ciphertext_hash";
    const calculated = await hashFile(artifact);
    if (calculated !== result.sha256) safeError("CIPHERTEXT_HASH_MISMATCH");
    diagnosticPhase = "ciphertext_authentication";
    const authenticated = await authenticateEnvelope(artifact, keyHex);
    if (authenticated.plaintextSha256 !== result.plaintextSha256) safeError("BACKUP_PLAINTEXT_CHECKSUM_MISMATCH");
    diagnosticPhase = "isolated_restore";
    const restored = await restoreAndValidate(artifact, keyHex, result.metadata, `${root}/.restore-socket-${process.pid}`);
    diagnosticPhase = "manifest_write";
    const manifest = {
      format: "L4CKOS-Backup-v2", formatVersion: 2, algorithm: "AES-256-GCM", keyReference: "l4ckos-staging-aes-v2", keyDerivation: "none; 32-byte key provided directly", nonceBytes: 12, tagBytes: 16,
      artifactId: id, artifactSha256: result.sha256, plaintextDumpSha256: result.plaintextSha256, envelopeNonce: result.nonce, authenticationTag: result.tag, authenticatedContextSha256: result.contextSha256, createdAt, sourceProjectId: TARGET.projectId, sourceEnvironmentId: TARGET.environmentId, sourceMysqlServiceId: TARGET.mysqlServiceId, sourceSchema: TARGET.schema,
      sourceFingerprint: PRE, restoreFingerprint: restored.report.fingerprint, restoredIsolated: true, restoreMysqlVersion: restored.report.mysqlVersion, restoredTableCount: restored.report.tableCount,
      checksumsVerified: true, foreignKeyViolations: restored.report.foreignKeyViolations, ledgerTail: restored.report.ledgerTail, validationId: restored.validationId,
      inventory: result.metadata.inventory, definerDigest: restored.report.definerDigest, sourceRowCountDigest: restored.report.sourceRowCountDigest, rowCountDigest: restored.report.restoredRowCountDigest, restoreReport: restored.report,
    };
    if (manifest.restoreFingerprint !== PRE) safeError("ISOLATED_RESTORE_FINGERPRINT_MISMATCH");
    const manifestPath = `${artifact}.manifest.json`;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 }); await chmod(manifestPath, 0o600);
    keyHex = "";
    console.log(JSON.stringify({ status: "BACKUP_V2_CREATED_AND_RESTORED", artifactId: id, artifactPath: artifact, manifestPath, sha256: result.sha256, restoreFingerprint: restored.report.fingerprint, restoreMysqlVersion: restored.report.mysqlVersion, tableCount: restored.report.tableCount, validationId: restored.validationId }));
  } catch (error) {
    keyHex = "";
    child.kill("SIGTERM"); await rm(partial, { force: true }); await rm(artifact, { force: true });
    const status = await closed.catch(() => null);
    const code = status !== null && status !== 0 ? `RAILWAY_CHILD_EXIT_${status}` : safeDiagnosticCode(error);
    throw Object.assign(new Error("STAGING_BACKUP_V2_FAILED"), { backupDiagnostic: formatBackupDiagnostic(diagnosticPhase, code) });
  }
}

export async function verifyCryptoCases() {
  // Targeted crypto failure cases; the MySQL integration harness drives this helper too.
  const key = "ab".repeat(32), wrong = "cd".repeat(32), context: BackupContext = { sourceProjectId: TARGET.projectId, sourceEnvironmentId: TARGET.environmentId, sourceMysqlServiceId: TARGET.mysqlServiceId, sourceSchema: TARGET.schema, createdAt: new Date(0).toISOString(), sourceFingerprint: PRE, inventory: { tables: 1, views: 0, triggers: 0, routines: 0, events: 0, nonInnoDbTables: 0 }, mysqlVersion: "8.4.test" };
  const dir = `/tmp/l4ckos-backup-v2-crypto-${process.pid}`;
  await mkdir(dir, { mode: 0o700 });
  try {
    const path = `${dir}/sample.enc`, payload = Buffer.from("synthetic-only-dump\n");
    const envelope = createEnvelopeHeader(context, key), cipherText = Buffer.concat([envelope.cipher.update(payload), envelope.cipher.final()]), tag = envelope.cipher.getAuthTag();
    await writeFile(path, Buffer.concat([envelope.header, cipherText, tag]), { mode: 0o600 });
    await authenticateEnvelope(path, key);
    for (const [label, mutate, candidateKey] of [["wrong-key", (x: Buffer) => x, wrong], ["tamper", (x: Buffer) => { x[x.length - 20] ^= 1; return x; }, key], ["truncated", (x: Buffer) => x.subarray(0, x.length - 3), key]] as const) {
      const bad = `${dir}/${label}.enc`; await writeFile(bad, mutate(Buffer.from(await readFile(path))), { mode: 0o600 });
      let rejected = false; try { await authenticateEnvelope(bad, candidateKey); } catch (error) { rejected = error instanceof Error; }
      if (!rejected) safeError(`CRYPTO_FAILURE_CASE_NOT_REJECTED_${label.toUpperCase()}`);
    }
    const brokenSource = Readable.from((async function* () { yield Buffer.from("partial"); throw new Error("synthetic-export-failure"); })());
    let rejected = false; try { await import("./staging-backup-v2-crypto").then(m => m.encryptStream(brokenSource, `${dir}/failed.enc`, context, key)); } catch { rejected = true; }
    if (!rejected || await import("node:fs/promises").then(m => m.stat(`${dir}/failed.enc`).then(() => false).catch(() => true)) !== true) safeError("EXPORT_FAILURE_CASE_NOT_REJECTED");
    console.log(JSON.stringify({ status: "BACKUP_V2_CRYPTO_CASES_PASSED", cases: ["correct-key", "wrong-key", "ciphertext-tamper", "truncated-file", "export-stream-failure-no-final-artifact"] }));
  } finally { await rm(dir, { recursive: true, force: true }); }
}

const command = process.argv[2];
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (command === "capture") capture().catch(error => {
    const diagnostic = (error as { backupDiagnostic?: unknown } | null)?.backupDiagnostic;
    console.error(typeof diagnostic === "string" ? diagnostic : formatBackupDiagnostic(diagnosticPhase, safeDiagnosticCode(error)));
    process.exitCode = 1;
  });
  else if (command === "preflight") {
    try { assertReviewedRcCheckout(); console.log(JSON.stringify({ status: "BACKUP_V2_RC_CHECKOUT_READY", baseSha: "88daab3046f5351b6724ad51f69041b4fd896509" })); }
    catch (error) { console.error(error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message) ? error.message : "BACKUP_RC_PREFLIGHT_FAILED"); process.exitCode = 1; }
  }
  else if (command === "test-crypto") verifyCryptoCases().catch(error => { console.error(error instanceof Error ? error.message : "BACKUP_V2_TEST_FAILED"); process.exitCode = 1; });
  else if (command === "test-key-input") verifyKeyInputOnly().catch(error => { console.error(formatBackupDiagnostic("key_input", safeDiagnosticCode(error))); process.exitCode = 1; });
  else safeError("USAGE: tsx scripts/staging-backup-v2.ts preflight|capture|test-crypto|test-key-input");
}
