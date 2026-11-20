import { createHash } from "node:crypto";

export const MYSQL_TLS_HOST = "mysql-w5fk.railway.internal";
/** Route-B dedicated MySQL (mysql-l4ckos-c7). Bound to ITS OWN CA ("L4CKOS Dedicated MySQL CA 2026-B"); the CA above is NOT trusted for this host and vice versa. */
export const MYSQL_TLS_C7_HOST = "mysql-l4ckos-c7.railway.internal";
export const MYSQL_TLS_C7_CA_SHA256 = "4365d180154640779b83dbd8ae014bbf187b513e0b87839c2fba220e47986a49";
/**
 * Exact production MySQL hosts whose certificate chains to the pinned CA below. A new Route-B host is added HERE only after its
 * hostname and certificate chain were verified against that CA (or the CA pin is replaced in the same reviewed change).
 */
export const MYSQL_TLS_APPROVED_HOSTS = Object.freeze([MYSQL_TLS_HOST]);  // kept for API compatibility; the registry below is authoritative
export function isApprovedMysqlTlsHost(hostname) {
  return typeof hostname === "string" && REGISTRY.find(hostname) !== undefined;
}
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

// Public trust anchor only (CA certificate, no key material). Byte-identical to the owner-generated ca.pem (sha256 pinned above).
const MYSQL_TLS_C7_CA_PEM = `-----BEGIN CERTIFICATE-----
MIIESjCCArKgAwIBAgIUClEDcNfiq0DGQDadnNFdUmpYkGswDQYJKoZIhvcNAQEL
BQAwKzEpMCcGA1UEAwwgTDRDS09TIERlZGljYXRlZCBNeVNRTCBDQSAyMDI2LUIw
HhcNMjYxMTE5MDQyMzEyWhcNMzYxMTE2MDQyMzEyWjArMSkwJwYDVQQDDCBMNENL
T1MgRGVkaWNhdGVkIE15U1FMIENBIDIwMjYtQjCCAaIwDQYJKoZIhvcNAQEBBQAD
ggGPADCCAYoCggGBAKoWPc9cKG57FkHyLzKrxOftx21cQjVjui5UvK5823jG6xQz
wZ956eioR1zMew7Rxvtocn8izDUPkGRxhVgwVA67IPghd9ivWGMA0AcIIGjY6/pW
6WsmJe+wEJVDY9iNRl7cazjNZH2m42eH3MVs2qcjgYVNsje5Lpz4jfaQ3OBnpMTt
Yd/NJhrMQBNVNcbSHg5GsN4muiks/w1pFUVVXukoTpW1Qfq5TuvJm78ugKzCx9X7
uTtGpcQGlhu8jkha1hEVuOpOJaDJqk+FEeA5Ob3VSY3RFcSfZrtMgQeQ7bZ9cuyd
6x/0rH385xvap7V01ApvY+s0k4zTkOfy7bNjDF2xGTEASrBVbTfMAnQDxK+OlzGi
UNysv7rzILDK2k2wvjQLHJ5sS/VuXG2IcY4crh278IuWSoiCNd/HirdPEb58BLSa
D8eN0+8QWM+SIKPK80y9lSnP3zKil83QHLy+50Of7OQ7Wz7XaHWE8AVH7vh8W16q
h9fJLEEafW48lXrznQIDAQABo2YwZDAdBgNVHQ4EFgQUqaniRrC0w6snZBfoCcbT
f+TDmVcwHwYDVR0jBBgwFoAUqaniRrC0w6snZBfoCcbTf+TDmVcwEgYDVR0TAQH/
BAgwBgEB/wIBADAOBgNVHQ8BAf8EBAMCAQYwDQYJKoZIhvcNAQELBQADggGBAAXt
tzkX29uZBtbhG58BBn3TKeu5ueNGKa4K4hdRYgrE7LouFM3kZxE9Byb4dJS7u7Fz
ZjuHmZFK/0aFxaowOD/H78Y+Cpht5W/ESAMdnUjNsbavrFXYlusPKkKj/zOrwm7k
gtV3XlT4JuC41bKMhqAvKMf1Yti1GT7NNI1BHXws++2l9XlSTNucnJX0KhAz6hgy
j5d1cw3fHHxAr0R/95vM8joLIxgHU0k+0dV62NMwmk2fLq5dkjAVqjjAnNHuL4su
EJQHSWL2amtqQ9/8+nktFMcHJUHHkw3SyBm5fHGBnPI0YDV+EwnvFkmK+RZcIOoq
mQtmSfYu8hU2ySm3A+gNrdtyEBsg6ql31nGYh8CmY7d8DGqtt5wFwU1BeO2Zk1nh
DnSOQZgPgXao9FKtmy2+XPNYRSoHzIGVsGUFX/a0COOBsNyeLcbRJ2pRCaKIIL1l
Cxbtjni3SDJUNEu/l31PlS+UquTXyI54SukJv+NHvamwGfxjXJeT4kqGFkx3Xw==
-----END CERTIFICATE-----
`;

