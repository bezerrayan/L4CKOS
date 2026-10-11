import type { Connection } from "mysql2/promise";
import {
  assertLocalSchemaTarget,
  verifyLocalConnection,
  type LocalTarget,
} from "../schema/safety";
import { rows } from "../schema/fingerprint";
import { assertPlan, digest, fail, TARGET, type WindowPlan } from "./policy";

declare const grant: unique symbol;
export type Capability = { readonly [grant]: true };
const grants = new WeakMap<
  object,
  { connection: Connection; planDigest: string; verify: () => Promise<void> }
>();
export type RemoteIdentity = Pick<
  WindowPlan,
  "target" | "deploymentId" | "serverUuid" | "endpointHash"
>;
export function assertRemoteEnvironment(p: RemoteIdentity) {
  if (
    digest(p.target) !== digest(TARGET) ||
    !/^[a-f0-9-]{36}$/.test(p.serverUuid) ||
    !/^[a-f0-9-]{36}$/.test(p.deploymentId) ||
    !/^[a-f0-9]{64}$/.test(p.endpointHash)
  )
    fail("STAGING_IDENTITY_INVALID");
  for (const [k, v] of Object.entries({
    RAILWAY_PROJECT_ID: TARGET.projectId,
    RAILWAY_ENVIRONMENT_ID: TARGET.environmentId,
    RAILWAY_SERVICE_ID: TARGET.serviceId,
    RAILWAY_DEPLOYMENT_ID: p.deploymentId,
  }))
    if (process.env[k] !== v) fail("STAGING_RUNTIME_IDENTITY_MISMATCH");
}
export function assertPrivateUrl(value: string, p: RemoteIdentity) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail("STAGING_PRIVATE_DATABASE_REQUIRED");
  }
  const database = decodeURIComponent(url.pathname.slice(1));
  if (
    url.protocol !== "mysql:" ||
    !url.hostname.endsWith(".railway.internal") ||
    url.search ||
    url.hash ||
    database !== TARGET.database ||
    digest([url.hostname, Number(url.port || 3306), database]) !==
      p.endpointHash
  )
    fail("STAGING_ENDPOINT_NOT_APPROVED");
  return url;
}
export async function verifyRemoteIdentity(c: Connection, p: RemoteIdentity) {
  assertRemoteEnvironment(p);
  if (
    !c.config.host?.endsWith(".railway.internal") ||
    c.config.socketPath ||
    c.config.database !== TARGET.database ||
    digest([c.config.host, Number(c.config.port), c.config.database]) !==
      p.endpointHash
  )
    fail("STAGING_CONNECTION_BINDING_MISMATCH");
  const r = (
    await rows(
      c,
      "SELECT DATABASE() db, @@server_uuid uuid, VERSION() version, @@SESSION.foreign_key_checks fk, @@SESSION.autocommit autocommit, @@SESSION.sql_mode mode"
    )
  )[0];
  if (
    r.db !== TARGET.database ||
    r.uuid !== p.serverUuid ||
    !/^8\.4\./.test(r.version) ||
    Number(r.fk) !== 1 ||
    Number(r.autocommit) !== 1 ||
    !String(r.mode).includes("STRICT_TRANS_TABLES")
  )
    fail("STAGING_SERVER_IDENTITY_MISMATCH");
  await c.query("SET time_zone = '+00:00'");
}
export async function remoteCapability(
  c: Connection,
  p: WindowPlan
): Promise<Capability> {
  assertPlan(p);
  const verify = () => verifyRemoteIdentity(c, p);
  await verify();
  const token = Object.freeze({});
  grants.set(token, { connection: c, planDigest: digest(p), verify });
  return token as Capability;
}
/** Test issuer cannot authorize a Railway URL/runtime or the staging database. */
export async function localCapability(
  c: Connection,
  p: WindowPlan,
  target: LocalTarget
): Promise<Capability> {
  assertPlan(p);
  assertLocalSchemaTarget(target);
  const verify = async () => {
    await verifyLocalConnection(c, target);
    if ((await rows(c, "SELECT @@server_uuid uuid"))[0].uuid !== p.serverUuid)
      fail("LOCAL_SERVER_IDENTITY_MISMATCH");
  };
  await verify();
  const token = Object.freeze({});
  grants.set(token, { connection: c, planDigest: digest(p), verify });
  return token as Capability;
}
export async function verifyCapability(
  c: Connection,
  p: WindowPlan,
  cap: Capability
) {
  const value = grants.get(cap);
  if (!value || value.connection !== c || value.planDigest !== digest(p))
    fail("0022_CAPABILITY_REQUIRED");
  assertPlan(p);
  await value.verify();
}
