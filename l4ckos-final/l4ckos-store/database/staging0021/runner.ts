import type { Connection } from "mysql2/promise";
import { performance } from "node:perf_hooks";
import { canonical, readStructuralSchema, structuralHash } from "../schema/fingerprint";
import { loadLineage } from "../migrations/runner";
import { withAuthorizedPreorderStagingLock, execution, completeExecution, insertLedger } from "../schema/governance";
import { backupDatabase } from "../../server/database/backupRestore";
import { assertPriorGovernance, governanceCheckpoint, checkpointChecksums } from "./checkpoint";
import { verifyStagingCapability, MIGRATION, PRE, POST, fail, type AuthorizedStagingCapability } from "./policy";
import { verifyScope } from "./executor";
export async function migrateAuthorizedPreorderStaging(
  c: Connection,
  capability: AuthorizedStagingCapability,
  withBackupPhase?: <T>(action: () => Promise<T>) => Promise<T>,
) {
  return withAuthorizedPreorderStagingLock(c, capability, async () => {
    const plan = await verifyStagingCapability(c, capability);
    await verifyScope();
    const before = structuralHash(await readStructuralSchema(c));
    const governance = await governanceCheckpoint(c);
    if (before === POST) {
      const migration = governance.ledger[2];
      const prior = { ...governance, ledger: governance.ledger.slice(0,2), executions: governance.executions.filter(e => e.operation !== MIGRATION.name) };
      assertPriorGovernance(prior);
      const completed = governance.executions.filter(e => e.operation === MIGRATION.name);
      if (governance.ledger.length !== 3 || !migration || migration.applicationCommit !== plan.applicationCommit || migration.runnerVersion !== "2.0.0" || Number(migration.manifestVersion) !== 2 || completed.length !== 1 || completed[0].applicationCommit !== plan.applicationCommit || Number(completed[0].completedStatements) !== 4 || completed[0].observedFingerprint !== POST || canonical(checkpointChecksums(prior)) !== canonical(plan.governance)) fail("STAGING_REPLAY_HISTORY_MISMATCH");
      return { status: "UP_TO_DATE", applied: [], fingerprint: POST };
    }
    if (before !== PRE) fail("STAGING_PREWRITE_DRIFT");
    assertPriorGovernance(governance);
    if (canonical(checkpointChecksums(governance)) !== canonical(plan.governance)) fail("STAGING_GOVERNANCE_CHANGED");
    const snapshot = await (
      withBackupPhase
        ? withBackupPhase(() => backupDatabase(c))
        : backupDatabase(c)
    );
    if (snapshot.schemaFingerprint !== plan.backup.schemaFingerprint || canonical(Object.fromEntries(Object.entries(snapshot.tables).map(([t,v]) => [t,v.rowCount]))) !== canonical(plan.backup.rowCounts) || canonical(Object.fromEntries(Object.entries(snapshot.tables).map(([t,v]) => [t,v.checksum]))) !== canonical(plan.backup.rowChecksums)) fail("STAGING_PREWRITE_DATA_CHANGED");
    await verifyStagingCapability(c, capability);
    const entry = (await loadLineage()).entries[0];
    const context = { applicationCommit: plan.applicationCommit, approvedFingerprint: POST };
    const startedAt = performance.now();
    await execution(c, context, { name: entry.name, checksum: entry.checksum, preFingerprint: PRE }, async (checkpoint, id) => {
      for (const statement of entry.statements) { await c.query(statement); await checkpoint(); }
      if (structuralHash(await readStructuralSchema(c)) !== POST) fail("MIGRATION_POSTFINGERPRINT_MISMATCH");
      await c.beginTransaction();
      try {
        await insertLedger(c, context, { ...entry, preFingerprint: PRE, postFingerprint: POST, manifestVersion: 2, startedAt });
        await completeExecution(c, id, POST);
        await c.commit();
      } catch (error) { await c.rollback(); throw error; }
    });
    const after = await governanceCheckpoint(c);
    if (after.ledger.length !== 3 || after.ledger[2].applicationCommit !== plan.applicationCommit) fail("RECOVERY_REQUIRED");
    return { status: "APPLIED", applied: [MIGRATION.name], fingerprint: POST };
  });
}
