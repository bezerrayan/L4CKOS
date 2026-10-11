import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { openBackupConnection } from "../../server/database/backupRestore";
import { capture, validatePrior } from "./evidence";
import { activateBarrier, type BarrierState } from "./barrier";
import { rows, sha256 } from "../schema/fingerprint";
import { verifyCapability, type Capability } from "./capability";
import type { Connection } from "mysql2/promise";
import {
  remoteCapability,
  assertRemoteEnvironment,
  assertPrivateUrl,
  verifyRemoteIdentity,
  type RemoteIdentity,
} from "./capability";
import { execute0022, verifyMigrationScope } from "./runner";
import { assertPlan, digest, fail, type WindowPlan } from "./policy";

/** Runs in the existing staging API Node runtime over the private MySQL endpoint.
 * No dotenv, URL argument, provider action or migration outside 0022 is accepted.
 * Applying also quarantines accounts/sessions: authorization must include that scope.
 */
export async function runWindow(p: WindowPlan, approval: string) {
  assertRemoteEnvironment(p);
  assertPlan(p);
  if (approval !== digest(p)) fail("WINDOW_CONFIRMATION_REQUIRED");
  const url = assertPrivateUrl(process.env.DATABASE_URL || "", p);
  const c = await openBackupConnection(url.href);
  const events: { event: string; at: string }[] = [];
  const log = (event: string) =>
    events.push({ event, at: new Date().toISOString() });
  let recoveryFile: string | undefined;
  try {
    const cap = await remoteCapability(c, p);
    await verifyMigrationScope();
    const result = await applyGovernedWindow(c, p, cap, async state => {
      recoveryFile = `/tmp/l4ckos-0022-recovery-${randomUUID()}.json`;
      await writeFile(recoveryFile, JSON.stringify({ serverUuid: p.serverUuid, target: p.target,
        planDigest: approval, state }), { mode: 0o600, flag: "wx" });
      log("barrier_recovery_saved");
    }, log);
    return {
      ...result,
      events,
      recoveryFile,
      barrier: "HELD",
      releaseRequiresSeparateApproval: true,
    };
  } catch (error) {
    // Leave account quarantine/read_only intact even on failure/transport loss.
    log("window_stopped");
    return {
      status: "STOPPED",
      code:
        typeof (error as { code?: unknown }).code === "string" &&
        /^[A-Z0-9_]+$/.test(String((error as { code?: unknown }).code))
          ? (error as { code: string }).code
          : "WINDOW_FAILED",
      events,
      recoveryFile,
      barrier: "DO_NOT_RELEASE",
      recoveryRequired: true,
    };
  } finally {
    await c.end();
  }
}

export async function inspectWindow(p: RemoteIdentity) {
  assertRemoteEnvironment(p);
  const url = assertPrivateUrl(process.env.DATABASE_URL || "", p);
  const c = await openBackupConnection(url.href);
  try {
    await verifyRemoteIdentity(c, p);
    await validatePrior(c);
    return await capture(c);
  } finally {
    await c.end();
  }
}

/** Arbitration begins BEFORE account/global writes. A losing full executor cannot
 * quarantine or kill the winning executor's session.
 */
export async function applyGovernedWindow(c: Connection, plan: WindowPlan, cap: Capability,
  preserve: (state: BarrierState) => Promise<void>, log: (event: string) => void = () => {}) {
  await verifyCapability(c, plan, cap);
  const lock = `l4ckos_window_${sha256(c.config.database!).slice(0,32)}`;
  if (Number((await rows(c, 'SELECT GET_LOCK(?,0) acquired', [lock]))[0].acquired) !== 1)
    fail('WINDOW_EXECUTOR_BUSY');
  try {
    await validatePrior(c);
    await activateBarrier(c, plan, cap, preserve);
    log('barrier_active');
    return await execute0022(c, plan, cap, log);
  } finally {
    if (Number((await rows(c, 'SELECT RELEASE_LOCK(?) released', [lock]))[0].released) !== 1)
      fail('WINDOW_LOCK_RELEASE_FAILED');
  }
}
