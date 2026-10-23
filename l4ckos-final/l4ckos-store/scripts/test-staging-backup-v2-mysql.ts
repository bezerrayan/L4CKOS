import { createConnection } from "mysql2/promise";
import { mkdir, chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import { authenticateEnvelope, decryptAuthenticatedStream, encryptStream } from "./staging-backup-v2-crypto";
import { validateRestoredLedger } from "./staging-backup-v2";
import { readStructuralSchema, structuralHash, canonical } from "../database/schema/fingerprint";

const IMAGE = "mysql:8.4.11";
const KEY = "19".repeat(32);
const CONTEXT = { sourceProjectId: "synthetic", sourceEnvironmentId: "isolated", sourceMysqlServiceId: "mysql-8.4", sourceSchema: "l4ckos_backup_fixture", createdAt: new Date(0).toISOString(), sourceFingerprint: "synthetic", inventory: { tables: 6, views: 1, triggers: 1, routines: 1, events: 1, nonInnoDbTables: 0 }, mysqlVersion: "8.4.synthetic" };

function run(args: string[], input?: string) {
  const result = spawnSync(args[0], args.slice(1), { input, encoding: "utf8", stdio: ["pipe", "ignore", "ignore"] });
  if (result.status !== 0) throw new Error("SYNTHETIC_MYSQL_COMMAND_FAILED");
}
async function start(name: string, socketDir: string) {
  run(["docker", "run", "--detach", "--rm", "--name", name, "--network", "none", "--tmpfs", "/var/lib/mysql:rw,nosuid,nodev,size=1g", "--mount", `type=bind,source=${socketDir},target=/run/mysqld`, "--env", "MYSQL_ALLOW_EMPTY_PASSWORD=yes", "--env", "MYSQL_ROOT_HOST=%", IMAGE, "--skip-networking", "--socket=/run/mysqld/mysqld.sock"]);
  for (let i = 0; i < 90; i++) {
    const logs = spawnSync("docker", ["logs", name], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const initialized = `${logs.stdout || ""}${logs.stderr || ""}`.includes("MySQL init process done. Ready for start up.");
    if (initialized && spawnSync("docker", ["exec", name, "mysqladmin", "--protocol=socket", "--socket=/run/mysqld/mysqld.sock", "-uroot", "ping", "--silent"], { stdio: "ignore" }).status === 0) return;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error("SYNTHETIC_MYSQL_START_TIMEOUT");
}
function mysql(name: string, sql: string) { run(["docker", "exec", "-i", name, "mysql", "--protocol=socket", "--socket=/run/mysqld/mysqld.sock", "-uroot", "--binary-mode", "-e", sql]); }
async function acquireReadLock(name: string) {
  const child = spawn("docker", ["exec", "-i", name, "mysql", "--protocol=socket", "--socket=/run/mysqld/mysqld.sock", "-uroot", "--batch", "--skip-column-names", "--silent", "--unbuffered"], { stdio: ["pipe", "pipe", "pipe"] });
  const closed = new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  let resolveMarker!: () => void, rejectMarker!: (error: Error) => void;
  const marker = new Promise<void>((resolve, reject) => { resolveMarker = resolve; rejectMarker = reject; });
  const lines = createInterface({ input: child.stdout! });
  let stderr = "";
  child.stderr!.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
  child.once("close", code => { if (code !== 0) rejectMarker(new Error(`SYNTHETIC_SNAPSHOT_LOCK_CLIENT_EXIT_${code}_${stderr.trim().replace(/\s+/g, " ").slice(0, 300)}`)); });
  lines.on("line", line => { if (line === "L4CKOS_LOCK_ACQUIRED") resolveMarker(); else if (line.startsWith("ERROR")) rejectMarker(new Error("SYNTHETIC_SNAPSHOT_LOCK_FAILED")); });
  child.stdin!.write("FLUSH TABLES WITH READ LOCK;\nSELECT 'L4CKOS_LOCK_ACQUIRED';\n");
  const timeout = setTimeout(() => { child.kill("SIGTERM"); rejectMarker(new Error(`SYNTHETIC_SNAPSHOT_LOCK_TIMEOUT_${stderr.trim().replace(/\s+/g, " ").slice(0, 300)}`)); }, 15000);
  await marker.finally(() => clearTimeout(timeout));
  return { release: async () => { child.stdin!.end("UNLOCK TABLES;\nexit\n"); lines.close(); return closed; }, stop: () => child.kill("SIGTERM") };
}
async function inventory(socketDir: string) {
  const c = await createConnection({ socketPath: `${socketDir}/mysqld.sock`, user: "root", database: CONTEXT.sourceSchema });
  try {
    const structural = structuralHash(await readStructuralSchema(c));
    const [tables] = await c.query<any[]>("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME");
    const counts: Record<string, number> = {};
    for (const { TABLE_NAME: tableName } of tables) {
      const [rows] = await c.query<any[]>(`SELECT COUNT(*) n FROM \`${String(tableName).replace(/`/g, "``")}\``);
      counts[tableName] = Number(rows[0].n);
    }
    const [parentRows] = await c.query<any[]>("SELECT id,label FROM parent ORDER BY id");
    const [childRows] = await c.query<any[]>("SELECT id,parentId,CAST(amount AS CHAR) amount FROM child ORDER BY id");
    const [ledgerRows] = await c.query<any[]>("SELECT id,name FROM _l4ckos_schema_migrations ORDER BY id");
    const [variantRows] = await c.query<any[]>("SELECT id,sku FROM productVariants ORDER BY id");
    const [executionRows] = await c.query<any[]>("SELECT operation,state FROM _l4ckos_schema_executions ORDER BY id");
    const [auditRows] = await c.query<any[]>("SELECT id,note FROM triggerAudit ORDER BY id");
    const [highlightTables] = await c.query<any[]>("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='homeHighlightSettings'");
    const [activeColumns] = await c.query<any[]>("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='productVariants' AND COLUMN_NAME='isActive'");
    const preV6Structure = highlightTables.length === 0 && activeColumns.length === 0;
    const dataDigest = createHash("sha256").update(canonical({ parentRows, childRows, ledgerRows, variantRows, executionRows, auditRows })).digest("hex");
    let oldStatusQueryCode = "NO_ERROR";
    try { await c.query("SELECT name,status FROM _l4ckos_schema_migrations ORDER BY id"); }
    catch (error) { oldStatusQueryCode = String((error as NodeJS.ErrnoException).code || "UNKNOWN"); }
    if (oldStatusQueryCode !== "ER_BAD_FIELD_ERROR") throw new Error("PRE0024_OLD_LEDGER_QUERY_NOT_REPRODUCED");
    const ledgerTail = await validateRestoredLedger(c);
    const [objects] = await c.query<any[]>("SELECT (SELECT COUNT(*) FROM information_schema.VIEWS WHERE TABLE_SCHEMA=DATABASE()) views,(SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()) triggers,(SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=DATABASE()) routines,(SELECT COUNT(*) FROM information_schema.EVENTS WHERE EVENT_SCHEMA=DATABASE()) events");
    const [definers] = await c.query<any[]>("SELECT CONCAT(kind,':',objectName,':',definer) objectDefiner FROM (SELECT 'VIEW' kind,TABLE_NAME objectName,DEFINER definer FROM information_schema.VIEWS WHERE TABLE_SCHEMA=DATABASE() UNION ALL SELECT 'TRIGGER',TRIGGER_NAME,DEFINER FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() UNION ALL SELECT ROUTINE_TYPE,ROUTINE_NAME,DEFINER FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=DATABASE() UNION ALL SELECT 'EVENT',EVENT_NAME,DEFINER FROM information_schema.EVENTS WHERE EVENT_SCHEMA=DATABASE()) backup_definers ORDER BY objectDefiner");
    const [accounts] = await c.query<any[]>("SELECT user,host FROM mysql.user");
    const accountSet = new Set(accounts.map(row => `${row.user}@${row.host}`));
    const missingDefiners = definers.map(row => String(row.objectDefiner).slice(String(row.objectDefiner).lastIndexOf(":") + 1)).filter(definer => !accountSet.has(definer));
    const [fk] = await c.query<any[]>("SELECT COUNT(*) n FROM child c LEFT JOIN parent p ON p.id=c.parentId WHERE c.parentId IS NOT NULL AND p.id IS NULL");
    return { structural, counts, dataDigest, objects: objects[0], definers: definers.map(row => row.objectDefiner).sort(), missingDefiners, fk: Number(fk[0].n), preV6Structure, ledgerTail };
  } finally { await c.end(); }
}

async function main() {
  const dir = await mkdtemp(path.join(tmpdir(), "l4ckos-backup-v2-mysql-"));
  const sourceSocket = path.join(dir, "src"), restoreSocket = path.join(dir, "dst"), artifact = path.join(dir, "synthetic.enc");
  const sourceName = `l4ckos-bkp-src-${process.pid}`, restoreName = `l4ckos-bkp-dst-${process.pid}`;
  let snapshotLock: Awaited<ReturnType<typeof acquireReadLock>> | undefined;
  await mkdir(sourceSocket, { mode: 0o777 }); await mkdir(restoreSocket, { mode: 0o777 }); await chmod(sourceSocket, 0o777); await chmod(restoreSocket, 0o777);
  try {
    await start(sourceName, sourceSocket); await start(restoreName, restoreSocket);
    const ledgerDdl = await readFile(new URL("../database/governance/ledger.sql", import.meta.url), "utf8");
    const executionsDdl = await readFile(new URL("../database/governance/executions.sql", import.meta.url), "utf8");
    mysql(sourceName, `CREATE DATABASE ${CONTEXT.sourceSchema}; USE ${CONTEXT.sourceSchema};
      CREATE TABLE parent(id INT PRIMARY KEY, label VARCHAR(32) NOT NULL) ENGINE=InnoDB;
      CREATE TABLE child(id INT PRIMARY KEY, parentId INT NOT NULL, amount DECIMAL(10,2) NOT NULL, CONSTRAINT fk_child_parent FOREIGN KEY(parentId) REFERENCES parent(id)) ENGINE=InnoDB;
      CREATE TABLE productVariants(id INT PRIMARY KEY, sku VARCHAR(32) NOT NULL UNIQUE) ENGINE=InnoDB;
      CREATE TABLE triggerAudit(id INT PRIMARY KEY, note VARCHAR(32) NOT NULL) ENGINE=InnoDB;
      ${ledgerDdl}
      ${executionsDdl}
      CREATE VIEW parent_view AS SELECT id,label FROM parent;
      CREATE TRIGGER child_audit AFTER INSERT ON child FOR EACH ROW INSERT INTO triggerAudit VALUES (NEW.id, 'trigger-ran');
      CREATE PROCEDURE fixture_routine() SELECT COUNT(*) FROM child;
      CREATE EVENT fixture_event ON SCHEDULE AT CURRENT_TIMESTAMP + INTERVAL 1 DAY DO INSERT INTO triggerAudit VALUES (999,'event-ran');
      INSERT INTO _l4ckos_schema_migrations (name,kind,checksum,applicationCommit,description,preFingerprint,postFingerprint,manifestVersion,runnerVersion,executionDurationMs) VALUES ('0023_asaas_webhook_inbox','MIGRATION',REPEAT('a',64),REPEAT('b',40),'synthetic pre-v6 ledger fixture',REPEAT('c',64),REPEAT('d',64),2,'fixture',0);
      INSERT INTO _l4ckos_schema_executions (operation,checksum,applicationCommit,state,preFingerprint) VALUES ('0023_asaas_webhook_inbox',REPEAT('a',64),REPEAT('b',40),'COMPLETED',REPEAT('c',64));
      INSERT INTO parent VALUES (1,'synthetic'),(2,'fixture'); INSERT INTO child VALUES (10,1,12.34),(11,2,56.78); INSERT INTO productVariants VALUES (1,'SYNTHETIC-SKU');`);
    snapshotLock = await acquireReadLock(sourceName);
    const before = await inventory(sourceSocket);
    if (before.counts.parent !== 2 || before.counts.child !== 2 || before.counts.productVariants !== 1 || before.counts._l4ckos_schema_migrations !== 1 || before.counts._l4ckos_schema_executions !== 1 || before.preV6Structure !== true || before.ledgerTail !== "0023_asaas_webhook_inbox" || before.fk !== 0 || before.objects.views !== 1 || before.objects.triggers !== 1 || before.objects.routines !== 1 || before.objects.events !== 1) throw new Error("SYNTHETIC_SOURCE_FIXTURE_INVALID");
    const blockedWrite = spawn("docker", ["exec", sourceName, "mysql", "--protocol=socket", "--socket=/run/mysqld/mysqld.sock", "-uroot", "-e", `INSERT INTO ${CONTEXT.sourceSchema}.parent VALUES (99,'after snapshot')`], { stdio: "ignore" });
    const blockedWriteClosed = new Promise<number | null>(resolve => blockedWrite.once("close", resolve));
    await new Promise(resolve => setTimeout(resolve, 250));
    if (blockedWrite.exitCode !== null) throw new Error("SYNTHETIC_GLOBAL_READ_LOCK_DID_NOT_BLOCK_WRITES");
    const dump = spawn("docker", ["exec", sourceName, "mysqldump", "--protocol=socket", "--socket=/run/mysqld/mysqld.sock", "-uroot", "--single-transaction", "--quick", "--lock-tables=false", "--routines", "--triggers", "--events", "--hex-blob", "--default-character-set=utf8mb4", "--set-gtid-purged=OFF", "--column-statistics=0", "--databases", CONTEXT.sourceSchema], { stdio: ["ignore", "pipe", "pipe"] });
    const dumpClosed = new Promise<number | null>((resolve, reject) => { dump.once("error", reject); dump.once("close", resolve); });
    let dumpError = ""; dump.stderr!.setEncoding("utf8").on("data", chunk => { dumpError += chunk; });
    const encrypted = await encryptStream(dump.stdout!, artifact, CONTEXT, KEY);
    const dumpExit = await dumpClosed;
    if (dumpExit !== 0) throw new Error(`SYNTHETIC_EXPORT_FAILED_${dumpError.trim().replace(/\s+/g, " ").slice(0, 300)}`);
    if (await snapshotLock.release() !== 0) throw new Error("SYNTHETIC_SNAPSHOT_LOCK_RELEASE_FAILED");
    snapshotLock = undefined;
    if (await blockedWriteClosed !== 0) throw new Error("SYNTHETIC_BLOCKED_WRITE_DID_NOT_RESUME");
    await authenticateEnvelope(artifact, KEY);
    const load = spawn("docker", ["exec", "-i", restoreName, "mysql", "--protocol=socket", "--socket=/run/mysqld/mysqld.sock", "-uroot", "--binary-mode"], { stdio: ["pipe", "ignore", "pipe"] });
    const loadClosed = new Promise<number | null>((resolve, reject) => { load.once("error", reject); load.once("close", resolve); });
    let loadError = ""; load.stderr!.setEncoding("utf8").on("data", chunk => { loadError += chunk; });
    await decryptAuthenticatedStream(artifact, KEY, load.stdin!);
    const loadCode = await loadClosed;
    if (loadCode !== 0) {
      const logs = spawnSync("docker", ["logs", "--tail", "8", restoreName], { encoding: "utf8" });
      throw new Error(`SYNTHETIC_RESTORE_FAILED_${loadCode}_${loadError.trim().replace(/\s+/g, " ").slice(0, 300)}_${String(logs.stdout || logs.stderr).replace(/\s+/g, " ").slice(-600)}`);
    }
    const after = await inventory(restoreSocket);
    if (before.structural !== after.structural || canonical(before.counts) !== canonical(after.counts) || before.dataDigest !== after.dataDigest || canonical(before.objects) !== canonical(after.objects) || canonical(before.definers) !== canonical(after.definers) || before.missingDefiners.length || after.missingDefiners.length || before.preV6Structure !== true || after.preV6Structure !== true || before.ledgerTail !== "0023_asaas_webhook_inbox" || after.ledgerTail !== "0023_asaas_webhook_inbox" || after.fk !== 0) throw new Error("SYNTHETIC_RESTORE_VALIDATION_FAILED");
    const ciphertextSha256 = createHash("sha256").update(await (await import("node:fs/promises")).readFile(artifact)).digest("hex");
    console.log(JSON.stringify({ status: "BACKUP_V2_MYSQL_PRE0024_RESTORE_PASSED", image: IMAGE, sourceAndRestoreFingerprint: after.structural, tables: Object.keys(after.counts).length, preV6StructurePreserved: after.preV6Structure, ledgerTail: after.ledgerTail, oldLedgerStatusQuery: "ER_BAD_FIELD_ERROR_REPRODUCED", ledgerValidation: "PASSED", rowCountDigest: createHash("sha256").update(canonical(after.counts)).digest("hex"), syntheticDataDigest: after.dataDigest, objects: after.objects, foreignKeyViolations: after.fk, ciphertextSha256: encrypted.sha256 === ciphertextSha256 }));
  } finally {
    snapshotLock?.stop();
    spawnSync("docker", ["rm", "--force", sourceName], { stdio: "ignore" }); spawnSync("docker", ["rm", "--force", restoreName], { stdio: "ignore" });
    await rm(dir, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "BACKUP_V2_MYSQL_TEST_FAILED"); process.exitCode = 1; });
