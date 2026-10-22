import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readdir, rename, unlink } from "node:fs/promises";
import path from "node:path";

export type BackupKind = "manual" | "automatic";
let backupJobRunning = false;

function stamp(date: Date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

export async function writeBackupArtifact(directory: string, kind: BackupKind, artifact: unknown, now = new Date()) {
  const id = randomUUID();
  const prefix = kind === "automatic" ? "auto-backup" : "backup";
  const fileName = `${prefix}-${stamp(now)}-${id}.json`;
  const temporaryPath = path.join(directory, `.backup-write-${id}.tmp`);
  const finalPath = path.join(directory, fileName);
  let handle: Awaited<ReturnType<typeof open>> | undefined;

  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    const directoryInfo = await lstat(directory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw new Error("BACKUP_DIRECTORY_INVALID");
    await chmod(directory, 0o700);
    const serialized = JSON.stringify(artifact, null, 2);
    if (serialized === undefined) throw new Error("BACKUP_SERIALIZATION_FAILED");
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(serialized, { encoding: "utf8" });
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, finalPath);
    return { fileName };
  } catch {
    if (handle) await handle.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw new Error("BACKUP_WRITE_FAILED");
  }
}

/** Prevents overlapping manual/automatic snapshots within one server process. */
export async function createBackupFile(directory: string, kind: BackupKind, createArtifact: () => Promise<unknown>, now = new Date()) {
  if (backupJobRunning) throw new Error("BACKUP_ALREADY_RUNNING");
  backupJobRunning = true;
  try {
    const artifact = await createArtifact();
    return await writeBackupArtifact(directory, kind, artifact, now);
  } finally {
    backupJobRunning = false;
  }
}

export async function listBackupFileNames(directory: string) {
  try {
    const directoryInfo = await lstat(directory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw new Error("BACKUP_DIRECTORY_INVALID");
    const entries = await readdir(directory, { withFileTypes: true });
    return entries.filter(entry => entry.isFile() && entry.name.endsWith(".json")).map(entry => entry.name).sort().reverse();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error("BACKUP_LIST_FAILED");
  }
}
