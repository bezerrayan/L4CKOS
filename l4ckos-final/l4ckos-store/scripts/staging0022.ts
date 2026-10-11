// Local preparation; only identity reads fixed staging provider metadata.
// This CLI never calls SSH, Vercel, deployment, or a remote DB.
import { writeFile } from "node:fs/promises";
import { ROOT } from "../database/schema/artifacts";
import { assertLocalSchemaTarget } from "../database/schema/safety";
import { restoreAndProve } from "../database/staging0022/restore";
import { privateJson, packageWindow } from "../database/staging0022/package";
import {
  digest,
  fail,
  assertPlan,
  RC,
  SQL_SHA,
  TTL,
  type BackupProof,
  type Snapshot,
  type WindowPlan,
} from "../database/staging0022/policy";
import { repositoryRoot } from "../database/staging0022/evidence";
import path from "node:path";
import { realpath, stat } from "node:fs/promises";
import { prepareIdentity } from "../database/staging0022/identity";
import type { RemoteIdentity } from "../database/staging0022/capability";
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "identity" && args.length === 2) {
    await savePrivate(args[1], await prepareIdentity(args[0]));
    console.log(
      JSON.stringify({ status: "STAGING_IDENTITY_PREPARED", readOnly: true })
    );
    return;
  }
  if (
    command === "package" &&
    ((args[0] === "inspect" && args.length === 4) ||
      (args[0] === "apply" && args.length === 5))
  ) {
    const [operation, input, approval, output, artifact] = args;
    const value = await privateJson<WindowPlan | RemoteIdentity>(input);
    const result = await packageWindow(
      operation as "inspect" | "apply",
      value,
      approval,
      output,
      artifact
    );
    console.log(
      JSON.stringify({
        payloadSha256: result.payloadSha256,
        applicationCommit: result.applicationCommit,
        draft: result.draft,
        remoteExecuted: false,
      })
    );
    return;
  }
  if (command === "backup-input" && args.length === 4) {
    const [before, after, exportFile, output] = args;
    const exported = await privateJson<{ createdAt: string }>(exportFile);
    const data = {
      sourceBefore: await privateJson<Snapshot>(before),
      sourceAfter: await privateJson<Snapshot>(after),
      createdAt: exported.createdAt,
    };
    await savePrivate(output, data);
    console.log(
      JSON.stringify({ status: "BACKUP_INPUT_READY", remoteExecuted: false })
    );
    return;
  }
  if (command === "make-plan" && args.length === 6) {
    const [identity, proof, applicationCommit, operator, approver, output] =
      args;
    const backup = await privateJson<BackupProof>(proof),
      remote = await privateJson<RemoteIdentity>(identity);
    const plan: WindowPlan = {
      ...remote,
      version: 1,
      applicationCommit,
      sqlSourceCommit: RC,
      sqlChecksum: SQL_SHA,
      backup,
      operator,
      approver,
      expiresAt: new Date(
        Date.parse(backup.sourceBefore.at) + TTL
      ).toISOString(),
    };
    assertPlan(plan);
    await savePrivate(output, plan);
    console.log(
      JSON.stringify({
        status: "DRAFT_PLAN_REQUIRES_APPROVAL",
        planDigest: digest(plan),
      })
    );
    return;
  }
  if (command === "prove-backup" && args.length === 3) {
    const [input, artifact, output] = args;
    const data =
      await privateJson<
        Pick<BackupProof, "sourceBefore" | "sourceAfter" | "createdAt">
      >(input);
    const target = {
      url: process.env.L4CKOS_0022_LOCAL_URL || "",
      socketPath: process.env.L4CKOS_LOCAL_MYSQL_SOCKET,
    };
    assertLocalSchemaTarget(target);
    const proof = await restoreAndProve(target, artifact, ROOT, data);
    await savePrivate(output, proof);
    console.log(
      JSON.stringify({
        status: "RESTORE_VERIFIED",
        proofDigest: digest(proof),
        tables: Object.keys(proof.restored.tables).length,
        orphans: 0,
      })
    );
    return;
  }
  fail("INVALID_0022_PREPARATION_COMMAND");
}
async function savePrivate(output: string, value: unknown) {
  const parent = await realpath(path.dirname(output)),
    root = await repositoryRoot(ROOT);
  if (
    parent === root ||
    parent.startsWith(root + path.sep) ||
    (await stat(parent)).mode & 0o077
  )
    fail("PRIVATE_EXTERNAL_PROOF_REQUIRED");
  await writeFile(output, JSON.stringify(value), { mode: 0o600, flag: "wx" });
}
main().catch(() => {
  console.error(
    JSON.stringify({ status: "STOPPED", code: "0022_PREPARATION_FAILED" })
  );
  process.exitCode = 1;
});
