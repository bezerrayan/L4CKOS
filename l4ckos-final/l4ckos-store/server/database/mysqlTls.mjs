import { createHash } from "node:crypto";

export const MYSQL_TLS_HOST = "mysql-w5fk.railway.internal";
export const MYSQL_TLS_CA_SHA256 =
  "bc5d33922ec3d772622d9dcf19fdc95a17c7a1f0106b344e78c1169687c24c54";

// Public trust anchor only. No private key material is included.
const MYSQL_TLS_CA_PEM = `-----BEGIN CERTIFICATE-----
MIIERjCCAq6gAwIBAgIUKe/u98zRi3TuHmeJntP4J1z7b5gwDQYJKoZIhvcNAQEL
BQAwKTEnMCUGA1UEAwweTDRDS09TIERlZGljYXRlZCBNeVNRTCBDQSAyMDI2MB4X
DTI2MTEwNDIwMjIzOFoXDTM2MTEwMTIwMjIzOFowKTEnMCUGA1UEAwweTDRDS09T
IERlZGljYXRlZCBNeVNRTCBDQSAyMDI2MIIBojANBgkqhkiG9w0BAQEFAAOCAY8A
MIIBigKCAYEAqyNbf2ciiwM3kjSWifghhpd1UKRK9fFkvX8hzqhiNwF99I8P15hv
unbtLEAnleJYNV4tWo5HdrfoKUskeiDG3C66I5lqXtcduOL0pmod8LZqer+dulfK
+/mRFJTXA1Ng9/jdZyWgR+hyVS8v5ubnRyXis9GMsit0IH4QtBE+Bkir7gltyHvT
LgVxguN3EB+3GskgCcjkcLbGsdPuIyCxrnTbXir2dhY7TwCeEDZetlzYbkYldXCL
VGHOCwz39d79eKKAtIDqy69vTuIhh5Nl+47MEp4sIQTnCcsR6QWiD2tw+n0H2/6J
pJnM6y5tOf5l0JgtKDwmcZsz/LBcr/AeQzHHlwixu7WhMEtHMhdqh+JsvDvwr0ex
SxKw7Pp/auI5Gvj7OLcbvBO12Re3yroG8qWE40bPHC8MDf6nQgRZHFeczo5oed6Z
7lYwRKXq+qwDDnvkBeCYODpnj7Syx9KkczM0eN8RVjMryIBTJrKQsleOlRb+XJYy
E8JdjsdhCh8DAgMBAAGjZjBkMB8GA1UdIwQYMBaAFAV8IdmtQaO8CQpO1tL286ZL
KoVbMBIGA1UdEwEB/wQIMAYBAf8CAQAwDgYDVR0PAQH/BAQDAgEGMB0GA1UdDgQW
BBQFfCHZrUGjvAkKTtbS9vOmSyqFWzANBgkqhkiG9w0BAQsFAAOCAYEAZ/pDebrv
+zi/EwtywCSTnx4BaNaUqX01BJENsahpekDggqCPicFwC+AjGnxla5C9CRuHHFyv
KBmYwgEy4QUMmDFVzGhQeGAL1Hd+JbmoVPrqBeIx6eNDJKHLHEqZZCzz6In622tv
dDYid6CR+dAyfNjRMzZNlnmF/DHeCWIG5O1wY6URVN1kVBU8eP9ez50D68j5DQOB
yDP9O1fdZ/NKorh0E+orkEVmNO9txE9eDELMYPKmXnktu+ZKcJtMhR6a9k/1V43M
C8C3q8377vPP9PiLPZU2ndqpViHuKHqTE9Wv8WyvJt0StwlUwqwRRicoxkFfQdz2
sCJddCbFv3FRXdBbl1SQyrcvZaodV1NWJ5xhRQ5ScVUqHoRffHXXw4IGGmCa4hgY
CRTyOorjnTVv0NlsFRUW3m2SL1MJzWEoBUSUrm+DWAD7kfpDSjFleY1D0u4So0wr
7+xanTgmfUio8JnXxAQZ9G9OrMC/Bjvs2GOnPnoXhN63GWk+tshPxJNq
-----END CERTIFICATE-----
`;

