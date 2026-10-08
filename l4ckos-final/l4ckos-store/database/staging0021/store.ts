import { constants } from "node:fs";
import { mkdir, open, type FileHandle } from "node:fs/promises";
import { randomBytes, randomUUID, timingSafeEqual, createHash } from "node:crypto";
import { canonical } from "../schema/fingerprint";
import { assertPlan, digestPlan, sealPlan, fail, type Plan } from "./policy";

import { ROOT } from "../schema/artifacts";
export const PLAN_ROOT = `${ROOT}.local/staging-0021`;
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
async function directory(path: string) {
  const fd = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const stat = await fd.stat();
  if (stat.uid !== process.getuid?.() || (stat.mode & 0o077)) { await fd.close(); fail("PRIVATE_PLAN_DIRECTORY_REQUIRED"); }
  return fd;
}
async function root() {
  await mkdir(`${ROOT}.local`, { mode: 0o700, recursive: true });
  try { await mkdir(PLAN_ROOT, { mode: 0o700 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
  return directory(PLAN_ROOT);
}
const anchored = (dir: FileHandle, name: string) => `/proc/self/fd/${dir.fd}/${name}`;
async function read(dir: FileHandle, name: string, max: number) {
  const fd = await open(anchored(dir, name), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await fd.stat();
    if (!stat.isFile() || stat.uid !== process.getuid?.() || stat.nlink !== 1 || (stat.mode & 0o077) || stat.size > max) fail("PRIVATE_PLAN_FILE_REQUIRED");
    return await fd.readFile();
  } finally { await fd.close(); }
}
async function write(dir: FileHandle, name: string, bytes: Buffer | string) {
  const fd = await open(anchored(dir, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await fd.writeFile(bytes); await fd.sync(); } finally { await fd.close(); }
}
async function key(dir: FileHandle) {
  try { await write(dir, ".plan-key", randomBytes(32)); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
  const value = await read(dir, ".plan-key", 32);
  if (value.length !== 32) fail("INVALID_PLAN_SEAL_KEY");
  return value;
}
export function planPath(id: string) { if (!ID.test(id)) fail("INVALID_PLAN_PATH"); return `${PLAN_ROOT}/${id}/plan.json`; }
function idFromPath(path: string) {
  const prefix = `${PLAN_ROOT}/`, suffix = "/plan.json";
  if (!path.startsWith(prefix) || !path.endsWith(suffix)) fail("INVALID_PLAN_PATH");
  const id = path.slice(prefix.length, -suffix.length);
  if (!ID.test(id)) fail("INVALID_PLAN_PATH");
  return id;
}
export async function createPlanFiles(plan: Plan, backup: Buffer) {
  assertPlan(plan);
  const r = await root(); let dir: FileHandle | undefined;
  try {
    let existing = false;
    try { await mkdir(anchored(r, plan.planId), { mode: 0o700 }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; existing = true; }
    dir = await directory(anchored(r, plan.planId));
    if (existing) { if (!(await read(dir, "backup.json", 512 * 1024 * 1024)).equals(backup)) fail("STAGING_BACKUP_CHANGED"); }
    else await write(dir, "backup.json", backup);
    await write(dir, "plan.json", canonical(plan));
    await write(dir, "seal.json", JSON.stringify({ planDigest: digestPlan(plan), hmac: sealPlan(plan, await key(r)) }));
    return planPath(plan.planId);
  } finally { await dir?.close(); await r.close(); }
}
/** Persist before restore. Failure never removes this diagnostic evidence. */
export async function preserveBackup(backup: Buffer) {
  const id = randomUUID(), r = await root(); let dir: FileHandle | undefined;
  try {
    await mkdir(anchored(r, id), { mode: 0o700 });
    dir = await directory(anchored(r, id));
    await write(dir, "backup.json", backup);
    const saved = await read(dir, "backup.json", 512 * 1024 * 1024);
    const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
    if (sha(saved) !== sha(backup)) fail("STAGING_BACKUP_COPY_MISMATCH");
    return { planId: id, path: `${PLAN_ROOT}/${id}/backup.json`, size: saved.length, sha256: sha(saved), mode: "0600" };
  } finally { await dir?.close(); await r.close(); }
}
export async function withPlan<T>(path: string, action: (store: { plan: Plan; digest: string; backup: Buffer; evidence: (name: "governance.json" | "restore-proof.json") => Promise<Buffer>; result: () => Promise<any | null>; writeResult: (value: unknown) => Promise<void> }) => Promise<T>, lock = false) {
  const id = idFromPath(path), r = await root(); let dir: FileHandle | undefined; let lockFd: FileHandle | undefined;
  try {
    dir = await directory(anchored(r, id));
    if (lock) {
      // No stale-lock cleanup: a crashed APPLY requires review of runner evidence.
      for (let i = 0; ; i++) {
        try { lockFd = await open(anchored(dir, "apply.lock"), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); break; }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST" || i >= 100) fail("PLAN_APPLY_BUSY_OR_RECOVERY_REQUIRED"); await new Promise(r => setTimeout(r, 100)); }
      }
    }
    const plan = JSON.parse((await read(dir, "plan.json", 32768)).toString()) as Plan;
    const seal = JSON.parse((await read(dir, "seal.json", 4096)).toString());
    if (plan.planId !== id || seal.planDigest !== digestPlan(plan) || !/^[a-f0-9]{64}$/.test(seal.hmac) || !timingSafeEqual(Buffer.from(seal.hmac, "hex"), Buffer.from(sealPlan(plan, await key(r)), "hex"))) fail("STAGING_PLAN_TAMPERED");
    assertPlan(plan);
    const backup = await read(dir, "backup.json", 512 * 1024 * 1024);
    const result = async () => {
      try { return JSON.parse((await read(dir!, "result.json", 32768)).toString()); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
    };
    return await action({ plan, digest: seal.planDigest, backup, evidence: name => read(dir!, name, 16 * 1024 * 1024), result, writeResult: value => write(dir!, "result.json", JSON.stringify(value, null, 2)) });
  } finally {
    if (lockFd && dir) {
      // Resolve through the anchored directory; unlink only our own lock inode.
      const { unlink } = await import("node:fs/promises");
      await lockFd.close(); await unlink(anchored(dir, "apply.lock"));
    }
    await dir?.close(); await r.close();
  }
}

export async function preserveEvidence(id: string, name: "governance.json" | "restore-proof.json" | "prepare-failure.json", value: unknown) {
  if (!ID.test(id)) fail("INVALID_PLAN_PATH");
  const r = await root(); let dir: FileHandle | undefined;
  try { dir = await directory(anchored(r, id)); await write(dir, name, canonical(value)); }
  finally { await dir?.close(); await r.close(); }
}
