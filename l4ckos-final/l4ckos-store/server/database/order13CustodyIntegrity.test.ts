import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sealBackup } from "../../database/order13Reconciliation/backup";
import { digest } from "../../database/order13Reconciliation/operator";
import { verifyRenewalBackup } from "../../database/order13Reconciliation/renewalBackup";

it("binds actual persisted proof bytes, rejects canonical legacy hashes and tampering, and refuses custody overwrite", async () => {
  const dir = await mkdtemp("/tmp/l4ckos-order13-custody-integrity-");
  const sha = (b: Buffer | string) =>
    createHash("sha256").update(b).digest("hex");
  const save = (p: string, v: unknown) =>
    writeFile(p, JSON.stringify(v, null, 2) + "\n", { mode: 0o600 });
  try {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const stateHash = "a".repeat(64),
      verifiedAt = new Date().toISOString();
    const archive = Buffer.from(
      JSON.stringify(
        sealBackup(
          { stateHash, state: {} },
          publicKey.export({ type: "spki", format: "pem" }).toString()
        )
      )
    );
    await writeFile(dir + "/archive.json", archive, { mode: 0o600 });
    await writeFile(
      dir + "/key.pem",
      privateKey.export({ type: "pkcs8", format: "pem" }),
      { mode: 0o600 }
    );
    const proof = {
      status: "RESTORE_VERIFIED",
      archiveSha256: sha(archive),
      sourceStateHash: stateHash,
      restoredStateHash: stateHash,
      verifiedAt,
      localDisposable: true,
    };
    await save(dir + "/proof.json", proof);
    // Exercise the actual CLI producer; isolate its local custody root without
    // changing HOME or touching real credentials/custody.
    await mkdir(dir + "/custody-root", { mode: 0o700 });
    const run = () =>
      execFileSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          `import os from 'node:os';import {syncBuiltinESMExports} from 'node:module';os.homedir=()=>${JSON.stringify(dir + "/custody-root")};syncBuiltinESMExports();process.argv=[process.execPath,'custody',...${JSON.stringify([dir + "/archive.json", dir + "/key.pem", dir + "/proof.json"])}];await import(${JSON.stringify(pathToFileURL(resolve("scripts/custody-order13.ts")).href)});`,
        ],
        { encoding: "utf8", stdio: "pipe" }
      );
    const custody = JSON.parse(run());
    const manifestPath = custody.backupPath.replace(
      /[^/]+$/,
      "custody-manifest.json"
    );
    const manifestBytes = await readFile(manifestPath),
      proofBytes = await readFile(custody.restoreProofPath);
    expect(custody.restoreProofHash).toBe(sha(proofBytes));
    expect(custody.restoreProofHash).not.toBe(digest(proof));
    const request = {
      checkpoint: { stateHash },
      readiness: {
        backup: {
          ...proof,
          manifestReference: custody.restoreProofPath,
          custodyReference: manifestPath,
        },
      },
    };
    await expect(verifyRenewalBackup(request)).resolves.toMatchObject({
      archiveSha256: sha(archive),
    });
    // Reentry must preserve bytes and refuse to overwrite the same proof ID.
    expect(run).toThrow();
    expect(await readFile(manifestPath)).toEqual(manifestBytes);
    expect(await readFile(custody.restoreProofPath)).toEqual(proofBytes);
    // Whitespace is semantically identical but changes the persisted artifact.
    await writeFile(
      custody.restoreProofPath,
      Buffer.concat([proofBytes, Buffer.from(" ")])
    );
    expect(
      digest(JSON.parse(await readFile(custody.restoreProofPath, "utf8")))
    ).toBe(digest(proof));
    await expect(verifyRenewalBackup(request)).rejects.toThrow(
      "RENEWAL_BACKUP_NOT_VERIFIED"
    );
    await writeFile(custody.restoreProofPath, proofBytes);
    await save(manifestPath, { ...custody, restoreProofHash: digest(proof) });
    await expect(verifyRenewalBackup(request)).rejects.toThrow(
      "RENEWAL_BACKUP_NOT_VERIFIED"
    );
    await writeFile(manifestPath, manifestBytes);
    await writeFile(
      custody.backupPath,
      Buffer.concat([archive, Buffer.from(" ")])
    );
    await expect(verifyRenewalBackup(request)).rejects.toThrow(
      "RENEWAL_BACKUP_NOT_VERIFIED"
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 15000);
