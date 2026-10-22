import { it, expect } from "vitest";
import {
  proposeAuthorization,
  validateRenewable,
} from "../../database/order13Reconciliation/authorization";
import { digest } from "../../database/order13Reconciliation/operator";
const now = Date.now();
function fixture() {
  const t = new Date(now).toISOString();
  const request: any = {
    artifactHash: "a".repeat(64),
    decisionHash: "b".repeat(64),
    evidence: {
      observedAt: t,
      amountCents: 9900,
      status: "RECEIVED",
      paymentId: "fixed",
    },
    checkpoint: {
      observedAt: t,
      evidenceHash: "c".repeat(64),
      stateHash: "d".repeat(64),
    },
    readiness: {
      checkpointHash: "e".repeat(64),
      panel: { reviewedAt: t, reference: "known_panel_only" },
      backup: {
        archiveSha256: "f".repeat(64),
        manifestReference: "old-proof",
        custodyReference: "old-custody",
        verifiedAt: t,
        status: "RESTORE_VERIFIED",
        sourceStateHash: "d".repeat(64),
        restoredStateHash: "d".repeat(64),
      },
      quiescence: {
        verifiedAt: t,
        reference: "old-proof",
        status: "ALL_FINANCIAL_WRITERS_EXCLUDED",
      },
    },
    approval: {
      validFrom: t,
      validUntil: new Date(now + 900000).toISOString(),
      backupRestoreReference: "old-proof",
      notification: "ONE_HELD_INTENT_NO_DISPATCH",
      webhook: "KEEP_INTERRUPTED",
    },
  };
  const authorization = proposeAuthorization(
    request,
    t,
    new Date(now + 900000).toISOString()
  );
  return {
    authorization,
    request,
    claimsWindow: {
      id: "new-independent-window",
      validFrom: t,
      validUntil: new Date(now + 900000).toISOString(),
    },
  };
}
it("allows only renewed timestamps/checkpoint evidence digests and backup IDs under the same human digest", () => {
  const v = fixture(),
    h = digest(v.authorization);
  v.request.evidence.observedAt = new Date(now + 240000).toISOString();
  v.request.checkpoint.observedAt = v.request.evidence.observedAt;
  v.request.checkpoint.evidenceHash = "1".repeat(64);
  v.request.readiness.checkpointHash = "2".repeat(64);
  v.request.readiness.backup.archiveSha256 = "3".repeat(64);
  v.request.readiness.backup.manifestReference = "new-proof";
  v.request.readiness.backup.custodyReference = "new-custody";
  v.request.approval.backupRestoreReference = "new-proof";
  v.request.readiness.quiescence.reference = "new-window-proof";
  expect(validateRenewable(v, h, now + 240000).authorization).toEqual(
    v.authorization
  );
});
it.each([
  "amount",
  "payment",
  "state",
  "notification",
  "artifact",
  "panel",
  "backup-state",
])("rejects changed %s under the old human digest", kind => {
  const v = fixture(),
    h = digest(v.authorization);
  if (kind === "amount") v.request.evidence.amountCents = 10000;
  if (kind === "payment") v.request.evidence.paymentId = "other";
  if (kind === "state") v.request.checkpoint.stateHash = "0".repeat(64);
  if (kind === "notification") v.request.approval.notification = "SEND";
  if (kind === "artifact") v.request.artifactHash = "0".repeat(64);
  if (kind === "panel") v.request.readiness.panel.reference = "unknown";
  if (kind === "backup-state")
    v.request.readiness.backup.sourceStateHash = "0".repeat(64);
  expect(() => validateRenewable(v, h, now + 1)).toThrow(
    "AUTHORIZED_SCOPE_CHANGED"
  );
});
it("rejects legacy requests rather than converting their old approvals", () => {
  const v = fixture();
  expect(() => validateRenewable(v.request, digest(v.request), now)).toThrow();
});
it("rejects altered proposal bytes and extending approval past 15 minutes", () => {
  const v = fixture(),
    h = digest(v.authorization);
  v.authorization.validUntil = new Date(now + 900001).toISOString();
  expect(() => validateRenewable(v, h, now)).toThrow(
    "EXPLICIT_APPROVAL_HASH_REQUIRED"
  );
  expect(() => validateRenewable(v, digest(v.authorization), now)).toThrow(
    "AUTHORIZATION_EXPIRED_OR_INVALID"
  );
});
it("rejects expiration at the exact boundary and cannot reuse an expired claims window", () => {
  const v = fixture(),
    h = digest(v.authorization);
  expect(() => validateRenewable(v, h, now + 900000)).toThrow();
  v.claimsWindow.validUntil = new Date(now + 1).toISOString();
  expect(() => validateRenewable(v, h, now + 2)).toThrow();
});

