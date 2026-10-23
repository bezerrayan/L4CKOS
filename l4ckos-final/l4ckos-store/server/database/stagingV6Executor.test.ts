import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { TARGET, PRE, POST, APPLICATION_RC, MIGRATIONS, assertIdentity, assertBackupGate, digestApplyAuthorization, consumeAuthorizedV6Capability, type StagingIdentity, type BackupGate } from "../../database/stagingV6/policy";
import { verifyV6Scope, diagnoseV6 } from "../../database/stagingV6/executor";
import { identityFromRailway } from "../../database/stagingV6/railwayIdentity";
import { assertV6Runtime } from "../../database/stagingV6/runtime";
import { readAndVerifyBackupProof } from "../../database/stagingV6/backupProof";
import { canonical, sha256 } from "../../database/schema/fingerprint";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createEnvelopeHeader } from "../../scripts/staging-backup-v2-crypto";

const altered = vi.hoisted(() => ({ migration: false }));
vi.mock("../../database/schema/artifacts", async importOriginal => {
  const actual = await importOriginal<typeof import("../../database/schema/artifacts")>();
  return { ...actual, readArtifact: async (...args: Parameters<typeof actual.readArtifact>) => {
    const bytes = await actual.readArtifact(...args);
    return altered.migration && args[0] === "database/migrations/0024_home_highlight_settings.sql" ? Buffer.concat([bytes, Buffer.from(" ")]) : bytes;
  } };
});

const identity = { ...TARGET, deploymentId: randomUUID(), databaseHost: "mysql.railway.internal", connectionHash: "a".repeat(64) } as StagingIdentity;
const proof: BackupGate = { artifactId: "backup-fixture", artifactSha256: "b".repeat(64), createdAt: new Date().toISOString(), sourceProjectId: TARGET.projectId, sourceEnvironmentId: TARGET.environmentId, sourceMysqlServiceId: TARGET.mysqlServiceId, sourceSchema: TARGET.schema, sourceFingerprint: PRE, restoreFingerprint: PRE, restoredIsolated: true, restoreMysqlVersion: "8.4.11", restoredTableCount: 31, checksumsVerified: true, foreignKeyViolations: 0, ledgerTail: "0023_asaas_webhook_inbox", validationId: "restore-proof-fixture" };

