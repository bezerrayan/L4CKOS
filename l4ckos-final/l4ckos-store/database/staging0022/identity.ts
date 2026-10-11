import { execFileSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { homedir } from "node:os";
import { FixedPreorderRailwayAdapter } from "../staging0021/railway";
import { canonical, sha256 } from "../schema/fingerprint";
import { TARGET, digest, fail } from "./policy";
import type { RemoteIdentity } from "./capability";

/** Read-only metadata only, scoped to staging. UUID must come from the separate
 * fixed MySQL-service identity read; never discovered through an unchecked API URL.
 */
export async function prepareIdentity(
  serverUuid: string
): Promise<RemoteIdentity> {
  if (!/^[a-f0-9-]{36}$/.test(serverUuid)) fail("MYSQL_UUID_REQUIRED");
  const audited = await new FixedPreorderRailwayAdapter().identity();
  const cwd = await mkdtemp("/tmp/l4ckos-0022-identity-");
  let vars: Record<string, string>;
  try {
    vars = JSON.parse(
      execFileSync(
        "/home/yan/.railway/bin/railway",
        [
          "variables",
          "--project",
          TARGET.projectId,
          "--environment",
          TARGET.environmentId,
          "--service",
          TARGET.serviceId,
          "--json",
        ],
        {
          cwd,
          env: { PATH: process.env.PATH, HOME: homedir() },
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 30000,
        }
      )
    );
  } catch {
    return fail("STAGING_IDENTITY_METADATA_FAILED");
  }
  if (
    vars.RAILWAY_PROJECT_ID !== TARGET.projectId ||
    vars.RAILWAY_ENVIRONMENT_ID !== TARGET.environmentId ||
    vars.RAILWAY_SERVICE_ID !== TARGET.serviceId
  )
    fail("STAGING_VARIABLE_IDENTITY_MISMATCH");
  let u: URL;
  try {
    u = new URL(vars.DATABASE_URL);
  } catch {
    return fail("STAGING_PRIVATE_DATABASE_REQUIRED");
  }
  const database = decodeURIComponent(u.pathname.slice(1));
  const binding = sha256(
    canonical([
      u.hostname,
      Number(u.port || 3306),
      decodeURIComponent(u.username),
      decodeURIComponent(u.password),
      database,
      null,
    ])
  );
  if (
    u.protocol !== "mysql:" ||
    !u.hostname.endsWith(".railway.internal") ||
    u.search ||
    u.hash ||
    database !== TARGET.database ||
    binding !== audited.connectionHash
  )
    fail("STAGING_ENDPOINT_METADATA_CHANGED");
  return {
    target: TARGET,
    deploymentId: audited.deploymentId,
    serverUuid,
    endpointHash: digest([u.hostname, Number(u.port || 3306), database]),
  };
}
