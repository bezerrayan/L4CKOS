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

export function assertApprovedMysqlTlsCa() {
  return validateMysqlTlsCa(MYSQL_TLS_CA_PEM);
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
  if (hostname !== MYSQL_TLS_HOST) {
    throw new Error("MYSQL_TLS_HOST_MISMATCH");
  }

  const ca = assertApprovedMysqlTlsCa();
  return {
    uri: databaseUrl,
    ssl: {
      ca,
      rejectUnauthorized: true,
      verifyIdentity: true,
    },
  };
}