const PRODUCTION_PROJECT_ID = "5937dcf3-18ae-4df8-83f0-5bb60ec9b8db";
const PRODUCTION_API_SERVICE_ID = "743f3f4e-af1b-44f7-95c8-bb152e3c2f4b";
const STAGING_PROJECT_ID = "2bb90c8e-eb65-43ee-826b-f93750f0499c";
const STAGING_ENVIRONMENT_ID = "15545eee-bc02-4b70-afc4-19a5db9e6f46";
const STAGING_API_SERVICE_ID = "9f1c7705-f2f9-48cf-b957-8f63a6bba4db";
export const MYSQL_STAGING_TLS_HOST = "mysql.railway.internal";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const RAILWAY_ID_KEYS = [
  "RAILWAY_PROJECT_ID",
  "RAILWAY_ENVIRONMENT_ID",
  "RAILWAY_SERVICE_ID",
  "RAILWAY_DEPLOYMENT_ID",
];
const LOCAL_SOCKET = /^\/tmp\/l4ckos-[a-z0-9-]+\/mysqld\.sock$/;
const TLS_MIN_VERSION = "TLSv1.2";

function parseMysqlUrl(databaseUrl) {
  if (typeof databaseUrl !== "string" || !databaseUrl.trim()) {
    throw new Error("DATABASE_URL_REQUIRED");
  }
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL_INVALID");
  }
  if (parsed.protocol !== "mysql:" || !parsed.hostname) {
    throw new Error("DATABASE_URL_INVALID");
  }
  return { parsed, hostname: parsed.hostname.toLowerCase() };
}

function readRailwayIdentity(environment) {
  const present = RAILWAY_ID_KEYS.filter((key) => String(environment[key] ?? "").trim() !== "");
  if (present.length === 0) return null;
  if (present.length !== RAILWAY_ID_KEYS.length) {
    throw new Error("MYSQL_RAILWAY_IDENTITY_INCOMPLETE");
  }
  const identity = Object.fromEntries(RAILWAY_ID_KEYS.map((key) => [key, String(environment[key]).trim()]));
  for (const key of RAILWAY_ID_KEYS) {
    if (!UUID.test(identity[key])) throw new Error("MYSQL_RAILWAY_IDENTITY_INVALID");
  }
  return identity;
}

export function validateMysqlTlsCa(caPem, expectedSha256 = MYSQL_TLS_CA_SHA256) {
  if (typeof caPem !== "string" || !caPem.trim()) {
    throw new Error("MYSQL_TLS_CA_MISSING");
  }
  if (typeof expectedSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(expectedSha256)) {
    throw new Error("MYSQL_TLS_CA_SHA256_REQUIRED");
  }
  const actual = createHash("sha256").update(caPem, "utf8").digest("hex");
  if (actual !== expectedSha256.toLowerCase()) {
    throw new Error("MYSQL_TLS_CA_SHA256_MISMATCH");
  }
  return caPem;
}

export function assertApprovedMysqlTlsCa() {
  return validateMysqlTlsCa(MYSQL_TLS_CA_PEM);
}

function profileForRailway(environment, identity, hostname) {
  if (identity.RAILWAY_PROJECT_ID === STAGING_PROJECT_ID) {
    if (
      identity.RAILWAY_ENVIRONMENT_ID !== STAGING_ENVIRONMENT_ID ||
      identity.RAILWAY_SERVICE_ID !== STAGING_API_SERVICE_ID
    ) {
      throw new Error("MYSQL_STAGING_RAILWAY_IDENTITY_MISMATCH");
    }
    if (hostname !== MYSQL_STAGING_TLS_HOST) {
      throw new Error("MYSQL_STAGING_TLS_HOST_MISMATCH");
    }
    const caPem = environment.L4CKOS_STAGING_MYSQL_TLS_CA_PEM;
    const expectedSha256 = environment.L4CKOS_STAGING_MYSQL_TLS_CA_SHA256;
    if (typeof caPem !== "string" || !caPem.trim()) {
      throw new Error("MYSQL_STAGING_TLS_CA_REQUIRED");
    }
    if (typeof expectedSha256 !== "string" || !expectedSha256.trim()) {
      throw new Error("MYSQL_STAGING_TLS_CA_SHA256_REQUIRED");
    }
    if (expectedSha256.toLowerCase() === MYSQL_TLS_CA_SHA256) {
      throw new Error("MYSQL_STAGING_TLS_CA_NOT_INDEPENDENT");
    }
    validateMysqlTlsCa(caPem, expectedSha256);
    return Object.freeze({ profile: "staging", hostname, caPem, caSha256: expectedSha256.toLowerCase() });
  }

  if (identity.RAILWAY_PROJECT_ID === PRODUCTION_PROJECT_ID) {
    if (identity.RAILWAY_SERVICE_ID !== PRODUCTION_API_SERVICE_ID) {
      throw new Error("MYSQL_PRODUCTION_RAILWAY_IDENTITY_MISMATCH");
    }
    if (hostname !== MYSQL_TLS_HOST) {
      throw new Error("MYSQL_PRODUCTION_TLS_HOST_MISMATCH");
    }
    const caPem = assertApprovedMysqlTlsCa();
    return Object.freeze({ profile: "production", hostname, caPem, caSha256: MYSQL_TLS_CA_SHA256 });
  }

  throw new Error("MYSQL_RAILWAY_PROJECT_UNSUPPORTED");
}

