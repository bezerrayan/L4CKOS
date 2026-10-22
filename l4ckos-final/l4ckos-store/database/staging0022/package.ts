import { execFileSync } from "node:child_process";
import path from "node:path";
import { readFile, realpath, lstat, writeFile, stat } from "node:fs/promises";
import { build } from "esbuild";
import { ROOT } from "../schema/artifacts";
import {
  RC,
  SQL_SHA,
  SQL_SHA23,
  APPLICATION_RC,
  migrationPhase,
  assertPlan,
  digest,
  fail,
  exactKeys,
  TARGET,
  type WindowPlan,
} from "./policy";
import type { RemoteIdentity } from "./capability";
import type { SocketRuntime, SavedSequence } from "./window";
import { sha256 } from "../schema/fingerprint";
import { verifyPrivateGzip, repositoryRoot } from "./evidence";

export async function privateJson<T>(file: string): Promise<T> {
  const st = await lstat(file),
    resolved = await realpath(file),
    root = await repositoryRoot(ROOT);
  if (
    !st.isFile() ||
    st.isSymbolicLink() ||
    (st.mode & 0o077) !== 0 ||
    (await stat(path.dirname(resolved))).mode & 0o077 ||
    resolved.startsWith(root + path.sep) ||
    st.size > 8 * 1024 * 1024
  )
    fail("PRIVATE_EXTERNAL_MANIFEST_REQUIRED");
  return JSON.parse(await readFile(resolved, "utf8"));
}
/** Packages operational code separately from immutable SQL/contracts at the RC.
 * No provider/Git mutation and no remote operation is performed here.
 */
