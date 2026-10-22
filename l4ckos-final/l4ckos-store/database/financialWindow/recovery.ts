import type { Connection } from "mysql2/promise";
import { rows, sha256 } from "../schema/fingerprint";
import {
  captureSnapshot,
  verifyFinancial,
} from "../financialRecovery/evidence";
import { TARGET, type Checkpoint } from "../financialRecovery/policy";
export const CONTROL_RECOVERY_SQL =
  "SET GLOBAL read_only=ON;\nSET GLOBAL event_scheduler=OFF;\nALTER USER 'root'@'localhost' ACCOUNT UNLOCK;\nSET GLOBAL super_read_only=ON;\n";
/** Applied only at a separately approved restart with authenticated orchestration,
 * existing data, --skip-networking, --read-only=ON, --event-scheduler=OFF.
 * Never --skip-grant-tables, a new password/account, or executor unlock.
 */
export function controlRecoveryPlan(
  authorized: boolean,
  reference: string,
  journalHash: string
) {
  if (
    !authorized ||
    !/^[-a-zA-Z0-9_]{8,80}$/.test(reference) ||
    !/^[a-f0-9]{64}$/.test(journalHash)
  )
    throw Error("WINDOW_CONTROL_RECOVERY_APPROVAL");
  return {
    sql: CONTROL_RECOVERY_SQL,
    sqlSha256: sha256(CONTROL_RECOVERY_SQL),
    mysqlArgs: [
      "--skip-networking",
      "--read-only=ON",
      "--super-read-only=OFF",
      "--event-scheduler=OFF",
    ],
    reference,
    journalHash,
    requiresFreshAuthentication: true,
    automaticRetry: false,
  };
}
export async function inspectAfterControlLoss(
  c: Connection,
  checkpoint: Checkpoint,
  approvalReference: string,
  assertIdentity: () => Promise<void>,
  executionStarted: boolean
) {
  await assertIdentity();
  const [s] = await rows(
    c,
    "SELECT @@GLOBAL.read_only ro,@@GLOBAL.super_read_only sro,@@GLOBAL.event_scheduler scheduler,CURRENT_USER() account"
  );
  if (
    Number(s.ro) !== 1 ||
    Number(s.sro) !== 1 ||
    s.scheduler !== "OFF" ||
    s.account !== "root@localhost"
  )
    throw Error("WINDOW_CONTROL_RECOVERY_MODE");
  if (
    Number(
      (
        await rows(
          c,
          "SELECT COUNT(*) n FROM mysql.user WHERE account_locked='N' AND NOT (User='root' AND Host='localhost')"
        )
      )[0].n
    )
  )
    throw Error("WINDOW_CONTROL_RECOVERY_ADMISSION");
  await c.query("SET TRANSACTION READ ONLY");
  await c.beginTransaction();
  try {
    const current = await captureSnapshot(c);
    if (
      JSON.stringify(current.tableHashes) ===
      JSON.stringify(checkpoint.snapshot.tableHashes)
    )
      return {
        commitState: executionStarted ? "rolled_back" : "not_started",
        evidence: "NO_COMMIT_EFFECTS",
        retryAuthorized: false,
      };
    try {
      await verifyFinancial(
        c,
        checkpoint.snapshot,
        approvalReference,
        checkpoint.artifactHash
      );
      return {
        commitState: "confirmed",
        evidence: "INDEPENDENT_FINANCIAL_VERIFICATION",
        retryAuthorized: false,
      };
    } catch {
      return {
        commitState: "unknown",
        evidence: "DIVERGENCE_REQUIRES_INCIDENT",
        retryAuthorized: false,
      };
    }
  } finally {
    await c.rollback();
  }
}
