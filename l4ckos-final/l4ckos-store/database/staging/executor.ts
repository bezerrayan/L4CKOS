import { randomUUID } from "node:crypto";
import type { BackupArtifact } from "../../server/database/backupRestore";
import { canonical, sha256 } from "../schema/fingerprint";
import { loadLineage } from "../migrations/runner";
import { assertIdentity, assertPlan, digestPlan, fail, TARGET, MIGRATION, PRE, POST, TTL, type Identity, type Plan } from "./policy";
import { createPlanFiles, withPlan } from "./store";

export type Inspection = { fingerprint: string; secondFingerprint: string; webhook: boolean; internalTables: string[] };
export type RestoreProof = { fingerprint: string; verified: boolean; rowCounts: Record<string, number> };
/** Adapters are trusted implementation code, never selected by CLI/env/plan. Tests mock identity only. */
export interface StagingAdapter {
  source(): Promise<string>;
  identity(): Promise<Identity>;
  health(): Promise<{ status: number }>;
  inspect(): Promise<Inspection>;
  backup(): Promise<{ bytes: Buffer; originSha256: string }>;
  restoreProof(bytes: Buffer): Promise<RestoreProof>;
  reconcile(plan: Plan, digest: string): Promise<{ status: string; fingerprint: string; ledger: unknown[]; webhookRows: number }>;
}
export const logEvent = (event: string, metadata: Record<string, unknown> = {}) => console.log(JSON.stringify({ event, ...metadata }));
export async function verifyScope() {
  const lineage = await loadLineage(), entry = lineage.reconciliations[0];
  if (lineage.entries.length || lineage.reconciliations.length !== 1 || lineage.initialFingerprint !== PRE || lineage.contract.fingerprint !== POST || entry.name !== MIGRATION.name || entry.kind !== MIGRATION.kind || entry.checksum !== MIGRATION.checksum || entry.expectedPostFingerprint !== POST) fail("STAGING_MIGRATION_SCOPE_MISMATCH");
}
function assertInspection(i: Inspection) {
  if (i.fingerprint !== PRE || i.secondFingerprint !== PRE || i.webhook || i.internalTables.length) fail("STAGING_PREWRITE_DRIFT");
}
export function assertBackup(plan: Plan, bytes: Buffer) {
  if (sha256(bytes) !== plan.backup.artifactSha256) fail("STAGING_BACKUP_CHANGED");
  const artifact = JSON.parse(bytes.toString()) as BackupArtifact;
  if (canonical(Object.fromEntries(Object.entries(artifact.tables).map(([t,v]) => [t,v.rowCount]))) !== canonical(plan.backup.rowCounts) || artifact.schemaFingerprint !== plan.backup.schemaFingerprint) fail("STAGING_BACKUP_CHANGED");
}
export async function prepareStaging(adapter: StagingAdapter, approvedCommit: string) {
  if (await adapter.source() !== approvedCommit || !/^[a-f0-9]{40}$/.test(approvedCommit)) fail("STAGING_COMMIT_MISMATCH");
  await verifyScope();
  const identity = await adapter.identity(); assertIdentity(identity); logEvent("target_verified", { projectId: TARGET.projectId });
  const health = await adapter.health(); if (health.status !== 200) fail("STAGING_HEALTH_REQUIRED");
  const inspection = await adapter.inspect(); assertInspection(inspection);
  const { bytes, originSha256 } = await adapter.backup();
  if (sha256(bytes) !== originSha256) fail("STAGING_BACKUP_COPY_MISMATCH");
  const artifact = JSON.parse(bytes.toString()) as BackupArtifact;
  const rowCounts = Object.fromEntries(Object.entries(artifact.tables).map(([t,v]) => [t,v.rowCount]));
  if (Object.keys(rowCounts).length !== 25 || "asaasWebhookEvents" in rowCounts) fail("STAGING_BACKUP_INVENTORY_MISMATCH");
  logEvent("backup_created", { tables: 25, artifactSha256: originSha256 });
  const proof = await adapter.restoreProof(bytes);
  if (!proof.verified || proof.fingerprint !== PRE || canonical(proof.rowCounts) !== canonical(rowCounts)) fail("STAGING_RESTORE_PROOF_REQUIRED");
  logEvent("restore_verified", { fingerprint: proof.fingerprint });
  assertInspection(await adapter.inspect());
  if (canonical(await adapter.identity()) !== canonical(identity) || await adapter.source() !== approvedCommit) fail("STAGING_PREPARE_CHANGED");
  const created = Date.now();
  const plan: Plan = { version: 1, planId: randomUUID(), createdAt: new Date(created).toISOString(), expiresAt: new Date(created + TTL).toISOString(), applicationCommit: approvedCommit, target: identity, migration: MIGRATION, expectedPreFingerprint: PRE, observedPreFingerprint: PRE, expectedPostFingerprint: POST,
    backup: { created: true, copiedOffRuntime: true, checksumVerified: true, artifactSha256: originSha256, createdAt: artifact.createdAt, rowCounts, rowChecksums: Object.fromEntries(Object.entries(artifact.tables).map(([t,v]) => [t,v.checksum])), schemaFingerprint: artifact.schemaFingerprint, sourceFingerprint: PRE, restoreVerified: true, restoreFingerprint: proof.fingerprint }, health: { status: 200 }, asaasWebhookEventsBefore: "ABSENT", ledgerStateBefore: "ABSENT" };
  const path = await createPlanFiles(plan, bytes);
  logEvent("backup_copied", { planId: plan.planId, artifactSha256: originSha256 });
  logEvent("plan_created", { planId: plan.planId, planDigest: digestPlan(plan) });
  return { path, planId: plan.planId, planDigest: digestPlan(plan) };
}
export async function applyStaging(adapter: StagingAdapter, path: string, confirmation: string) {
  return withPlan(path, async store => {
    const { plan, digest } = store;
    if (confirmation !== plan.planId) fail("STAGING_CONFIRMATION_MISMATCH");
    assertPlan(plan); assertBackup(plan, store.backup);
    if (await adapter.source() !== plan.applicationCommit) fail("STAGING_COMMIT_MISMATCH");
    await verifyScope();
    if (canonical(await adapter.identity()) !== canonical(plan.target)) fail("STAGING_TARGET_IDENTITY_MISMATCH");
    const health = await adapter.health(); if (health.status !== 200) fail("STAGING_HEALTH_REQUIRED");
    const previous = await store.result();
    if (previous && (previous.planDigest !== digest || previous.outcome !== "APPLIED")) fail("RECOVERY_REQUIRED");
    if (!previous) assertInspection(await adapter.inspect());
    logEvent("plan_verified", { planId: plan.planId, planDigest: digest });
    const startedAt = new Date().toISOString();
    try {
      // Even replay revalidates live ledger/fingerprint under the same MySQL lock.
      const result = await adapter.reconcile(plan, digest);
      if (result.fingerprint !== POST || result.webhookRows !== 0 || result.ledger.length !== 2) fail("RECOVERY_REQUIRED");
      const after = await adapter.health();
      if (after.status !== 200) fail("STAGING_POST_HEALTH_FAILED");
      const audit = { planId: plan.planId, planDigest: digest, startedAt, completedAt: new Date().toISOString(), target: plan.target, migration: plan.migration, preFingerprint: PRE, postFingerprint: result.fingerprint, ledger: result.ledger, baseline: "canonical-v1", healthBefore: health.status, healthAfter: after.status, backupSha256: plan.backup.artifactSha256, outcome: "APPLIED" };
      if (!previous) await store.writeResult(audit);
      logEvent("operation_complete", { planId: plan.planId, outcome: result.status });
      return { ...audit, outcome: previous ? "ALREADY_APPLIED" : result.status, healthAfter: after.status };
    } catch (error) {
      if (!previous) await store.writeResult({ planId: plan.planId, planDigest: digest, startedAt, completedAt: new Date().toISOString(), target: plan.target, migration: plan.migration, backupSha256: plan.backup.artifactSha256, outcome: "RECOVERY_REQUIRED" });
      logEvent("recovery_required", { planId: plan.planId });
      throw error;
    }
  }, true);
}
