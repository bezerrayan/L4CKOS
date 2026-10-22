import type { Connection } from "mysql2/promise";
import { withBackupCleanup, inBackupPhase } from "./backupCleanup";
import { BackupCaptureProgress, boundedBackupPhase } from "./backupProgress";

// Finite independent budgets. Acquisition is not charged against capture duration.
export const BACKUP_LOCK_LIMITS = Object.freeze({
  acquisitionSeconds: 5, acquisitionMs: 10_000, captureMs: 180_000,
  noProgressMs: 30_000, closingMs: 10_000, heartbeatMs: 250, queryMs: 1_000,
});
type Limits = {[K in keyof typeof BACKUP_LOCK_LIMITS]: number};
type Capture<T> = (continuity: () => Promise<void>, progress: BackupCaptureProgress) => Promise<T>;
export async function withBackupLock<T>(lock: Connection, exporter: Connection,
  verifyIdentity: (connection: Connection) => Promise<void>, capture: Capture<T>,
  progress = new BackupCaptureProgress()): Promise<T> {
  return run(lock, exporter, verifyIdentity, capture, progress, BACKUP_LOCK_LIMITS);
}
/** Shorter deadlines only, and only for a synthetic local fixture; no runtime overrides. */
export async function rehearseBackupLock<T>(lock: Connection, exporter: Connection,
  verifyIdentity: (connection: Connection) => Promise<void>, capture: Capture<T>,
  progress: BackupCaptureProgress, shorter: Partial<Pick<Limits,"captureMs"|"noProgressMs">>) {
  if (!/^l4ckos_test_[a-z0-9_]+$/.test(String(exporter.config.database)) ||
      !/^\/tmp\/l4ckos-[a-z0-9-]+\/mysqld\.sock$/.test(String(exporter.config.socketPath)))
    throw Error("WINDOW_LOCAL_FIXTURE_REQUIRED");
  for (const [key, value] of Object.entries(shorter)) {
    if (!Number.isInteger(value) || value <= 0 || value > BACKUP_LOCK_LIMITS[key as keyof typeof shorter])
      throw Error("WINDOW_LOCAL_SHORTER_LIMIT_REQUIRED");
  }
  return run(lock, exporter, verifyIdentity, capture, progress, {...BACKUP_LOCK_LIMITS,...shorter});
}
async function run<T>(lock: Connection, exporter: Connection,
  verifyIdentity: (connection: Connection) => Promise<void>, capture: Capture<T>,
  progress: BackupCaptureProgress, limits: Limits): Promise<T> {
  if (lock === exporter) throw Error("WINDOW_BACKUP_DEDICATED_LOCK_REQUIRED");
  let held = false, stopping = false;
  let captureDeadlineAt: number | undefined;
  let failure: Error | undefined;
  let heartbeat: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setInterval> | undefined;
  let pending: Promise<void> = Promise.resolve();
  let rejectFailure: (error: Error) => void = () => {};
  const interrupted = new Promise<never>((_, reject) => { rejectFailure = reject; });
  void interrupted.catch(() => {});
  const invalidate = (code: string) => {
    if (!failure) { failure = Error(code); rejectFailure(failure);
      try { progress.stop(code); } catch {}
    }
    exporter.destroy(); lock.destroy();
  };
  const lost = () => invalidate("WINDOW_BACKUP_LOCK_SESSION_LOST");
  lock.on("error", lost); lock.on("end", lost);
  const query = (sql: string) => lock.query({sql, timeout: limits.queryMs});
  const assertAlive = () => {
    if (failure) throw failure;
    if (held && captureDeadlineAt !== undefined && performance.now() >= captureDeadlineAt) {
      invalidate("WINDOW_BACKUP_CAPTURE_DEADLINE"); throw failure;
    }
    if (held && progress.idleMs() >= limits.noProgressMs) {
      invalidate("WINDOW_BACKUP_NO_PROGRESS"); throw failure;
    }
  };
  return withBackupCleanup(async () => {
    const operation = async () => {
      const [identity] = await boundedBackupPhase(async () => {
        const result = await query("SELECT CONNECTION_ID() id,SHA2(@@server_uuid,256) uuidHash,CURRENT_USER() account,USER() login,VERSION() version,DATABASE() db");
        await query("SET SESSION lock_wait_timeout=5");
        await lock.query({sql:"LOCK INSTANCE FOR BACKUP",timeout:6_000}); held = true;
        return result;
      }, limits.acquisitionMs, "WINDOW_BACKUP_LOCK_ACQUISITION_TIMEOUT", () => invalidate("WINDOW_BACKUP_LOCK_ACQUISITION_TIMEOUT"));
      // Capture budget covers all work while holding the lock, including identity/crypto/final checks.
      captureDeadlineAt = performance.now() + limits.captureMs;
      deadline = setTimeout(() => invalidate("WINDOW_BACKUP_CAPTURE_DEADLINE"), limits.captureMs);
      progress.phaseStarted("LOCKED_IDENTITY"); progress.workCompleted();
      watchdog = setInterval(() => {
        try { progress.publish(); } catch { invalidate("WINDOW_BACKUP_PROGRESS_EVIDENCE"); return; }
        if (progress.idleMs() >= limits.noProgressMs) invalidate("WINDOW_BACKUP_NO_PROGRESS");
      }, 100);
      const initial = JSON.stringify(identity);
      const check = async () => {
        assertAlive();
        if (!held) throw Error("WINDOW_BACKUP_LOCK_CONTINUITY");
        try {
          const [current] = await query("SELECT CONNECTION_ID() id,SHA2(@@server_uuid,256) uuidHash,CURRENT_USER() account,USER() login,VERSION() version,DATABASE() db");
          if (JSON.stringify(current) !== initial) throw Error("WINDOW_BACKUP_LOCK_IDENTITY");
          const [locks] = await query("SELECT COUNT(*) n FROM performance_schema.metadata_locks WHERE OBJECT_TYPE='BACKUP LOCK' AND LOCK_STATUS='GRANTED' AND OWNER_THREAD_ID=(SELECT THREAD_ID FROM performance_schema.threads WHERE PROCESSLIST_ID=CONNECTION_ID())");
          if (Number((locks as {n:number}[])[0]?.n) !== 1) throw Error("WINDOW_BACKUP_LOCK_MISSING");
          assertAlive(); progress.lockVerified();
        } catch (error) {
          if (!failure) invalidate(error instanceof Error && /^WINDOW_BACKUP_LOCK_(IDENTITY|MISSING)$/.test(error.message) ? error.message : "WINDOW_BACKUP_LOCK_CONTINUITY");
          throw failure;
        }
      };
      const tick = () => {
        if (stopping || failure) return;
        heartbeat = setTimeout(() => { pending = check(); void pending.then(tick, () => {}); }, limits.heartbeatMs);
      };
      await check(); tick();
      progress.waitingFor("IDENTITY_CHECK");
      await inBackupPhase("LOCK_HELD_IDENTITY", () => verifyIdentity(lock));
      assertAlive(); progress.workCompleted();
      const value = await inBackupPhase("PROTECTED_CAPTURE", () => capture(check,progress));
      assertAlive(); stopping = true; clearTimeout(heartbeat); await pending; await check();
      // End monitoring before expected teardown; closing has its own finite budget.
      clearTimeout(deadline); clearInterval(watchdog);
      await boundedBackupPhase(async () => {
        await query("UNLOCK INSTANCE"); held = false;
        lock.removeListener("error",lost); lock.removeListener("end",lost);
        await lock.end();
      }, limits.closingMs,"WINDOW_BACKUP_LOCK_CLOSING_TIMEOUT",()=>lock.destroy());
      progress.phaseStarted("COMPLETE");
      return value;
    };
    try { return await Promise.race([operation(), interrupted]); }
    catch (error) { try {progress.stop("WINDOW_BACKUP_CAPTURE_FAILED");} catch {} throw error; }
  }, [{name:"administrative-lock",run:async()=>{
    stopping = true; clearTimeout(heartbeat); clearTimeout(deadline); clearInterval(watchdog);
    await boundedBackupPhase(async()=>{
      await pending.catch(()=>{});
      if (held && !failure) { try { await query("UNLOCK INSTANCE"); } finally {lock.destroy();} }
      else lock.destroy();
    },limits.closingMs,"WINDOW_BACKUP_LOCK_CLEANUP_TIMEOUT",()=>lock.destroy());
    lock.removeListener("error",lost); lock.removeListener("end",lost);
  }}]);
}
