import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { sha256 } from "../database/schema/fingerprint";
import { APPLICATION_RC, TARGET, digestApplyAuthorization, type BackupGate, type StagingIdentity } from "../database/stagingV6/policy";
import { identityFromRailway } from "../database/stagingV6/railwayIdentity";
import { readAndVerifyBackupProof } from "../database/stagingV6/backupProof";
import { ROOT } from "../database/schema/artifacts";
import path from "node:path";
import { homedir } from "node:os";

const RAILWAY = "/home/yan/.railway/bin/railway";
const BACKEND_HOST = "api-staging.l4ckos.com.br";
const EXPECTED_DIRTY = new Set([
  "l4ckos-final/l4ckos-store/database/schema/governance.ts",
  "l4ckos-final/l4ckos-store/database/migrations/runner.ts",
  "l4ckos-final/l4ckos-store/database/stagingV6/executor.ts",
  "l4ckos-final/l4ckos-store/database/stagingV6/backupProof.ts",
  "l4ckos-final/l4ckos-store/database/stagingV6/policy.ts",
  "l4ckos-final/l4ckos-store/database/stagingV6/railwayIdentity.ts",
  "l4ckos-final/l4ckos-store/database/stagingV6/remote.ts",
  "l4ckos-final/l4ckos-store/database/stagingV6/runtime.ts",
  "l4ckos-final/l4ckos-store/scripts/staging-v6.ts",
  "l4ckos-final/l4ckos-store/server/database/stagingV6Executor.test.ts",
  "l4ckos-final/l4ckos-store/server/database/stagingBackupV2.test.ts",
  "l4ckos-final/l4ckos-store/server/database/stagingV6Executor.mysql.test.ts",
  "l4ckos-final/l4ckos-store/scripts/staging-backup-v2-crypto.ts",
  "l4ckos-final/l4ckos-store/scripts/staging-backup-v2.ts",
  "l4ckos-final/l4ckos-store/scripts/run-staging-backup-v2.sh",
  "l4ckos-final/l4ckos-store/scripts/test-staging-backup-v2-mysql.ts",
  "l4ckos-final/l4ckos-store/scripts/test-staging-backup-v2-input-pty.py",
  "l4ckos-final/l4ckos-store/server/database/stagingBackupV2.test.ts",
  "l4ckos-final/l4ckos-store/docs/database/staging-backup-v2.md",
  "l4ckos-final/l4ckos-store/docs/database/staging-v6-remote-executor.md",
  "l4ckos-final/l4ckos-store/package.json",
]);