export async function packageWindow(
  operation: "inspect" | "apply" | "sequence" | "resume",
  input: RemoteIdentity | WindowPlan | SavedSequence,
  approval: string,
  output: string,
  artifact?: string,
  schedulerApproval?: string,
  runtime?: SocketRuntime
) {
  if(operation === "apply") fail("PRE_DDL_CHECKPOINT_REQUIRED");
  if(runtime&&(!exactKeys(runtime,['mysqlDeployment','httpApproval'])||!['sequence','resume'].includes(operation)||process.version!=='v22.23.2'))fail('SOCKET_PACKAGE_RUNTIME_REQUIRED');
  const plan = operation === "resume" ? (input as SavedSequence).identity : input as WindowPlan;
  if (
    operation === "inspect" &&
    (!exactKeys(input, [
      "target",
      "deploymentId",
      "serverUuid",
      "endpointHash",
    ]) ||
      digest(plan.target) !== digest(TARGET) ||
      !/^[a-f0-9-]{36}$/.test(plan.deploymentId) ||
      !/^[a-f0-9-]{36}$/.test(plan.serverUuid) ||
      !/^[a-f0-9]{64}$/.test(plan.endpointHash))
  )
    fail("INSPECTION_IDENTITY_INVALID");
  if (operation !== "inspect") {
    assertPlan(plan);
    if (plan.sqlChecksum !== SQL_SHA) fail("PACKAGE_ENTRY_REQUIRES_0022_PLAN");
    if(operation === "resume" && ((input as SavedSequence).planDigest !== digest(plan) || !(input as SavedSequence).barrier || !(input as SavedSequence).scheduler))fail("RECOVERY_PACKAGE_INVALID");
    if (approval !== digest(input)) fail("WINDOW_CONFIRMATION_REQUIRED");
    if (!artifact) fail("BACKUP_FILE_REQUIRED");
    const file = await verifyPrivateGzip(artifact, ROOT),
      proof = plan.backup;
    if (
      file.artifactSha256 !== proof.artifactSha256 ||
      file.bytes !== proof.bytes
    )
      fail("BACKUP_FILE_CHANGED_AFTER_PROOF");
  }
  if(runtime&&(!/^[a-f0-9-]{36}$/.test(runtime.mysqlDeployment)||runtime.httpApproval!==digest({plan:digest(plan),action:'http-maintenance-confirmed',apiDeploymentId:plan.deploymentId})))fail('HTTP_MAINTENANCE_APPROVAL_REQUIRED');
  const git = (args: string[]) =>
    execFileSync("git", args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  if (git(["branch", "--show-current"]) !== "feat/preorder-batch")
    fail("OPERATOR_BRANCH_REQUIRED");
  const prefix = git(["rev-parse", "--show-prefix"]);
  if (operation !== "inspect") {
    const commit = plan.applicationCommit;
    // The approved application SHA is local, not assumed to exist remotely.
    git(["cat-file", "-e", `${commit}^{commit}`]);
    for (const file of [
      "database/migrations/0022_preorder_manufacturing_schedule.sql",
      "database/migrations/manifest-v3.json",
      "database/schema/contract-v1.json",
      "database/schema/contract-v2.json",
      "database/schema/contract-v3.json",
      "database/schema/governance-v1.json",
    ]) {
      const original = git(["show", `${RC}:${prefix}${file}`]);
      if (git(["show", `${commit}:${prefix}${file}`]) !== original)
        fail("APPROVED_APPLICATION_SCHEMA_CHANGED");
    }
  }
  const sourceCommit = APPLICATION_RC;
  const artifactNames = git([
    "ls-tree",
    "-r",
    "--full-tree",
    "--name-only",
    sourceCommit,
    "--",
    prefix + "database",
  ])
    .split("\n")
    .filter(p => /\.(sql|json)$/.test(p));
  const artifacts: Record<string, string> = {};
  for (const name of artifactNames)
    artifacts[name.slice(prefix.length)] = execFileSync(
      "git",
      ["show", `${sourceCommit}:${name}`],
      { cwd: ROOT, encoding: "utf8" }
    );
  if (
    sha256(
      artifacts["database/migrations/0022_preorder_manufacturing_schedule.sql"]
    ) !== SQL_SHA
  )
    fail("RC_SQL_MISMATCH");
  const operatorFiles: Record<string, string> = {};
  const result = await build({
    entryPoints: [path.join(ROOT, "database/staging0022/window.ts")],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    packages: runtime ? "bundle" : "external",
    target: "node22",
    plugins: [
      {
        name: "approved-rc-and-operator",
        setup(b) {
          b.onLoad(
            { filter: /\.(ts|tsx|js|jsx|mjs|cjs|json)$/ },
            async args => {
              if(args.path.includes(path.sep+'node_modules'+path.sep))return undefined;
              const relative = path
                .relative(ROOT, args.path)
                .replaceAll(path.sep, "/");
              if (relative.startsWith("..") || path.isAbsolute(relative))
                fail("OPERATOR_IMPORT_OUTSIDE_REPOSITORY");
              let source: string;
              if (relative.startsWith("database/staging0022/")) {
                source = await readFile(args.path, "utf8");
                operatorFiles[relative] = sha256(source);
              } else
                source = execFileSync(
                  "git",
                  ["show", `${sourceCommit}:${prefix}${relative}`],
                  { cwd: ROOT, encoding: "utf8" }
                );
              if (relative === "database/schema/artifacts.ts") {
                source = source.replace(
                  'export const ROOT = fileURLToPath(new URL("../../", import.meta.url));',
                  'export const ROOT = "/approved-rc-artifacts";'
                );
                const start = source.indexOf(
                    "export async function readArtifact("
                  ),
                  end = source.indexOf("export type SchemaContract", start);
                if (start < 0 || end <= start)
                  fail("ARTIFACT_EMBEDDING_ANCHOR_MISSING");
                source =
                  source.slice(0, start) +
                  `const embedded=${JSON.stringify(artifacts)};\nexport async function readArtifact(relative:string,directory:string){if(!relative.startsWith(directory+'/')||!Object.hasOwn(embedded,relative))throw new SchemaError('UNAPPROVED_ARTIFACT_PATH');return Buffer.from(embedded[relative as keyof typeof embedded]);}\n` +
                  source.slice(end);
              }
              const ext = path.extname(relative);
              return {
                contents: source,
                loader:
                  ext === ".json"
                    ? "json"
                    : ext === ".tsx"
                      ? "tsx"
                      : [".js", ".mjs", ".cjs"].includes(ext)
                        ? "js"
                        : "ts",
                resolveDir: path.dirname(args.path),
              };
            }
          );
        },
      },
    ],
  });
  if (sha256(artifacts["database/migrations/0023_asaas_webhook_inbox.sql"]) !== SQL_SHA23) fail("RC_SQL_MISMATCH");
  if(operation==='sequence' && schedulerApproval!==digest({plan:digest(input),action:'suspend-scheduler'}))fail('SCHEDULER_APPROVAL_REQUIRED');
  const code = `const audited=(()=>{const module={exports:{}};${result.outputFiles[0].text}\nreturn module.exports;})();\naudited.${operation === "resume" ? "resumeWindowSequence" : operation === "sequence" ? (runtime ? "runSocketWindowSequence" : "runWindowSequence") : "inspectWindow"}(${JSON.stringify(input)}${operation !== "inspect" ? "," + JSON.stringify(approval) + (operation === "sequence" ? "," + JSON.stringify(schedulerApproval) : "") + (runtime ? "," + JSON.stringify(runtime) : "") : ""}).then(value=>{console.log(JSON.stringify(value));if(value.status==='STOPPED')process.exitCode=1;}).catch(()=>{console.log(JSON.stringify({status:'STOPPED',code:'WINDOW_PREFLIGHT_FAILED'}));process.exitCode=1;});\n`;
  const directory = await realpath(path.dirname(output)),
    root = await repositoryRoot(ROOT);
  if (
    directory === root ||
    directory.startsWith(root + path.sep) ||
    (await stat(directory)).mode & 0o077
  )
    fail("EXTERNAL_PACKAGE_REQUIRED");
  await writeFile(output, code, { flag: "wx", mode: 0o600 });
  const manifest = {
    operation,
    applicationCommit:
      operation !== "inspect" ? plan.applicationCommit : APPLICATION_RC,
    sqlSourceCommit: operation === "inspect" ? APPLICATION_RC : migrationPhase(plan.sqlChecksum).source,
    sqlChecksum: operation === "inspect" ? null : plan.sqlChecksum,
    scopes: ["sequence","resume"].includes(operation) ? ["scheduler-off", "0022", "0023-separate-proof-and-approval", "quarantine", "separate-read-admission", "separate-release"] : [operation],
    payloadSha256: sha256(code),
    operatorFiles,
    socketRuntime: runtime ? {...runtime,nodeSha256:sha256(await readFile(process.execPath)),nodeVersion:process.version} : null,
    operatorHead: git(["rev-parse", "HEAD"]),
    draft: true,
    requiresApproval: true,
  };
  await writeFile(
    output + ".manifest.json",
    JSON.stringify(manifest, null, 2),
    { flag: "wx", mode: 0o600 }
  );
  return manifest;
}
