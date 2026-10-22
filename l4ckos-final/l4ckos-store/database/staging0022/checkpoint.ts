import { randomUUID } from 'node:crypto';
import { assertPlan, digest, fail, PRE, snapshotDigest, type Snapshot, type WindowPlan } from './policy';

/** An in-memory challenge, never recovered as an approval after transport loss. */
export function checkpoint(plan: WindowPlan, snapshot: Snapshot) {
  if (snapshot.fingerprint !== PRE) fail('CHECKPOINT_REQUIRES_V2');
  return { version: 1 as const, nonce: randomUUID(), admission: digest(plan), at: snapshot.at, snapshot };
}
export type Checkpoint = ReturnType<typeof checkpoint>;
export function continuationApproval(point: Checkpoint, plan: WindowPlan) {
  return digest({ action: 'continue0022-after-restored-backup', checkpoint: digest(point), plan: digest(plan) });
}
export function validateContinuation(point: Checkpoint, admission: WindowPlan, plan: WindowPlan,
  approval: string, current: Snapshot) {
  assertPlan(plan);
  if (point.admission !== digest(admission) || approval !== continuationApproval(point, plan))
    fail('PRE_DDL_CONTINUATION_REQUIRED');
  for (const key of ['target', 'deploymentId', 'serverUuid', 'endpointHash', 'applicationCommit',
    'sqlChecksum', 'sqlSourceCommit', 'operator', 'approver'] as const)
    if (digest(plan[key]) !== digest(admission[key])) fail('CHECKPOINT_IDENTITY_CHANGED');
  if (Date.parse(plan.backup.sourceBefore.at) < Date.parse(point.at)) fail('BACKUP_PREDATES_CONTAINMENT');
  if (current.fingerprint !== PRE || snapshotDigest(point.snapshot) !== snapshotDigest(current) ||
    snapshotDigest(current) !== snapshotDigest(plan.backup.sourceAfter)) fail('CHECKPOINT_DATA_CHANGED');
}
