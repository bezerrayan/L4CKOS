import { execFileSync } from "node:child_process";
import path from "node:path";
import { readFile, realpath, lstat, writeFile, stat } from "node:fs/promises";
import { build } from "esbuild";
import { ROOT } from "../schema/artifacts";
import {
  RC,
  SQL_SHA,
  assertPlan,
  digest,
  fail,
  exactKeys,
  TARGET,
  type WindowPlan,
} from "./policy";
import type { RemoteIdentity } from "./capability";
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
  operation: "inspect" | "apply",
  input: RemoteIdentity | WindowPlan,
  approval: string,
  output: string,
  artifact?: string
) {
  if (
    operation === "inspect" &&
    (!exactKeys(input, [
      "target",
      "deploymentId",
      "serverUuid",
      "endpointHash",
    ]) ||
      digest(input.target) !== digest(TARGET) ||
      !/^[a-f0-9-]{36}$/.test(input.deploymentId) ||
      !/^[a-f0-9-]{36}$/.test(input.serverUuid) ||
      !/^[a-f0-9]{64}$/.test(input.endpointHash))
  )
    fail("INSPECTION_IDENTITY_INVALID");
  if (operation === "apply") {
    assertPlan(input as WindowPlan);
    if (approval !== digest(input)) fail("WINDOW_CONFIRMATION_REQUIRED");
    if (!artifact) fail("BACKUP_FILE_REQUIRED");
    const file = await verifyPrivateGzip(artifact, ROOT),
      proof = (input as WindowPlan).backup;
    if (
      file.artifactSha256 !== proof.artifactSha256 ||
      file.bytes !== proof.bytes
    )
      fail("BACKUP_FILE_CHANGED_AFTER_PROOF");
  }
  const git = (args: string[]) =>
    execFileSync("git", args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  if (git(["branch", "--show-current"]) !== "feat/preorder-batch")
    fail("OPERATOR_BRANCH_REQUIRED");
  const prefix = git(["rev-parse", "--show-prefix"]);
  if (operation === "apply") {
    const commit = (input as WindowPlan).applicationCommit;
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
  const artifactNames = git([
    "ls-tree",
    "-r",
    "--full-tree",
    "--name-only",
    RC,
    "--",
    prefix + "database",
  ])
    .split("\n")
    .filter(p => /\.(sql|json)$/.test(p));
  const artifacts: Record<string, string> = {};
  for (const name of artifactNames)
    artifacts[name.slice(prefix.length)] = execFileSync(
      "git",
      ["show", `${RC}:${name}`],
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
    packages: "external",
    target: "node22",
    plugins: [
      {
        name: "approved-rc-and-operator",
        setup(b) {
          b.onLoad(
            { filter: /\.(ts|tsx|js|jsx|mjs|cjs|json)$/ },
            async args => {
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
                  ["show", `${RC}:${prefix}${relative}`],
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
  const code = `const audited=(()=>{const module={exports:{}};${result.outputFiles[0].text}\nreturn module.exports;})();\naudited.${operation === "apply" ? "runWindow" : "inspectWindow"}(${JSON.stringify(input)}${operation === "apply" ? "," + JSON.stringify(approval) : ""}).then(value=>{console.log(JSON.stringify(value));if(value.status==='STOPPED')process.exitCode=1;}).catch(()=>{console.log(JSON.stringify({status:'STOPPED',code:'WINDOW_PREFLIGHT_FAILED'}));process.exitCode=1;});\n`;
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
      operation === "apply" ? (input as WindowPlan).applicationCommit : RC,
    sqlSourceCommit: RC,
    sqlChecksum: SQL_SHA,
    payloadSha256: sha256(code),
    operatorFiles,
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
