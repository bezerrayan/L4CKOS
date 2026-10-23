import type { Connection } from "mysql2/promise";
import { performance } from "node:perf_hooks";
import { readArtifact, readContract, readRecognizedExistingContract } from "../schema/artifacts";
import { readStructuralSchema, structuralHash, sha256, canonical } from "../schema/fingerprint";
import { SchemaError } from "../schema/safety";
import { appendCanonicalBaseline, assertNoRecoveryPending, ensureGovernance, completeExecution, execution, insertLedger, ledgerRows, validateGovernance, withSchemaLock, type OperationContext, type LedgerContext, withAuthorizedStagingLock, withVerifiedStagingSchemaLock } from "../schema/governance";
import { consumeAuthorizedV6Capability, type AuthorizedV6Capability } from "../stagingV6/policy";

export type MigrationEntry = {
  name: string; kind: "MIGRATION" | "RECONCILIATION"; checksum: string; path: string;
  description: string; expectedPreFingerprint: string; expectedPostFingerprint: string;
};
export type LineageManifest = { version: 2; migrations: MigrationEntry[]; unbaselined?: { expectedInitialFingerprint: string; reconciliations: MigrationEntry[] } };
/** Operational forward lineage; the fixed legacy staging executors retain manifest.json. */
export async function readOperationalManifest(): Promise<LineageManifest> {
  return JSON.parse((await readArtifact("database/migrations/manifest-v3.json", "database/migrations")).toString("utf8"));
}
export async function loadLineage(manifest?: LineageManifest) {
  const input = manifest ?? JSON.parse((await readArtifact("database/migrations/manifest.json", "database/migrations")).toString("utf8")) as LineageManifest;
  if (input.version !== 2 || !Array.isArray(input.migrations)) throw new SchemaError("INVALID_LINEAGE_MANIFEST");
  const contract = await readContract();
  const existingContract = await readRecognizedExistingContract();
  if (input.unbaselined && (![contract.fingerprint, existingContract.fingerprint].includes(input.unbaselined.expectedInitialFingerprint) || !Array.isArray(input.unbaselined.reconciliations) || !input.unbaselined.reconciliations.length || input.unbaselined.reconciliations.some(e => e.kind !== "RECONCILIATION"))) throw new SchemaError("INVALID_RECONCILIATION_MANIFEST");
  const reconcileInput = input.unbaselined?.reconciliations ?? [];
  let expected = input.unbaselined?.expectedInitialFingerprint ?? contract.fingerprint;
  const names = new Set<string>();
  const entries: (MigrationEntry & { statements: string[] })[] = [];
  for (const [index, entry] of [...reconcileInput, ...input.migrations].entries()) {
    if (index === reconcileInput.length) {
      if (expected !== contract.fingerprint) throw new SchemaError("RECONCILIATION_MUST_REACH_CANONICAL");
      expected = contract.fingerprint;
    }
    if (!/^[a-z0-9][a-z0-9_-]{0,190}$/.test(entry.name) || /^(?:00(?:0\d|1\d))(?:_|$)/.test(entry.name) || names.has(entry.name) ||
        !["MIGRATION", "RECONCILIATION"].includes(entry.kind) || typeof entry.description !== "string" || entry.description.length > 500 ||
        entry.expectedPreFingerprint !== expected || !/^[a-f0-9]{64}$/.test(entry.expectedPostFingerprint) || !/^[a-f0-9]{64}$/.test(entry.checksum)) throw new SchemaError("INVALID_LINEAGE_MANIFEST");
    names.add(entry.name);
    const sql = await readArtifact(entry.path, "database/migrations");
    if (sha256(sql) !== entry.checksum) throw new SchemaError("MIGRATION_CHECKSUM_MISMATCH");
    const statements = sql.toString("utf8").split(/^-- l4ckos:statement-breakpoint\s*$/m).map(s => s.trim()).filter(Boolean);
    if (!statements.length || statements.some(s => /^\s*(?:DELIMITER|USE\s|SET\s|START\s|COMMIT|ROLLBACK)/i.test(s))) throw new SchemaError("UNSUPPORTED_MIGRATION_STATEMENT");
    // Session/control changes and governance writes are never part of business migrations.
    if (statements.some(s => /_l4ckos_schema_|\bforeign_key_checks\b|\bGET_LOCK\s*\(|\bRELEASE_LOCK\s*\(/i.test(s))) throw new SchemaError("GOVERNANCE_MUTATION_FORBIDDEN");
    entries.push({ ...entry, statements });
    expected = entry.expectedPostFingerprint;
  }
  if (reconcileInput.length && !input.migrations.length && expected !== contract.fingerprint) throw new SchemaError("RECONCILIATION_MUST_REACH_CANONICAL");
  return { contract, entries: entries.slice(reconcileInput.length), reconciliations: entries.slice(0, reconcileInput.length), initialFingerprint: input.unbaselined?.expectedInitialFingerprint };

}
export async function validateHistory(connection: Connection, lineage: Awaited<ReturnType<typeof loadLineage>>, requireBaseline = true) {
  await validateGovernance(connection);
  await assertNoRecoveryPending(connection);
  const history = await ledgerRows(connection);
  const baselineIndex = history.findIndex(row => row.kind === "BASELINE");
  const prefix = baselineIndex < 0 ? history : history.slice(0, baselineIndex);
  if (baselineIndex !== 0) {
    if (!lineage.initialFingerprint || prefix.length > lineage.reconciliations.length) throw new SchemaError("BASELINE_REQUIRED");
    for (let i = 0; i < prefix.length; i++) verifyEntry(prefix[i], lineage.reconciliations[i]);
    if (baselineIndex > 0 && prefix.length !== lineage.reconciliations.length) throw new SchemaError("INCOMPLETE_RECONCILIATION_HISTORY");
  }
  if (baselineIndex < 0 && requireBaseline) throw new SchemaError("BASELINE_REQUIRED");
  if (baselineIndex >= 0) {
    const baseline = history[baselineIndex];
    if (baseline.name !== "baseline-v1" || baseline.checksum !== lineage.contract.checksum || baseline.preFingerprint !== lineage.contract.fingerprint || baseline.postFingerprint !== lineage.contract.fingerprint || Number(baseline.manifestVersion) !== 1) throw new SchemaError("BASELINE_CHECKSUM_OR_FINGERPRINT_MISMATCH");
    const migrations = history.slice(baselineIndex + 1);
    if (migrations.length > lineage.entries.length) throw new SchemaError("UNKNOWN_LEDGER_ENTRY");
    for (let i = 0; i < migrations.length; i++) verifyEntry(migrations[i], lineage.entries[i]);
  }
  const expected = history.length ? history[history.length - 1].postFingerprint : lineage.initialFingerprint;
  if (structuralHash(await readStructuralSchema(connection)) !== expected) throw new SchemaError("MIGRATION_PREFINGERPRINT_MISMATCH");
  return history;
}
function verifyEntry(recorded: Record<string, unknown>, entry: MigrationEntry) {
  if (recorded.name !== entry.name || recorded.kind !== entry.kind || recorded.checksum !== entry.checksum || recorded.preFingerprint !== entry.expectedPreFingerprint || recorded.postFingerprint !== entry.expectedPostFingerprint || Number(recorded.manifestVersion) !== 2) throw new SchemaError("LEDGER_CHECKSUM_OR_CHAIN_MISMATCH");
}
/** Only the explicit new manifest is loaded. drizzle SQL/journal is never read. */
export async function migrateDatabase(connection: Connection, context: OperationContext, manifest?: LineageManifest) {
  return withSchemaLock(connection, context, () => runMigrationBody(connection, context, manifest));
}
import { verifyStagingCapability, MIGRATION, PRE, POST, fail, type AuthorizedStagingCapability } from "../staging/policy";
export async function reconcileAuthorizedStaging(connection: Connection, capability: AuthorizedStagingCapability) {
  return withAuthorizedStagingLock(connection, capability, async () => {
    const plan = await verifyStagingCapability(connection, capability);
    const lineage = await loadLineage();
    if (lineage.reconciliations.length !== 1 || lineage.initialFingerprint !== PRE || lineage.contract.fingerprint !== POST || lineage.reconciliations[0].name !== MIGRATION.name || lineage.reconciliations[0].kind !== MIGRATION.kind || lineage.reconciliations[0].checksum !== MIGRATION.checksum) fail("STAGING_MIGRATION_SCOPE_MISMATCH");
    const current = structuralHash(await readStructuralSchema(connection));
    const internal = await readStructuralSchema(connection, true);
    if (current === POST) {
      const history = await validateHistory(connection, lineage);
      if (history.length !== 2 || history.some(r => r.applicationCommit !== plan.applicationCommit)) fail("STAGING_REPLAY_HISTORY_MISMATCH");
      return { status: "ALREADY_APPLIED", applied: [], fingerprint: POST };
    }
    if (current !== PRE || internal.tables.length) fail("STAGING_PREWRITE_DRIFT");
    const { backupDatabase } = await import("../../server/database/backupRestore");
    const snapshot = await backupDatabase(connection);
    if (snapshot.schemaFingerprint !== plan.backup.schemaFingerprint ||
        canonical(Object.fromEntries(Object.entries(snapshot.tables).map(([t,v]) => [t,v.rowCount]))) !== canonical(plan.backup.rowCounts) ||
        canonical(Object.fromEntries(Object.entries(snapshot.tables).map(([t,v]) => [t,v.checksum]))) !== canonical(plan.backup.rowChecksums)) fail("STAGING_PREWRITE_DATA_CHANGED");
    await verifyStagingCapability(connection, capability);
    const reviewed=JSON.parse((await readArtifact("database/migrations/manifest.json","database/migrations")).toString("utf8")) as LineageManifest;
    // This legacy authorized operation remains restricted to 0020 even when forward migrations exist.
    return runMigrationBody(connection, { applicationCommit: plan.applicationCommit, approvedFingerprint: POST }, {...reviewed,migrations:[]}, async () => {
      const [counts] = await connection.query<any[]>("SELECT COUNT(*) n FROM asaasWebhookEvents");
      if (Number(counts[0].n) !== 0) fail("STAGING_WEBHOOK_TABLE_NOT_EMPTY");
    });
  });
}
/** Runs the unmodified release lineage under an independently verified fixed staging capability. */
export async function migrateAuthorizedStagingV6(
  connection: Connection,
  capability: AuthorizedV6Capability,
  manifest: LineageManifest,
  validatePost?: (entry: MigrationEntry) => Promise<void>,
) {
  const { context, verify } = await consumeAuthorizedV6Capability(connection, capability);
  return withVerifiedStagingSchemaLock(connection, context, verify, () => runMigrationBody(connection, context, manifest, validatePost));
}
async function runMigrationBody(connection: Connection, context: LedgerContext, manifest?: LineageManifest, validatePost?: (entry: MigrationEntry) => Promise<void>) {
    const lineage = await loadLineage(manifest);
    const targetFingerprint=lineage.entries.at(-1)?.expectedPostFingerprint ?? lineage.contract.fingerprint;
    if (![targetFingerprint,lineage.contract.fingerprint].includes(context.approvedFingerprint)) throw new SchemaError("APPROVED_FINGERPRINT_REQUIRED");
    const internal = await readStructuralSchema(connection, true);
    if (!internal.tables.length) {
      if (!lineage.initialFingerprint) throw new SchemaError("BASELINE_REQUIRED");
      if (structuralHash(await readStructuralSchema(connection)) !== lineage.initialFingerprint) throw new SchemaError("RECONCILIATION_PREFINGERPRINT_MISMATCH");
      await ensureGovernance(connection);
    }
    let history = await validateHistory(connection, lineage, false);
    const applied: string[] = [];
    if (!history.some(row => row.kind === "BASELINE")) {
      for (const entry of lineage.reconciliations.slice(history.length)) await applyEntry(entry);
      await appendCanonicalBaseline(connection, context, "POST RECONCILIATION: existing schema reconciled; canonical-v1 validated and accepted as initial trusted governance point; no legacy execution claims");
      history = await validateHistory(connection, lineage);
    }
    const baselineIndex = history.findIndex(row => row.kind === "BASELINE");
    for (const entry of lineage.entries.slice(history.length - baselineIndex - 1)) await applyEntry(entry);
    async function applyEntry(entry: Awaited<ReturnType<typeof loadLineage>>["entries"][number]) {
      const startedAt = performance.now();
      const before = structuralHash(await readStructuralSchema(connection));
      if (before !== entry.expectedPreFingerprint) throw new SchemaError("MIGRATION_PREFINGERPRINT_MISMATCH");
      await execution(connection, context, { name: entry.name, checksum: entry.checksum, preFingerprint: before }, async (checkpoint, executionId) => {
        for (const statement of entry.statements) { await connection.query(statement); await checkpoint(); }
        const after = structuralHash(await readStructuralSchema(connection));
        if (after !== entry.expectedPostFingerprint) throw new SchemaError("MIGRATION_POSTFINGERPRINT_MISMATCH");
        await (validatePost as ((entry: MigrationEntry) => Promise<void>) | undefined)?.(entry);
        await connection.beginTransaction();
        try {
          await insertLedger(connection, context, { name: entry.name, kind: entry.kind, checksum: entry.checksum, description: entry.description, preFingerprint: before, postFingerprint: after, manifestVersion: 2, startedAt });
          await completeExecution(connection, executionId, after);
          await connection.commit();
        } catch (error) { await connection.rollback(); throw error; }
      });
      applied.push(entry.name);
    }
    await validateHistory(connection, lineage);
    return { status: applied.length ? "APPLIED" : "UP_TO_DATE", applied, fingerprint: structuralHash(await readStructuralSchema(connection)) };
}

/** Current local release lineage; fixed staging operators retain their pinned manifests. */
export async function readReleaseManifest(): Promise<LineageManifest> {
  return JSON.parse((await readArtifact("database/migrations/manifest-v6.json", "database/migrations")).toString("utf8"));
}
