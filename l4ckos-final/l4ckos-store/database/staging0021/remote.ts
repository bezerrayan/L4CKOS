import type { Connection } from "mysql2/promise";
import { openBackupConnection, backupDatabase } from "../../server/database/backupRestore";
import { canonical, readStructuralSchema, structuralHash, sha256 } from "../schema/fingerprint";
import { loadLineage } from "../migrations/runner";
import { assertIdentity, assertPlan, createAuthorizedStagingContext, connectionHash, fail, PRE, TARGET, type Identity, type Plan } from "./policy";
import { assertStagingRuntime } from "../staging/runtime";
import { governanceCheckpoint, assertPriorGovernance } from "./checkpoint";
import { migrateAuthorizedPreorderStaging } from "./runner";
import { assert0021SqlScope } from "./sqlScope";
export async function inspectConnection(c: Connection) {
  const fingerprint = structuralHash(await readStructuralSchema(c));
  const governance = await governanceCheckpoint(c);
  return { fingerprint, secondFingerprint: structuralHash(await readStructuralSchema(c)), governance };
}
export async function reconcileConnection(c: Connection, identity: Identity, plan: Plan, digest: string) {
  const capability = createAuthorizedStagingContext(c, plan, identity, digest);
  const lineage = await loadLineage();
  const permitted = new Set(lineage.entries.filter(e => e.name === plan.migration.name).flatMap(e => e.statements));
  const original = c.query.bind(c);
  let backupPhase = false;
  const events: {event: string; planId: string; at: string}[] = [];
  const event = (name: string) => events.push({ event: name, planId: plan.planId, at: new Date().toISOString() });
  // Only four exact reviewed DDL statements. INSERT-only ledger cannot create a baseline/legacy record.
  c.query = (async (...args: any[]) => {
    const sql = args[0];
    assert0021SqlScope(sql, args[1], plan, permitted, backupPhase);
    const result = await (original as any)(...args);
    if (sql.startsWith("SELECT GET_LOCK") && Number(result[0][0].acquired) === 1) event("lock_acquired");
    if (permitted.has(sql)) event("migration_statement_completed");
    return result;
  }) as typeof c.query;
  try {
    const result = await migrateAuthorizedPreorderStaging(
      c,
      capability,
      async <T>(action: () => Promise<T>): Promise<T> => {
        if (backupPhase) fail("STAGING_WRITE_SCOPE_VIOLATION");
        backupPhase = true;
        try {
          return await action();
        } finally {
          backupPhase = false;
        }
      },
    );
    const governance = await governanceCheckpoint(c);
    if (result.status === "APPLIED") event("migration_validated");
    return { ...result, ledger: governance.ledger, governance, events };
  } finally { c.query = original; }
}
/** Fixed target only. No dotenv, URL override, SQL argument or provider imports. */
export async function remoteOperation(operation: "inspect" | "backup" | "apply", identity: Identity, plan?: Plan, digest?: string) {
  assertIdentity(identity);
  if (Object.entries({ RAILWAY_PROJECT_ID: TARGET.projectId, RAILWAY_ENVIRONMENT_ID: TARGET.environmentId, RAILWAY_SERVICE_ID: TARGET.serviceId, RAILWAY_DEPLOYMENT_ID: identity.deploymentId }).some(([k,v]) => process.env[k] !== v)) fail("STAGING_RUNTIME_IDENTITY_MISMATCH");
  const url = process.env.DATABASE_URL || "";
  let parsed: URL;
  try { parsed = new URL(url); } catch { return fail("STAGING_PRIVATE_DATABASE_REQUIRED"); }
  if (parsed.protocol !== "mysql:" || !parsed.hostname.endsWith(".railway.internal") || parsed.search || parsed.hash) fail("STAGING_PRIVATE_DATABASE_REQUIRED");
  const c = await openBackupConnection(url);
  try {
    assertStagingRuntime(c, identity);
    if (connectionHash(c) !== identity.connectionHash) fail("STAGING_CONNECTION_IDENTITY_MISMATCH");
    if (operation === "inspect") return await inspectConnection(c);
    if (operation === "backup") {
      const before = await inspectConnection(c);
      if (before.fingerprint !== PRE || before.secondFingerprint !== PRE) fail("STAGING_PREWRITE_DRIFT");
      assertPriorGovernance(before.governance);
      const artifact = await backupDatabase(c);
      if (canonical(await inspectConnection(c)) !== canonical(before)) fail("STAGING_PREWRITE_DRIFT");
      const bytes = Buffer.from(JSON.stringify(artifact));
      return { bytes: bytes.toString("base64"), originSha256: sha256(bytes) };
    }
    if (operation !== "apply" || !plan || !digest) fail("INVALID_STAGING_OPERATION");
    assertPlan(plan);
    return await reconcileConnection(c, identity, plan, digest);
  } finally { await c.end(); }
}