function git(args: string[]) { return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trimEnd(); }
function assertReviewedWorkingTree() {
  if (git(["rev-parse", "HEAD"]) !== APPLICATION_RC) throw new Error("STAGING_V6_BASE_SHA_MISMATCH");
  const rows = git(["status", "--porcelain", "--untracked-files=all", "--", "."]).split("\n").filter(Boolean);
  const paths = rows.map(row => row.slice(3));
  if (paths.some(p => !EXPECTED_DIRTY.has(p)) || paths.some(p => p.endsWith(".npmrc"))) throw new Error("STAGING_V6_UNREVIEWED_WORKTREE_CHANGE");
}
const cleanEnvironment = () => ({ PATH: `${path.dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`, HOME: homedir(), ...(process.env.SSH_AUTH_SOCK ? { SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK } : {}) });
function railway(args: string[]) {
  try { return JSON.parse(execFileSync(RAILWAY, args, { cwd: "/tmp", env: cleanEnvironment(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 })); }
  catch { throw new Error("STAGING_RAILWAY_METADATA_FAILED"); }
}

async function readIdentity() {
  const status = railway(["status", "--project", TARGET.projectId, "--environment", TARGET.environmentId, "--json"]);
  const variables = (serviceId: string) => railway(["variables", "--project", TARGET.projectId, "--environment", TARGET.environmentId, "--service", serviceId, "--json"]);
  const [apiVars, mysqlVars] = await Promise.all([variables(TARGET.apiServiceId), variables(TARGET.mysqlServiceId)]);
  const network = railway(["private-network", "status", "--project", TARGET.projectId, "--environment", TARGET.environmentId, "--service", TARGET.mysqlServiceId, "--json"]);
  return identityFromRailway(status, apiVars, mysqlVars, network);
}

async function bundle() {
  const artifactPaths = git(["ls-files", "database"]).split("\n").filter(file => /\.(json|sql)$/.test(file));
  const artifacts: Record<string, string> = {};
  for (const file of artifactPaths) artifacts[file] = execFileSync("git", ["show", `${APPLICATION_RC}:${git(["rev-parse", "--show-prefix"])}${file}`], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const result = await build({ entryPoints: [path.join(ROOT, "database/stagingV6/remote.ts")], bundle: true, platform: "node", format: "cjs", packages: "external", write: false, plugins: [{ name: "approved-artifacts", setup(builder) {
    builder.onLoad({ filter: /\.(ts|json)$/ }, async args => {
      const relative = path.relative(ROOT, args.path).split(path.sep).join("/");
      if (relative.startsWith("../") || path.isAbsolute(relative)) throw new Error("UNREVIEWED_STAGING_V6_SOURCE");
      let source = await readFile(args.path, "utf8");
      if (relative === "database/schema/artifacts.ts") {
        source = source.replace('export const ROOT = fileURLToPath(new URL("../../", import.meta.url));', 'export const ROOT = "/reviewed-artifacts";');
        const start = source.indexOf("export async function readArtifact("), end = source.indexOf("export type SchemaContract", start);
        source = source.slice(0, start) + `const embedded = ${JSON.stringify(artifacts)}; export async function readArtifact(relative: string, directory: string) { if (!relative.startsWith(directory + "/") || !Object.hasOwn(embedded, relative)) throw new SchemaError("UNAPPROVED_ARTIFACT_PATH"); return Buffer.from(embedded[relative as keyof typeof embedded]); }\n` + source.slice(end);
      }
      return { contents: source, loader: relative.endsWith(".json") ? "json" : "ts", resolveDir: path.dirname(args.path) };
    });
  } }] });
  return result.outputFiles[0].text;
}

async function main() {
  const [operation, backupPath, confirmation] = process.argv.slice(2);
  if (!["package", "diagnose", "authorize", "apply"].includes(operation) || (operation === "package" && (backupPath || confirmation)) || (operation === "diagnose" && (backupPath || confirmation)) || (operation === "authorize" && (!backupPath || confirmation)) || (operation === "apply" && (!backupPath || !/^[a-f0-9]{64}$/.test(confirmation || "")))) throw new Error("USAGE: pnpm db:staging:v6 package | diagnose | authorize <backup-proof.json> | apply <backup-proof.json> <confirmation-digest>");
  assertReviewedWorkingTree();
  if (operation === "package") {
    const payload = await bundle();
    console.log(JSON.stringify({ status: "REMOTE_BUNDLE_REVIEWED", baseSha: APPLICATION_RC, payloadSha256: sha256(payload), bytes: Buffer.byteLength(payload), remoteExecuted: false }));
    return;
  }
  const identity = await readIdentity();
  let backup: BackupGate | undefined;
  if (operation === "apply") {
    backup = (await readAndVerifyBackupProof(backupPath!)).manifest;
    if (digestApplyAuthorization(identity, backup) !== confirmation) throw new Error("V6_APPLY_CONFIRMATION_MISMATCH");
  } else if (operation === "authorize") {
    backup = (await readAndVerifyBackupProof(backupPath!)).manifest;
    console.log(JSON.stringify({ status: "LOCAL_AUTHORIZATION_DIGEST_READY", digest: digestApplyAuthorization(identity, backup), target: { projectId: TARGET.projectId, environmentId: TARGET.environmentId, mysqlServiceId: TARGET.mysqlServiceId, schema: TARGET.schema } }));
    return;
  }
  const payload = await bundle();
  const payloadSha = sha256(payload);
  const invocation = `const x=(()=>{const module={exports:{}};${payload}\nreturn module.exports;})();x.remoteV6Operation(${JSON.stringify(operation)},${JSON.stringify(identity)},${JSON.stringify(backup)},${JSON.stringify(confirmation)}).then(v=>console.log(JSON.stringify({ok:true,result:v}))).catch(e=>{console.log(JSON.stringify({ok:false,code:typeof e.code==="string"&&/^[A-Z_0-9]+$/.test(e.code)?e.code:typeof e.message==="string"&&/^[A-Z_0-9]+$/.test(e.message)?e.message:"STAGING_V6_OPERATION_FAILED"}));process.exitCode=1;});`;
  const child = spawnSync(RAILWAY, ["ssh", "--project", TARGET.projectId, "--environment", TARGET.environmentId, "--service", TARGET.apiServiceId, "--", "node", "--input-type=commonjs"], { cwd: "/tmp", env: cleanEnvironment(), input: invocation, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 120000, maxBuffer: 128 * 1024 * 1024 });
  if (child.status !== 0) throw new Error("STAGING_V6_REMOTE_OPERATION_FAILED");
  let response: any;
  try { response = JSON.parse(child.stdout.trim()); } catch { throw new Error("STAGING_V6_REMOTE_RESPONSE_INVALID"); }
  if (!response?.ok) throw new Error(typeof response?.code === "string" ? response.code : "STAGING_V6_OPERATION_FAILED");
  console.log(JSON.stringify({ operation, target: { projectId: TARGET.projectId, environmentId: TARGET.environmentId, mysqlServiceId: TARGET.mysqlServiceId, schema: TARGET.schema }, payloadSha256: payloadSha, result: response.result }));
}
main().catch(error => { console.error(error instanceof Error && /^[A-Z_0-9]+$/.test(error.message) ? error.message : "STAGING_V6_OPERATION_FAILED"); process.exitCode = 1; });
