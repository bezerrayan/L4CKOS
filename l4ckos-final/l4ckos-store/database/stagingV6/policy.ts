import type { Connection } from "mysql2/promise";
import { canonical, sha256 } from "../schema/fingerprint";
import { SchemaError } from "../schema/safety";
import { assertV6Runtime as assertRuntime } from "./runtime";

export const TARGET = Object.freeze({
  projectId: "2bb90c8e-eb65-43ee-826b-f93750f0499c",
  projectName: "l4ckos-staging",
  environmentId: "15545eee-bc02-4b70-afc4-19a5db9e6f46",
  environmentName: "production",
  apiServiceId: "9f1c7705-f2f9-48cf-b957-8f63a6bba4db",
  mysqlServiceId: "bcda5d78-4a0d-4682-8659-8316847addb7",
  schema: "l4ckos_staging",
});
export const APPLICATION_RC = "88daab3046f5351b6724ad51f69041b4fd896509";
export const PRE = "0ba16c9b19b698d4933d0abad9a5e4679052fd2aaf78800da42d480e396ef5d2";
export const AFTER_0024 = "7fe98896cff3da47b18a522c668fc429355e0397d74afa26c864585f102d649e";
export const POST = "38b664bdad6d26873fcb3b539c17234ee4214cf6654aecf0bc13286622cc0d04";
export const MIGRATIONS = Object.freeze([
  { name: "0024_home_highlight_settings", checksum: "b687a35477a7c3da740dbf0c139bfa386742dbe4e8143325dedc73ee557b61e3", pre: PRE, post: AFTER_0024 },
  { name: "0025_product_variant_identity", checksum: "8145647beaf71af5228dacc12b7f03048379c557389ac8121189d16e99622e05", pre: AFTER_0024, post: POST },
]);
export const fail = (code: string): never => { throw new SchemaError(code); };
export type StagingIdentity = typeof TARGET & {
  deploymentId: string;
  databaseHost: string;
  connectionHash: string;
};
export type BackupGate = {
  artifactId: string;
  artifactSha256: string;
  createdAt: string;
  sourceProjectId: typeof TARGET.projectId;
  sourceEnvironmentId: typeof TARGET.environmentId;
  sourceMysqlServiceId: typeof TARGET.mysqlServiceId;
  sourceSchema: typeof TARGET.schema;
  sourceFingerprint: typeof PRE;
  restoreFingerprint: typeof PRE;
  restoredIsolated: true;
  restoreMysqlVersion: string;
  restoredTableCount: 31;
  checksumsVerified: true;
  foreignKeyViolations: 0;
  ledgerTail: "0023_asaas_webhook_inbox";
  validationId: string;
};
declare const authorized: unique symbol;
export type AuthorizedV6Capability = { readonly [authorized]: true };
type Grant = { connection: Connection; identity: StagingIdentity; backup: BackupGate; digest: string; consumed: boolean };
const grants = new WeakMap<object, Grant>();
export function assertIdentity(identity: StagingIdentity) {
  if (!identity || Object.entries(TARGET).some(([key, value]) => identity[key as keyof StagingIdentity] !== value) ||
      identity.schema !== "l4ckos_staging" ||
      !/^[a-f0-9-]{36}$/.test(identity.deploymentId) ||
      !/^[a-z0-9-]+\.railway\.internal$/.test(identity.databaseHost) ||
      !/^[a-f0-9]{64}$/.test(identity.connectionHash)) fail("STAGING_TARGET_IDENTITY_MISMATCH");
}
export function connectionHash(c: Connection) {
  const x = c.config;
  return sha256(canonical([x.host, Number(x.port || 3306), x.user, x.password || "", x.database, x.socketPath || null]));
}
export function assertBackupGate(gate: BackupGate, now = Date.now()) {
  const created = Date.parse(gate?.createdAt || "");
  if (!gate || typeof gate.artifactId !== "string" || !gate.artifactId.trim() ||
      !/^[a-f0-9]{64}$/.test(gate.artifactSha256 || "") || !Number.isFinite(created) || created > now || now - created > 24 * 60 * 60 * 1000 ||
      gate.sourceProjectId !== TARGET.projectId || gate.sourceEnvironmentId !== TARGET.environmentId || gate.sourceMysqlServiceId !== TARGET.mysqlServiceId || gate.sourceSchema !== TARGET.schema ||
      gate.sourceFingerprint !== PRE || gate.restoreFingerprint !== PRE || gate.restoredIsolated !== true ||
      !/^8\.4\./.test(gate.restoreMysqlVersion || "") || gate.restoredTableCount !== 31 || gate.checksumsVerified !== true || gate.foreignKeyViolations !== 0 || gate.ledgerTail !== "0023_asaas_webhook_inbox" ||
      typeof gate.validationId !== "string" || gate.validationId.trim().length < 8) fail("CURRENT_RESTORED_BACKUP_PROOF_REQUIRED");
}
export function digestApplyAuthorization(identity: StagingIdentity, backup: BackupGate) {
  assertIdentity(identity); assertBackupGate(backup);
  return sha256(canonical({ target: TARGET, deploymentId: identity.deploymentId, connectionHash: identity.connectionHash, backup, migrations: MIGRATIONS, applicationCommit: APPLICATION_RC }));
}
export async function createAuthorizedV6Capability(c: Connection, identity: StagingIdentity, backup: BackupGate, confirmationDigest: string): Promise<AuthorizedV6Capability> {
  assertIdentity(identity); assertBackupGate(backup);
  if (connectionHash(c) !== identity.connectionHash || confirmationDigest !== digestApplyAuthorization(identity, backup)) fail("V6_APPLY_CONFIRMATION_MISMATCH");
  await assertRuntime(c, identity);
  const token = Object.freeze({});
  grants.set(token, { connection: c, identity: structuredClone(identity), backup: structuredClone(backup), digest: confirmationDigest, consumed: false });
  return token as AuthorizedV6Capability;
}
export async function consumeAuthorizedV6Capability(c: Connection, token: AuthorizedV6Capability) {
  const grant = grants.get(token);
  if (!grant || grant.connection !== c || grant.consumed) return fail("V6_CAPABILITY_REQUIRED");
  grant.consumed = true;
  const verify = async () => {
    assertIdentity(grant.identity); assertBackupGate(grant.backup);
    if (connectionHash(c) !== grant.identity.connectionHash || digestApplyAuthorization(grant.identity, grant.backup) !== grant.digest) fail("V6_CAPABILITY_BINDING_MISMATCH");
    await assertRuntime(c, grant.identity);
  };
  await verify();
  return { context: { applicationCommit: APPLICATION_RC, approvedFingerprint: POST }, verify };
}
