import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Connection } from "mysql2/promise";
import { TARGET, PRE, POST, AFTER_0024, connectionHash, digestApplyAuthorization, type StagingIdentity, type BackupGate } from "../../database/stagingV6/policy";
import { diagnoseV6, applyV6 } from "../../database/stagingV6/executor";
import { openBackupConnection } from "./backupRestore";
import { bootstrapDatabase } from "../../database/bootstrap/bootstrap";
import { readContract } from "../../database/schema/artifacts";
import { readReleaseManifest, migrateDatabase } from "../../database/migrations/runner";
import { quote, rows } from "../../database/schema/fingerprint";

vi.mock("../../database/stagingV6/runtime", () => ({
  assertV6Runtime: async () => ({ schema: "l4ckos_staging", version: "8.4.11", hostname: "mysql-isolated-test" }),
}));

const socket = process.env.L4CKOS_LOCAL_MYSQL_SOCKET ?? "/tmp/l4ckos-v6-socket/mysqld.sock";
const schema = `l4ckos_test_v6_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const url = `mysql://root@localhost/${schema}`;
let root: Connection | undefined;
let c: Connection | undefined;
const priorFlag = process.env.L4CKOS_LOCAL_SCHEMA;
let identity: StagingIdentity;
const backup: BackupGate = { artifactId: "synthetic-isolated-fixture", artifactSha256: "a".repeat(64), createdAt: new Date().toISOString(), sourceProjectId: TARGET.projectId, sourceEnvironmentId: TARGET.environmentId, sourceMysqlServiceId: TARGET.mysqlServiceId, sourceSchema: TARGET.schema, sourceFingerprint: PRE, restoreFingerprint: PRE, restoredIsolated: true, restoreMysqlVersion: "8.4.11", restoredTableCount: 31, checksumsVerified: true, foreignKeyViolations: 0, ledgerTail: "0023_asaas_webhook_inbox", validationId: "isolated-mysql-test-proof" };

