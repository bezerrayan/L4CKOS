import type { Connection } from "mysql2/promise";
import { performance } from "node:perf_hooks";
import { bootstrapArtifacts, readContract } from "../schema/artifacts";
import { readStructuralSchema, structuralHash, rows } from "../schema/fingerprint";
import { SchemaError } from "../schema/safety";
import { assertCanonical, ensureGovernance, execution, completeExecution, insertLedger, withSchemaLock, type OperationContext } from "../schema/governance";

export async function bootstrapDatabase(connection: Connection, context: OperationContext) {
  return withSchemaLock(connection, context, async () => {
    const startedAt = performance.now();
    const artifacts = await bootstrapArtifacts();
    const contract = await readContract();
    if (context.approvedFingerprint !== contract.fingerprint) throw new SchemaError("APPROVED_FINGERPRINT_REQUIRED");
    // Empty means no objects at all, including governance, views and unsupported objects.
    const objects = await rows(connection, "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()");
    const initial = await readStructuralSchema(connection);
    if (objects.length || Object.values(initial.unsupported).some(Boolean)) throw new SchemaError("BOOTSTRAP_TARGET_NOT_EMPTY");
    await ensureGovernance(connection);
    const preFingerprint = structuralHash(initial);
    await execution(connection, context, { name: "fresh-bootstrap-v1", checksum: artifacts.checksum, preFingerprint }, async (checkpoint, executionId) => {
      for (const statement of artifacts.statements) { await connection.query(statement.sql); await checkpoint(); }
      await assertCanonical(connection, context.approvedFingerprint);
      // DML success and trail completion use one transaction AFTER all implicit-commit DDL.
      await connection.beginTransaction();
      try {
        await insertLedger(connection, context, { name: "baseline-v1", kind: "BASELINE", checksum: contract.checksum, description: "FRESH BOOTSTRAP v1; inspected canonical schema; no legacy execution claims", preFingerprint: contract.fingerprint, postFingerprint: contract.fingerprint, startedAt, manifestVersion: 1 });
        await completeExecution(connection, executionId, contract.fingerprint);
        await connection.commit();
      } catch (error) { await connection.rollback(); throw error; }
    });
    return { status: "BOOTSTRAPPED", fingerprint: contract.fingerprint, tables: artifacts.statements.length };
  });
}

/** Fresh operational bootstrap preserves the original baseline then executes reviewed forward migrations. */
export async function bootstrapCurrentDatabase(connection: Connection, context: OperationContext) {
  const {readCurrentContract}=await import('../schema/artifacts');
  const {migrateDatabase,readOperationalManifest}=await import('../migrations/runner');
  const current=await readCurrentContract(),baseline=await readContract();
  if(context.approvedFingerprint!==current.fingerprint) throw new SchemaError('APPROVED_FINGERPRINT_REQUIRED');
  await bootstrapDatabase(connection,{...context,approvedFingerprint:baseline.fingerprint});
  const migrated=await migrateDatabase(connection,context,await readOperationalManifest());
  if(migrated.fingerprint!==current.fingerprint) throw new SchemaError('CANONICAL_SCHEMA_DRIFT');
  return {...migrated,status:'BOOTSTRAPPED_CURRENT',tables:current.schema.tables.length};
}
