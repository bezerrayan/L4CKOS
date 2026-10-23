import type { Connection, RowDataPacket } from "mysql2/promise";
import { readReleaseManifest, loadLineage, validateHistory, migrateAuthorizedStagingV6 } from "../migrations/runner";
import { ledgerRows, assertNoRecoveryPending } from "../schema/governance";
import { canonical, rows, structuralHash, readStructuralSchema } from "../schema/fingerprint";
import { assertBackupGate, assertIdentity, createAuthorizedV6Capability, digestApplyAuthorization, fail, MIGRATIONS, POST, PRE, AFTER_0024, type BackupGate, type StagingIdentity } from "./policy";
import { assertV6Runtime as assertRuntime } from "./runtime";

type Check = { name: string; passed: boolean; detail?: string };
type Diagnostic = { readOnly: true; identity: { schema: string; mysqlVersion: string; hostname: string } | null; fingerprint: string | null; state: "READY" | "PARTIAL_0024_COMPLETE" | "COMPLETE" | "BLOCKED"; blockedBy?: string; checks: Check[]; pending: string[] };

export async function verifyV6Scope() {
  const manifest = await readReleaseManifest();
  const lineage = await loadLineage(manifest);
  const expected = [
    { name: "0021_preorder_production_batches", checksum: "46e7b40f6320659791ba90d3ebaf4c4cc031e84de36f5bdf8789ab1993d0233d", pre: "f2baf7519cb425c955bfd0f697da10afa670ee57763e3f641b61a09ba75b7f8d", post: "6654c63ea42bbcb84af99e7640f24d3963581128a6a5387898b12b34cbbca93a" },
    { name: "0022_preorder_manufacturing_schedule", checksum: "f6f3ec21394b03da2920d88b163d3aa512a6fe74da4aea4a689dda4f828b26c1", pre: "6654c63ea42bbcb84af99e7640f24d3963581128a6a5387898b12b34cbbca93a", post: "a7c2774e783e83f34c0304e970a91278f4df9e8c2b0a1fd5576c2694c1b9011e" },
    { name: "0023_asaas_webhook_inbox", checksum: "b0b588463e5318fdc63761fd6a8261827478fe058f2152a8a630fa5fa87bae8a", pre: "a7c2774e783e83f34c0304e970a91278f4df9e8c2b0a1fd5576c2694c1b9011e", post: PRE },
    { name: MIGRATIONS[0].name, checksum: MIGRATIONS[0].checksum, pre: MIGRATIONS[0].pre, post: MIGRATIONS[0].post },
    { name: MIGRATIONS[1].name, checksum: MIGRATIONS[1].checksum, pre: MIGRATIONS[1].pre, post: MIGRATIONS[1].post },
  ];
  const reconciliation = lineage.reconciliations[0];
  if (lineage.entries.length !== expected.length || lineage.reconciliations.length !== 1 ||
      reconciliation?.name !== "0020_reconcile_asaas_webhook_events" || reconciliation.checksum !== "cad11dda08787cf7935390a1531002627f7a2894455ad250357b0ec1fa050423" || reconciliation.expectedPreFingerprint !== "09f647cdda027984d3425bef6ccee9cb3496a648602515b0930465b7b02d9efe" || reconciliation.expectedPostFingerprint !== expected[0].pre ||
      lineage.entries.some((entry, index) => entry.kind !== "MIGRATION" || entry.name !== expected[index].name || entry.checksum !== expected[index].checksum || entry.expectedPreFingerprint !== expected[index].pre || entry.expectedPostFingerprint !== expected[index].post) ||
      lineage.entries.at(-1)?.expectedPostFingerprint !== POST) fail("V6_RELEASE_SCOPE_MISMATCH");
  return { manifest, lineage };
}

