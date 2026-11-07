import { createHash } from "node:crypto";

// Unit tests that mock mysql2 still exercise the same explicit local profile.
// This deliberately invalid CA cannot authenticate a real TLS server.
if (process.env.NODE_ENV === "test" && !process.env.RAILWAY_PROJECT_ID) {
  const ca = "L4CKOS_TEST_ONLY_INVALID_CA_FIXTURE";
  process.env.L4CKOS_MYSQL_TLS_PROFILE = "local-test";
  process.env.L4CKOS_TEST_MYSQL_TLS_HOST = "localhost,127.0.0.1,::1";
  process.env.L4CKOS_TEST_MYSQL_TLS_CA_PEM = ca;
  process.env.L4CKOS_TEST_MYSQL_TLS_CA_SHA256 = createHash("sha256").update(ca, "utf8").digest("hex");
}
