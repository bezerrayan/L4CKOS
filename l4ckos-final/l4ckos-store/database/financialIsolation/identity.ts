import type { Connection } from "mysql2/promise";
import {
  rows,
  readStructuralSchema,
  structuralHash,
  sha256,
} from "../schema/fingerprint";
import {
  TARGET,
  assertEnvironment,
  type Environment,
} from "../financialRecovery/policy";
/** Fixed production adapter guard. Local tests use explicit seams, never stdin/env overrides. */
export async function verifyStagingIsolationIdentity(
  c: Connection,
  apiEnvironment: Environment,
  mysqlServiceId: string,
  deployedApiBundle: Uint8Array
) {
  assertEnvironment(apiEnvironment);
  if (
    mysqlServiceId !== "bcda5d78-4a0d-4682-8659-8316847addb7" ||
    c.config.socketPath !== "/var/run/mysqld/mysqld.sock"
  )
    throw Error("ISOLATION_FIXED_MYSQL_SOCKET_REQUIRED");
  const [m] = await rows(
    c,
    "SELECT DATABASE() db,SHA2(@@server_uuid,256) uuidHash,VERSION() version,CURRENT_USER() account"
  );
  if (
    m.db !== TARGET.database ||
    m.uuidHash !== TARGET.mysqlUuidHash ||
    !String(m.version).startsWith("8.4.") ||
    m.account !== "root@localhost"
  )
    throw Error("ISOLATION_FIXED_DATABASE_REQUIRED");
  if (
    sha256(Buffer.from(deployedApiBundle)) !== TARGET.bundleHash ||
    structuralHash(await readStructuralSchema(c)) !== TARGET.schemaHash
  )
    throw Error("ISOLATION_ARTIFACT_OR_SCHEMA_MISMATCH");
}