it("checks the renewed archive and restore/custody digests without loading a private key", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { createHash } = await import("node:crypto");
  const { verifyRenewalBackup } = await import(
    "../../database/order13Reconciliation/renewalBackup"
  );
  const dir = await mkdtemp("/tmp/l4ckos-order13-backup-binding-");
  const save = async (p: string, v: any) =>
    writeFile(p, JSON.stringify(v), { mode: 0o600 });
  const sha = (v: string) => createHash("sha256").update(v).digest("hex");
  try {
    const archive = { ciphertext: "synthetic-encrypted-only" },
      archiveHash = sha(JSON.stringify(archive)),
      stateHash = "a".repeat(64),
      verifiedAt = new Date().toISOString();
    const proof = {
      status: "RESTORE_VERIFIED",
      localDisposable: true,
      archiveSha256: archiveHash,
      sourceStateHash: stateHash,
      restoredStateHash: stateHash,
      verifiedAt,
    };
    const custody = {
      backupPath: dir + "/backup.json",
      restoreProofPath: dir + "/proof.json",
      restoreProofHash: sha(JSON.stringify(proof)),
      archiveSha256: archiveHash,
      sourceStateHash: stateHash,
      copyIntegrity: "VERIFIED",
      decryption: "VERIFIED",
    };
    await save(custody.backupPath, archive);
    await save(custody.restoreProofPath, proof);
    await save(dir + "/custody.json", custody);
    const request = {
      checkpoint: { stateHash },
      readiness: {
        backup: {
          ...proof,
          manifestReference: custody.restoreProofPath,
          custodyReference: dir + "/custody.json",
        },
      },
    };
    expect(await verifyRenewalBackup(request)).toMatchObject({
      archiveSha256: archiveHash,
    });
    await save(custody.backupPath, { ciphertext: "tampered" });
    await expect(verifyRenewalBackup(request)).rejects.toThrow(
      "RENEWAL_BACKUP_NOT_VERIFIED"
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("packages a V2 proposal with its separate execution request and the existing supervisor verifies both bindings", async () => {
  const { execFileSync } = await import("node:child_process");
  const { mkdir, readFile, writeFile, rm } = await import("node:fs/promises");
  const { createHash, randomUUID } = await import("node:crypto");
  const { STAGING } = await import(
    "../../database/order13Reconciliation/staging"
  );
  const { OPERATION } = await import(
    "../../database/order13Reconciliation/operator"
  );
  const dir =
      "/tmp/l4ckos-order13-v2-package-test-" + randomUUID().replaceAll("-", ""),
    out = dir + "-armed",
    base = dir + "-base";
  const sha = (v: Buffer | string) =>
    createHash("sha256").update(v).digest("hex");
  const save = async (name: string, v: any) =>
    writeFile(dir + "/" + name, JSON.stringify(v), { mode: 0o600 });
  await mkdir(dir, { mode: 0o700 });
  try {
    execFileSync(
      process.execPath,
      ["--import", "tsx", "scripts/prepare-order13-staging.ts", "--out", base],
      { stdio: "pipe" }
    );
    const manifest = JSON.parse(
      await readFile(base + "/manifest.json", "utf8")
    );
    const at = new Date().toISOString(),
      stateHash = "a".repeat(64),
      archive = Buffer.from('{"synthetic":"not-a-financial-backup"}');
    const proof = {
      status: "RESTORE_VERIFIED",
      localDisposable: true,
      sourceStateHash: stateHash,
      restoredStateHash: stateHash,
      archiveSha256: sha(archive),
      verifiedAt: at,
    };
    const proofPath = dir + "/proof.json",
      custodyPath = dir + "/custody.json",
      backupPath = dir + "/backup.json";
    await writeFile(backupPath, archive, { mode: 0o600 });
    await writeFile(proofPath, JSON.stringify(proof, null, 2) + "\n", {
      mode: 0o600,
    });
    await save("custody.json", {
      backupPath,
      restoreProofPath: proofPath,
      restoreProofHash: sha(await readFile(proofPath)),
      archiveSha256: sha(archive),
      sourceStateHash: stateHash,
      copyIntegrity: "VERIFIED",
      decryption: "VERIFIED",
    });
    const request: any = {
      command: "COMMIT_ORDER13_ONCE",
      artifactHash: manifest.commitHash,
      decisionHash: manifest.decisionHash,
      checkpoint: {
        operation: OPERATION,
        observedAt: at,
        stateHash,
        evidenceHash: "a".repeat(64),
      },
      evidence: {
        observedAt: at,
        paymentId: "synthetic-invalid-for-remote-execution",
        amountCents: 0,
      },
      approval: {
        reference: "synthetic-only",
        validFrom: at,
        validUntil: new Date(Date.parse(at) + 900000).toISOString(),
        backupRestoreReference: proofPath,
      },
      readiness: {
        operation: OPERATION,
        deployment: STAGING.deployment,
        bundleHash: STAGING.bundleHash,
        artifactHash: manifest.commitHash,
        decisionHash: manifest.decisionHash,
        checkpointHash: "a".repeat(64),
        panel: {
          status: "REVIEWED_NO_CONFLICTING_EVENTS",
          reference: "synthetic-panel",
          reviewedAt: at,
        },
        backup: {
          status: "RESTORE_VERIFIED",
          archiveSha256: sha(archive),
          sourceStateHash: stateHash,
          restoredStateHash: stateHash,
          manifestReference: proofPath,
          custodyReference: custodyPath,
          verifiedAt: at,
        },
        quiescence: {
          status: "ALL_FINANCIAL_WRITERS_EXCLUDED",
          reference: "synthetic-only",
          externalWritersExcluded: true,
          inFlightDrained: true,
          verifiedAt: at,
        },
      },
    };
    const authorization = proposeAuthorization(
        request,
        at,
        request.approval.validUntil
      ),
      hash = digest(authorization);
    await save("authorization.json", authorization);
    await save("binding.json", {
      authorization,
      request,
      claimsWindow: {
        id: randomUUID(),
        validFrom: at,
        validUntil: request.approval.validUntil,
      },
    });
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/prepare-order13-staging.ts",
        "--out",
        out,
        "--approval-file",
        dir + "/authorization.json",
        "--approval-sha256",
        hash,
        "--execution-request-file",
        dir + "/binding.json",
      ],
      { stdio: "pipe" }
    );
    const manifestHash = sha(await readFile(out + "/manifest.json"));
    const check =
      "import importlib.util,sys; s=importlib.util.spec_from_file_location('s','scripts/order13-supervised-observer.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m);m.load_package(sys.argv[1],sys.argv[2],sys.argv[3]);print('PASS')";
    expect(
      execFileSync("python3", ["-c", check, out, manifestHash, hash], {
        encoding: "utf8",
      }).trim()
    ).toBe("PASS");
    expect(() =>
      execFileSync(
        "python3",
        ["-c", check, out, manifestHash, "f".repeat(64)],
        { stdio: "pipe" }
      )
    ).toThrow();
    const manifestBytes = await readFile(out + "/manifest.json");
    expect(() =>
      execFileSync(
        process.execPath,
        ["--import", "tsx", "scripts/prepare-order13-staging.ts", "--out", out],
        { stdio: "pipe" }
      )
    ).toThrow();
    expect(await readFile(out + "/manifest.json")).toEqual(manifestBytes);
    for (const name of [
      "commit.cjs",
      "approved-request.json",
      "supervisor.py",
      "manifest.json",
    ]) {
      const original = await readFile(out + "/" + name);
      await writeFile(
        out + "/" + name,
        Buffer.concat([original, Buffer.from("\n")])
      );
      expect(() =>
        execFileSync("python3", ["-c", check, out, manifestHash, hash], {
          stdio: "pipe",
        })
      ).toThrow();
      await writeFile(out + "/" + name, original);
    }
    expect(
      execFileSync("python3", ["-c", check, out, manifestHash, hash], {
        encoding: "utf8",
      }).trim()
    ).toBe("PASS");
    // Do not invoke any loader: this test has no network or financial execution.
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(out, { recursive: true, force: true });
    await rm(base, { recursive: true, force: true });
  }
}, 15000);
