import type { Connection } from "mysql2/promise";
import { withBackupLock } from "./backupLock";
import { BackupCaptureProgress } from "./backupProgress";
import { BACKUP_TARGET } from "./backupIdentity";

/** Split privilege model: administrative session protects structure, reader exports.
 * Neither connection is replaced, pooled or reconnected. The existing lock controller
 * checks session id/physical identity and GRANTED metadata lock throughout capture.
 */
export async function withAdministrativeBackup<T>(
  administrator: Connection,
  reader: Connection,
  capture: (continuity: () => Promise<void>, progress: BackupCaptureProgress) => Promise<T>,
  assertReader: () => Promise<void>,
  progress = new BackupCaptureProgress()
) {
  return run(administrator, reader, capture, assertReader, BACKUP_TARGET, "root@localhost", progress);
}

export async function rehearseAdministrativeBackup<T>(
  administrator: Connection, reader: Connection,
  capture: (continuity: () => Promise<void>, progress: BackupCaptureProgress) => Promise<T>,
  assertReader: () => Promise<void>,
  reference: { database: string; uuidHash: string; mysqlVersion: string; account: string }
) {
  if (!/^l4ckos_test_[a-z0-9_]+$/.test(reference.database) ||
      !/^root@(?:localhost|%)$/.test(reference.account))
    throw Error("WINDOW_LOCAL_FIXTURE_REQUIRED");
  return run(administrator, reader, capture, assertReader, reference, reference.account);
}

async function run<T>(
  administrator: Connection, reader: Connection,
  capture: (continuity: () => Promise<void>, progress: BackupCaptureProgress) => Promise<T>,
  assertReader: () => Promise<void>,
  reference: { database: string; uuidHash: string; mysqlVersion: string }, account: string, progress = new BackupCaptureProgress()
) {
  return withBackupLock(administrator, reader, async c => {
    const [r] = await c.query(
      "SELECT CONNECTION_ID() id,SHA2(@@server_uuid,256) uuidHash,CURRENT_USER() account,USER() login,VERSION() version,DATABASE() db"
    );
    const id = (r as Record<string, unknown>[])[0];
    if (!id || id.uuidHash !== reference.uuidHash || id.account !== account ||
        typeof id.login !== "string" || !id.login.startsWith("root@") ||
        id.version !== reference.mysqlVersion || id.db !== reference.database)
      throw Error("WINDOW_ADMIN_BACKUP_PHYSICAL_IDENTITY");
    await assertReader();
  }, async (continuity, tracker) => {
    tracker.waitingFor("IDENTITY_CHECK"); await assertReader(); tracker.workCompleted();
    const result = await capture(continuity,tracker);
    tracker.phaseStarted("VERIFY_FINAL"); tracker.waitingFor("IDENTITY_CHECK");
    await assertReader(); tracker.workCompleted();
    await continuity();
    return result;
  },progress);
}