async function checks(c: Connection, identity: StagingIdentity): Promise<{ diagnostic: Diagnostic; lineage?: Awaited<ReturnType<typeof verifyV6Scope>>["lineage"]; manifest?: Awaited<ReturnType<typeof verifyV6Scope>>["manifest"] }> {
  const checks: Check[] = [];
  const push = (name: string, passed: boolean, detail?: string) => checks.push({ name, passed, ...(detail ? { detail } : {}) });
  const blocked = (name: string, code: string, identity: Diagnostic["identity"] = null, fingerprint: string | null = null): { diagnostic: Diagnostic } => {
    push(name, false, code);
    return { diagnostic: { readOnly: true, identity, fingerprint, state: "BLOCKED", blockedBy: code, checks, pending: MIGRATIONS.map(m => m.name) } };
  };
  let sqlIdentity: Awaited<ReturnType<typeof assertRuntime>>;
  try { sqlIdentity = await assertRuntime(c, identity); push("staging_sql_identity", true, `${sqlIdentity.schema}; MySQL ${sqlIdentity.version}`); }
  catch (error) { return blocked("staging_sql_identity", errorCode(error)); }
  let lineageResult: Awaited<ReturnType<typeof verifyV6Scope>>;
  try { lineageResult = await verifyV6Scope(); push("official_manifest_and_checksums", true, "0024 and 0025 only after 0021–0023"); }
  catch (error) { return blocked("official_manifest_and_checksums", errorCode(error), { schema: sqlIdentity.schema, mysqlVersion: sqlIdentity.version, hostname: sqlIdentity.hostname }); }
  try { await assertNoRecoveryPending(c); push("ledger_has_no_recovery_state", true); }
  catch (error) { return blocked("ledger_has_no_recovery_state", errorCode(error), { schema: sqlIdentity.schema, mysqlVersion: sqlIdentity.version, hostname: sqlIdentity.hostname }); }
  let history: Awaited<ReturnType<typeof validateHistory>>;
  try { history = await validateHistory(c, lineageResult.lineage); push("official_ledger_chain", true, `entries=${history.length}`); }
  catch (error) { return blocked("official_ledger_chain", errorCode(error), { schema: sqlIdentity.schema, mysqlVersion: sqlIdentity.version, hostname: sqlIdentity.hostname }); }
  let fingerprint: string;
  try { fingerprint = structuralHash(await readStructuralSchema(c)); }
  catch (error) { return blocked("current_schema_fingerprint", errorCode(error), { schema: sqlIdentity.schema, mysqlVersion: sqlIdentity.version, hostname: sqlIdentity.hostname }); }
  const relevant = history.filter(r => r.kind === "MIGRATION").map(r => r.name);
  let state: Diagnostic["state"];
  if (fingerprint === PRE && relevant.at(-1) === "0023_asaas_webhook_inbox" && relevant.length === 3) state = "READY";
  else if (fingerprint === AFTER_0024 && relevant.at(-1) === MIGRATIONS[0].name && relevant.length === 4) state = "PARTIAL_0024_COMPLETE";
  else if (fingerprint === POST && relevant.at(-1) === MIGRATIONS[1].name && relevant.length === 5) state = "COMPLETE";
  else return blocked("expected_fingerprint_and_sequence", "V6_FINGERPRINT_OR_SEQUENCE_MISMATCH", { schema: sqlIdentity.schema, mysqlVersion: sqlIdentity.version, hostname: sqlIdentity.hostname }, fingerprint);
  push("expected_fingerprint_and_sequence", true, `${state}; ${fingerprint}`);
  try { const counts = (await rows(c, "SELECT COUNT(*) n FROM productVariants"))[0]; push("variant_inventory_readable", true, `count=${Number(counts.n)}`); }
  catch (error) { return blocked("variant_inventory_readable", errorCode(error), { schema: sqlIdentity.schema, mysqlVersion: sqlIdentity.version, hostname: sqlIdentity.hostname }, fingerprint); }
  const migrationsApplied = new Set(relevant);
  return { diagnostic: { readOnly: true, identity: { schema: sqlIdentity.schema, mysqlVersion: sqlIdentity.version, hostname: sqlIdentity.hostname }, fingerprint, state, checks, pending: MIGRATIONS.filter(m => !migrationsApplied.has(m.name)).map(m => m.name) }, lineage: lineageResult.lineage, manifest: lineageResult.manifest };
}

export async function diagnoseV6(c: Connection, identity: StagingIdentity): Promise<Diagnostic> {
  return (await checks(c, identity)).diagnostic;
}