/**
 * host -> CA registry. Each approved private hostname is bound to ITS OWN CA (PEM + sha256 pin). A new Route-B host is added here, in a reviewed
 * change, together with its CA; nothing is inferred and no CA is trusted for a host it was not pinned to.
 */
export function createMysqlTlsRegistry(targets) {
  const seen = new Set();
  for (const t of targets) {
    if (!/^[a-z0-9-]+\.railway\.internal$/.test(t.host) || seen.has(t.host)) throw new Error("MYSQL_TLS_REGISTRY_INVALID");
    if (createHash("sha256").update(t.caPem, "utf8").digest("hex") !== t.caSha256) throw new Error("MYSQL_TLS_CA_SHA256_MISMATCH");
    seen.add(t.host);
  }
  const frozen = Object.freeze(targets.map(t => Object.freeze({ ...t })));
  return Object.freeze({
    hosts: Object.freeze(frozen.map(t => t.host)),
    find(hostname) { return typeof hostname === "string" ? frozen.find(t => t.host === hostname.trim().toLowerCase()) : undefined; },
  });
}

export function validateMysqlTlsCa(caPem, expectedSha256 = MYSQL_TLS_CA_SHA256) {
  if (typeof caPem !== "string" || !caPem.trim()) {
    throw new Error("MYSQL_TLS_CA_MISSING");
  }
  const actual = createHash("sha256").update(caPem, "utf8").digest("hex");
  if (actual !== expectedSha256) {
    throw new Error("MYSQL_TLS_CA_SHA256_MISMATCH");
  }
  return caPem;
}

const REGISTRY = createMysqlTlsRegistry([
  { host: MYSQL_TLS_HOST, caPem: MYSQL_TLS_CA_PEM, caSha256: MYSQL_TLS_CA_SHA256 },
  { host: MYSQL_TLS_C7_HOST, caPem: MYSQL_TLS_C7_CA_PEM, caSha256: MYSQL_TLS_C7_CA_SHA256 },
]);
export function assertApprovedMysqlTlsCa() {
  for (const host of REGISTRY.hosts) { const t = REGISTRY.find(host); validateMysqlTlsCa(t.caPem, t.caSha256); }
  return validateMysqlTlsCa(MYSQL_TLS_CA_PEM);
}
export function mysqlTlsCaForHost(hostname) {
  const t = REGISTRY.find(hostname);
  if (!t) throw new Error("MYSQL_TLS_HOST_MISMATCH");
  return validateMysqlTlsCa(t.caPem, t.caSha256);
}

export function createMysqlConnectionOptions(databaseUrl) {
  if (typeof databaseUrl !== "string" || !databaseUrl.trim()) {
    throw new Error("DATABASE_URL_REQUIRED");
  }

  let hostname;
  try {
    hostname = new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    throw new Error("DATABASE_URL_INVALID");
  }
  if (!isApprovedMysqlTlsHost(hostname)) {
    throw new Error("MYSQL_TLS_HOST_MISMATCH");
  }

  const ca = mysqlTlsCaForHost(hostname);
  return {
    uri: databaseUrl,
    ssl: {
      ca,
      rejectUnauthorized: true,
      verifyIdentity: true,
    },
  };
}
