import { createConnection } from "mysql2/promise";
import { applyV6, diagnoseV6 } from "./executor";
import { assertIdentity, connectionHash, fail, TARGET, type BackupGate, type StagingIdentity } from "./policy";

/** Entry point for a reviewed Railway SSH bundle. It never loads application routes or payment workers. */
export async function remoteV6Operation(operation: "diagnose" | "apply", identity: StagingIdentity, backup?: BackupGate, confirmationDigest?: string) {
  assertIdentity(identity);
  if (Object.entries({
    RAILWAY_PROJECT_ID: TARGET.projectId,
    RAILWAY_ENVIRONMENT_ID: TARGET.environmentId,
    RAILWAY_SERVICE_ID: TARGET.apiServiceId,
    RAILWAY_DEPLOYMENT_ID: identity.deploymentId,
  }).some(([key, value]) => process.env[key] !== value)) fail("STAGING_RUNTIME_IDENTITY_MISMATCH");
  const raw = process.env.DATABASE_URL || "";
  let url: URL;
  try { url = new URL(raw); } catch { return fail("STAGING_DATABASE_URL_REQUIRED"); }
  if (url.protocol !== "mysql:" || url.hostname !== identity.databaseHost || url.pathname !== `/${TARGET.schema}` || url.search || url.hash) fail("STAGING_DATABASE_TARGET_MISMATCH");
  const c = await createConnection({ uri: raw, timezone: "Z", multipleStatements: false });
  try {
    if (connectionHash(c) !== identity.connectionHash) fail("STAGING_CONNECTION_IDENTITY_MISMATCH");
    if (operation === "diagnose") return await diagnoseV6(c, identity);
    if (operation !== "apply" || !backup || !confirmationDigest) return fail("INVALID_V6_OPERATION");
    return await applyV6(c, identity, backup, confirmationDigest);
  } finally { await c.end(); }
}
