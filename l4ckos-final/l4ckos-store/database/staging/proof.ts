import type { Connection } from "mysql2/promise";
import { backupDatabase, restoreDatabase, type BackupArtifact } from "../../server/database/backupRestore";
import { bootstrapArtifacts } from "../schema/artifacts";
import { readStructuralSchema, structuralHash } from "../schema/fingerprint";
import { PRE, fail } from "./policy";
import type { LocalTarget } from "../schema/safety";
import { RestoreProofError, restoreDiagnostic } from "./restoreDiagnostics";
export async function restoreProof(c: Connection, target: LocalTarget, bytes: Buffer) {
  let phase = "RESTORE_SCHEMA_PREPARATION_FAILED";
  try {
  const artifact = JSON.parse(bytes.toString()) as BackupArtifact;
  for (const entry of (await bootstrapArtifacts()).statements) if (entry.table !== "asaasWebhookEvents") await c.query(entry.sql);
  if (structuralHash(await readStructuralSchema(c)) !== PRE) fail("STAGING_PROOF_SCHEMA_MISMATCH");
  phase = "RESTORE_IMPORT_FAILED";
  await restoreDatabase(c, artifact, target);
  phase = "RESTORE_VALIDATION_FAILED";
  const restored = await backupDatabase(c);
  const tables = Object.fromEntries(Object.entries(restored.tables).map(([table, value]) => {
    const expected = artifact.tables[table];
    if (value.rowCount !== expected.rowCount || value.checksum !== expected.checksum) throw new RestoreProofError({ detail: value.rowCount !== expected.rowCount ? "RESTORE_ROWCOUNT_FAILED" : "RESTORE_CHECKSUM_FAILED", table, expectedCount: expected.rowCount, observedCount: value.rowCount, expectedChecksum: expected.checksum, observedChecksum: value.checksum });
    return [table, { expectedRows: expected.rowCount, restoredRows: value.rowCount, checksumVerified: true }];
  }));
  const fingerprint = structuralHash(await readStructuralSchema(c));
  if (fingerprint !== PRE) throw new RestoreProofError({ detail: "RESTORE_FINGERPRINT_FAILED" });
  return { verified: true, fingerprint, rowCounts: Object.fromEntries(Object.entries(restored.tables).map(([t,v]) => [t,v.rowCount])), tables };
  } catch (error) { throw new RestoreProofError(restoreDiagnostic(error, phase)); }
}
