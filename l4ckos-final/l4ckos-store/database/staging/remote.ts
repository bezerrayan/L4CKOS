import type { Connection } from "mysql2/promise";
import { openBackupConnection, backupDatabase } from "../../server/database/backupRestore";
import { readStructuralSchema, structuralHash, sha256, rows } from "../schema/fingerprint";
import { readArtifact } from "../schema/artifacts";
import { reconcileAuthorizedStaging } from "../migrations/runner";
import { ledgerRows } from "../schema/governance";
import { assertIdentity, assertPlan, createAuthorizedStagingContext, connectionHash, fail, PRE, TARGET, type Identity, type Plan } from "./policy";

export async function inspectConnection(c: Connection) {
  const schema = await readStructuralSchema(c), fingerprint = structuralHash(schema);
  return { fingerprint, secondFingerprint: structuralHash(await readStructuralSchema(c)), webhook: schema.tables.some(t => t.name === "asaasWebhookEvents"), internalTables: (await readStructuralSchema(c, true)).tables.map(t => t.name) };
}
export async function reconcileConnection(c: Connection, identity: Identity, plan: Plan, digest: string) {
  const capability = createAuthorizedStagingContext(c, plan, identity, digest);
  const permitted = new Set([
    (await readArtifact("database/migrations/0020_reconcile_asaas_webhook_events.sql", "database/migrations")).toString().trim(),
    (await readArtifact("database/governance/executions.sql", "database/governance")).toString(),
    (await readArtifact("database/governance/ledger.sql", "database/governance")).toString(),
  ]);
  const original = c.query.bind(c);
  const events: { event: string; planId: string; at: string }[] = [];
  const event = (name: string) => events.push({ event: name, planId: plan.planId, at: new Date().toISOString() });
  // Defense in depth: remote DDL is restricted to these exact reviewed statements.
  c.query = (async (...args: any[]) => {
    const sql = args[0];
    if (typeof sql !== "string" || (/^\s*(CREATE|ALTER|DROP|RENAME|TRUNCATE)/i.test(sql) && !permitted.has(sql)) || (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql) && !/^\s*(?:INSERT INTO|UPDATE) _l4ckos_schema_(?:migrations|executions)\b/.test(sql))) fail("STAGING_WRITE_SCOPE_VIOLATION");
    if (sql.startsWith("CREATE TABLE `asaasWebhookEvents`")) event("reconciliation_started");
    const result = await (original as any)(...args);
    if (sql.startsWith("SELECT GET_LOCK") && Number(result[0][0].acquired) === 1) event("lock_acquired");
    if (sql.startsWith("CREATE TABLE `_l4ckos_schema_migrations`")) event("governance_initialized");
    return result;
  }) as typeof c.query;
  try {
    const result = await reconcileAuthorizedStaging(c, capability);
    const webhookRows = Number((await rows(c, "SELECT COUNT(*) n FROM asaasWebhookEvents"))[0].n);
    const ledger = (await ledgerRows(c)).map(r => ({ name: r.name, kind: r.kind, checksum: r.checksum, applicationCommit: r.applicationCommit, description: r.description, preFingerprint: r.preFingerprint, postFingerprint: r.postFingerprint, appliedAt: r.appliedAt, executionDurationMs: r.executionDurationMs }));
    if (result.status === "APPLIED") { event("reconciliation_validated"); event("baseline_created"); }
    return { ...result, webhookRows, ledger, events };
  } finally { c.query = original; }
}
/** Called only in the fixed staging service by the verified transport; never loads application/providers. */
export async function remoteOperation(operation: "inspect" | "backup" | "apply", identity: Identity, plan?: Plan, digest?: string) {
  assertIdentity(identity);
  if (Object.entries({ RAILWAY_PROJECT_ID: TARGET.projectId, RAILWAY_ENVIRONMENT_ID: TARGET.environmentId, RAILWAY_SERVICE_ID: TARGET.serviceId, RAILWAY_DEPLOYMENT_ID: identity.deploymentId }).some(([k,v]) => process.env[k] !== v)) fail("STAGING_RUNTIME_IDENTITY_MISMATCH");
  const url = process.env.DATABASE_URL || "";
  let parsed: URL;
  try { parsed = new URL(url); } catch { return fail("STAGING_PRIVATE_DATABASE_REQUIRED"); }
  if (parsed.protocol !== "mysql:" || !parsed.hostname.endsWith(".railway.internal") || parsed.search || parsed.hash) fail("STAGING_PRIVATE_DATABASE_REQUIRED");
  const c = await openBackupConnection(url);
  try {
    if (connectionHash(c) !== identity.connectionHash) fail("STAGING_CONNECTION_IDENTITY_MISMATCH");
    if (operation === "inspect") return inspectConnection(c);
    if (operation === "backup") {
      const before = await inspectConnection(c);
      if (before.fingerprint !== PRE || before.secondFingerprint !== PRE || before.webhook || before.internalTables.length) fail("STAGING_PREWRITE_DRIFT");
      const artifact = await backupDatabase(c);
      if ((await inspectConnection(c)).fingerprint !== PRE) fail("STAGING_PREWRITE_DRIFT");
      const bytes = Buffer.from(JSON.stringify(artifact));
      return { bytes: bytes.toString("base64"), originSha256: sha256(bytes) };
    }
    if (operation !== "apply" || !plan || !digest) fail("INVALID_STAGING_OPERATION");
    assertPlan(plan);
    return reconcileConnection(c, identity, plan, digest);
  } finally { await c.end(); }
}