describe.skipIf(process.env.L4CKOS_MYSQL_TEST !== "1")("governed remote v6 executor on isolated MySQL 8.4", () => {
  beforeAll(async () => {
    process.env.L4CKOS_LOCAL_SCHEMA = "1";
    root = await openBackupConnection("mysql://root@localhost/mysql", socket);
    await root.query(`CREATE DATABASE ${quote(schema)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    c = await openBackupConnection(url, socket);
    const baseline = await readContract();
    await bootstrapDatabase(c, { url, socketPath: socket, applicationCommit: "a".repeat(40), approvedFingerprint: baseline.fingerprint });
    const full = await readReleaseManifest();
    await migrateDatabase(c, { url, socketPath: socket, applicationCommit: "b".repeat(40), approvedFingerprint: PRE }, { ...full, migrations: full.migrations.slice(0, 3) });
    await c.query("INSERT INTO products (id,name,category,price,stock) VALUES (8501,'synthetic v6 fixture','fixture',14000,9)");
    await c.query("INSERT INTO productVariants (id,productId,name,sku,price,stock,size,color,optionKey) VALUES (9501,8501,'legacy unclassified','V6-SYN-9501',NULL,7,NULL,NULL,NULL)");
    await c.query("INSERT INTO orders (id,userId,totalPrice,status,paymentStatus) VALUES (8601,8701,14000,'paid','confirmed')");
    await c.query("INSERT INTO payments (id,orderId,billingType,amount,status,externalReference,paidAmount,refundedAmount,netAmount) VALUES (9701,8601,'PIX',14000,'received','synthetic-v6-payment-9701',14000,0,13650)");
    identity = { ...TARGET, deploymentId: randomUUID(), databaseHost: "mysql.railway.internal", connectionHash: connectionHash(c) } as StagingIdentity;
  }, 120000);

  afterAll(async () => {
    await c?.end();
    if (root) { await root.query(`DROP DATABASE IF EXISTS ${quote(schema)}`); await root.end(); }
    if (priorFlag === undefined) delete process.env.L4CKOS_LOCAL_SCHEMA; else process.env.L4CKOS_LOCAL_SCHEMA = priorFlag;
  });

  it("diagnoses a 0023 ledger read-only, applies only 0024/0025, preserves variant/financial data, rejects replay", async () => {
    const before = await diagnoseV6(c!, identity);
    expect(before).toMatchObject({ readOnly: true, state: "READY", fingerprint: PRE, pending: ["0024_home_highlight_settings", "0025_product_variant_identity"] });
    expect(before.checks.every(check => check.passed)).toBe(true);
    await c!.query("INSERT INTO _l4ckos_schema_executions (operation,checksum,applicationCommit,state,preFingerprint) VALUES ('unexpected_partial','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','88daab3046f5351b6724ad51f69041b4fd896509','STARTED',?)", [PRE]);
    const blockedPartial = await diagnoseV6(c!, identity);
    expect(blockedPartial).toMatchObject({ state: "BLOCKED", blockedBy: "RECOVERY_REQUIRED" });
    expect(blockedPartial.checks).toEqual([
      { name: "staging_sql_identity", passed: true, detail: "l4ckos_staging; MySQL 8.4.11" },
      { name: "official_manifest_and_checksums", passed: true, detail: "0024 and 0025 only after 0021–0023" },
      { name: "ledger_has_no_recovery_state", passed: false, detail: "RECOVERY_REQUIRED" },
    ]);
    await c!.query("DELETE FROM _l4ckos_schema_executions WHERE operation='unexpected_partial' AND state='STARTED'");
    const auth = digestApplyAuthorization(identity, backup);
    const applied = await applyV6(c!, identity, backup, auth);
    expect(applied).toMatchObject({ status: "APPLIED", applied: ["0024_home_highlight_settings", "0025_product_variant_identity"], fingerprint: POST, ledger: ["0024_home_highlight_settings", "0025_product_variant_identity"], variantsAllInactiveByDefault: true, financialAggregatesPreserved: true });
    const variants = await rows(c!, "SELECT id,productId,name,sku,price,stock,size,color,optionKey,isActive FROM productVariants");
    expect(variants).toEqual([{ id: 9501, productId: 8501, name: "legacy unclassified", sku: "V6-SYN-9501", price: null, stock: 7, size: null, color: null, optionKey: null, isActive: 0 }]);
    const ledger = await rows(c!, "SELECT name,checksum,preFingerprint,postFingerprint FROM _l4ckos_schema_migrations WHERE name IN ('0024_home_highlight_settings','0025_product_variant_identity') ORDER BY id");
    expect(ledger.map(row => row.name)).toEqual(["0024_home_highlight_settings", "0025_product_variant_identity"]);
    expect((await diagnoseV6(c!, identity)).state).toBe("COMPLETE");
    await expect(applyV6(c!, identity, backup, auth)).rejects.toThrow("V6_DUPLICATE_EXECUTION_BLOCKED");
    expect(AFTER_0024).toMatch(/^[a-f0-9]{64}$/);

    const partialName = `l4ckos_test_v6_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const partialUrl = `mysql://root@localhost/${partialName}`;
    await root!.query(`CREATE DATABASE ${quote(partialName)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    const partial = await openBackupConnection(partialUrl, socket);
    try {
      const base = await readContract();
      await bootstrapDatabase(partial, { url: partialUrl, socketPath: socket, applicationCommit: "c".repeat(40), approvedFingerprint: base.fingerprint });
      const manifest = await readReleaseManifest();
      await migrateDatabase(partial, { url: partialUrl, socketPath: socket, applicationCommit: "d".repeat(40), approvedFingerprint: PRE }, { ...manifest, migrations: manifest.migrations.slice(0, 3) });
      await migrateDatabase(partial, { url: partialUrl, socketPath: socket, applicationCommit: "e".repeat(40), approvedFingerprint: AFTER_0024 }, { ...manifest, migrations: manifest.migrations.slice(0, 4) });
      const partialIdentity = { ...TARGET, deploymentId: randomUUID(), databaseHost: "mysql.railway.internal", connectionHash: connectionHash(partial) } as StagingIdentity;
      const partialDiagnostic = await diagnoseV6(partial, partialIdentity);
      expect(partialDiagnostic).toMatchObject({ state: "PARTIAL_0024_COMPLETE", fingerprint: AFTER_0024, pending: ["0025_product_variant_identity"] });
      expect(partialDiagnostic.checks.every(check => check.passed)).toBe(true);
      await expect(applyV6(partial, partialIdentity, backup, digestApplyAuthorization(partialIdentity, backup))).rejects.toThrow("V6_PARTIAL_STATE_BLOCKED");
    } finally {
      await partial.end();
      await root!.query(`DROP DATABASE IF EXISTS ${quote(partialName)}`);
    }
  }, 120000);
});
