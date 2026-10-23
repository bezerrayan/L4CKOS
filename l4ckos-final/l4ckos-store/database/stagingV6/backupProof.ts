import { open, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { canonical, sha256 } from "../schema/fingerprint";
import { assertBackupGate, type BackupGate } from "./policy";

export async function readAndVerifyBackupProof(manifestArgument: string, now = Date.now()) {
  const manifestPath = await realpath(manifestArgument);
  const manifestStat = await stat(manifestPath);
  if ((manifestStat.mode & 0o077) !== 0 || !manifestPath.endsWith(".enc.manifest.json")) throw new Error("BACKUP_PROOF_FILE_PERMISSIONS_OR_PATH_INVALID");
  let manifest: any;
  try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); }
  catch { throw new Error("BACKUP_PROOF_MANIFEST_INVALID"); }
  if (manifest.format !== "L4CKOS-Backup-v2" || manifest.formatVersion !== 2 || manifest.algorithm !== "AES-256-GCM" || manifest.keyReference !== "l4ckos-staging-aes-v2" || manifest.keyDerivation !== "none; 32-byte key provided directly" || manifest.nonceBytes !== 12 || manifest.tagBytes !== 16) throw new Error("BACKUP_PROOF_FORMAT_UNSUPPORTED");
  if (!/^[a-f0-9]{24}$/.test(manifest.envelopeNonce || "") || !/^[a-f0-9]{32}$/.test(manifest.authenticationTag || "") || !/^[a-f0-9]{64}$/.test(manifest.authenticatedContextSha256 || "")) throw new Error("BACKUP_PROOF_INTEGRITY_METADATA_INVALID");
  if (!/^[a-f0-9]{64}$/.test(manifest.plaintextDumpSha256 || "")) throw new Error("BACKUP_PROOF_PLAINTEXT_CHECKSUM_INVALID");
  const artifactId = String(manifest.artifactId || "");
  if (!/^l4ckos-staging-[0-9TZ-]+-[a-f0-9]{8}-v2$/.test(artifactId) || path.basename(manifestPath) !== `${artifactId}.enc.manifest.json`) throw new Error("BACKUP_PROOF_ARTIFACT_ID_INVALID");
  const artifactPath = manifestPath.slice(0, -".manifest.json".length);
  const artifactStat = await stat(artifactPath);
  if (!artifactStat.isFile() || (artifactStat.mode & 0o077) !== 0 || artifactStat.size < 64) throw new Error("BACKUP_ARTIFACT_FILE_INVALID");
  const artifactHandle = await open(artifactPath, "r");
  try {
    const fixed = Buffer.alloc(26);
    if ((await artifactHandle.read(fixed, 0, fixed.length, 0)).bytesRead !== fixed.length || fixed.subarray(0, 8).toString("ascii") !== "L4CKOSBK" || fixed[8] !== 2 || fixed[9] !== 1 || fixed.subarray(10, 22).toString("hex") !== manifest.envelopeNonce) throw new Error("BACKUP_ENVELOPE_HEADER_INVALID");
    const contextLength = fixed.readUInt32BE(22);
    if (contextLength > 64 * 1024 || artifactStat.size < 26 + contextLength + 16) throw new Error("BACKUP_ENVELOPE_HEADER_INVALID");
    const contextBytes = Buffer.alloc(contextLength);
    if ((await artifactHandle.read(contextBytes, 0, contextLength, 26)).bytesRead !== contextLength || sha256(contextBytes) !== manifest.authenticatedContextSha256) throw new Error("BACKUP_ENVELOPE_CONTEXT_HASH_MISMATCH");
    const tag = Buffer.alloc(16);
    if ((await artifactHandle.read(tag, 0, tag.length, artifactStat.size - tag.length)).bytesRead !== tag.length || tag.toString("hex") !== manifest.authenticationTag) throw new Error("BACKUP_ENVELOPE_TAG_MISMATCH");
    let context: any;
    try { context = JSON.parse(contextBytes.toString("utf8")); } catch { throw new Error("BACKUP_ENVELOPE_CONTEXT_INVALID"); }
    if (context.sourceProjectId !== manifest.sourceProjectId || context.sourceEnvironmentId !== manifest.sourceEnvironmentId || context.sourceMysqlServiceId !== manifest.sourceMysqlServiceId || context.sourceSchema !== manifest.sourceSchema || context.sourceFingerprint !== manifest.sourceFingerprint || context.createdAt !== manifest.createdAt || context.mysqlVersion !== manifest.restoreMysqlVersion || canonical(context.inventory) !== canonical(manifest.inventory)) throw new Error("BACKUP_ENVELOPE_CONTEXT_MISMATCH");
  } finally { await artifactHandle.close(); }
  const hash = createHash("sha256");
  await pipeline(createReadStream(artifactPath), new Transform({ transform(chunk, _encoding, cb) { hash.update(chunk); cb(null, chunk); } }), new Transform({ transform(_chunk, _encoding, cb) { cb(); } }));
  if (hash.digest("hex") !== manifest.artifactSha256) throw new Error("BACKUP_ARTIFACT_SHA256_MISMATCH");
  assertBackupGate(manifest as BackupGate, now);
  const restoreReport = manifest.restoreReport;
  if (!restoreReport || restoreReport.fingerprint !== manifest.restoreFingerprint || restoreReport.tableCount !== manifest.restoredTableCount || restoreReport.ledgerTail !== manifest.ledgerTail || restoreReport.foreignKeyViolations !== manifest.foreignKeyViolations || restoreReport.sourceRowCountDigest !== manifest.sourceRowCountDigest || restoreReport.restoredRowCountDigest !== manifest.rowCountDigest || manifest.sourceRowCountDigest !== manifest.rowCountDigest) throw new Error("BACKUP_RESTORE_REPORT_INCONSISTENT");
  if (!/^[a-f0-9]{64}$/.test(manifest.definerDigest || "") || restoreReport.definerDigest !== manifest.definerDigest) throw new Error("BACKUP_DEFINER_DIGEST_INCONSISTENT");
  if (!manifest.inventory || !restoreReport.inventory || manifest.inventory.tables !== restoreReport.inventory.tables || manifest.inventory.views !== restoreReport.inventory.views || manifest.inventory.triggers !== restoreReport.inventory.triggers || manifest.inventory.routines !== restoreReport.inventory.routines || manifest.inventory.events !== restoreReport.inventory.events || manifest.inventory.nonInnoDbTables !== 0 || restoreReport.tableCount !== manifest.inventory.tables) throw new Error("BACKUP_OBJECT_INVENTORY_INCONSISTENT");
  if (sha256(canonical(restoreReport)) !== manifest.validationId) throw new Error("BACKUP_VALIDATION_ID_MISMATCH");
  return { manifest: manifest as BackupGate, artifactPath };
}
