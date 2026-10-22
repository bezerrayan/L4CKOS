import type { Connection } from "mysql2/promise";
import {
  rows,
  structuralHash,
  readStructuralSchema,
  canonical,
  sha256,
} from "../schema/fingerprint";
import { TARGET } from "../financialRecovery/policy";
export const BACKUP_TARGET = Object.freeze({
  projectId: TARGET.projectId,
  environmentId: TARGET.environmentId,
  mysqlServiceId: "bcda5d78-4a0d-4682-8659-8316847addb7",
  mysqlDeploymentId: "23828bf1-c7d6-4ef2-b6d5-91dfe812fd89",
  database: TARGET.database,
  uuidHash: TARGET.mysqlUuidHash,
  mysqlVersion: "8.4.11",
  schemaHash: TARGET.schemaHash,
  governanceHash:
    "47462fe9f093c89f83444b2b849ecf488ae7de04557a79e11286bf48484f693b",
  migration: "0023_asaas_webhook_inbox",
  migrationChecksum:
    "b0b588463e5318fdc63761fd6a8261827478fe058f2152a8a630fa5fa87bae8a",
  tableCount: 31,
});
export type PhysicalReference = {
  readonly [K in keyof typeof BACKUP_TARGET]: (typeof BACKUP_TARGET)[K] extends number
    ? number
    : string;
} & { account?: string; login?: string };
export function assertBackupRailway(env: Record<string, string | undefined>) {
  const expected = {
    RAILWAY_PROJECT_ID: BACKUP_TARGET.projectId,
    RAILWAY_ENVIRONMENT_ID: BACKUP_TARGET.environmentId,
    RAILWAY_SERVICE_ID: BACKUP_TARGET.mysqlServiceId,
    RAILWAY_DEPLOYMENT_ID: BACKUP_TARGET.mysqlDeploymentId,
  };
  for (const [key, value] of Object.entries(expected))
    if (env[key] !== value) throw Error("WINDOW_BACKUP_RAILWAY_IDENTITY");
  // Neither MYSQL_DATABASE nor a malformed name is an authority or fallback.
}
export function assertBackupReference(
  reference: unknown,
  expectedHash: string,
  presentedHash: string
) {
  if (
    !/^[a-f0-9]{64}$/.test(expectedHash) ||
    presentedHash !== expectedHash ||
    sha256(canonical(reference)) !== expectedHash ||
    !reference ||
    typeof reference !== "object" ||
    canonical((reference as { target?: unknown }).target) !==
      canonical(BACKUP_TARGET) ||
    !Array.isArray((reference as { sources?: unknown }).sources) ||
    !(reference as { sources: unknown[] }).sources.length
  )
    throw Error("WINDOW_BACKUP_REFERENCE_INTEGRITY");
}
/** Reference must be pinned before connection. Production CLI supplies the embedded target;
 * local synthetic tests supply a separately established local fixture reference. No env/stdin override. */
export async function verifyPhysicalBackupIdentity(
  c: Connection,
  ref: PhysicalReference
) {
  let id: Record<string, any>;
  try {
    [id] = await rows(
      c,
      ref.login !== undefined
        ? "SELECT DATABASE() db,SHA2(@@server_uuid,256) uuidHash,VERSION() version,CURRENT_USER() account,USER() login"
        : "SELECT DATABASE() db,SHA2(@@server_uuid,256) uuidHash,VERSION() version,CURRENT_USER() account"
    );
  } catch {
    throw Error("WINDOW_BACKUP_PHYSICAL_IDENTITY_UNAVAILABLE");
  }
  if (!id?.uuidHash) throw Error("WINDOW_BACKUP_PHYSICAL_IDENTITY_UNAVAILABLE");
  if (
    id.db !== ref.database ||
    id.uuidHash !== ref.uuidHash ||
    id.version !== ref.mysqlVersion ||
    id.account !== (ref.account ?? "root@localhost") ||
    (ref.login !== undefined &&
      (typeof id.login !== "string" ||
        id.login.lastIndexOf("@") < 1 ||
        id.login.slice(0, id.login.lastIndexOf("@")) !== ref.login))
  )
    throw Error("WINDOW_BACKUP_PHYSICAL_IDENTITY");
  if (
    structuralHash(await readStructuralSchema(c)) !== ref.schemaHash ||
    structuralHash(await readStructuralSchema(c, true)) !== ref.governanceHash
  )
    throw Error("WINDOW_BACKUP_FINGERPRINT");
  const tables = await rows(
    c,
    "SELECT ENGINE engine,TABLE_TYPE type FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()"
  );
  if (
    tables.length !== ref.tableCount ||
    tables.some(t => t.engine !== "InnoDB" || t.type !== "BASE TABLE")
  )
    throw Error("WINDOW_BACKUP_TABLE_COVERAGE");
  const ledger = await rows(
    c,
    "SELECT checksum,postFingerprint,kind,manifestVersion FROM `_l4ckos_schema_migrations` WHERE name=?",
    [ref.migration]
  );
  const execution = await rows(
    c,
    "SELECT checksum,state,observedFingerprint,errorCode FROM `_l4ckos_schema_executions` WHERE operation=?",
    [ref.migration]
  );
  const incomplete = await rows(
    c,
    "SELECT COUNT(*) n FROM `_l4ckos_schema_executions` WHERE state <> 'COMPLETED'"
  );
  if (
    ledger.length !== 1 ||
    ledger[0].checksum !== ref.migrationChecksum ||
    ledger[0].postFingerprint !== ref.schemaHash ||
    ledger[0].kind !== "MIGRATION" ||
    Number(ledger[0].manifestVersion) !== 2 ||
    execution.length !== 1 ||
    execution[0].checksum !== ref.migrationChecksum ||
    execution[0].state !== "COMPLETED" ||
    execution[0].observedFingerprint !== ref.schemaHash ||
    execution[0].errorCode !== null ||
    Number(incomplete[0].n) !== 0
  )
    throw Error("WINDOW_BACKUP_MIGRATION_IDENTITY");
}
