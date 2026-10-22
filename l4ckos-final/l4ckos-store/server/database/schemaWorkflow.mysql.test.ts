import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Connection } from "mysql2/promise";
import audited from "../../docs/database/audited-physical-schema.json";
import { openBackupConnection, backupDatabase, restoreDatabase } from "./backupRestore";
import { readContract, readReleaseContract, bootstrapArtifacts, ROOT } from "../../database/schema/artifacts";
import { normalizeDefault, normalizeExtra, normalizePreorderV7CheckClause, readStructuralSchema, sha256, structuralHash, quote, rows } from "../../database/schema/fingerprint";
import { assertLocalSchemaTarget, safeDiagnosticCause, SchemaError } from "../../database/schema/safety";
import { baselineDatabase } from "../../database/schema/baseline";
import { bootstrapDatabase } from "../../database/bootstrap/bootstrap";
import { migrateDatabase, loadLineage, type LineageManifest } from "../../database/migrations/runner";
import { ledgerRows, type OperationContext } from "../../database/schema/governance";

const socketPath = process.env.L4CKOS_LOCAL_MYSQL_SOCKET ?? "/tmp/l4ckos-reconciliation-socket/mysqld.sock";
const url = (name: string) => `mysql://root@localhost/${name}`;
const runId = randomUUID().replaceAll("-", "").slice(0, 12);
const schemaName = (suffix: string) => `l4ckos_test_workflow_${runId}_${suffix}`;
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
let root: Connection;
let expected: Awaited<ReturnType<typeof readContract>>;
let fresh1: Connection;
let fresh2: Connection;
const databases: string[] = [];
const connections: Connection[] = [];
const context = (name: string): OperationContext => ({ url: url(name), socketPath, applicationCommit: commit, approvedFingerprint: expected.fingerprint, lockTimeoutSeconds: 0 });
async function database(suffix: string) {
  const name = schemaName(suffix);
  await root.query(`CREATE DATABASE ${quote(name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  databases.push(name);
  const c = await openBackupConnection(url(name), socketPath);
  connections.push(c);
  return { c, ctx: context(name) };
}
async function rawCanonical(c: Connection) {
  for (const entry of (await bootstrapArtifacts()).statements) await c.query(entry.sql);
}
async function historySize(c: Connection) { return (await ledgerRows(c)).length; }
async function fixtureManifest(post: string, partial = false): Promise<LineageManifest> {
  const path = `database/migrations/fixtures/${partial ? "test-partial-failure" : "test-add-column"}.sql`;
  return { version: 2, migrations: [{ name: partial ? "test_partial_failure" : "test_add_column", kind: "MIGRATION", path, checksum: sha256(await readFile(`${ROOT}/${path}`)), description: "Local test only; never in production lineage", expectedPreFingerprint: expected.fingerprint, expectedPostFingerprint: post }] };
}
async function postFingerprint(suffix = "post_probe") {
  const { c } = await database(suffix);
  await rawCanonical(c);
  await c.query(await readFile(`${ROOT}/database/migrations/fixtures/test-add-column.sql`, "utf8"));
  return structuralHash(await readStructuralSchema(c));
}

describe("local schema safety and reviewed artifacts", () => {
  it("normalizes temporal expressions without changing textual defaults or precision", () => {
    expect(normalizeDefault("now()", "timestamp")).toBe(normalizeDefault("CURRENT_TIMESTAMP", "timestamp"));
    expect(normalizeDefault("(now())", "timestamp")).toBe("CURRENT_TIMESTAMP(0)");
    expect(normalizeDefault("CURRENT_TIMESTAMP(3)", "timestamp(3)")).toBe("CURRENT_TIMESTAMP(3)");
    expect(normalizeDefault("now()", "varchar(30)")).toBe("now()");
    expect(normalizeExtra("DEFAULT_GENERATED on update CURRENT_TIMESTAMP(3)")).toBe("on update CURRENT_TIMESTAMP(3)");
    expect(normalizeExtra("on update current_timestamp()")).toBe("on update CURRENT_TIMESTAMP(0)");
    expect(normalizeExtra("auto_increment")).toBe("auto_increment");
    expect(structuralHash({ type: "timestamp(3)", datetimePrecision: 3, extra: normalizeExtra("on update CURRENT_TIMESTAMP(3)") }))
      .not.toBe(structuralHash({ type: "timestamp", datetimePrecision: 0, extra: normalizeExtra("on update CURRENT_TIMESTAMP(0)") }));
  });
  it("canonicalizes MySQL v7 CHECK serialization while retaining condition semantics", () => {
    const cases = [
      [
        "(`salesState` in ('review_required','accepting','sales_closed','settling','consolidated','reconciliation_required'))",
        "(`salesState` in (_utf8mb4'review_required',_utf8mb4'accepting',_utf8mb4'sales_closed',_utf8mb4'settling',_utf8mb4'consolidated',_utf8mb4'reconciliation_required'))",
      ],
      [
        "((`paymentMethod` = 'CARD' and `commercialExpiresAt` is null) or (`paymentMethod` in ('PIX','BOLETO') and `commercialExpiresAt` is not null))",
        "(((`paymentMethod` = _utf8mb4'CARD') and (`commercialExpiresAt` is null)) or ((`paymentMethod` in (_utf8mb4'PIX',_utf8mb4'BOLETO')) and (`commercialExpiresAt` is not null)))",
      ],
      [
        "((`state` = 'exception' and `reconciliationCode` is not null) or (`state` <> 'exception' and `reconciliationCode` is null))",
        "(((`state` = _utf8mb4'exception') and (`reconciliationCode` is not null)) or ((`state` <> _utf8mb4'exception') and (`reconciliationCode` is null)))",
      ],
      [
        "(`paymentMethod` in ('PIX','CARD','BOLETO'))",
        "(`paymentMethod` in (_utf8mb4'PIX',_utf8mb4'CARD',_utf8mb4'BOLETO'))",
      ],
      [
        "(`state` in ('active','allocated','released','expired','exception'))",
        "(`state` in (_utf8mb4'active',_utf8mb4'allocated',_utf8mb4'released',_utf8mb4'expired',_utf8mb4'exception'))",
      ],
    ] as const;
    for (const [expected, mysql] of cases) {
      expect(normalizePreorderV7CheckClause(mysql)).toBe(expected);
      expect(normalizePreorderV7CheckClause(mysql.replace(/'/g, "\\'"))).toBe(expected);
    }
    expect(normalizePreorderV7CheckClause(cases[3][1].replace("'BOLETO'", "'CASH'"))).not.toBe(cases[3][0]);
    expect(normalizePreorderV7CheckClause("(`quantity` > 0)")).not.toBe(normalizePreorderV7CheckClause("(`quantity` >= 0)"));
    expect(normalizePreorderV7CheckClause("(`quantity` between 1 and 10)")).toBe("(`quantity` between 1 and 10)");
    expect(normalizePreorderV7CheckClause("(`a` = 1 and (`b` = 2 or `c` = 3))"))
      .not.toBe(normalizePreorderV7CheckClause("((`a` = 1 and `b` = 2) or `c` = 3)"));
  });
  it("keeps a sanitized cause chain when recovery evidence cannot be fingerprinted", () => {
    const driver = Object.assign(new Error("query failed: mysql://secret@example.invalid/db"), { code: "ER_PARSE_ERROR" });
    const root = new Error("UNSUPPORTED_PREORDER_V7_CHECK_EXPRESSION", { cause: driver });
    const wrapped = new SchemaError("RECOVERY_REQUIRED", undefined, { cause: safeDiagnosticCause(root) });
    expect(wrapped.code).toBe("RECOVERY_REQUIRED");
    const cause = wrapped.cause as Error;
    expect(cause.message).toBe("UNSUPPORTED_PREORDER_V7_CHECK_EXPRESSION");
    expect((cause.cause as Error).message).toBe("ER_PARSE_ERROR");
    expect(`${cause.message}:${(cause.cause as Error).message}`).not.toContain("secret");
  });
  it("keeps every v6 physical extra value stable under the corrected normalizer", async () => {
    expect((await readContract()).fingerprint).toBe("f2baf7519cb425c955bfd0f697da10afa670ee57763e3f641b61a09ba75b7f8d");
    const release = await readReleaseContract();
    expect(release.fingerprint).toBe("38b664bdad6d26873fcb3b539c17234ee4214cf6654aecf0bc13286622cc0d04");
    for (const table of release.schema.tables) {
      for (const column of table.columns) {
        if (column.extra) expect(normalizeExtra(column.extra), `${table.name}.${column.name}`).toBe(column.extra);
      }
    }
  });
  it("rejects remote/production/Railway/unidentified/URL override targets", () => {
    const env = { NODE_ENV: "test", L4CKOS_LOCAL_SCHEMA: "1" };
    expect(() => assertLocalSchemaTarget({ url: url("l4ckos_test_ok") }, env)).not.toThrow();
    for (const value of ["mysql://root@remote.invalid/l4ckos_test_bad", "mysql://root@localhost/production", "mysql://root@localhost/l4ckos_test_bad?host=remote.invalid", "invalid"]) expect(() => assertLocalSchemaTarget({ url: value }, env)).toThrow("LOCAL_SCHEMA_TARGET_REQUIRED");
    for (const bad of [{ ...env, NODE_ENV: "production" }, { ...env, RAILWAY_PROJECT_ID: "synthetic" }, { ...env, L4CKOS_LOCAL_SCHEMA: "" }]) expect(() => assertLocalSchemaTarget({ url: url("l4ckos_test_ok") }, bad)).toThrow();
  });
  it("db:push CLI blocks a remote target before invoking Drizzle, without leaking the URL", () => {
    const result = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/database-push.ts"], { cwd: ROOT, env: { PATH: process.env.PATH, NODE_ENV: "test", L4CKOS_LOCAL_SCHEMA: "1", DATABASE_URL: "mysql://synthetic:do-not-log@remote.invalid/l4ckos_test_bad" }, encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe("LOCAL_DB_PUSH_REQUIRED");
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain("do-not-log");
  });
  it("uses only an explicit new lineage and rejects legacy paths", async () => {
    const lineage = await loadLineage();
    expect(lineage.entries.map(e=>e.name)).toEqual(["0021_preorder_production_batches"]);
    expect(lineage.reconciliations.map(e => e.name)).toEqual(["0020_reconcile_asaas_webhook_events"]);
    const contract = await readContract();
    const invalid = { version: 2 as const, migrations: [{ name: "test_escape", kind: "MIGRATION" as const, path: "drizzle/0001_tired_bruce_banner.sql", checksum: "a".repeat(64), description: "test", expectedPreFingerprint: contract.fingerprint, expectedPostFingerprint: contract.fingerprint }] };
    await expect(loadLineage(invalid)).rejects.toThrow("UNAPPROVED_ARTIFACT_PATH");
  });
});

describe.skipIf(process.env.L4CKOS_MYSQL_TEST !== "1")("MySQL 8.4 schema / ledger / bootstrap / runner", () => {
  beforeAll(async () => {
    process.env.L4CKOS_LOCAL_SCHEMA = "1";
    process.env.L4CKOS_LOCAL_RESTORE = "1";
    root = await openBackupConnection("mysql://root@localhost/mysql", socketPath);
    expected = await readContract();
  });
  afterAll(async () => {
    for (const c of connections) await c.end();
    for (const name of databases) await root.query(`DROP DATABASE ${quote(name)}`);
    await root?.end();
  });
  it("fresh #1 bootstraps 26 tables, validates canonical structure and creates one truthful BASELINE", async () => {
    const { c, ctx } = await database("fresh1"); fresh1 = c;
    expect(await bootstrapDatabase(c, ctx)).toMatchObject({ status: "BOOTSTRAPPED", tables: 26, fingerprint: expected.fingerprint });
    const ledger = await ledgerRows(c);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ name: "baseline-v1", kind: "BASELINE", checksum: expected.checksum });
    expect(ledger[0].description).toContain("FRESH BOOTSTRAP");
    expect((await readStructuralSchema(c)).tables).toHaveLength(26);
    console.log(`Canonical fresh #1: ${expected.fingerprint}, 26 business tables, 1 BASELINE`);
  });
  it("fresh #2 produces an identical fingerprint, excluding governance and allocator counters", async () => {
    const { c, ctx } = await database("fresh2"); fresh2 = c;
    await bootstrapDatabase(c, ctx);
    expect(structuralHash(await readStructuralSchema(c))).toBe(expected.fingerprint);
    await c.query("ALTER TABLE users AUTO_INCREMENT=999");
    expect(structuralHash(await readStructuralSchema(c))).toBe(expected.fingerprint);
    console.log(`Canonical fresh #2: ${expected.fingerprint}`);
  });
  it("preserves every audited table, column, index, FK and CHECK from independent metadata", async () => {
    const actual = await readStructuralSchema(fresh1);
    for (const table of audited.tables) {
      const observed = actual.tables.find(t => t.name === table.name)!;
      const columns = audited.columns.filter(c => c.tableName === table.name);
      expect(observed.engine).toBe(table.engine);
      expect(observed.collation).toBe(table.collation);
      expect(observed.columns).toHaveLength(columns.length);
      for (const column of columns) {
        const o = observed.columns.find(c => c.name === column.name)!;
        expect(o).toMatchObject({ type: column.type, nullable: column.nullable === "YES", position: column.position, defaultValue: normalizeDefault(column.defaultValue, column.type), charset: column.charset, collation: column.collation });
      }
      expect(observed.indexes.length).toBe(new Set(audited.indexes.filter(i => i.tableName === table.name).map(i => i.name)).size);
      expect(observed.foreignKeys.length).toBe(audited.foreignKeys.filter(i => i.tableName === table.name).length);
      expect(observed.checks.length).toBe(audited.constraints.filter(i => i.tableName === table.name && i.type === "CHECK").length);
    }
  });
  it("baselines existing canonical schema, repeats idempotently and never records legacy", async () => {
    const { c, ctx } = await database("baseline");
    await rawCanonical(c);
    expect(await baselineDatabase(c, ctx)).toMatchObject({ status: "BASELINED" });
    expect(await baselineDatabase(c, ctx)).toMatchObject({ status: "ALREADY_BASELINED" });
    expect(await historySize(c)).toBe(1);
    expect((await ledgerRows(c))[0].description).toContain("EXISTING CANONICAL");
    await c.query("UPDATE _l4ckos_schema_migrations SET postFingerprint=REPEAT('b',64) WHERE name='baseline-v1'");
    await expect(baselineDatabase(c, ctx)).rejects.toThrow("BASELINE_CHECKSUM_OR_FINGERPRINT_MISMATCH");
  });
  it("refuses column drift, unknown tables and absent webhook before creating ledger", async () => {
    for (const [suffix, sql, error] of [
      ["drift", "ALTER TABLE orderItems MODIFY unitPrice BIGINT NOT NULL", "CANONICAL_SCHEMA_DRIFT"],
      ["unknown", "CREATE TABLE foo (id int PRIMARY KEY) ENGINE=InnoDB", "UNKNOWN_BUSINESS_TABLE"],
      ["pre_staging", "DROP TABLE asaasWebhookEvents", "CANONICAL_SCHEMA_DRIFT"],
    ]) {
      const { c, ctx } = await database(suffix);
      await rawCanonical(c); await c.query(sql);
      await expect(baselineDatabase(c, ctx)).rejects.toThrow(error);
      expect((await readStructuralSchema(c, true)).tables).toHaveLength(0);
    }
  });
  it("refuses a nonempty bootstrap target and wrong accepted fingerprint without changing it", async () => {
    await expect(bootstrapDatabase(fresh1, context(schemaName("fresh1")))).rejects.toThrow("BOOTSTRAP_TARGET_NOT_EMPTY");
    const { c, ctx } = await database("wrong_acceptance");
    await expect(bootstrapDatabase(c, { ...ctx, approvedFingerprint: "b".repeat(64) })).rejects.toThrow("APPROVED_FINGERPRINT_REQUIRED");
    expect((await readStructuralSchema(c)).tables).toHaveLength(0);
    expect((await readStructuralSchema(c, true)).tables).toHaveLength(0);
  });
  it("fingerprint ignores index labels, detects lost uniqueness, AUTO_INCREMENT flags and CHECK enforcement", async () => {
    const { c } = await database("normalization"); await rawCanonical(c);
    await c.query("ALTER TABLE coupons RENAME INDEX coupons_code_unique TO arbitrary_label");
    expect(structuralHash(await readStructuralSchema(c))).toBe(expected.fingerprint);
    await c.query("ALTER TABLE coupons DROP INDEX arbitrary_label, ADD INDEX nonunique_code (code)");
    expect(structuralHash(await readStructuralSchema(c))).not.toBe(expected.fingerprint);
    await c.query("ALTER TABLE coupons DROP INDEX nonunique_code, ADD UNIQUE INDEX arbitrary_label (code)");
    expect(structuralHash(await readStructuralSchema(c))).toBe(expected.fingerprint);
    await c.query("ALTER TABLE users MODIFY id int NOT NULL");
    expect(structuralHash(await readStructuralSchema(c))).not.toBe(expected.fingerprint);
    await c.query("ALTER TABLE users MODIFY id int NOT NULL AUTO_INCREMENT");
    await c.query("ALTER TABLE orderItems ALTER CHECK order_items_quantity_positive_chk NOT ENFORCED");
    expect(structuralHash(await readStructuralSchema(c))).not.toBe(expected.fingerprint);
  });
  it("default V2 ignores all legacy SQL/journal and never discovers test fixtures", async () => {
    expect((await readdir(`${ROOT}/drizzle`)).filter(n => /^00\d\d.*\.sql$/.test(n)).length).toBeGreaterThanOrEqual(20);
    const {c,ctx}=await database("forward_default");
    await bootstrapDatabase(c,ctx);
    const result = await migrateDatabase(c,ctx);
    expect(result).toMatchObject({ status: "APPLIED", applied: ["0021_preorder_production_batches"] });
    expect(await historySize(c)).toBe(2);
    expect(structuralHash(await readStructuralSchema(c))).toBe((await loadLineage()).entries[0].expectedPostFingerprint);
  });
  it("runs a manifest-listed migration once, checks postcondition and rejects changed ledger checksum", async () => {
    const post = await postFingerprint();
    const manifest = await fixtureManifest(post);
    const { c, ctx } = await database("runner"); await bootstrapDatabase(c, ctx);
    expect(await migrateDatabase(c, ctx, manifest)).toMatchObject({ status: "APPLIED", fingerprint: post, applied: ["test_add_column"] });
    expect(await migrateDatabase(c, ctx, manifest)).toMatchObject({ status: "UP_TO_DATE" });
    expect(await historySize(c)).toBe(2);
    await c.query("UPDATE _l4ckos_schema_migrations SET checksum=REPEAT('b',64) WHERE name='test_add_column'");
    await expect(migrateDatabase(c, ctx, manifest)).rejects.toThrow("LEDGER_CHECKSUM_OR_CHAIN_MISMATCH");
    expect(await historySize(c)).toBe(2);
  });
  it("rejects altered SQL checksum and wrong precondition before executing anything", async () => {
    const manifest = await fixtureManifest(expected.fingerprint);
    manifest.migrations[0].checksum = "b".repeat(64);
    await expect(migrateDatabase(fresh1, context(schemaName("fresh1")), manifest)).rejects.toThrow("MIGRATION_CHECKSUM_MISMATCH");
    manifest.migrations[0].expectedPreFingerprint = "a".repeat(64);
    await expect(migrateDatabase(fresh1, context(schemaName("fresh1")), manifest)).rejects.toThrow("INVALID_LINEAGE_MANIFEST");
    expect(await historySize(fresh1)).toBe(1);
  });
  it("serializes two runner instances, aborts the competitor and executes only once", async () => {
    const { c, ctx } = await database("concurrent"); await bootstrapDatabase(c, ctx);
    const second = await openBackupConnection(ctx.url, socketPath); connections.push(second);
    const manifest = await fixtureManifest(await postFingerprint("lock_probe"));
    const original = c.query.bind(c);
    let release!: () => void; let reached!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { reached = resolve; });
    let executions = 0;
    c.query = (async (...args: any[]) => {
      if (typeof args[0] === "string" && args[0].startsWith("ALTER TABLE orders ADD COLUMN runnerFixture")) { executions++; reached(); await gate; }
      return (original as any)(...args);
    }) as typeof c.query;
    const first = migrateDatabase(c, ctx, manifest);
    await started;
    try { await expect(migrateDatabase(second, ctx, manifest)).rejects.toThrow("SCHEMA_LOCK_UNAVAILABLE"); }
    finally { release(); c.query = original; }
    expect((await first).status).toBe("APPLIED");
    expect(executions).toBe(1);
    expect(await historySize(c)).toBe(2);
    expect((await migrateDatabase(second, ctx, manifest)).status).toBe("UP_TO_DATE");
  });
  it("supports an explicitly manifested unbaselined reconciliation, then records a truthful canonical BASELINE", async () => {
    const { c, ctx } = await database("unbaselined_path"); await rawCanonical(c);
    const path = "database/migrations/fixtures/test-reconciliation-noop.sql";
    const manifest: LineageManifest = { version: 2, migrations: [], unbaselined: { expectedInitialFingerprint: expected.fingerprint, reconciliations: [{ name: "test_reconciliation", kind: "RECONCILIATION", path, checksum: sha256(await readFile(`${ROOT}/${path}`)), description: "Local reconciliation runner path test; SELECT 1 only", expectedPreFingerprint: expected.fingerprint, expectedPostFingerprint: expected.fingerprint }] } };
    expect((await migrateDatabase(c, ctx, manifest)).applied).toEqual(["test_reconciliation"]);
    expect((await ledgerRows(c)).map(r => r.kind)).toEqual(["RECONCILIATION", "BASELINE"]);
    expect((await migrateDatabase(c, ctx, manifest)).status).toBe("UP_TO_DATE");
    await expect(migrateDatabase(c, ctx)).rejects.toThrow("LEDGER_CHECKSUM_OR_CHAIN_MISMATCH");
  });
  it("partial implicit-commit DDL leaves evidence, no success ledger and blocks blind retry", async () => {
    const { c, ctx } = await database("partial"); await bootstrapDatabase(c, ctx);
    const manifest = await fixtureManifest(expected.fingerprint, true);
    await expect(migrateDatabase(c, ctx, manifest)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED", evidence: { completedStatements: 1 } });
    expect(await historySize(c)).toBe(1);
    expect((await readStructuralSchema(c)).tables.find(t => t.name === "orders")?.columns.some(col => col.name === "partialFixture")).toBe(true);
    const failed = await rows(c, "SELECT state, completedStatements, errorCode FROM _l4ckos_schema_executions WHERE operation='test_partial_failure'");
    expect(failed[0]).toMatchObject({ state: "FAILED", completedStatements: 1, errorCode: "RECOVERY_REQUIRED" });
    await expect(migrateDatabase(c, ctx, manifest)).rejects.toThrow("RECOVERY_REQUIRED");
  });
  it("unbaselined reconciliation failure preserves DDL evidence without creating any BASELINE", async () => {
    const { c, ctx } = await database("unbaselined_failure"); await rawCanonical(c);
    const fixture = await fixtureManifest(expected.fingerprint, true);
    const manifest: LineageManifest = { version: 2, migrations: [], unbaselined: { expectedInitialFingerprint: expected.fingerprint, reconciliations: [{ ...fixture.migrations[0], kind: "RECONCILIATION" }] } };
    await expect(migrateDatabase(c, ctx, manifest)).rejects.toThrow("RECOVERY_REQUIRED");
    expect(await historySize(c)).toBe(0);
    await expect(migrateDatabase(c, ctx, manifest)).rejects.toThrow("RECOVERY_REQUIRED");
  });
  it("failed postcondition also records no success and blocks retry", async () => {
    const { c, ctx } = await database("post_failure"); await bootstrapDatabase(c, ctx);
    const manifest = await fixtureManifest(expected.fingerprint);
    await expect(migrateDatabase(c, ctx, manifest)).rejects.toThrow("RECOVERY_REQUIRED");
    expect(await historySize(c)).toBe(1);
    await expect(migrateDatabase(c, ctx, manifest)).rejects.toThrow("RECOVERY_REQUIRED");
  });
  it("fresh bootstrap -> 26-table synthetic fixture -> backup v1 -> fresh restore preserves data and business fingerprint", async () => {
    for (const table of (await bootstrapArtifacts()).statements) {
      const cols = await rows(fresh1, `SHOW FULL COLUMNS FROM ${quote(table.table)}`);
      const row: Record<string, unknown> = {};
      for (const col of cols) {
        if (col.Null === "YES") { row[col.Field] = null; continue; }
        const type = String(col.Type);
        row[col.Field] = type.startsWith("int") ? 1 : type.startsWith("timestamp") ? "2026-09-27 15:00:00" : type.startsWith("enum") ? type.match(/^enum\('([^']+)'/)![1] : "synthetic".slice(0, Number(type.match(/varchar\((\d+)\)/)?.[1] || 255));
      }
      if (table.table === "products") row.price = 9000;
      if (table.table === "orders") row.totalPrice = 17970;
      if (table.table === "orderItems") Object.assign(row, { unitPrice: 5990, quantity: 3, totalPrice: 17970 });
      if (table.table === "stockReservations") Object.assign(row, { status: "restocked", quantity: 3, orderItemId: 1 });
      if (table.table === "auditLogs") Object.assign(row, { actorUserId: null, actorType: "system", orderId: 1, paymentId: 1 });
      if (table.table === "notificationOutbox") Object.assign(row, { orderId: 1, paymentId: 1, status: "sent", attempts: 4, sentAt: "2026-09-27 15:00:00" });
      if (table.table === "paymentEvents") Object.assign(row, { orderId: 1, paymentId: 1 });
      if (table.table === "orderEmailEvents") Object.assign(row, { status: "sent", attemptCount: 3, providerMessageId: "synthetic-provider", processingToken: "synthetic-lease", scheduledAt: "2026-09-27 15:05:00", sentAt: "2026-09-27 15:05:00" });
      await fresh1.query(`INSERT INTO ${quote(table.table)} (${Object.keys(row).map(quote)}) VALUES (${Object.keys(row).map(() => "?")})`, Object.values(row));
    }
    const backup = await backupDatabase(fresh1);
    expect(Object.keys(backup.tables)).toHaveLength(26);
    expect(await restoreDatabase(fresh2, JSON.parse(JSON.stringify(backup)), { url: url(schemaName("fresh2")), socketPath })).toEqual({ tables: 26, rows: 26 });
    const restored = await backupDatabase(fresh2);
    for (const table of Object.keys(backup.tables)) expect(restored.tables[table].checksum).toBe(backup.tables[table].checksum);
    expect(structuralHash(await readStructuralSchema(fresh1))).toBe(expected.fingerprint);
    expect(structuralHash(await readStructuralSchema(fresh2))).toBe(expected.fingerprint);
    expect(await historySize(fresh1)).toBe(1); expect(await historySize(fresh2)).toBe(1);
    console.log("Fresh backup v1 round-trip: 26 tables / 26 rows; all data checksums and canonical fingerprints equal; governance independently preserved");
  });
});
