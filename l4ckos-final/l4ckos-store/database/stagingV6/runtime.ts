import type { Connection } from "mysql2/promise";
import { canonical, rows, sha256 } from "../schema/fingerprint";
import { SchemaError } from "../schema/safety";

type RuntimeIdentity = { projectId: string; environmentId: string; apiServiceId: string; deploymentId: string; schema: string; databaseHost: string; connectionHash: string };
const fail = (code: string): never => { throw new SchemaError(code); };

/** Runtime-side identity validation, separated from Railway metadata discovery. */
export async function assertV6Runtime(c: Connection, identity: RuntimeIdentity) {
  const config = c.config;
  const actualHash = sha256(canonical([config.host, Number(config.port || 3306), config.user, config.password || "", config.database, config.socketPath || null]));
  if (actualHash !== identity.connectionHash || config.host !== identity.databaseHost || config.database !== identity.schema || config.socketPath) fail("STAGING_CONNECTION_IDENTITY_MISMATCH");
  for (const [key, value] of Object.entries({
    RAILWAY_PROJECT_ID: "2bb90c8e-eb65-43ee-826b-f93750f0499c",
    RAILWAY_ENVIRONMENT_ID: "15545eee-bc02-4b70-afc4-19a5db9e6f46",
    RAILWAY_SERVICE_ID: "9f1c7705-f2f9-48cf-b957-8f63a6bba4db",
    RAILWAY_DEPLOYMENT_ID: identity.deploymentId,
  })) if (process.env[key] !== value) fail("STAGING_RUNTIME_IDENTITY_MISMATCH");
  const row = (await rows(c, "SELECT DATABASE() schemaName, VERSION() version, @@hostname hostname, @@SESSION.foreign_key_checks fk, @@SESSION.autocommit autocommit, @@SESSION.sql_mode sqlMode"))[0];
  if (row.schemaName !== identity.schema || !/^8\.4\./.test(String(row.version)) || Number(row.fk) !== 1 || Number(row.autocommit) !== 1 || !String(row.sqlMode).includes("STRICT_TRANS_TABLES")) fail("MYSQL_84_STAGING_SQL_IDENTITY_REQUIRED");
  return { schema: String(row.schemaName), version: String(row.version), hostname: String(row.hostname) };
}
