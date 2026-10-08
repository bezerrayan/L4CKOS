import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, stat } from "node:fs/promises";
import type { Connection } from "mysql2/promise";
import { openBackupConnection, backupDatabase } from "./backupRestore";
import { bootstrapArtifacts } from "../../database/schema/artifacts";
import { quote, rows, sha256, readStructuralSchema, structuralHash } from "../../database/schema/fingerprint";
import { migrateDatabase } from "../../database/migrations/runner";
import type { LineageManifest } from "../../database/migrations/runner";
import { readArtifact } from "../../database/schema/artifacts";
import { prepareStaging, applyStaging, type StagingAdapter } from "../../database/staging0021/executor";
import { TARGET, PRE, POST, connectionHash, type Identity } from "../../database/staging0021/policy";
import { inspectConnection, reconcileConnection } from "../../database/staging0021/remote";
import { restoreProof } from "../../database/staging0021/proof";
import { FixedPreorderRailwayAdapter } from "../../database/staging0021/railway";
vi.mock("../../database/staging/runtime", () => ({ assertStagingRuntime: (c: Connection) => {
  if (c.config.socketPath !== (process.env.L4CKOS_LOCAL_MYSQL_SOCKET ?? "/tmp/l4ckos-reconciliation-socket/mysqld.sock") || !c.config.database?.startsWith("l4ckos_test_0021_")) throw Error("LOCAL_IDENTITY_FIXTURE_REQUIRED");
} }));
const altered = vi.hoisted(() => ({ sql: false }));
vi.mock("../../database/schema/artifacts", async original => {
  const actual = await original<typeof import("../../database/schema/artifacts")>();
  return { ...actual, readArtifact: async (...args: Parameters<typeof actual.readArtifact>) => {
    const bytes = await actual.readArtifact(...args);
    return altered.sql && args[0] === "database/migrations/0021_preorder_production_batches.sql" ? Buffer.concat([bytes, Buffer.from(" ")]) : bytes;
  } };
});
const socketPath = process.env.L4CKOS_LOCAL_MYSQL_SOCKET ?? "/tmp/l4ckos-reconciliation-socket/mysqld.sock";
const commit = "a".repeat(40);
let root: Connection;
const names: string[] = [], connections: Connection[] = [];
async function database() {
  const name = `l4ckos_test_0021_${randomUUID().replaceAll("-", "").slice(0,16)}`;
  const url = `mysql://root@localhost/${name}`;
  await root.query(`CREATE DATABASE ${quote(name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); names.push(name);
  const c = await openBackupConnection(url, socketPath); connections.push(c);
  return { c, target: { url, socketPath } };
}
async function fixture() {
  const { c, target } = await database();
  for (const entry of (await bootstrapArtifacts()).statements) if (entry.table !== "asaasWebhookEvents") await c.query(entry.sql);
  const manifest = JSON.parse((await readArtifact("database/migrations/manifest.json", "database/migrations")).toString()) as LineageManifest;
  await migrateDatabase(c, { ...target, applicationCommit: "b".repeat(40), approvedFingerprint: PRE }, { ...manifest, migrations: [] });
  await c.query("INSERT INTO users (id,openId,name) VALUES (1,'synthetic-0021','Synthetic')");
  await c.query("INSERT INTO products (id,name,category,price,stock) VALUES (1,'Synthetic STOCK','fixture',5990,3)");
  await c.query("INSERT INTO orders (id,userId,totalPrice) VALUES (1,1,11980)");
  await c.query("INSERT INTO orderItems (id,orderId,productId,productName,unitPrice,quantity,totalPrice) VALUES (1,1,1,'Synthetic STOCK',5990,2,11980)");
  const identity = { ...TARGET, deploymentId: randomUUID(), connectionHash: connectionHash(c) } as Identity;
  let currentCommit = commit, currentIdentity = identity, health = 200;
  const adapter: StagingAdapter = {
    source: async () => currentCommit, identity: async () => currentIdentity, health: async () => ({ status: health }), inspect: () => inspectConnection(c),
    backup: async () => { const bytes = Buffer.from(JSON.stringify(await backupDatabase(c))); return { bytes, originSha256: sha256(bytes) }; },
    restoreProof: async bytes => { const proof = await database(); return restoreProof(proof.c, proof.target, bytes); },
    reconcile: async (plan, digest) => {
      const writer = await openBackupConnection(target.url, socketPath); connections.push(writer);
      return reconcileConnection(writer, currentIdentity, plan, digest);
    },
  };
  return { c, target, identity, adapter, changeCommit: () => { currentCommit = "c".repeat(40); }, changeTarget: () => { currentIdentity = { ...identity, projectName: "l4ckos-production" } as Identity; }, failHealth: () => { health = 503; } };
}
describe.skipIf(process.env.L4CKOS_MYSQL_TEST !== "1")("fixed 0021 MySQL 8.4 executor, local identity only", () => {
  beforeAll(async () => { process.env.L4CKOS_LOCAL_SCHEMA = "1"; process.env.L4CKOS_LOCAL_RESTORE = "1"; root = await openBackupConnection("mysql://root@localhost/mysql", socketPath); });
  afterAll(async () => { for (const c of connections) await c.end(); for (const n of names) await root.query(`DROP DATABASE ${quote(n)}`); await root.end(); });
  it("PREPARE, separate governance + business backup, real restore, APPLY, exactly one MIGRATION, replay", async () => {
    const f = await fixture(), before = await inspectConnection(f.c), prepared = await prepareStaging(f.adapter, commit);
    expect(structuralHash(await readStructuralSchema(f.c))).toBe(PRE);
    const evidence = async (name: string) => JSON.parse(await readFile(prepared.path.replace("plan.json",name),"utf8"));
    const checkpoint = await evidence("governance.json"), backup = await evidence("backup.json"), proof = await evidence("restore-proof.json");
    expect(checkpoint).toEqual(before.governance);
    expect(Object.keys(backup.tables)).toHaveLength(26);
    expect(backup.tables).not.toHaveProperty("_l4ckos_schema_migrations");
    expect(proof).toMatchObject({verified:true,fingerprint:PRE});
    const result = await applyStaging(f.adapter,prepared.path,prepared.planId);
    expect(result.outcome).toBe("APPLIED"); expect(result.postFingerprint).toBe(POST);
    const ledger = await rows(f.c,"SELECT * FROM _l4ckos_schema_migrations ORDER BY id");
    expect(ledger.map(r=>r.kind)).toEqual(["RECONCILIATION","BASELINE","MIGRATION"]);
    expect(ledger[2]).toMatchObject({name:"0021_preorder_production_batches",manifestVersion:2,runnerVersion:"2.0.0",applicationCommit:commit});
    expect(ledger.slice(0,2)).toEqual(before.governance.ledger);
    expect((await rows(f.c,"SELECT quantity,unitPrice,totalPrice,salesModeAtPurchase FROM orderItems"))[0]).toMatchObject({quantity:2,unitPrice:5990,totalPrice:11980,salesModeAtPurchase:"STOCK"});
    expect((await applyStaging(f.adapter,prepared.path,prepared.planId)).outcome).toBe("UP_TO_DATE");
    expect(await rows(f.c,"SELECT * FROM _l4ckos_schema_migrations ORDER BY id")).toEqual(ledger);
    expect((await evidence("result.json")).outcome).toBe("APPLIED");
    expect((await stat(prepared.path)).mode & 0o777).toBe(0o600);
  });
  it.each(["schema","commit","target","health","backup","governance-file","proof","ledger","execution","migration","data"])("rejects changed %s without applying DDL", async kind => {
    const f = await fixture(), p = await prepareStaging(f.adapter,commit);
    if (kind === "schema") await f.c.query("ALTER TABLE orders ADD syntheticDrift int");
    if (kind === "commit") f.changeCommit(); if (kind === "target") f.changeTarget(); if (kind === "health") f.failHealth();
    if (kind === "backup") await writeFile(p.path.replace("plan.json","backup.json"),"changed");
    if (kind === "governance-file") await writeFile(p.path.replace("plan.json","governance.json"),"{}");
    if (kind === "proof") await writeFile(p.path.replace("plan.json","restore-proof.json"),"{}");
    if (kind === "ledger") await f.c.query("UPDATE _l4ckos_schema_migrations SET applicationCommit=? WHERE id=1",["d".repeat(40)]);
    if (kind === "execution") await f.c.query("UPDATE _l4ckos_schema_executions SET completedStatements=99 WHERE id=1");
    if (kind === "migration") altered.sql = true;
    if (kind === "data") await f.c.query("UPDATE products SET stock=4 WHERE id=1");
    try { await expect(applyStaging(f.adapter,p.path,p.planId)).rejects.toThrow(); } finally { altered.sql = false; }
    expect((await readStructuralSchema(f.c)).tables.some(t=>t.name==="productionBatches")).toBe(false);
    expect(await rows(f.c,"SELECT name FROM _l4ckos_schema_migrations WHERE kind='MIGRATION'")).toHaveLength(0);
  });
  it("two callers serialize on the plan and execute 0021 exactly once", async () => {
    const f = await fixture(), p = await prepareStaging(f.adapter,commit);
    const results = await Promise.all([applyStaging(f.adapter,p.path,p.planId),applyStaging(f.adapter,p.path,p.planId)]);
    expect(results.map(r=>r.outcome).sort()).toEqual(["APPLIED","UP_TO_DATE"]);
    expect(await rows(f.c,"SELECT id FROM _l4ckos_schema_executions WHERE operation='0021_preorder_production_batches'")).toHaveLength(1);
  });
  it("requires the shared GET_LOCK before any migration write", async () => {
    const f = await fixture(), p = await prepareStaging(f.adapter,commit);
    const name = `l4ckos_schema_v2_${sha256(f.c.config.database!).slice(0,32)}`;
    await f.c.query("SELECT GET_LOCK(?,0)",[name]);
    try { await expect(applyStaging(f.adapter,p.path,p.planId)).rejects.toThrow("SCHEMA_LOCK_UNAVAILABLE"); }
    finally { await f.c.query("SELECT RELEASE_LOCK(?)",[name]); }
    expect(await rows(f.c,"SELECT id FROM _l4ckos_schema_executions WHERE operation='0021_preorder_production_batches'")).toHaveLength(0);
  });
  it.each([0,1,2,3,4])("failure after %i statements persists evidence and blocks blind retry", async stop => {
    const f = await fixture(), p = await prepareStaging(f.adapter,commit);
    f.adapter.reconcile = async (plan,digest) => {
      const writer = await openBackupConnection(f.target.url,socketPath); connections.push(writer);
      const original = writer.query.bind(writer); let completed = 0;
      writer.query = (async (...args:any[]) => {
        if (typeof args[0] === "string" && /^(CREATE|ALTER)/.test(args[0])) {
          if (completed === stop) throw Error("synthetic DDL failure");
          const result = await (original as any)(...args); completed++; return result;
        }
        if (stop === 4 && args[0].startsWith("INSERT INTO _l4ckos_schema_migrations")) throw Error("synthetic ledger failure");
        return (original as any)(...args);
      }) as typeof writer.query;
      return reconcileConnection(writer,plan.target,plan,digest);
    };
    await expect(applyStaging(f.adapter,p.path,p.planId)).rejects.toThrow("RECOVERY_REQUIRED");
    const e = (await rows(f.c,"SELECT * FROM _l4ckos_schema_executions WHERE operation='0021_preorder_production_batches'"))[0];
    expect(e).toMatchObject({state:"FAILED",completedStatements:stop,errorCode:"RECOVERY_REQUIRED"});
    expect(await rows(f.c,"SELECT * FROM _l4ckos_schema_migrations")).toHaveLength(2);
    for (const name of ["backup.json","governance.json","restore-proof.json","plan.json","seal.json","result.json"]) expect((await stat(p.path.replace("plan.json",name))).size).toBeGreaterThan(0);
    await expect(applyStaging(f.adapter,p.path,p.planId)).rejects.toThrow("RECOVERY_REQUIRED");
    const fresh = await openBackupConnection(f.target.url,socketPath); connections.push(fresh);
    await expect(reconcileConnection(fresh,f.identity,JSON.parse(await readFile(p.path,"utf8")),p.planDigest)).rejects.toThrow("RECOVERY_REQUIRED");
  });
  it("failed restore retains backup and governance without a usable plan", async () => {
    const f = await fixture();
    const { PLAN_ROOT } = await import("../../database/staging0021/store");
    const { readdir } = await import("node:fs/promises");
    const before = new Set(await readdir(PLAN_ROOT));
    f.adapter.restoreProof = async () => { throw Error("synthetic restore failure"); };
    await expect(prepareStaging(f.adapter,commit)).rejects.toThrow("synthetic restore failure");
    const added = (await readdir(PLAN_ROOT)).filter(id => !before.has(id));
    expect(added).toHaveLength(1);
    const directory = `${PLAN_ROOT}/${added[0]}`;
    expect(directory).not.toBe("");
    expect((await stat(`${directory}/backup.json`)).size).toBeGreaterThan(0);
    expect((await stat(`${directory}/prepare-failure.json`)).size).toBeGreaterThan(0);
  });
  it("fixed adapter proves real restore in an independent Docker MySQL without Railway", async () => {
    const f = await fixture();
    expect(await new FixedPreorderRailwayAdapter().restoreProof((await f.adapter.backup()).bytes)).toMatchObject({verified:true,fingerprint:PRE});
  },60000);
});
