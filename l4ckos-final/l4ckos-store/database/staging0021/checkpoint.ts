import type { Connection } from "mysql2/promise";
import { canonical, rows, sha256 } from "../schema/fingerprint";
import { loadLineage, validateHistory } from "../migrations/runner";
import { fail, PRE } from "./policy";
export type GovernanceCheckpoint = { version: 1; ledger: Record<string, unknown>[]; executions: Record<string, unknown>[] };
export const checkpointChecksums = (g: GovernanceCheckpoint) => ({ checksum: sha256(canonical(g)), ledgerChecksum: sha256(canonical(g.ledger)), executionChecksum: sha256(canonical(g.executions)) });
export async function governanceCheckpoint(c: Connection): Promise<GovernanceCheckpoint> {
  const ledger = await validateHistory(c, await loadLineage());
  const executions = await rows(c, "SELECT * FROM _l4ckos_schema_executions ORDER BY id");
  return JSON.parse(JSON.stringify({ version: 1, ledger, executions }));
}
export function assertPriorGovernance(g: GovernanceCheckpoint) {
  if (g.version !== 1 || g.ledger.length !== 2 || g.ledger[0].kind !== "RECONCILIATION" || g.ledger[0].name !== "0020_reconcile_asaas_webhook_events" || g.ledger[1].kind !== "BASELINE" || g.ledger[1].postFingerprint !== PRE || g.executions.some(e => e.state !== "COMPLETED") || g.executions.some(e => e.operation === "0021_preorder_production_batches")) fail("STAGING_0021_PRIOR_GOVERNANCE_REQUIRED");
}
