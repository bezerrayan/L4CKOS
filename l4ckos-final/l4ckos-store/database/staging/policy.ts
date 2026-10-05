import type { Connection } from "mysql2/promise";
import { createHmac } from "node:crypto";
import { canonical, sha256, rows } from "../schema/fingerprint";
import { assertStagingRuntime } from "./runtime";
import { SchemaError } from "../schema/safety";

export const TARGET = Object.freeze({ projectId: "2bb90c8e-eb65-43ee-826b-f93750f0499c", projectName: "l4ckos-staging", environment: "production", environmentId: "15545eee-bc02-4b70-afc4-19a5db9e6f46", service: "l4ckos-staging", serviceId: "9f1c7705-f2f9-48cf-b957-8f63a6bba4db", mysqlServiceId: "bcda5d78-4a0d-4682-8659-8316847addb7", backendHost: "api-staging.l4ckos.com.br" });
export const MIGRATION = Object.freeze({ name: "0020_reconcile_asaas_webhook_events", kind: "RECONCILIATION", checksum: "cad11dda08787cf7935390a1531002627f7a2894455ad250357b0ec1fa050423" });
export const PRE = "09f647cdda027984d3425bef6ccee9cb3496a648602515b0930465b7b02d9efe";
export const POST = "f2baf7519cb425c955bfd0f697da10afa670ee57763e3f641b61a09ba75b7f8d";
export const TTL = 15 * 60 * 1000;
export function fail(code: string): never { throw new SchemaError(code); }
export type Identity = typeof TARGET & { deploymentId: string; connectionHash: string };
export function assertIdentity(identity: Identity) {
  if (identity.projectName === ("l4ckos-production" as string) || identity.backendHost === ("l4ckos.com.br" as string) || Object.entries(TARGET).some(([k,v]) => identity[k as keyof Identity] !== v) || !/^[a-f0-9]{64}$/.test(identity.connectionHash) || !/^[a-f0-9-]{36}$/.test(identity.deploymentId)) fail("STAGING_TARGET_IDENTITY_MISMATCH");
}
export function connectionHash(connection: Connection) {
  const c = connection.config;
  return sha256(canonical([c.host, Number(c.port), c.user, c.password || "", c.database, c.socketPath || null]));
}
export type Plan = {
  version: 1; planId: string; createdAt: string; expiresAt: string; applicationCommit: string;
  target: Identity; migration: typeof MIGRATION;
  expectedPreFingerprint: string; observedPreFingerprint: string; expectedPostFingerprint: string;
  backup: { created: true; copiedOffRuntime: true; checksumVerified: true; artifactSha256: string; createdAt: string; rowCounts: Record<string, number>; rowChecksums: Record<string, string>; sourceFingerprint: string; schemaFingerprint: string; restoreVerified: true; restoreFingerprint: string };
  health: { status: 200 }; asaasWebhookEventsBefore: "ABSENT"; ledgerStateBefore: "ABSENT";
};
export const digestPlan = (plan: Plan) => sha256(canonical(plan));
export const sealPlan = (plan: Plan, key: Buffer) => createHmac("sha256", key).update(digestPlan(plan)).digest("hex");
export function assertPlan(plan: Plan, now = Date.now()) {
  if (!plan || plan.version !== 1 || !/^[a-f0-9-]{36}$/.test(plan.planId) || !/^[a-f0-9]{40}$/.test(plan.applicationCommit)) fail("INVALID_STAGING_PLAN");
  assertIdentity(plan.target);
  if (canonical(plan.migration) !== canonical(MIGRATION) || plan.expectedPreFingerprint !== PRE || plan.observedPreFingerprint !== PRE || plan.expectedPostFingerprint !== POST || plan.asaasWebhookEventsBefore !== "ABSENT" || plan.ledgerStateBefore !== "ABSENT" || plan.health?.status !== 200) fail("STAGING_PLAN_SCOPE_MISMATCH");
  const created = Date.parse(plan.createdAt), expires = Date.parse(plan.expiresAt);
  if (!Number.isFinite(created) || !Number.isFinite(expires) || expires - created !== TTL || created > now || now >= expires) fail("STAGING_PLAN_EXPIRED");
  const b = plan.backup;
  if (!b || !Number.isFinite(Date.parse(b.createdAt)) || Date.parse(b.createdAt) > now + 30000 || now - Date.parse(b.createdAt) >= TTL || canonical(Object.keys(b.rowChecksums || {}).sort()) !== canonical(Object.keys(b.rowCounts || {}).sort()) || Object.values(b.rowChecksums || {}).some(h => !/^[a-f0-9]{64}$/.test(h)) || b.created !== true || b.copiedOffRuntime !== true || b.checksumVerified !== true || b.restoreVerified !== true || b.sourceFingerprint !== PRE || b.restoreFingerprint !== PRE || !/^[a-f0-9]{64}$/.test(b.artifactSha256) || !/^[a-f0-9]{64}$/.test(b.schemaFingerprint) || Object.keys(b.rowCounts || {}).length !== 25 || Object.values(b.rowCounts).some(n => !Number.isSafeInteger(n) || n < 0)) fail("STAGING_BACKUP_PROOF_REQUIRED");
}

// Runtime identity is additionally verified by the fixed Railway transport before this issuer.
// An arbitrary object/cast is not a capability: each token is registered and connection-bound.
declare const authorized: unique symbol;
export type AuthorizedStagingCapability = { readonly [authorized]: true };
const grants = new WeakMap<object, { connection: Connection; plan: Plan; digest: string }>();
export function createAuthorizedStagingContext(connection: Connection, plan: Plan, identity: Identity, confirmationDigest: string): AuthorizedStagingCapability {
  assertPlan(plan); assertIdentity(identity);
  if (canonical(identity) !== canonical(plan.target) || connectionHash(connection) !== identity.connectionHash || digestPlan(plan) !== confirmationDigest) fail("STAGING_CAPABILITY_BINDING_MISMATCH");
  assertStagingRuntime(connection, identity);
  const token = Object.freeze({});
  grants.set(token, { connection, plan: structuredClone(plan), digest: confirmationDigest });
  return token as AuthorizedStagingCapability;
}
export async function verifyStagingCapability(connection: Connection, token: AuthorizedStagingCapability) {
  const grant = grants.get(token);
  if (!grant || grant.connection !== connection) fail("STAGING_CAPABILITY_REQUIRED");
  assertPlan(grant.plan);
  assertStagingRuntime(connection, grant.plan.target);
  if (digestPlan(grant.plan) !== grant.digest || connectionHash(connection) !== grant.plan.target.connectionHash) fail("STAGING_CAPABILITY_BINDING_MISMATCH");
  const r = (await rows(connection, "SELECT VERSION() version, @@SESSION.foreign_key_checks fk, @@SESSION.sql_mode sqlMode, @@SESSION.autocommit autocommit"))[0];
  if (!/^8\.4\./.test(r.version) || Number(r.fk) !== 1 || Number(r.autocommit) !== 1 || !String(r.sqlMode).includes("STRICT_TRANS_TABLES")) fail("MYSQL_84_STRICT_TARGET_REQUIRED");
  return structuredClone(grant.plan);
}