function localTestProfile(environment, hostname) {
  if (environment.NODE_ENV !== "test" || environment.L4CKOS_MYSQL_TLS_PROFILE !== "local-test") {
    throw new Error("MYSQL_RAILWAY_IDENTITY_REQUIRED");
  }
  const expectedHosts = String(environment.L4CKOS_TEST_MYSQL_TLS_HOST ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  if (!expectedHosts.includes(hostname) || hostname === MYSQL_TLS_HOST || hostname === MYSQL_STAGING_TLS_HOST) {
    throw new Error("MYSQL_TEST_TLS_HOST_REQUIRED");
  }
  const caPem = environment.L4CKOS_TEST_MYSQL_TLS_CA_PEM;
  const expectedSha256 = environment.L4CKOS_TEST_MYSQL_TLS_CA_SHA256;
  if (typeof caPem !== "string" || !caPem.trim()) throw new Error("MYSQL_TEST_TLS_CA_REQUIRED");
  if (typeof expectedSha256 !== "string" || !expectedSha256.trim()) throw new Error("MYSQL_TEST_TLS_CA_SHA256_REQUIRED");
  if (expectedSha256.toLowerCase() === MYSQL_TLS_CA_SHA256) throw new Error("MYSQL_TEST_TLS_CA_NOT_INDEPENDENT");
  validateMysqlTlsCa(caPem, expectedSha256);
  return Object.freeze({ profile: "local-test", hostname, caPem, caSha256: expectedSha256.toLowerCase() });
}

export function resolveMysqlTlsProfile(databaseUrl, environment = process.env) {
  const { hostname } = parseMysqlUrl(databaseUrl);
  const identity = readRailwayIdentity(environment);
  if (identity) return profileForRailway(environment, identity, hostname);
  return localTestProfile(environment, hostname);
}

function createLocalSocketOptions(databaseUrl, environment, socketPath) {
  const { hostname } = parseMysqlUrl(databaseUrl);
  const hasRailwayIdentity = RAILWAY_ID_KEYS.some((key) => String(environment[key] ?? "").trim() !== "");
  const explicitlyAuthorized =
    (environment.NODE_ENV === "test" && environment.L4CKOS_LOCAL_MYSQL_SOCKET === socketPath) ||
    (environment.NODE_ENV !== "production" && environment.L4CKOS_LOCAL_RESTORE === "1");
  if (hasRailwayIdentity) throw new Error("MYSQL_LOCAL_SOCKET_FORBIDDEN_IN_RAILWAY");
  if (!explicitlyAuthorized || !LOCAL_SOCKET.test(socketPath)) throw new Error("MYSQL_LOCAL_SOCKET_NOT_AUTHORIZED");
  if (!new Set(["localhost", "127.0.0.1", "::1"]).has(hostname)) throw new Error("MYSQL_LOCAL_SOCKET_HOST_MISMATCH");
  return Object.freeze({ uri: databaseUrl, socketPath });
}

export function createMysqlConnectionOptions(databaseUrl, environment = process.env, options = {}) {
  const socketPath = options?.socketPath ?? "";
  if (socketPath) return createLocalSocketOptions(databaseUrl, environment, socketPath);
  const profile = resolveMysqlTlsProfile(databaseUrl, environment);
  return {
    uri: databaseUrl,
    ssl: {
      ca: profile.caPem,
      rejectUnauthorized: true,
      verifyIdentity: true,
      minVersion: TLS_MIN_VERSION,
    },
  };
}

export async function assertMysqlConnectionReady({
  databaseUrl = process.env.DATABASE_URL,
  environment = process.env,
  socketPath = environment.L4CKOS_LOCAL_MYSQL_SOCKET,
  connect,
} = {}) {
  const options = createMysqlConnectionOptions(databaseUrl, environment, { socketPath });
  let connection;
  try {
    const open = connect ?? (await import("mysql2/promise")).createConnection;
    connection = await open(options);
  } catch {
    throw new Error("MYSQL_STARTUP_CONNECTION_FAILED");
  }
  try {
    await connection.end();
  } catch {
    throw new Error("MYSQL_STARTUP_CONNECTION_CLOSE_FAILED");
  }
}
