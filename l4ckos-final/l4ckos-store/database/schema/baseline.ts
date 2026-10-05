import type { Connection } from "mysql2/promise";
import { SchemaError } from "./safety";
import { appendCanonicalBaseline, assertCanonical, assertNoRecoveryPending, ensureGovernance, ledgerRows, withSchemaLock, type OperationContext } from "./governance";
import { loadLineage, validateHistory } from "../migrations/runner";

export async function baselineDatabase(connection: Connection, context: OperationContext) {
  return withSchemaLock(connection, context, async () => {
    const contract = await assertCanonical(connection, context.approvedFingerprint);
    await ensureGovernance(connection);
    await assertNoRecoveryPending(connection);
    const existing = await ledgerRows(connection);
    const lineage = await loadLineage();
    if (existing.some(row => row.kind === "BASELINE")) {
      await validateHistory(connection, lineage);
      return { status: "ALREADY_BASELINED", fingerprint: contract.fingerprint };
    }
    if (existing.length) {
      await validateHistory(connection, lineage, false);
      if (existing.length !== lineage.reconciliations.length) throw new SchemaError("INCOMPLETE_RECONCILIATION_HISTORY");
    }
    await appendCanonicalBaseline(connection, context, "EXISTING CANONICAL SCHEMA inspected and accepted; no legacy execution claims");
    await validateHistory(connection, lineage);
    return { status: "BASELINED", fingerprint: contract.fingerprint };
  });
}
