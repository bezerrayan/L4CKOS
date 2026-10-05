import governanceContract from "./governance-v1.json";
import type { Connection } from "mysql2/promise";
import { performance } from "node:perf_hooks";
import { readArtifact, readContract } from "./artifacts";
import { readStructuralSchema, rows, sha256, structuralHash } from "./fingerprint";
import { verifyLocalConnection, SchemaError, type LocalTarget } from "./safety";

export const RUNNER_VERSION = "2.0.0";
export type OperationContext = LocalTarget & { applicationCommit: string; approvedFingerprint: string; lockTimeoutSeconds?: number };
const activeConnections = new WeakSet<Connection>();
export async function withSchemaLock<T>(connection: Connection, context: OperationContext, action: () => Promise<T>) {
  await verifyLocalConnection(connection, context);
  if (!/^[a-f0-9]{40}$/.test(context.applicationCommit)) throw new SchemaError("APPLICATION_COMMIT_REQUIRED");
  const timeout = context.lockTimeoutSeconds ?? 1;
  if (!Number.isInteger(timeout) || timeout < 0 || timeout > 10) throw new SchemaError("FINITE_LOCK_TIMEOUT_REQUIRED");
  if (activeConnections.has(connection)) throw new SchemaError("CONNECTION_OPERATION_ACTIVE");
  activeConnections.add(connection);
  const name = `l4ckos_schema_v2_${sha256(connection.config.database!).slice(0, 32)}`;
  let locked = false;
  try {
    const acquired = (await rows(connection, "SELECT GET_LOCK(?, ?) acquired", [name, timeout]))[0].acquired;
    if (Number(acquired) !== 1) throw new SchemaError("SCHEMA_LOCK_UNAVAILABLE");
    locked = true;
    return await action();
  } finally {
    try {
      if (locked && Number((await rows(connection, "SELECT RELEASE_LOCK(?) released", [name]))[0].released) !== 1) throw new SchemaError("SCHEMA_LOCK_RELEASE_FAILED");
    } finally { activeConnections.delete(connection); }
  }
}
export async function assertCanonical(connection: Connection, approvedFingerprint: string) {
  const contract = await readContract();
  if (approvedFingerprint !== contract.fingerprint) throw new SchemaError("APPROVED_FINGERPRINT_REQUIRED");
  const current = await readStructuralSchema(connection);
  const expectedNames = new Set(contract.schema.tables.map(t => t.name));
  if (current.tables.some(t => !expectedNames.has(t.name))) throw new SchemaError("UNKNOWN_BUSINESS_TABLE");
  if (structuralHash(current) !== contract.fingerprint) throw new SchemaError("CANONICAL_SCHEMA_DRIFT");
  return contract;
}
export async function validateGovernance(connection: Connection) {
  if (structuralHash(governanceContract.schema) !== governanceContract.fingerprint) throw new SchemaError("INVALID_APPROVED_CONTRACT");
  if (structuralHash(await readStructuralSchema(connection, true)) !== governanceContract.fingerprint) throw new SchemaError("GOVERNANCE_SCHEMA_DRIFT");
}
export async function ensureGovernance(connection: Connection) {
  const existing = await readStructuralSchema(connection, true);
  if (existing.tables.length) { await validateGovernance(connection); return; }
  const manifest = JSON.parse((await readArtifact("database/governance/manifest.json", "database/governance")).toString("utf8")) as { version: number; tables: { path: string; checksum: string }[] };
  if (manifest.version !== 1 || manifest.tables.length !== 2) throw new SchemaError("INVALID_GOVERNANCE_MANIFEST");
  const statements: string[] = [];
  for (const entry of manifest.tables) {
    const sql = await readArtifact(entry.path, "database/governance");
    if (sha256(sql) !== entry.checksum) throw new SchemaError("GOVERNANCE_CHECKSUM_MISMATCH");
    statements.push(sql.toString("utf8"));
  }
  let completed = 0;
  try {
    for (const sql of statements) { await connection.query(sql); completed++; }
    await validateGovernance(connection);
  } catch { throw new SchemaError("RECOVERY_REQUIRED", { operation: "governance-v1", completedStatements: completed, preFingerprint: structuralHash(existing), observedFingerprint: null }); }
}
export async function assertNoRecoveryPending(connection: Connection) {
  if ((await rows(connection, "SELECT id FROM _l4ckos_schema_executions WHERE state <> 'COMPLETED' LIMIT 1")).length) throw new SchemaError("RECOVERY_REQUIRED");
}
export async function ledgerRows(connection: Connection) {
  return rows(connection, "SELECT * FROM _l4ckos_schema_migrations ORDER BY id");
}
export async function insertLedger(connection: Connection, context: OperationContext, input: { name: string; kind: "BASELINE" | "MIGRATION" | "RECONCILIATION"; checksum: string; description: string; preFingerprint: string; postFingerprint: string; startedAt: number; manifestVersion: number }) {
  // Intentionally INSERT-only. No UPSERT, UPDATE, DELETE or history repair path.
  await connection.query("INSERT INTO _l4ckos_schema_migrations (name,kind,checksum,applicationCommit,description,preFingerprint,postFingerprint,manifestVersion,runnerVersion,executionDurationMs) VALUES (?,?,?,?,?,?,?,?,?,?)", [input.name, input.kind, input.checksum, context.applicationCommit, input.description, input.preFingerprint, input.postFingerprint, input.manifestVersion, RUNNER_VERSION, Math.max(0, Math.round(performance.now() - input.startedAt))]);
}
export async function execution(connection: Connection, context: OperationContext, input: { name: string; checksum: string; preFingerprint: string }, action: (checkpoint: () => Promise<void>, executionId: number) => Promise<void>) {
  const [result] = await connection.query<any>("INSERT INTO _l4ckos_schema_executions (operation,checksum,applicationCommit,state,preFingerprint) VALUES (?,?,?,'STARTED',?)", [input.name, input.checksum, context.applicationCommit, input.preFingerprint]);
  const id = result.insertId;
  let completed = 0;
  try {
    await action(async () => {
      completed++;
      await connection.query("UPDATE _l4ckos_schema_executions SET completedStatements=? WHERE id=? AND state='STARTED'", [completed, id]);
    }, id);
  } catch {
    let observed: string | null = null;
    try { observed = structuralHash(await readStructuralSchema(connection)); } catch { /* Evidence unavailable; never infer rollback. */ }
    try { await connection.query("UPDATE _l4ckos_schema_executions SET state='FAILED', observedFingerprint=?,errorCode='RECOVERY_REQUIRED',finishedAt=CURRENT_TIMESTAMP(3) WHERE id=? AND state='STARTED'", [observed, id]); } catch { /* STARTED itself blocks retry if connection was lost. */ }
    throw new SchemaError("RECOVERY_REQUIRED", { operation: input.name, completedStatements: completed, preFingerprint: input.preFingerprint, observedFingerprint: observed });
  }
  return id as number;
}
export async function completeExecution(connection: Connection, id: number, observed: string) {
  await connection.query("UPDATE _l4ckos_schema_executions SET state='COMPLETED',observedFingerprint=?,finishedAt=CURRENT_TIMESTAMP(3) WHERE id=? AND state='STARTED'", [observed, id]);
}

export async function appendCanonicalBaseline(connection: Connection, context: OperationContext, description: string) {
  const startedAt = performance.now();
  const contract = await assertCanonical(connection, context.approvedFingerprint);
  await execution(connection, context, { name: "baseline-v1", checksum: contract.checksum, preFingerprint: contract.fingerprint }, async (_checkpoint, id) => {
    await connection.beginTransaction();
    try {
      await insertLedger(connection, context, { name: "baseline-v1", kind: "BASELINE", checksum: contract.checksum, description, preFingerprint: contract.fingerprint, postFingerprint: contract.fingerprint, manifestVersion: 1, startedAt });
      await completeExecution(connection, id, contract.fingerprint);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; }
  });
}
