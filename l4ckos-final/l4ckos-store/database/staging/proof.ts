import type { Connection } from "mysql2/promise";
import { backupDatabase, restoreDatabase, type BackupArtifact } from "../../server/database/backupRestore";
import { bootstrapArtifacts } from "../schema/artifacts";
import { readStructuralSchema, structuralHash, canonical } from "../schema/fingerprint";
import { PRE, fail } from "./policy";
import type { LocalTarget } from "../schema/safety";
export async function restoreProof(c: Connection, target: LocalTarget, bytes: Buffer) {
  const artifact = JSON.parse(bytes.toString()) as BackupArtifact;
  for (const entry of (await bootstrapArtifacts()).statements) if (entry.table !== "asaasWebhookEvents") await c.query(entry.sql);
  if (structuralHash(await readStructuralSchema(c)) !== PRE) fail("STAGING_PROOF_SCHEMA_MISMATCH");
  await restoreDatabase(c, artifact, target);
  const restored = await backupDatabase(c);
  if (canonical(Object.fromEntries(Object.entries(restored.tables).map(([t,v]) => [t,[v.rowCount,v.checksum]]))) !== canonical(Object.fromEntries(Object.entries(artifact.tables).map(([t,v]) => [t,[v.rowCount,v.checksum]])))) fail("STAGING_PROOF_DATA_MISMATCH");
  return { verified: true, fingerprint: structuralHash(await readStructuralSchema(c)), rowCounts: Object.fromEntries(Object.entries(restored.tables).map(([t,v]) => [t,v.rowCount])) };
}
