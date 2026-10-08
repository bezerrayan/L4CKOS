import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, chmod, mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ROOT } from "../schema/artifacts";
import { canonical, sha256 } from "../schema/fingerprint";
import { assertIdentity, fail, TARGET, type Identity, type Plan } from "./policy";
import { SchemaError } from "../schema/safety";
import type { Inspection, StagingAdapter } from "./executor";
import { RestoreProofError, restoreDiagnostic } from "../staging/restoreDiagnostics";

const RAILWAY = "/home/yan/.railway/bin/railway";
const cleanEnvironment = () => ({ PATH: `${path.dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`, HOME: homedir(), ...(process.env.SSH_AUTH_SOCK ? { SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK } : {}) });
function git(args: string[]) { return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
export function reviewedSource() {
  const prefix = git(["rev-parse", "--show-prefix"]);
  const dirty = git(["status", "--porcelain", "--untracked-files=all", "--", "."]).split("\n").filter(line => line && line !== `?? ${prefix}.npmrc`);
  if (dirty.length) fail("STAGING_REVIEWED_CLEAN_SOURCE_REQUIRED");
  return git(["rev-parse", "HEAD"]);
}
export class FixedPreorderRailwayAdapter implements StagingAdapter {
  private cwd?: string;
  private verified?: Identity;
  private async cli(args: string[]) {
    this.cwd ??= await mkdtemp("/tmp/l4ckos-staging-executor-");
    await chmod(this.cwd, 0o700);
    try { return JSON.parse(execFileSync(RAILWAY, args, { cwd: this.cwd, env: cleanEnvironment(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 })); }
    catch { return fail("STAGING_RAILWAY_METADATA_FAILED"); }
  }
  async source() { return reviewedSource(); }
  async identity(): Promise<Identity> {
    const status = await this.cli(["status", "--project", TARGET.projectId, "--environment", TARGET.environmentId, "--json"]);
    if (status.id !== TARGET.projectId || status.name !== TARGET.projectName) fail("STAGING_TARGET_IDENTITY_MISMATCH");
    const env = status.environments.edges.map((v: any) => v.node).find((v: any) => v.id === TARGET.environmentId);
    if (!env || env.name !== TARGET.environment) fail("STAGING_TARGET_IDENTITY_MISMATCH");
    const services = env.serviceInstances.edges.map((v: any) => v.node);
    const app = services.find((v: any) => v.serviceId === TARGET.serviceId), mysql = services.find((v: any) => v.serviceId === TARGET.mysqlServiceId);
    if (!app || app.serviceName !== TARGET.service || !mysql || mysql.serviceName !== "mysql" || services.filter((v: any) => v.serviceName === "mysql").length !== 1 || !app.domains.customDomains.some((v: any) => v.domain === TARGET.backendHost)) fail("STAGING_TARGET_IDENTITY_MISMATCH");
    const deployment = app.activeDeployments?.edges?.map((v: any) => v.node) ?? app.activeDeployments;
    const active = Array.isArray(deployment) ? deployment : [];
    if (active.length !== 1 || !active[0].id) fail("STAGING_SINGLE_ACTIVE_DEPLOYMENT_REQUIRED");
    const variables = async (service: string) => {
      const v = await this.cli(["variables", "--project", TARGET.projectId, "--environment", TARGET.environmentId, "--service", service, "--json"]);
      if (v.RAILWAY_PROJECT_ID !== TARGET.projectId || v.RAILWAY_ENVIRONMENT_ID !== TARGET.environmentId || v.RAILWAY_SERVICE_ID !== service) fail("STAGING_VARIABLE_IDENTITY_MISMATCH");
      return v;
    };
    const a = await variables(TARGET.serviceId), d = await variables(TARGET.mysqlServiceId);
    let u: URL, privateUrl: URL;
    try { u = new URL(a.DATABASE_URL); privateUrl = new URL(d.MYSQL_URL); } catch { return fail("STAGING_PRIVATE_DATABASE_REQUIRED"); }
    if (u.protocol !== "mysql:" || privateUrl.protocol !== "mysql:" || u.search || u.hash || !u.hostname.endsWith(".railway.internal") || u.href !== privateUrl.href) fail("STAGING_DATABASE_NOT_EXCLUSIVE");
    const network = await this.cli(["private-network", "status", "--project", TARGET.projectId, "--environment", TARGET.environmentId, "--service", TARGET.mysqlServiceId, "--json"]);
    // Independent networking metadata binds the endpoint to this exact service,
    // rather than trusting a potentially misconfigured MYSQL_URL variable alone.
    const domains = new Set<string>();
    const visit = (value: unknown) => {
      if (typeof value === "string" && value.endsWith(".railway.internal")) domains.add(value);
      else if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") Object.values(value).forEach(visit);
    };
    visit(network);
    if (domains.size !== 1 || !domains.has(u.hostname)) fail("STAGING_MYSQL_NETWORK_IDENTITY_MISMATCH");
    const connectionHash = sha256(canonical([u.hostname, Number(u.port || 3306), decodeURIComponent(u.username), decodeURIComponent(u.password), decodeURIComponent(u.pathname.slice(1)), null]));
    const identity = { ...TARGET, deploymentId: active[0].id, connectionHash };
    assertIdentity(identity); this.verified = identity;
    return identity;
  }
  async health() {
    try {
      const r = await fetch(`https://${TARGET.backendHost}/health`, { redirect: "error", signal: AbortSignal.timeout(10000) });
      const body = await r.json();
      if (r.status !== 200 || body.ok !== true || body.service !== "backend") fail("STAGING_HEALTH_REQUIRED");
      return { status: 200 };
    } catch { return fail("STAGING_HEALTH_REQUIRED"); }
  }
  private async remote(operation: "inspect" | "backup" | "apply", plan?: Plan, digest?: string) {
    if (!this.verified) fail("STAGING_IDENTITY_REQUIRED");
    const commit = reviewedSource();
    if (plan && plan.applicationCommit !== commit) fail("STAGING_COMMIT_MISMATCH");
    const prefix = git(["rev-parse", "--show-prefix"]);
    const artifacts: Record<string, string> = {};
    for (const name of git(["ls-files", "database"]).split("\n").filter(n => /\.(json|sql)$/.test(n))) artifacts[name] = execFileSync("git", ["show", `${commit}:${prefix}${name}`], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const bundle = await build({ entryPoints: [path.join(ROOT, "database/staging0021/remote.ts")], bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
      plugins: [{ name: "reviewed-artifacts", setup(b) {
        b.onLoad({ filter: /\.(ts|tsx|js|jsx|mjs|cjs|json)$/ }, async args => {
          const relative = path.relative(ROOT, args.path).replaceAll(path.sep, "/");
          if (relative.startsWith("..") || path.isAbsolute(relative)) fail("UNREVIEWED_STAGING_SOURCE");
          let source = execFileSync("git", ["show", `${commit}:${prefix}${relative}`], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
          if (relative === "database/schema/artifacts.ts") {
            const anchor = 'export const ROOT = fileURLToPath(new URL("../../", import.meta.url));';
            if (!source.includes(anchor)) fail("UNREVIEWED_STAGING_SOURCE");
            source = source.replace(anchor, 'export const ROOT = "/reviewed-artifacts";');
            const start = source.indexOf("export async function readArtifact("), end = source.indexOf("export type SchemaContract", start);
            if (start < 0 || end <= start) fail("UNREVIEWED_STAGING_SOURCE");
            source = source.slice(0, start) + `const embedded = ${JSON.stringify(artifacts)};\nexport async function readArtifact(relative: string, directory: string) { if(!relative.startsWith(directory + '/') || !Object.hasOwn(embedded, relative)) throw new SchemaError('UNAPPROVED_ARTIFACT_PATH'); return Buffer.from(embedded[relative as keyof typeof embedded]); }\n` + source.slice(end);
          }
          const ext = path.extname(relative);
          const loader = ext === ".json" ? "json" :
            ext === ".tsx" ? "tsx" :
            ext === ".jsx" ? "jsx" :
            [".js", ".mjs", ".cjs"].includes(ext) ? "js" : "ts";
          return { contents: source, loader, resolveDir: path.dirname(args.path) };
        });
      } }] });
    const code = `const audited=(()=>{const module={exports:{}};${bundle.outputFiles[0].text}\nreturn module.exports;})();audited.remoteOperation(${JSON.stringify(operation)},${JSON.stringify(this.verified)},${JSON.stringify(plan)},${JSON.stringify(digest)}).then(value=>console.log(JSON.stringify({ok:true,value}))).catch(error=>{console.log(JSON.stringify({ok:false,code:typeof error.code==='string'&&/^[A-Z_0-9]+$/.test(error.code)?error.code:'STAGING_OPERATION_FAILED',evidence:error.evidence}));process.exitCode=1;});`;
    try {
      if (reviewedSource() !== commit) fail("STAGING_COMMIT_MISMATCH");
      // stdin avoids shell interpolation and single-argument size limits for the audited bundle.
      const child = spawnSync(RAILWAY, ["ssh", "--project", TARGET.projectId, "--environment", TARGET.environmentId, "--service", TARGET.serviceId, "--", "node", "--input-type=commonjs"], { cwd: this.cwd, env: cleanEnvironment(), input: code, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 120000, maxBuffer: 768 * 1024 * 1024 });
      if (child.status !== 0) {
        const response = (() => { try { return JSON.parse(child.stdout || ""); } catch { return null; } })();
        if (response?.code === "RECOVERY_REQUIRED") throw new SchemaError("RECOVERY_REQUIRED", response.evidence);
        fail(operation === "apply" ? "RECOVERY_REQUIRED" : "STAGING_READ_OPERATION_FAILED");
      }
      const output = child.stdout;
      const response = JSON.parse(output.trim());
      if (!response.ok) fail("STAGING_OPERATION_FAILED");
      return response.value;
    } catch (error) {
      if (error instanceof SchemaError && error.code === "RECOVERY_REQUIRED") throw error;
      // Never log transport stdout/stderr: a backup response contains application data.
      try { const response = JSON.parse(String((error as any).stdout || "")); if (response.ok === false && response.code === "RECOVERY_REQUIRED") fail("RECOVERY_REQUIRED"); } catch (e) { if ((e as any).code === "RECOVERY_REQUIRED") throw e; }
      return fail(operation === "apply" ? "RECOVERY_REQUIRED" : "STAGING_READ_OPERATION_FAILED");
    }
  }
  async inspect(): Promise<Inspection> { return this.remote("inspect"); }
  async backup() { const response = await this.remote("backup"); return { bytes: Buffer.from(response.bytes, "base64"), originSha256: response.originSha256 }; }
  async reconcile(plan: Plan, digest: string) {
    if (canonical(await this.identity()) !== canonical(plan.target)) fail("STAGING_TARGET_IDENTITY_MISMATCH");
    if ((await this.health()).status !== 200) fail("STAGING_HEALTH_REQUIRED");
    const result = await this.remote("apply", plan, digest);
    for (const event of result.events || []) if (["lock_acquired", "governance_initialized", "migration_started", "migration_validated"].includes(event.event)) console.log(JSON.stringify({ event: event.event, planId: plan.planId, at: event.at }));
    return result;
  }
  async restoreProof(bytes: Buffer) {
    const socketDirectory = `/tmp/l4ckos-proof-${randomUUID()}`;
    await mkdir(socketDirectory, { mode: 0o700 });
    const id = path.basename(socketDirectory).toLowerCase(), name = `l4ckos_test_proof_${randomUUID().replaceAll("-", "").slice(0,16)}`;
    const container = `l4ckos-proof-${id}`;
    let created = false;
    try {
      execFileSync("/usr/bin/docker", ["--host", "unix:///var/run/docker.sock", "run", "-d", "--user", `${process.getuid?.()}:${process.getgid?.()}`, "--tmpfs", `/var/lib/mysql:rw,uid=${process.getuid?.()},gid=${process.getgid?.()},mode=0700`, "--pull=never", "--name", container, "--network", "none", "-v", `${socketDirectory}:/var/run/mysqld`, "-e", "MYSQL_ALLOW_EMPTY_PASSWORD=yes", "mysql:8.4"], { stdio: ["ignore", "pipe", "pipe"] }); created = true;
      let ready = false;
      for (let i = 0; i < 60; i++) {
        const process = spawnSync("/usr/bin/docker", ["--host", "unix:///var/run/docker.sock", "exec", container, "cat", "/proc/1/comm"], { encoding: "utf8" });
        const p = spawnSync("/usr/bin/docker", ["--host", "unix:///var/run/docker.sock", "exec", container, "mysqladmin", "--socket=/var/run/mysqld/mysqld.sock", "ping"], { stdio: "ignore" });
        if (process.status === 0 && process.stdout.trim() === "mysqld" && p.status === 0) { ready = true; break; } await new Promise(r => setTimeout(r, 500));
      }
      if (!ready) throw new RestoreProofError({ detail: "RESTORE_MYSQL_STARTUP_FAILED" });
      const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/staging0021-restore-proof.ts", `mysql://root@localhost/${name}`, `${socketDirectory}/mysqld.sock`], { cwd: ROOT, env: { ...cleanEnvironment(), NODE_ENV: "test", L4CKOS_LOCAL_RESTORE: "1" }, input: bytes, encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 120000 });
      if (result.status !== 0) {
        let diagnostic: Record<string, string | number | boolean> = { detail: "RESTORE_VALIDATION_FAILED" };
        try { diagnostic = restoreDiagnostic({ diagnostic: JSON.parse(result.stderr.trim()).diagnostic }); } catch { /* Never print raw child output. */ }
        throw new RestoreProofError(diagnostic);
      }
      const proof = JSON.parse(result.stdout.trim());
      for (const [table, v] of Object.entries(proof.tables || {}) as [string, any][]) if (/^[a-zA-Z0-9_]+$/.test(table) && Number.isSafeInteger(v.expectedRows) && Number.isSafeInteger(v.restoredRows)) console.log(JSON.stringify({ event: "restore_table_validated", table, expectedRows: v.expectedRows, restoredRows: v.restoredRows, checksumVerified: v.checksumVerified === true }));
      return proof;
    } catch (error) {
      console.error(JSON.stringify({ event: "restore_proof_failed", diagnostic: restoreDiagnostic(error) }));
      return fail("STAGING_RESTORE_PROOF_REQUIRED");
    }
    finally { if (created) execFileSync("/usr/bin/docker", ["--host", "unix:///var/run/docker.sock", "rm", "-fv", container], { stdio: "ignore" }); }
  }
}
