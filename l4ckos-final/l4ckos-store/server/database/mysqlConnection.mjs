import { createHash } from "node:crypto";
import {
  createMysqlConnectionOptions,
  MYSQL_TLS_CA_SHA256,
  MYSQL_TLS_HOST,
} from "./mysqlTls.mjs";

// Known staging identity (same constants the staging guards in services/asaasConfig.ts and payments/webhookRecovery.ts use).
const STAGING_RAILWAY_PROJECT_ID = "2bb90c8e-eb65-43ee-826b-f93750f0499c";
const STAGING_RAILWAY_ENVIRONMENT_ID = "15545eee-bc02-4b70-afc4-19a5db9e6f46";
const ISOLATED_STAGING_RAILWAY_PROJECT_ID = "66faf690-a068-40d1-b85c-cb5d8595560a";
const ISOLATED_STAGING_RAILWAY_ENVIRONMENT_ID = "5335340d-311c-47e9-9713-6e5a86969c88";
const ISOLATED_STAGING_RAILWAY_SERVICE_ID = "d66762a4-422a-4656-94a1-502215a27aa2";
const ISOLATED_STAGING_MYSQL_HOST = "mysql-stock-homologation.railway.internal";
const APP_ENVIRONMENTS = new Set(["production", "staging", "local-test"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const DISPOSABLE_DATABASE = /^l4ckos_(?:stock_)?test(?:_[a-z0-9_]+)?$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

function fail(code) {
  throw new Error(code);
}

function parseUrl(databaseUrl) {
  if (typeof databaseUrl !== "string" || !databaseUrl.trim()) fail("DATABASE_URL_REQUIRED");
  try {
    return new URL(databaseUrl);
  } catch {
    return fail("DATABASE_URL_INVALID");
  }
}

function hasIsolatedStagingMarker(env) {
  return env.RAILWAY_PROJECT_ID === ISOLATED_STAGING_RAILWAY_PROJECT_ID ||
    env.RAILWAY_ENVIRONMENT_ID === ISOLATED_STAGING_RAILWAY_ENVIRONMENT_ID ||
    env.RAILWAY_SERVICE_ID === ISOLATED_STAGING_RAILWAY_SERVICE_ID;
}

function matchesIsolatedStagingIdentity(env) {
  return env.RAILWAY_PROJECT_ID === ISOLATED_STAGING_RAILWAY_PROJECT_ID &&
    env.RAILWAY_ENVIRONMENT_ID === ISOLATED_STAGING_RAILWAY_ENVIRONMENT_ID &&
    env.RAILWAY_SERVICE_ID === ISOLATED_STAGING_RAILWAY_SERVICE_ID;
}

/**
 * Classifies the runtime from EXPLICIT markers only and refuses ambiguity:
 *  - APP_ENV in {production, staging, local-test};
 *  - NODE_ENV=production with no APP_ENV is production (the pre-existing deployment shape);
 *  - the staging Railway project/environment ids force "staging".
 * Any conflict between markers, an unknown APP_ENV, or no marker at all throws.
 */
export function resolveDatabaseEnvironment(env = process.env) {
  const appEnv = env.APP_ENV;
  if (appEnv !== undefined && appEnv !== "" && !APP_ENVIRONMENTS.has(appEnv)) fail("DB_ENVIRONMENT_UNKNOWN");
  const isolatedStagingMarker = hasIsolatedStagingMarker(env);
  const isolatedStagingIdentity = matchesIsolatedStagingIdentity(env);
  if (isolatedStagingMarker && !isolatedStagingIdentity) fail("DB_ISOLATED_STAGING_IDENTITY_INVALID");
  const stagingIdentity =
    env.RAILWAY_PROJECT_ID === STAGING_RAILWAY_PROJECT_ID ||
    env.RAILWAY_ENVIRONMENT_ID === STAGING_RAILWAY_ENVIRONMENT_ID ||
    isolatedStagingIdentity;
  if (appEnv === "local-test") {
    // The local exception can never coexist with a deployed identity or a production runtime.
    if (env.NODE_ENV === "production" || stagingIdentity || env.RAILWAY_PROJECT_ID || env.RAILWAY_ENVIRONMENT_ID || env.RAILWAY_SERVICE_ID) {
      fail("DB_LOCAL_EXCEPTION_FORBIDDEN");
    }
    return "local-test";
  }
  if (appEnv === "staging") return "staging";
  if (appEnv === "production") {
    if (stagingIdentity) fail("DB_ENVIRONMENT_CONFLICT");
    return "production";
  }
  if (stagingIdentity) return "staging";
  if (env.NODE_ENV === "production") return "production";
  return fail("DB_ENVIRONMENT_UNSPECIFIED");
}

function normalizePem(raw) {
  if (typeof raw !== "string") return "";
  return raw.replace(/\\n/g, "\n").trim() + "\n";
}

function stagingOptions(url, databaseUrl, env) {
  const host = (env.STAGING_DB_TLS_HOST ?? "").trim().toLowerCase();
  const expectedHash = (env.STAGING_DB_TLS_CA_SHA256 ?? "").trim().toLowerCase();
  const rawCa = env.STAGING_DB_TLS_CA_PEM ?? "";
  if (!host || !expectedHash || !rawCa.trim()) fail("STAGING_DB_TLS_CONFIG_REQUIRED");
  if (!SHA256_HEX.test(expectedHash)) fail("STAGING_DB_TLS_CA_SHA256_INVALID");
  // Staging must never reuse the production database identity or production trust anchor.
  if (host === MYSQL_TLS_HOST || url.hostname.toLowerCase() === MYSQL_TLS_HOST) fail("STAGING_DB_MUST_NOT_USE_PRODUCTION_HOST");
  if (expectedHash === MYSQL_TLS_CA_SHA256) fail("STAGING_DB_MUST_NOT_USE_PRODUCTION_CA");
  if (url.hostname.toLowerCase() !== host) fail("STAGING_DB_TLS_HOST_MISMATCH");
  if (matchesIsolatedStagingIdentity(env) && host !== ISOLATED_STAGING_MYSQL_HOST) {
    fail("STAGING_DB_ISOLATED_HOST_INVALID");
  }
  const ca = normalizePem(rawCa);
  if (!ca.includes("BEGIN CERTIFICATE")) fail("STAGING_DB_TLS_CA_INVALID");
  if (createHash("sha256").update(ca, "utf8").digest("hex") !== expectedHash) fail("STAGING_DB_TLS_CA_SHA256_MISMATCH");
  return { uri: databaseUrl, ssl: { ca, rejectUnauthorized: true, verifyIdentity: true } };
}

function localOptions(url, databaseUrl, env) {
  if (env.L4CKOS_LOCAL_DB_EXCEPTION !== "disposable-loopback") fail("DB_LOCAL_EXCEPTION_NOT_CONFIGURED");
  if (env.NODE_ENV !== "test" && env.NODE_ENV !== "development") fail("DB_LOCAL_EXCEPTION_FORBIDDEN");
  if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) fail("DB_LOCAL_EXCEPTION_REQUIRES_LOOPBACK");
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!DISPOSABLE_DATABASE.test(database)) fail("DB_LOCAL_EXCEPTION_REQUIRES_DISPOSABLE_DATABASE");
  // Loopback + disposable database only; this is the single place TLS is not used, and it is unreachable remotely.
  return { uri: databaseUrl };
}

/**
 * Connection options for the current runtime, or a thrown error code (fail-closed).
 * No generic bypass exists: variables such as NODE_TLS_REJECT_UNAUTHORIZED or any "disable TLS" flag are ignored.
 */
export function resolveMysqlConnection(databaseUrl, env = process.env) {
  const environment = resolveDatabaseEnvironment(env);
  const url = parseUrl(databaseUrl);
  if (environment === "production") {
    if (url.hostname.toLowerCase() !== MYSQL_TLS_HOST) fail("MYSQL_TLS_HOST_MISMATCH");
    return { environment, options: createMysqlConnectionOptions(databaseUrl) };
  }
  if (environment === "staging") return { environment, options: stagingOptions(url, databaseUrl, env) };
  return { environment, options: localOptions(url, databaseUrl, env) };
}

export function createMysqlConnectionOptionsForEnvironment(databaseUrl, env = process.env) {
  return resolveMysqlConnection(databaseUrl, env).options;
}
