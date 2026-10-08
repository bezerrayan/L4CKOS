import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type { Connection } from "mysql2/promise";
import { openBackupConnection, backupDatabase, compatibleSchema, checksum } from "./backupRestore";
import { bootstrapArtifacts } from "../../database/schema/artifacts";
import { quote, rows, sha256, readStructuralSchema, structuralHash } from "../../database/schema/fingerprint";
import { prepareStaging, applyStaging, type StagingAdapter } from "../../database/staging/executor";
import { TARGET, PRE, POST, connectionHash, type Identity } from "../../database/staging/policy";
import { inspectConnection, reconcileConnection } from "../../database/staging/remote";
import { restoreProof } from "../../database/staging/proof";
import { FixedRailwayAdapter } from "../../database/staging/railway";
// Identity adapter is mocked only in this test module. Shipped code has no local remote-capability override.
vi.mock("../../database/staging/runtime", () => ({ assertStagingRuntime: (c: Connection) => {
  if (c.config.socketPath !== (process.env.L4CKOS_LOCAL_MYSQL_SOCKET ?? "/tmp/l4ckos-reconciliation-socket/mysqld.sock") || !c.config.database?.startsWith("l4ckos_test_executor_")) throw Error("LOCAL_IDENTITY_FIXTURE_REQUIRED");
} }));
const altered = vi.hoisted(() => ({ sql: false }));
vi.mock("../../database/schema/artifacts", async original => {
  const actual = await original<typeof import("../../database/schema/artifacts")>();
  return { ...actual, readArtifact: async (...args: Parameters<typeof actual.readArtifact>) => {
    const bytes = await actual.readArtifact(...args);
    return altered.sql && args[0] === "database/migrations/0020_reconcile_asaas_webhook_events.sql" ? Buffer.concat([bytes, Buffer.from(" ")]) : bytes;
  } };
});
const socketPath = process.env.L4CKOS_LOCAL_MYSQL_SOCKET ?? "/tmp/l4ckos-reconciliation-socket/mysqld.sock";
const commit = "a".repeat(40);
let root: Connection;
const names: string[] = [], connections: Connection[] = [];
async function database() {
  const name = `l4ckos_test_executor_${randomUUID().replaceAll("-", "").slice(0,16)}`;
  const url = `mysql://root@localhost/${name}`;
  await root.query(`CREATE DATABASE ${quote(name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); names.push(name);
  const c = await openBackupConnection(url, socketPath); connections.push(c);
  return { c, target: { url, socketPath } };
}
async function fixture() {
  const { c, target } = await database();
  for (const entry of (await bootstrapArtifacts()).statements) if (entry.table !== "asaasWebhookEvents") await c.query(entry.sql);
  for (const entry of (await bootstrapArtifacts()).statements.filter(e => e.table !== "asaasWebhookEvents")) {
    const row: Record<string, unknown> = {};
    for (const col of await rows(c, `SHOW FULL COLUMNS FROM ${quote(entry.table)}`)) {
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
    await c.query(`INSERT INTO ${quote(entry.table)} (${Object.keys(row).map(quote)}) VALUES (${Object.keys(row).map(() => "?")})`, Object.values(row));
  }
  const identity = { ...TARGET, deploymentId: randomUUID(), connectionHash: connectionHash(c) } as Identity;
  let currentCommit = commit, currentIdentity = identity, restoreValid = true;
  const adapter: StagingAdapter = {
    source: async () => currentCommit,
    identity: async () => currentIdentity,
    health: async () => ({ status: 200 }),
    inspect: () => inspectConnection(c),
    backup: async () => { const bytes = Buffer.from(JSON.stringify(await backupDatabase(c))); return { bytes, originSha256: sha256(bytes) }; },
    restoreProof: async bytes => { const proof = await database(); const result = await restoreProof(proof.c, proof.target, bytes); return { ...result, verified: restoreValid }; },
    reconcile: async (plan, digest) => {
      const writer = await openBackupConnection(target.url, socketPath); connections.push(writer);
      return reconcileConnection(writer, currentIdentity, plan, digest);
    },
  };
  return { c, adapter, changeCommit: () => { currentCommit = "b".repeat(40); }, changeTarget: () => { currentIdentity = { ...identity, projectName: "l4ckos-production" } as Identity; }, failRestore: () => { restoreValid = false; } };
}
describe.skipIf(process.env.L4CKOS_MYSQL_TEST !== "1")("MySQL 8.4 staging executor with local identity adapter", () => {
  it("restores all 25 tables when source DDL inherits charset but canonical DDL spells it explicitly", async () => {
    const source = await fixture(), target = await database();
    const artifact = await backupDatabase(source.c);
    // Synthetic representation fixture: model the exact SHOW CREATE difference
    // observed on staging, with valid checksums. Real backup bytes are never edited.
    for (const table of Object.values(artifact.tables)) { table.schema = compatibleSchema(table.schema); table.schemaChecksum = checksum(table.schema); }
    artifact.schemaFingerprint = checksum(Object.fromEntries(Object.entries(artifact.tables).map(([name,t]) => [name,t.schema])));
    const { artifactChecksum, ...body } = artifact; artifact.artifactChecksum = checksum(body);
    const bytes = Buffer.from(JSON.stringify(artifact)), original = sha256(bytes);
    expect(artifact.tables.users.schema).not.toContain("CHARACTER SET utf8mb4 COLLATE");
    const proof = await restoreProof(target.c, target.target, bytes);
    expect(proof.verified).toBe(true); expect(proof.fingerprint).toBe(PRE);
    expect(Object.keys(proof.rowCounts)).toHaveLength(25);
    expect(sha256(bytes)).toBe(original);
    const restored = await backupDatabase(target.c);
    for (const table of Object.keys(artifact.tables)) expect([restored.tables[table].rowCount, restored.tables[table].checksum]).toEqual([artifact.tables[table].rowCount, artifact.tables[table].checksum]);
  });
  beforeAll(async () => { process.env.L4CKOS_LOCAL_RESTORE = "1"; root = await openBackupConnection("mysql://root@localhost/mysql", socketPath); });
  afterAll(async () => { for (const c of connections) await c.end(); for (const n of names) await root.query(`DROP DATABASE ${quote(n)}`); await root.end(); });
  it("PREPARE -> real backup/restore -> sealed plan -> APPLY -> real 0020/BASELINE -> audit -> replay", async () => {
    const f = await fixture(), prepared = await prepareStaging(f.adapter, commit);
    expect(structuralHash(await readStructuralSchema(f.c))).toBe(PRE);
    const result = await applyStaging(f.adapter, prepared.path, prepared.planId);
    expect(result.outcome).toBe("APPLIED"); expect(result.postFingerprint).toBe(POST);
    const ledger = await rows(f.c, "SELECT name,kind FROM _l4ckos_schema_migrations ORDER BY id");
    expect(ledger.map(v => v.kind)).toEqual(["RECONCILIATION","BASELINE"]);
    expect(Number((await rows(f.c, "SELECT COUNT(*) n FROM asaasWebhookEvents"))[0].n)).toBe(0);
    expect(Number((await rows(f.c, "SELECT COUNT(*) n FROM users"))[0].n)).toBe(1);
    const audit = JSON.parse(await readFile(prepared.path.replace("plan.json","result.json"), "utf8"));
    expect(audit).toMatchObject({ outcome: "APPLIED", planDigest: prepared.planDigest, preFingerprint: PRE, postFingerprint: POST });
    expect((await applyStaging(f.adapter, prepared.path, prepared.planId)).outcome).toBe("ALREADY_APPLIED");
    expect(await rows(f.c, "SELECT name,kind FROM _l4ckos_schema_migrations ORDER BY id")).toEqual(ledger);
  }, 15000);
  it.each(["schema", "commit", "backup", "target", "migration", "data"])("TOCTOU %s changes fail before governance is initialized", async kind => {
      const f = await fixture(), prepared = await prepareStaging(f.adapter, commit);
      if (kind === "schema") await f.c.query("ALTER TABLE orderItems MODIFY unitPrice bigint NOT NULL");
      if (kind === "commit") f.changeCommit();
      if (kind === "target") f.changeTarget();
      if (kind === "data") await f.c.query("UPDATE users SET name='synthetic changed' WHERE id=1");
      if (kind === "migration") altered.sql = true;
      if (kind === "backup") await writeFile(prepared.path.replace("plan.json","backup.json"), "changed");
      try { await expect(applyStaging(f.adapter, prepared.path, prepared.planId)).rejects.toThrow(); } finally { altered.sql = false; }
      expect((await readStructuralSchema(f.c,true)).tables).toHaveLength(0);
  });
  it("failed restore prevents creation of a usable plan", async () => {
    const f = await fixture(); f.failRestore(); await expect(prepareStaging(f.adapter, commit)).rejects.toThrow("STAGING_RESTORE_PROOF_REQUIRED");
    expect((await readStructuralSchema(f.c,true)).tables).toHaveLength(0);
  });
  it("two APPLY callers of one plan execute DDL once; second verifies ALREADY_APPLIED", async () => {
    const f = await fixture(), p = await prepareStaging(f.adapter, commit);
    const outcomes = await Promise.all([applyStaging(f.adapter,p.path,p.planId), applyStaging(f.adapter,p.path,p.planId)]);
    expect(outcomes.map(r => r.outcome).sort()).toEqual(["ALREADY_APPLIED","APPLIED"]);
    expect(await rows(f.c,"SELECT name FROM _l4ckos_schema_migrations")).toHaveLength(2);
    expect(Number((await rows(f.c,"SELECT COUNT(*) n FROM _l4ckos_schema_executions WHERE operation='0020_reconcile_asaas_webhook_events'"))[0].n)).toBe(1);
  });
  it("postcondition failure leaves RECOVERY_REQUIRED evidence and no false baseline/success", async () => {
    const f = await fixture(), p = await prepareStaging(f.adapter,commit);
    f.adapter.reconcile = async (plan,digest) => {
      const writer = await openBackupConnection((f.c.config as any).uri || `mysql://root@localhost/${f.c.config.database}`,socketPath); connections.push(writer);
      const original = writer.query.bind(writer);
      writer.query = (async (...args: any[]) => {
        const value = await (original as any)(...args);
        if (typeof args[0] === "string" && args[0].startsWith("CREATE TABLE `asaasWebhookEvents`")) await original("ALTER TABLE asaasWebhookEvents ADD syntheticDrift int");
        return value;
      }) as typeof writer.query;
      return reconcileConnection(writer,plan.target,plan,digest);
    };
    await expect(applyStaging(f.adapter,p.path,p.planId)).rejects.toThrow("RECOVERY_REQUIRED");
    expect(await rows(f.c,"SELECT name FROM _l4ckos_schema_migrations")).toHaveLength(0);
    expect((await rows(f.c,"SELECT state FROM _l4ckos_schema_executions"))[0].state).toBe("FAILED");
    await expect(applyStaging(f.adapter,p.path,p.planId)).rejects.toThrow("RECOVERY_REQUIRED");
  });
  it("production adapter restore uses a separate real Docker MySQL, never Railway", async () => {
    const f = await fixture(); const bytes = (await f.adapter.backup()).bytes;
    const proof = await new FixedRailwayAdapter().restoreProof(bytes);
    expect(proof).toMatchObject({ verified: true, fingerprint: PRE });
    expect(proof.rowCounts.users).toBe(1);
  }, 60000);
});
