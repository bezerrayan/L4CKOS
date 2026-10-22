/** Local custody check before packaging. Never reads the private key. */
import { readFile, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { archiveSha256 } from "./backup";
import { digest } from "./operator";
export async function verifyRenewalBackup(request: any) {
  const b = request.readiness.backup;
  const load = async (p: string) => {
    const st = await lstat(p);
    if (
      !st.isFile() ||
      st.isSymbolicLink() ||
      st.uid !== process.getuid?.() ||
      st.mode & 0o077
    )
      throw Error("PRIVATE_CUSTODY_REQUIRED");
    return readFile(p);
  };
  const custody = JSON.parse((await load(b.custodyReference)).toString());
  const proofBytes = await load(b.manifestReference);
  const proof = JSON.parse(proofBytes.toString());
  const archiveBytes = await load(custody.backupPath);
  const sha = createHash("sha256").update(proofBytes).digest("hex");
  if (
    custody.restoreProofPath !== b.manifestReference ||
    custody.restoreProofHash !== sha ||
    custody.archiveSha256 !== b.archiveSha256 ||
    archiveSha256(archiveBytes) !== b.archiveSha256 ||
    custody.copyIntegrity !== "VERIFIED" ||
    custody.decryption !== "VERIFIED" ||
    custody.sourceStateHash !== request.checkpoint.stateHash ||
    proof.status !== "RESTORE_VERIFIED" ||
    !proof.localDisposable ||
    proof.sourceStateHash !== request.checkpoint.stateHash ||
    proof.restoredStateHash !== request.checkpoint.stateHash ||
    proof.archiveSha256 !== b.archiveSha256 ||
    proof.verifiedAt !== b.verifiedAt ||
    b.sourceStateHash !== proof.sourceStateHash ||
    b.restoredStateHash !== proof.restoredStateHash ||
    !Number.isFinite(Date.parse(proof.verifiedAt)) ||
    Date.now() - Date.parse(proof.verifiedAt) > 900000 ||
    Date.parse(proof.verifiedAt) > Date.now() + 5000
  )
    throw Error("RENEWAL_BACKUP_NOT_VERIFIED");
  return { archiveSha256: b.archiveSha256, restoreProofDigest: digest(proof) };
}