async function variantSnapshot(c: Connection) {
  return rows(c, "SELECT * FROM productVariants ORDER BY id") as Promise<RowDataPacket[]>;
}
function variantSnapshotDigest(snapshot: RowDataPacket[]) {
  return canonical(snapshot.map(row => { const copy = { ...row }; delete copy.isActive; return copy; }));
}
async function financialAggregates(c: Connection) {
  const orders = (await rows(c, "SELECT COUNT(*) n, COALESCE(SUM(totalPrice),0) total FROM orders"))[0];
  const payments = (await rows(c, "SELECT COUNT(*) n, COALESCE(SUM(amount),0) amount, COALESCE(SUM(paidAmount),0) paid, COALESCE(SUM(netAmount),0) net, COALESCE(SUM(refundedAmount),0) refunded FROM payments"))[0];
  return { orders: [String(orders.n), String(orders.total)], payments: [String(payments.n), String(payments.amount), String(payments.paid), String(payments.net), String(payments.refunded)] };
}
async function assertPostcondition(c: Connection, expectedVariants: RowDataPacket[], expectedFinancials: unknown, expectedFingerprint: string) {
  if (structuralHash(await readStructuralSchema(c)) !== expectedFingerprint) fail("V6_MIGRATION_FINGERPRINT_MISMATCH");
  if (variantSnapshotDigest(await variantSnapshot(c)) !== variantSnapshotDigest(expectedVariants)) fail("V6_EXISTING_VARIANTS_CHANGED");
  if (canonical(await financialAggregates(c)) !== canonical(expectedFinancials)) fail("V6_FINANCIAL_AGGREGATES_CHANGED");
  const settings = await rows(c, "SELECT id,displayMode,rotationIntervalSeconds FROM homeHighlightSettings ORDER BY id");
  if (canonical(settings) !== canonical([{ id: 1, displayMode: "single", rotationIntervalSeconds: 8 }])) fail("V6_HOME_SETTINGS_SEED_MISMATCH");
  if (expectedFingerprint === POST) {
    const inactive = (await rows(c, "SELECT COUNT(*) n FROM productVariants WHERE isActive <> 0"))[0];
    if (Number(inactive.n) !== 0) fail("V6_VARIANT_DEFAULT_NOT_FAIL_CLOSED");
  }
}

/** Diagnostic exposes read-only checks; apply is a separate capability-gated operation. */
export async function applyV6(c: Connection, identity: StagingIdentity, backup: BackupGate, confirmationDigest: string) {
  assertIdentity(identity); assertBackupGate(backup);
  const digest = digestApplyAuthorization(identity, backup);
  if (confirmationDigest !== digest) fail("V6_APPLY_CONFIRMATION_MISMATCH");
  const { diagnostic, lineage, manifest } = await checks(c, identity);
  if (diagnostic.state === "BLOCKED") fail(diagnostic.blockedBy || "V6_PREFLIGHT_BLOCKED");
  if (!lineage || !manifest) return fail("V6_PREFLIGHT_INCOMPLETE");
  if (diagnostic.state !== "READY") fail(diagnostic.state === "COMPLETE" ? "V6_DUPLICATE_EXECUTION_BLOCKED" : "V6_PARTIAL_STATE_BLOCKED");
  const beforeVariants = await variantSnapshot(c), beforeFinancials = await financialAggregates(c);
  const current = structuralHash(await readStructuralSchema(c));
  if (current !== PRE) fail("V6_PREFINGERPRINT_CHANGED");
  assertBackupGate(backup);
  const capability = await createAuthorizedV6Capability(c, identity, backup, confirmationDigest);
  const result = await migrateAuthorizedStagingV6(c, capability, manifest, async entry => {
    const expected = entry.name === MIGRATIONS[0].name ? AFTER_0024 : entry.name === MIGRATIONS[1].name ? POST : undefined;
    if (!expected) return fail("V6_MIGRATION_SCOPE_MISMATCH");
    await assertPostcondition(c, beforeVariants, beforeFinancials, expected);
  });
  const post = await diagnoseV6(c, identity);
  if (post.state !== "COMPLETE" || post.fingerprint !== POST || post.pending.length) fail("V6_POSTCONDITION_FAILED");
  const rowsLedger = await ledgerRows(c);
  if (rowsLedger.filter(r => MIGRATIONS.some(m => m.name === r.name)).length !== 2) fail("V6_LEDGER_RESULT_MISMATCH");
  return { status: result.status, applied: result.applied, fingerprint: post.fingerprint, ledger: rowsLedger.filter(r => MIGRATIONS.some(m => m.name === r.name)).map(r => r.name), variantsAllInactiveByDefault: true, financialAggregatesPreserved: true };
}

function errorCode(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
  return /^[A-Z0-9_]+$/.test(code) ? code : "PREFLIGHT_CHECK_FAILED";
}
