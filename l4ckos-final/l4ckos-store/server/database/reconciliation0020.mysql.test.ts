import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import type { Connection } from "mysql2/promise";
import type * as mysqlOrm from "drizzle-orm/mysql2";
import { openBackupConnection, backupDatabase, restoreDatabase } from "./backupRestore";
import { bootstrapArtifacts, readContract, readRecognizedExistingContract, ROOT } from "../../database/schema/artifacts";
import { quote, rows, sha256, readStructuralSchema, structuralHash } from "../../database/schema/fingerprint";
import { loadLineage, migrateDatabase as migrateForwardDatabase, type LineageManifest } from "../../database/migrations/runner";
import { baselineDatabase } from "../../database/schema/baseline";
import { bootstrapDatabase } from "../../database/bootstrap/bootstrap";
import { ledgerRows, type OperationContext } from "../../database/schema/governance";

// Only connection construction is substituted; the real ORM executes against MySQL.
// No provider module or business handler is invoked.
const injected = vi.hoisted(() => ({ orm: null as unknown, corruptSql: false }));
vi.mock("drizzle-orm/mysql2", async importOriginal => ({
  ...await importOriginal<typeof mysqlOrm>(), drizzle: () => injected.orm,
}));
vi.mock("../../database/schema/artifacts", async importOriginal => {
  const original = await importOriginal<typeof import("../../database/schema/artifacts")>();
  return { ...original, readArtifact: async (...args: Parameters<typeof original.readArtifact>) => {
    const bytes = await original.readArtifact(...args);
    // A single changed byte of the versioned SQL, without touching the working tree.
    if (injected.corruptSql && args[0] === "database/migrations/0020_reconcile_asaas_webhook_events.sql") {
      const changed = Buffer.from(bytes); changed[changed.length - 1] ^= 1; return changed;
    }
    return bytes;
  } };
});
async function migrateDatabase(c: Connection, ctx: OperationContext, manifest?: LineageManifest) {
  const historical=JSON.parse(await readFile(`${ROOT}/database/migrations/manifest.json`,"utf8")) as LineageManifest;
  return migrateForwardDatabase(c,ctx,manifest??{...historical,migrations:[]});
}
const migrationName = "0020_reconcile_asaas_webhook_events";
const socketPath = process.env.L4CKOS_LOCAL_MYSQL_SOCKET ?? "/tmp/l4ckos-reconciliation-socket/mysqld.sock";
const applicationCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
let root: Connection;
let success: Connection;
let successContext: OperationContext;
const connections: Connection[] = [];
const databases: string[] = [];
const expectedPre = "09f647cdda027984d3425bef6ccee9cb3496a648602515b0930465b7b02d9efe";
const expectedPost = "f2baf7519cb425c955bfd0f697da10afa670ee57763e3f641b61a09ba75b7f8d";
async function database(suffix: string, preState = true) {
  const name = `l4ckos_test_0020_${suffix}`;
  await root.query(`CREATE DATABASE ${quote(name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  databases.push(name);
  const url = `mysql://root@localhost/${name}`;
  const c = await openBackupConnection(url, socketPath); connections.push(c);
  const ctx: OperationContext = { url, socketPath, applicationCommit, approvedFingerprint: expectedPost, lockTimeoutSeconds: 0 };
  if (preState) {
    // Explicit derivation: approved bootstrap minus exactly one named CREATE.
    const artifacts = await bootstrapArtifacts();
    expect(artifacts.statements.filter(e => e.table === "asaasWebhookEvents")).toHaveLength(1);
    for (const entry of artifacts.statements) if (entry.table !== "asaasWebhookEvents") await c.query(entry.sql);
    expect(structuralHash(await readStructuralSchema(c))).toBe(expectedPre);
  }
  return { c, ctx };
}
const fingerprint = async (c: Connection) => structuralHash(await readStructuralSchema(c));
async function noGovernance(c: Connection) { expect((await readStructuralSchema(c, true)).tables).toHaveLength(0); }

describe("0020 reviewed artifact", () => {
  it("is byte-identical to the canonical CREATE, with exact checksum and no business DML", async () => {
    const lineage = await loadLineage();
    expect(lineage.entries.map(e=>e.name)).toEqual(["0021_preorder_production_batches"]);
    expect(lineage.reconciliations).toHaveLength(1);
    const entry = lineage.reconciliations[0];
    const sql = await readFile(`${ROOT}/${entry.path}`);
    expect(sql.equals(await readFile(`${ROOT}/database/bootstrap/v1/asaasWebhookEvents.sql`))).toBe(true);
    expect(entry).toMatchObject({ name: migrationName, kind: "RECONCILIATION", expectedPreFingerprint: expectedPre, expectedPostFingerprint: expectedPost, checksum: sha256(sql) });
    expect(entry.statements).toHaveLength(1);
    expect(sql.toString()).toMatch(/^CREATE TABLE `asaasWebhookEvents`/);
    expect(sql.toString()).not.toMatch(/\b(?:IF NOT EXISTS|INSERT|UPDATE\s+\w+\s+SET|DELETE|DROP|ALTER|RENAME)\b/i);
    expect((await readdir(`${ROOT}/drizzle`)).filter(n => /^00(?:0\d|1\d).*\.sql$/.test(n))).toHaveLength(20);
    const contract = await readContract();
    const pre = await readRecognizedExistingContract();
    expect(pre.schema).toEqual({ ...contract.schema, tables: contract.schema.tables.filter(t => t.name !== "asaasWebhookEvents") });
  });
  it("rejects a one-byte SQL change against the manifest checksum", async () => {
    injected.corruptSql = true;
    try { await expect(loadLineage()).rejects.toThrow("MIGRATION_CHECKSUM_MISMATCH"); }
    finally { injected.corruptSql = false; }
  });
});

describe.skipIf(process.env.L4CKOS_MYSQL_TEST !== "1")("MySQL 8.4 first reconciliation 0020", () => {
  beforeAll(async () => {
    process.env.L4CKOS_LOCAL_SCHEMA = "1";
    process.env.L4CKOS_LOCAL_RESTORE = "1";
    root = await openBackupConnection("mysql://root@localhost/mysql", socketPath);
    expect(String((await rows(root, "SELECT VERSION() version"))[0].version)).toMatch(/^8\.4\./);
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    for (const c of connections) await c.end();
    for (const name of databases) await root.query(`DROP DATABASE ${quote(name)}`);
    await root?.end();
  });
  it("creates only the missing table, accepts canonical baseline and records real facts once", async () => {
    const { c, ctx } = await database("success"); success = c; successContext = ctx;
    const before = await readStructuralSchema(c);
    expect(await migrateDatabase(c, ctx)).toEqual({ status: "APPLIED", applied: [migrationName], fingerprint: expectedPost });
    const after = await readStructuralSchema(c);
    expect({ ...after, tables: after.tables.filter(t => t.name !== "asaasWebhookEvents") }).toEqual(before);
    expect(Number((await rows(c, "SELECT COUNT(*) n FROM asaasWebhookEvents"))[0].n)).toBe(0);
    const history = await ledgerRows(c);
    expect(history.map(r => [r.name, r.kind])).toEqual([[migrationName, "RECONCILIATION"], ["baseline-v1", "BASELINE"]]);
    expect(history[0]).toMatchObject({ preFingerprint: expectedPre, postFingerprint: expectedPost, checksum: (await loadLineage()).reconciliations[0].checksum });
    expect(history[1].description).toContain("canonical-v1 validated and accepted as initial trusted governance point");
    expect(history[1].description).toContain("no legacy execution claims");
    expect((await baselineDatabase(c, ctx)).status).toBe("ALREADY_BASELINED");
    const originalQuery = c.query.bind(c);
    const spy = vi.spyOn(c, "query");
    expect(await migrateDatabase(c, ctx)).toEqual({ status: "UP_TO_DATE", applied: [], fingerprint: expectedPost });
    expect(spy.mock.calls.some(args => typeof args[0] === "string" && /^CREATE|^ALTER|^INSERT/i.test(args[0]))).toBe(false);
    spy.mockRestore(); c.query = originalQuery;
    expect(await ledgerRows(c)).toEqual(history);
    const trail = await rows(c, "SELECT operation, state, completedStatements FROM _l4ckos_schema_executions ORDER BY id");
    expect(trail).toMatchObject([{ operation: migrationName, state: "COMPLETED", completedStatements: 1 }, { operation: "baseline-v1", state: "COMPLETED", completedStatements: 0 }]);
    console.log(`0020 real pre/post: ${expectedPre} -> ${expectedPost}; 1 RECONCILIATION + 1 BASELINE; no legacy entries`);
  });
  it("fails before DDL for an existing unexpected webhook table, wrong pre-state and unknown table", async () => {
    for (const [suffix, sql] of [
      ["existing", "CREATE TABLE asaasWebhookEvents (id int PRIMARY KEY) ENGINE=InnoDB"],
      ["wrong_pre", "ALTER TABLE orderItems MODIFY unitPrice bigint NOT NULL"],
      ["unknown", "CREATE TABLE foo (id int PRIMARY KEY) ENGINE=InnoDB"],
    ]) {
      const { c, ctx } = await database(suffix); await c.query(sql);
      const before = await fingerprint(c);
      await expect(migrateDatabase(c, ctx)).rejects.toThrow("RECONCILIATION_PREFINGERPRINT_MISMATCH");
      expect(await fingerprint(c)).toBe(before); await noGovernance(c);
    }
  });
  it("refuses checksum corruption before governance/DDL, without updating approved checksum", async () => {
    const { c, ctx } = await database("checksum");
    injected.corruptSql = true;
    try { await expect(migrateDatabase(c, ctx)).rejects.toThrow("MIGRATION_CHECKSUM_MISMATCH"); }
    finally { injected.corruptSql = false; }
    expect(await fingerprint(c)).toBe(expectedPre); await noGovernance(c);
  });
  it("serializes two instances on the same lock and runs CREATE exactly once", async () => {
    const { c, ctx } = await database("concurrent");
    const second = await openBackupConnection(ctx.url, socketPath); connections.push(second);
    const original = c.query.bind(c);
    let release!: () => void; let reached!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const started = new Promise<void>(r => { reached = r; });
    let ddlCount = 0;
    c.query = (async (...args: any[]) => {
      if (typeof args[0] === "string" && args[0].startsWith("CREATE TABLE `asaasWebhookEvents`")) { ddlCount++; reached(); await gate; }
      return (original as any)(...args);
    }) as typeof c.query;
    const first = migrateDatabase(c, ctx);
    await started;
    try { await expect(migrateDatabase(second, ctx)).rejects.toThrow("SCHEMA_LOCK_UNAVAILABLE"); }
    finally { release(); c.query = original; }
    expect((await first).status).toBe("APPLIED");
    expect(ddlCount).toBe(1);
    expect((await migrateDatabase(second, ctx)).status).toBe("UP_TO_DATE");
    expect(await ledgerRows(c)).toHaveLength(2);
  });
  it("postcondition drift preserves execution evidence and no success/baseline, refusing retry", async () => {
    const { c, ctx } = await database("post_failure");
    const original = c.query.bind(c);
    c.query = (async (...args: any[]) => {
      const result = await (original as any)(...args);
      if (typeof args[0] === "string" && args[0].startsWith("CREATE TABLE `asaasWebhookEvents`")) await original("ALTER TABLE asaasWebhookEvents ADD recoveryProbe int");
      return result;
    }) as typeof c.query;
    try { await expect(migrateDatabase(c, ctx)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED", evidence: { completedStatements: 1 } }); }
    finally { c.query = original; }
    expect(await ledgerRows(c)).toHaveLength(0);
    expect((await rows(c, "SELECT state, completedStatements, errorCode FROM _l4ckos_schema_executions"))[0]).toMatchObject({ state: "FAILED", completedStatements: 1, errorCode: "RECOVERY_REQUIRED" });
    await expect(migrateDatabase(c, ctx)).rejects.toThrow("RECOVERY_REQUIRED");
  });
  it("a CREATE committed before lost acknowledgement leaves evidence and blocks blind retry", async () => {
    const { c, ctx } = await database("uncertain_ddl");
    const original = c.query.bind(c);
    c.query = (async (...args: any[]) => {
      const result = await (original as any)(...args);
      if (typeof args[0] === "string" && args[0].startsWith("CREATE TABLE `asaasWebhookEvents`")) throw new Error("synthetic lost DDL acknowledgement");
      return result;
    }) as typeof c.query;
    try { await expect(migrateDatabase(c, ctx)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED", evidence: { completedStatements: 0 } }); }
    finally { c.query = original; }
    expect(await fingerprint(c)).toBe(expectedPost);
    expect(await ledgerRows(c)).toHaveLength(0);
    expect((await rows(c, "SELECT state, observedFingerprint FROM _l4ckos_schema_executions"))[0]).toMatchObject({ state: "FAILED", observedFingerprint: expectedPost });
    await expect(migrateDatabase(c, ctx)).rejects.toThrow("RECOVERY_REQUIRED");
  });
  it("runAsaasWebhookOnce uses the real ORM for processing/processed/failed and duplicate eventId", async () => {
    const actual = await vi.importActual<typeof mysqlOrm>("drizzle-orm/mysql2");
    injected.orm = actual.drizzle(success);
    vi.stubEnv("DATABASE_URL", successContext.url);
    const { runAsaasWebhookOnce } = await import("../db");
    const input = { eventId: "synthetic-first", eventType: "SYNTHETIC_TEST", payload: { synthetic: true } };
    let runs = 0;
    expect(await runAsaasWebhookOnce(input, async () => {
      runs++;
      expect((await rows(success, "SELECT status FROM asaasWebhookEvents WHERE eventId=?", [input.eventId]))[0].status).toBe("processing");
      return "local-success";
    })).toEqual({ duplicate: false, result: "local-success" });
    expect((await rows(success, "SELECT status, processedAt, payloadHash FROM asaasWebhookEvents WHERE eventId=?", [input.eventId]))[0]).toMatchObject({ status: "processed", payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/), processedAt: expect.any(String) });
    expect(await runAsaasWebhookOnce(input, async () => { runs++; })).toEqual({ duplicate: true });
    expect(runs).toBe(1);
    const failed = { ...input, eventId: "synthetic-failed" };
    await expect(runAsaasWebhookOnce(failed, async () => { throw new Error("synthetic handler failure"); })).rejects.toThrow("synthetic handler failure");
    expect((await rows(success, "SELECT status, processedAt FROM asaasWebhookEvents WHERE eventId=?", [failed.eventId]))[0]).toMatchObject({ status: "failed", processedAt: null });
    expect(await runAsaasWebhookOnce(failed, async () => "recovered")).toEqual({ duplicate: false, result: "recovered" });
    expect((await rows(success, "SELECT status FROM asaasWebhookEvents WHERE eventId=?", [failed.eventId]))[0].status).toBe("processed");
    expect(await fingerprint(success)).toBe(expectedPost);
  });
  it("reconciled 26-table fixture backs up and restores webhook rows into fresh canonical DB", async () => {
    const { c: source, ctx } = await database("backup_source");
    await migrateDatabase(source, ctx);
    for (const entry of (await bootstrapArtifacts()).statements) {
      const row: Record<string, unknown> = {};
      for (const col of await rows(source, `SHOW FULL COLUMNS FROM ${quote(entry.table)}`)) {
        const type = String(col.Type);
        row[col.Field] = col.Null === "YES" ? null : type.startsWith("int") ? 1 : type.startsWith("timestamp") ? "2026-10-05 12:00:00" : type.startsWith("enum") ? type.match(/^enum\('([^']+)'/)![1] : "synthetic".slice(0, Number(type.match(/varchar\((\d+)\)/)?.[1] || 255));
      }
      if (entry.table === "orders") row.totalPrice = 17970;
      if (entry.table === "orderItems") Object.assign(row, { unitPrice: 5990, quantity: 3, totalPrice: 17970 });
      if (entry.table === "stockReservations") Object.assign(row, { status: "restocked", quantity: 3, orderItemId: 1 });
      if (entry.table === "auditLogs") Object.assign(row, { actorUserId: null, actorType: "system", orderId: 1, paymentId: 1 });
      if (entry.table === "paymentEvents") Object.assign(row, { orderId: 1, paymentId: 1 });
      if (entry.table === "notificationOutbox") Object.assign(row, { orderId: 1, paymentId: 1, status: "sent", attempts: 4, sentAt: "2026-10-05 12:00:00" });
      if (entry.table === "orderEmailEvents") Object.assign(row, { status: "sent", attemptCount: 3, providerMessageId: "synthetic-provider", processingToken: "synthetic-lease", scheduledAt: "2026-10-05 12:00:00", sentAt: "2026-10-05 12:00:00" });
      if (entry.table === "asaasWebhookEvents") Object.assign(row, { eventId: "synthetic-backup", status: "processed", payloadHash: sha256("synthetic"), processedAt: "2026-10-05 12:00:00" });
      await source.query(`INSERT INTO ${quote(entry.table)} (${Object.keys(row).map(quote)}) VALUES (${Object.keys(row).map(() => "?")})`, Object.values(row));
    }
    const { c: target, ctx: targetContext } = await database("backup_target", false);
    await bootstrapDatabase(target, targetContext);
    const backup = await backupDatabase(source);
    expect(backup.tables.asaasWebhookEvents.rowCount).toBe(1);
    expect(await restoreDatabase(target, JSON.parse(JSON.stringify(backup)), targetContext)).toEqual({ tables: 26, rows: 26 });
    const restored = await backupDatabase(target);
    for (const [table, artifact] of Object.entries(backup.tables)) expect(restored.tables[table].checksum).toBe(artifact.checksum);
    expect(await fingerprint(source)).toBe(expectedPost); expect(await fingerprint(target)).toBe(expectedPost);
    expect(await ledgerRows(source)).toHaveLength(2); expect(await ledgerRows(target)).toHaveLength(1);
    console.log("0020 backup round-trip: 26 tables / 26 rows; webhook included; exact checksums and canonical fingerprints; governance records remain independent");
  });
});
