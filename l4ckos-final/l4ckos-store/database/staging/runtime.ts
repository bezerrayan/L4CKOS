import type { Connection } from "mysql2/promise";
import { TARGET, fail, type Identity } from "./policy";
/** Defense in depth inside the fixed Railway service; no test/local override exists. */
export function assertStagingRuntime(connection: Connection, identity: Identity) {
  if (!connection.config.host?.endsWith(".railway.internal") || connection.config.socketPath ||
      Object.entries({ RAILWAY_PROJECT_ID: TARGET.projectId, RAILWAY_ENVIRONMENT_ID: TARGET.environmentId, RAILWAY_SERVICE_ID: TARGET.serviceId, RAILWAY_DEPLOYMENT_ID: identity.deploymentId }).some(([k,v]) => process.env[k] !== v)) fail("STAGING_RUNTIME_IDENTITY_MISMATCH");
}
