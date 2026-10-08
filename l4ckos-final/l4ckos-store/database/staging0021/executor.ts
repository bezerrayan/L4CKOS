import type { BackupArtifact } from "../../server/database/backupRestore";
import { canonical, sha256 } from "../schema/fingerprint";
import { loadLineage } from "../migrations/runner";
import { assertIdentity, assertPlan, digestPlan, fail, MIGRATION, PRE, POST, TTL, type Identity, type Plan } from "./policy";
import { createPlanFiles, withPlan, preserveBackup, preserveEvidence } from "./store";
import { assertPriorGovernance, checkpointChecksums, type GovernanceCheckpoint } from "./checkpoint";
export type Inspection = { fingerprint: string; secondFingerprint: string; governance: GovernanceCheckpoint };
export type RestoreProof = { fingerprint: string; verified: boolean; rowCounts: Record<string, number> };
export interface StagingAdapter {
  source(): Promise<string>;
  identity(): Promise<Identity>;
  health(): Promise<{ status: number }>;
  inspect(): Promise<Inspection>;
  backup(): Promise<{ bytes: Buffer; originSha256: string }>;
  restoreProof(bytes: Buffer): Promise<RestoreProof>;
  reconcile(plan: Plan, digest: string): Promise<{ status: string; fingerprint: string; ledger: Record<string, unknown>[]; governance: GovernanceCheckpoint }>;
}
export async function verifyScope() {
  const lineage = await loadLineage(), entry = lineage.entries[0];
  if (lineage.entries.length !== 1 || lineage.contract.fingerprint !== PRE || !entry || entry.name !== MIGRATION.name || entry.kind !== MIGRATION.kind || entry.checksum !== MIGRATION.checksum || entry.expectedPreFingerprint !== PRE || entry.expectedPostFingerprint !== POST) fail("STAGING_MIGRATION_SCOPE_MISMATCH");
}
function assertInspection(i: Inspection) {
  if (i.fingerprint !== PRE || i.secondFingerprint !== PRE) fail("STAGING_PREWRITE_DRIFT");
  assertPriorGovernance(i.governance);
}
export function assertBackup(plan: Plan, bytes: Buffer) {
  if (sha256(bytes) !== plan.backup.artifactSha256) fail("STAGING_BACKUP_CHANGED");
  const a = JSON.parse(bytes.toString()) as BackupArtifact;
  if (a.schemaFingerprint !== plan.backup.schemaFingerprint || canonical(Object.fromEntries(Object.entries(a.tables).map(([t,v]) => [t,v.rowCount]))) !== canonical(plan.backup.rowCounts) || canonical(Object.fromEntries(Object.entries(a.tables).map(([t,v]) => [t,v.checksum]))) !== canonical(plan.backup.rowChecksums)) fail("STAGING_BACKUP_CHANGED");
}
export async function prepareStaging(adapter: StagingAdapter, approvedCommit: string) {
  if (!/^[a-f0-9]{40}$/.test(approvedCommit) || await adapter.source() !== approvedCommit) fail("STAGING_COMMIT_MISMATCH");
  await verifyScope();
  const target = await adapter.identity(); assertIdentity(target);
  if ((await adapter.health()).status !== 200) fail("STAGING_HEALTH_REQUIRED");
  const before = await adapter.inspect(); assertInspection(before);
  const { bytes, originSha256 } = await adapter.backup();
  if (sha256(bytes) !== originSha256) fail("STAGING_BACKUP_COPY_MISMATCH");
  const a = JSON.parse(bytes.toString()) as BackupArtifact;
  const rowCounts = Object.fromEntries(Object.entries(a.tables).map(([t,v]) => [t,v.rowCount]));
  if (Object.keys(rowCounts).length !== 26 || !("asaasWebhookEvents" in rowCounts) || Object.keys(rowCounts).some(t => t.startsWith("_l4ckos_"))) fail("STAGING_BACKUP_INVENTORY_MISMATCH");
  const saved = await preserveBackup(bytes);
  // Governance is excluded from business backup: preserve it independently BEFORE restore.
  await preserveEvidence(saved.planId, "governance.json", before.governance);
  try {
    const proof = await adapter.restoreProof(bytes);
    await preserveEvidence(saved.planId, "restore-proof.json", proof);
    if (!proof.verified || proof.fingerprint !== PRE || canonical(proof.rowCounts) !== canonical(rowCounts)) fail("STAGING_RESTORE_PROOF_REQUIRED");
    const after = await adapter.inspect(); assertInspection(after);
    if (canonical(after) !== canonical(before) || canonical(await adapter.identity()) !== canonical(target) || await adapter.source() !== approvedCommit) fail("STAGING_PREPARE_CHANGED");
    const created = Date.now();
    const plan: Plan = { version: 2, planId: saved.planId, createdAt: new Date(created).toISOString(), expiresAt: new Date(created + TTL).toISOString(), applicationCommit: approvedCommit, target, migration: MIGRATION, expectedPreFingerprint: PRE, observedPreFingerprint: PRE, expectedPostFingerprint: POST,
      backup: { created: true, copiedOffRuntime: true, checksumVerified: true, artifactSha256: originSha256, createdAt: a.createdAt, rowCounts, rowChecksums: Object.fromEntries(Object.entries(a.tables).map(([t,v]) => [t,v.checksum])), sourceFingerprint: PRE, schemaFingerprint: a.schemaFingerprint, restoreVerified: true, restoreFingerprint: proof.fingerprint },
      governance: checkpointChecksums(before.governance), restoreProofChecksum: sha256(canonical(proof)), health: { status: 200 } };
    const path = await createPlanFiles(plan, bytes);
    return { path, planId: plan.planId, planDigest: digestPlan(plan) };
  } catch (error) {
    await preserveEvidence(saved.planId, "prepare-failure.json", { outcome: "PREPARE_FAILED", at: new Date().toISOString() });
    throw error;
  }
}
export async function applyStaging(adapter: StagingAdapter, path: string, confirmation: string) {
  return withPlan(path, async store => {
    const { plan, digest } = store;
    if (confirmation !== plan.planId) fail("STAGING_CONFIRMATION_MISMATCH");
    assertPlan(plan); assertBackup(plan, store.backup);
    const governance = JSON.parse((await store.evidence("governance.json")).toString()) as GovernanceCheckpoint;
    assertPriorGovernance(governance);
    const proof = await store.evidence("restore-proof.json");
    if (canonical(checkpointChecksums(governance)) !== canonical(plan.governance) || sha256(proof) !== plan.restoreProofChecksum) fail("STAGING_GOVERNANCE_OR_PROOF_CHANGED");
    if (await adapter.source() !== plan.applicationCommit) fail("STAGING_COMMIT_MISMATCH");
    await verifyScope();
    if (canonical(await adapter.identity()) !== canonical(plan.target)) fail("STAGING_TARGET_IDENTITY_MISMATCH");
    if ((await adapter.health()).status !== 200) fail("STAGING_HEALTH_REQUIRED");
    const previous = await store.result();
    if (previous && (previous.planDigest !== digest || previous.outcome !== "APPLIED")) fail("RECOVERY_REQUIRED");
    // The remote runner rechecks live state under GET_LOCK, including crash-after-success replay.
    const startedAt = new Date().toISOString();
    try {
      const result = await adapter.reconcile(plan, digest);
      if (result.fingerprint !== POST || result.ledger.length !== 3 || !["APPLIED", "UP_TO_DATE"].includes(result.status)) fail("RECOVERY_REQUIRED");
      const g = result.governance;
      if (canonical(g.ledger.slice(0,2)) !== canonical(governance.ledger) || canonical(g.executions.slice(0,governance.executions.length)) !== canonical(governance.executions)) fail("RECOVERY_REQUIRED");
      const health = await adapter.health(); if (health.status !== 200) fail("STAGING_POST_HEALTH_FAILED");
      const audit = { planId: plan.planId, planDigest: digest, startedAt, completedAt: new Date().toISOString(), target: plan.target, applicationCommit: plan.applicationCommit, migration: MIGRATION, preFingerprint: PRE, postFingerprint: POST, backupSha256: plan.backup.artifactSha256, governance: plan.governance, executionCheckpoint: g.executions, ledger: result.ledger, healthAfter: health.status, outcome: "APPLIED" };
      if (!previous) await store.writeResult(audit);
      return { ...audit, outcome: result.status };
    } catch (error) {
      if (!previous) await store.writeResult({ planId: plan.planId, planDigest: digest, startedAt, outcome: "RECOVERY_REQUIRED", backupSha256: plan.backup.artifactSha256, governance: plan.governance, executionCheckpoint: (error as { evidence?: unknown }).evidence ?? null });
      throw error;
    }
  }, true);
}