describe("fixed v6 staging executor policy", () => {
  it("pins only the approved RC, isolated Railway IDs, schema and exact 0024/0025 checksums", async () => {
    expect(APPLICATION_RC).toBe("88daab3046f5351b6724ad51f69041b4fd896509");
    expect(MIGRATIONS.map(m => m.name)).toEqual(["0024_home_highlight_settings", "0025_product_variant_identity"]);
    expect((await verifyV6Scope()).lineage.entries.at(-1)?.expectedPostFingerprint).toBe(POST);
    expect(() => assertIdentity(identity)).not.toThrow();
    for (const change of [{ projectId: randomUUID() }, { projectName: "l4ckos-production" }, { environmentId: randomUUID() }, { mysqlServiceId: randomUUID() }, { schema: "production" }, { databaseHost: "mysql.production.railway.internal" }]) {
      expect(() => assertIdentity({ ...identity, ...change } as StagingIdentity)).toThrow("STAGING_TARGET_IDENTITY_MISMATCH");
    }
  });
  it("blocks a changed official migration file before exposing an executable lineage", async () => {
    altered.migration = true;
    try { await expect(verifyV6Scope()).rejects.toThrow("MIGRATION_CHECKSUM_MISMATCH"); }
    finally { altered.migration = false; }
  });
  it("requires a recent restored backup proof on the exact initial fingerprint", () => {
    expect(() => assertBackupGate(proof)).not.toThrow();
    for (const change of [{ sourceFingerprint: POST }, { restoreFingerprint: POST }, { restoredIsolated: false }, { artifactSha256: "bad" }, { validationId: "" }]) {
      expect(() => assertBackupGate({ ...proof, ...change } as BackupGate)).toThrow("CURRENT_RESTORED_BACKUP_PROOF_REQUIRED");
    }
  });
  it("binds the executor proof to the local encrypted artifact and v2 format", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "l4ckos-backup-proof-"));
    try {
      const artifactId = "l4ckos-staging-2026-10-22T22-30-00-000Z-a1b2c3d4-v2";
      const artifactPath = path.join(dir, `${artifactId}.enc`);
      const manifestPath = `${artifactPath}.manifest.json`;
      const inventory = { tables: 31, views: 2, triggers: 3, routines: 1, events: 0, nonInnoDbTables: 0 };
      const createdAt = new Date().toISOString();
      const context = { sourceProjectId: TARGET.projectId, sourceEnvironmentId: TARGET.environmentId, sourceMysqlServiceId: TARGET.mysqlServiceId, sourceSchema: TARGET.schema, createdAt, sourceFingerprint: PRE, inventory, mysqlVersion: "8.4.11" };
      const envelope = createEnvelopeHeader(context, "7".repeat(64));
      const encryptedPayload = Buffer.concat([envelope.cipher.update(Buffer.from("synthetic dump payload only")), envelope.cipher.final()]);
      const tag = envelope.cipher.getAuthTag();
      const bytes = Buffer.concat([envelope.header, encryptedPayload, tag]);
      const artifactSha256 = sha256(bytes);
      const rowDigest = "5".repeat(64);
      const restoreReport = { fingerprint: PRE, tableCount: 31, ledgerTail: "0023_asaas_webhook_inbox", foreignKeyViolations: 0, sourceRowCountDigest: rowDigest, restoredRowCountDigest: rowDigest, definerDigest: "6".repeat(64), inventory: { tables: 31, views: 2, triggers: 3, routines: 1, events: 0 } };
      const manifest = { ...proof, artifactId, artifactSha256, createdAt, restoreMysqlVersion: "8.4.11", validationId: sha256(canonical(restoreReport)), plaintextDumpSha256: "4".repeat(64), sourceRowCountDigest: rowDigest, rowCountDigest: rowDigest, definerDigest: restoreReport.definerDigest, inventory, format: "L4CKOS-Backup-v2", formatVersion: 2, algorithm: "AES-256-GCM", keyReference: "l4ckos-staging-aes-v2", keyDerivation: "none; 32-byte key provided directly", nonceBytes: 12, tagBytes: 16, envelopeNonce: envelope.nonce.toString("hex"), authenticationTag: tag.toString("hex"), authenticatedContextSha256: sha256(envelope.contextBytes), restoreReport };
      await writeFile(artifactPath, bytes, { mode: 0o600 });
      await writeFile(manifestPath, JSON.stringify(manifest), { mode: 0o600 });
      await expect(readAndVerifyBackupProof(manifestPath)).resolves.toMatchObject({ manifest: { artifactSha256 }, artifactPath });
      const tampered = Buffer.from(bytes); tampered[26 + envelope.contextBytes.length] ^= 1;
      await writeFile(artifactPath, tampered, { mode: 0o600 });
      await expect(readAndVerifyBackupProof(manifestPath)).rejects.toThrow("BACKUP_ARTIFACT_SHA256_MISMATCH");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("binds manual apply confirmation to target, deployment, backup and both migration checksums", () => {
    const digest = digestApplyAuthorization(identity, proof);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digestApplyAuthorization({ ...identity, deploymentId: randomUUID() }, proof)).not.toBe(digest);
    expect(digestApplyAuthorization(identity, { ...proof, artifactSha256: "c".repeat(64) })).not.toBe(digest);
  });
  it("derives identity only from the pinned Railway project, environment, API, MySQL URL and private network", () => {
    const host = "mysql-production-0.railway.internal";
    const url = `mysql://synthetic:synthetic@${host}:3306/l4ckos_staging`;
    const deploymentId = randomUUID();
    const status = { id: TARGET.projectId, name: TARGET.projectName, environments: { edges: [{ node: { id: TARGET.environmentId, name: TARGET.environmentName, serviceInstances: { edges: [
      { node: { serviceId: TARGET.apiServiceId, serviceName: "l4ckos-staging", activeDeployments: { edges: [{ node: { id: deploymentId } }] }, domains: { customDomains: [{ domain: "api-staging.l4ckos.com.br" }] } } },
      { node: { serviceId: TARGET.mysqlServiceId, serviceName: "mysql" } },
    ] } } }] } };
    const variables = (serviceId: string) => ({ RAILWAY_PROJECT_ID: TARGET.projectId, RAILWAY_ENVIRONMENT_ID: TARGET.environmentId, RAILWAY_SERVICE_ID: serviceId, DATABASE_URL: url, MYSQL_URL: url });
    const derived = identityFromRailway(status, variables(TARGET.apiServiceId), variables(TARGET.mysqlServiceId), { privateHost: host });
    expect(derived).toMatchObject({ ...TARGET, deploymentId, databaseHost: host });
    expect(JSON.stringify(derived)).not.toContain("synthetic:synthetic");
    expect(() => identityFromRailway({ ...status, id: "production" }, variables(TARGET.apiServiceId), variables(TARGET.mysqlServiceId), { privateHost: host })).toThrow("STAGING_TARGET_IDENTITY_MISMATCH");
  });
  it("diagnostic does not issue SQL writes", async () => {
    const c = { query: vi.fn() } as any;
    const result = await diagnoseV6(c, identity);
    expect(result).toMatchObject({ readOnly: true, state: "BLOCKED", blockedBy: "PREFLIGHT_CHECK_FAILED" });
    expect(result.checks).toEqual([{ name: "staging_sql_identity", passed: false, detail: "PREFLIGHT_CHECK_FAILED" }]);
    expect(c.query).not.toHaveBeenCalled();
  });
  it("requires an opaque connection-bound, single-use execution capability", async () => {
    await expect(consumeAuthorizedV6Capability({} as any, {} as any)).rejects.toThrow("V6_CAPABILITY_REQUIRED");
  });
  it("fails closed outside the pinned Railway runtime before querying SQL", async () => {
    const config = { host: identity.databaseHost, port: 3306, user: "synthetic", password: "synthetic", database: TARGET.schema, socketPath: undefined };
    const c = { config, query: vi.fn() } as any;
    const bound = { ...identity, connectionHash: sha256(canonical([config.host, config.port, config.user, config.password, config.database, null])) };
    await expect(assertV6Runtime(c, bound)).rejects.toThrow("STAGING_RUNTIME_IDENTITY_MISMATCH");
    expect(c.query).not.toHaveBeenCalled();
  });
});
