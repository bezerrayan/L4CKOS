import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createMysqlConnectionOptionsForEnvironment,
  resolveDatabaseEnvironment,
  resolveMysqlConnection,
} from "./mysqlConnection.mjs";
import { MYSQL_TLS_CA_SHA256, MYSQL_TLS_HOST } from "./mysqlTls.mjs";

const STAGING_PROJECT = "2bb90c8e-eb65-43ee-826b-f93750f0499c";
const ISOLATED_STAGING_PROJECT = "66faf690-a068-40d1-b85c-cb5d8595560a";
const ISOLATED_STAGING_ENVIRONMENT = "5335340d-311c-47e9-9713-6e5a86969c88";
const ISOLATED_STAGING_SERVICE = "d66762a4-422a-4656-94a1-502215a27aa2";
const STAGING_HOST = "mysql-staging.railway.internal";
const ISOLATED_STAGING_HOST = "mysql-stock-homologation.railway.internal";
const STAGING_CA = "-----BEGIN CERTIFICATE-----\nU1lOVEhFVElDLVNUQUdJTkctQ0EtRk9SLVRFU1RT\n-----END CERTIFICATE-----\n";
const STAGING_CA_SHA = createHash("sha256").update(STAGING_CA, "utf8").digest("hex");

const productionUrl = `mysql://app:secret@${MYSQL_TLS_HOST}:3306/railway`;
const stagingUrl = `mysql://app:secret@${STAGING_HOST}:3306/railway`;
const isolatedStagingUrl = `mysql://app:secret@${ISOLATED_STAGING_HOST}:3306/railway`;
const localUrl = "mysql://root@127.0.0.1:3306/l4ckos_stock_test";

const production = { NODE_ENV: "production", APP_ENV: "production" };
const staging = {
  NODE_ENV: "production",
  APP_ENV: "staging",
  RAILWAY_PROJECT_ID: STAGING_PROJECT,
  STAGING_DB_TLS_HOST: STAGING_HOST,
  STAGING_DB_TLS_CA_PEM: STAGING_CA,
  STAGING_DB_TLS_CA_SHA256: STAGING_CA_SHA,
};
const isolatedStaging = {
  ...staging,
  APP_ENV: "staging",
  RAILWAY_PROJECT_ID: ISOLATED_STAGING_PROJECT,
  RAILWAY_ENVIRONMENT_ID: ISOLATED_STAGING_ENVIRONMENT,
  RAILWAY_SERVICE_ID: ISOLATED_STAGING_SERVICE,
  STAGING_DB_TLS_HOST: ISOLATED_STAGING_HOST,
};
const local = { NODE_ENV: "test", APP_ENV: "local-test", L4CKOS_LOCAL_DB_EXCEPTION: "disposable-loopback" };

const reject = (url: string, env: Record<string, string | undefined>, code: string) =>
  expect(() => resolveMysqlConnection(url, env)).toThrow(code);

describe("MySQL connection policy per environment", () => {
  describe("production (unchanged controls)", () => {
    it("keeps the approved CA pin and strict identity verification for mysql-w5fk.railway.internal", () => {
      const { environment, options } = resolveMysqlConnection(productionUrl, production);
      expect(environment).toBe("production");
      expect(options).toMatchObject({ ssl: { rejectUnauthorized: true, verifyIdentity: true } });
      expect(createHash("sha256").update(String((options.ssl as { ca: string }).ca), "utf8").digest("hex")).toBe(MYSQL_TLS_CA_SHA256);
    });
    it("treats NODE_ENV=production without APP_ENV as production (existing deployment shape)", () => {
      expect(resolveDatabaseEnvironment({ NODE_ENV: "production" })).toBe("production");
      expect(resolveMysqlConnection(productionUrl, { NODE_ENV: "production" }).environment).toBe("production");
    });
    it("rejects an incorrect hostname", () => {
      reject(`mysql://app:secret@evil.example.com:3306/railway`, production, "MYSQL_TLS_HOST_MISMATCH");
      reject(`mysql://app:secret@${STAGING_HOST}:3306/railway`, production, "MYSQL_TLS_HOST_MISMATCH");
      reject(`mysql://app:secret@mysql-w5fk.railway.internal.evil.example:3306/railway`, production, "MYSQL_TLS_HOST_MISMATCH");
    });
    it("rejects a local loopback URL: production never accepts the local exception", () => {
      reject(localUrl, production, "MYSQL_TLS_HOST_MISMATCH");
      reject(localUrl, { ...production, L4CKOS_LOCAL_DB_EXCEPTION: "disposable-loopback" }, "MYSQL_TLS_HOST_MISMATCH");
    });
  });

  describe("staging (independent database, own host and CA)", () => {
    it("accepts only its own configured host and a CA whose hash matches the configured pin", () => {
      const { environment, options } = resolveMysqlConnection(stagingUrl, staging);
      expect(environment).toBe("staging");
      expect(options).toMatchObject({ uri: stagingUrl, ssl: { ca: STAGING_CA, rejectUnauthorized: true, verifyIdentity: true } });
    });
    it("is detected from the staging Railway identity even without APP_ENV", () => {
      const { APP_ENV: _omit, ...withoutAppEnv } = staging;
      expect(resolveMysqlConnection(stagingUrl, withoutAppEnv).environment).toBe("staging");
    });
    it("treats the isolated homologation service identity as staging and never production", () => {
      expect(resolveDatabaseEnvironment({
        NODE_ENV: "production",
        RAILWAY_PROJECT_ID: ISOLATED_STAGING_PROJECT,
        RAILWAY_ENVIRONMENT_ID: ISOLATED_STAGING_ENVIRONMENT,
        RAILWAY_SERVICE_ID: ISOLATED_STAGING_SERVICE,
      })).toBe("staging");
      reject(productionUrl, {
        NODE_ENV: "production",
        APP_ENV: "production",
        RAILWAY_PROJECT_ID: ISOLATED_STAGING_PROJECT,
        RAILWAY_ENVIRONMENT_ID: ISOLATED_STAGING_ENVIRONMENT,
        RAILWAY_SERVICE_ID: ISOLATED_STAGING_SERVICE,
      }, "DB_ENVIRONMENT_CONFLICT");
    });
    it("accepts isolated TLS only for the exact private database hostname", () => {
      const { options } = resolveMysqlConnection(isolatedStagingUrl, isolatedStaging);
      expect(options).toMatchObject({ uri: isolatedStagingUrl, ssl: { ca: STAGING_CA, rejectUnauthorized: true, verifyIdentity: true } });
      reject(`mysql://app:secret@mysql-staging.railway.internal:3306/railway`, isolatedStaging, "STAGING_DB_TLS_HOST_MISMATCH");
      reject(`mysql://app:secret@mysql-stock-homologation.railway.internal.evil.example:3306/railway`, {
        ...isolatedStaging,
        STAGING_DB_TLS_HOST: "mysql-stock-homologation.railway.internal.evil.example",
      }, "STAGING_DB_ISOLATED_HOST_INVALID");
      reject(isolatedStagingUrl, { ...isolatedStaging, STAGING_DB_TLS_HOST: "mysql-staging.railway.internal" }, "STAGING_DB_TLS_HOST_MISMATCH");
    });
    it("rejects incomplete or swapped isolated Railway identities", () => {
      for (const env of [
        { NODE_ENV: "production", APP_ENV: "staging", RAILWAY_PROJECT_ID: ISOLATED_STAGING_PROJECT },
        { ...isolatedStaging, RAILWAY_ENVIRONMENT_ID: "wrong-environment" },
        { ...isolatedStaging, RAILWAY_SERVICE_ID: "wrong-service" },
      ]) {
        reject(isolatedStagingUrl, { ...env, STAGING_DB_TLS_HOST: ISOLATED_STAGING_HOST, STAGING_DB_TLS_CA_PEM: STAGING_CA, STAGING_DB_TLS_CA_SHA256: STAGING_CA_SHA }, "DB_ISOLATED_STAGING_IDENTITY_INVALID");
      }
    });
    it("fails closed on missing, malformed or mismatched isolated CA configuration", () => {
      for (const key of ["STAGING_DB_TLS_HOST", "STAGING_DB_TLS_CA_PEM", "STAGING_DB_TLS_CA_SHA256"] as const) {
        reject(isolatedStagingUrl, { ...isolatedStaging, [key]: undefined }, "STAGING_DB_TLS_CONFIG_REQUIRED");
        reject(isolatedStagingUrl, { ...isolatedStaging, [key]: "" }, "STAGING_DB_TLS_CONFIG_REQUIRED");
      }
      reject(isolatedStagingUrl, { ...isolatedStaging, STAGING_DB_TLS_CA_PEM: STAGING_CA.replace("U1lO", "AAAA") }, "STAGING_DB_TLS_CA_SHA256_MISMATCH");
      reject(isolatedStagingUrl, { ...isolatedStaging, STAGING_DB_TLS_CA_SHA256: "not-a-hash" }, "STAGING_DB_TLS_CA_SHA256_INVALID");
      reject(isolatedStagingUrl, { ...isolatedStaging, STAGING_DB_TLS_CA_SHA256: MYSQL_TLS_CA_SHA256 }, "STAGING_DB_MUST_NOT_USE_PRODUCTION_CA");
    });
    it("fails closed when host, CA or CA pin is missing", () => {
      for (const key of ["STAGING_DB_TLS_HOST", "STAGING_DB_TLS_CA_PEM", "STAGING_DB_TLS_CA_SHA256"] as const) {
        reject(stagingUrl, { ...staging, [key]: undefined }, "STAGING_DB_TLS_CONFIG_REQUIRED");
        reject(stagingUrl, { ...staging, [key]: "" }, "STAGING_DB_TLS_CONFIG_REQUIRED");
      }
    });
    it("rejects an incorrect hostname", () => {
      reject(`mysql://app:secret@other.railway.internal:3306/railway`, staging, "STAGING_DB_TLS_HOST_MISMATCH");
    });
    it("rejects an incorrect CA (content does not match the configured pin) and a malformed pin", () => {
      reject(stagingUrl, { ...staging, STAGING_DB_TLS_CA_PEM: STAGING_CA.replace("U1lO", "AAAA") }, "STAGING_DB_TLS_CA_SHA256_MISMATCH");
      reject(stagingUrl, { ...staging, STAGING_DB_TLS_CA_SHA256: "not-a-hash" }, "STAGING_DB_TLS_CA_SHA256_INVALID");
      reject(stagingUrl, { ...staging, STAGING_DB_TLS_CA_PEM: "not a certificate" }, "STAGING_DB_TLS_CA_INVALID");
    });
    it("never accepts the production host or the production CA pin as automatic staging configuration", () => {
      reject(productionUrl, staging, "STAGING_DB_MUST_NOT_USE_PRODUCTION_HOST");
      reject(productionUrl, { ...staging, STAGING_DB_TLS_HOST: MYSQL_TLS_HOST }, "STAGING_DB_MUST_NOT_USE_PRODUCTION_HOST");
      reject(stagingUrl, { ...staging, STAGING_DB_TLS_CA_SHA256: MYSQL_TLS_CA_SHA256 }, "STAGING_DB_MUST_NOT_USE_PRODUCTION_CA");
    });
    it("does not fall back to production defaults when nothing is configured", () => {
      reject(productionUrl, { NODE_ENV: "production", APP_ENV: "staging" }, "STAGING_DB_TLS_CONFIG_REQUIRED");
    });
  });

  describe("local disposable exception", () => {
    it("allows only a loopback, disposable database under the explicit test configuration", () => {
      const { environment, options } = resolveMysqlConnection(localUrl, local);
      expect(environment).toBe("local-test");
      expect(options).toEqual({ uri: localUrl });
      expect(resolveMysqlConnection("mysql://root@localhost/l4ckos_test_inbox_ab12", local).environment).toBe("local-test");
    });
    it("requires the explicit exception flag", () => {
      reject(localUrl, { NODE_ENV: "test", APP_ENV: "local-test" }, "DB_LOCAL_EXCEPTION_NOT_CONFIGURED");
      reject(localUrl, { ...local, L4CKOS_LOCAL_DB_EXCEPTION: "1" }, "DB_LOCAL_EXCEPTION_NOT_CONFIGURED");
      reject(localUrl, { ...local, L4CKOS_LOCAL_DB_EXCEPTION: "true" }, "DB_LOCAL_EXCEPTION_NOT_CONFIGURED");
    });
    it("rejects non-loopback hosts and non-disposable databases", () => {
      reject(productionUrl, local, "DB_LOCAL_EXCEPTION_REQUIRES_LOOPBACK");
      reject(stagingUrl, local, "DB_LOCAL_EXCEPTION_REQUIRES_LOOPBACK");
      reject("mysql://root@10.0.0.5/l4ckos_stock_test", local, "DB_LOCAL_EXCEPTION_REQUIRES_LOOPBACK");
      reject("mysql://root@127.0.0.1/railway", local, "DB_LOCAL_EXCEPTION_REQUIRES_DISPOSABLE_DATABASE");
      reject("mysql://root@127.0.0.1/l4ckos_production", local, "DB_LOCAL_EXCEPTION_REQUIRES_DISPOSABLE_DATABASE");
    });
    it("is rejected in production, in staging and on any deployed Railway identity", () => {
      reject(localUrl, { ...local, NODE_ENV: "production" }, "DB_LOCAL_EXCEPTION_FORBIDDEN");
      reject(localUrl, { ...local, RAILWAY_PROJECT_ID: STAGING_PROJECT }, "DB_LOCAL_EXCEPTION_FORBIDDEN");
      reject(localUrl, { ...local, RAILWAY_SERVICE_ID: "any" }, "DB_LOCAL_EXCEPTION_FORBIDDEN");
      reject(localUrl, { ...staging, L4CKOS_LOCAL_DB_EXCEPTION: "disposable-loopback" }, "STAGING_DB_TLS_HOST_MISMATCH");
      reject(localUrl, { ...production, L4CKOS_LOCAL_DB_EXCEPTION: "disposable-loopback" }, "MYSQL_TLS_HOST_MISMATCH");
      reject(localUrl, { ...local, NODE_ENV: "staging" }, "DB_LOCAL_EXCEPTION_FORBIDDEN");
    });
  });

  describe("environment identity", () => {
    it("rejects swapped or conflicting environments", () => {
      // APP_ENV=production but the staging Railway project id is present.
      reject(productionUrl, { ...production, RAILWAY_PROJECT_ID: STAGING_PROJECT }, "DB_ENVIRONMENT_CONFLICT");
      // Staging config pointing at the production database, and production config pointing at staging.
      reject(productionUrl, staging, "STAGING_DB_MUST_NOT_USE_PRODUCTION_HOST");
      reject(stagingUrl, production, "MYSQL_TLS_HOST_MISMATCH");
    });
    it("fails closed on an unknown or missing environment", () => {
      expect(() => resolveDatabaseEnvironment({ NODE_ENV: "production", APP_ENV: "prod" })).toThrow("DB_ENVIRONMENT_UNKNOWN");
      expect(() => resolveDatabaseEnvironment({ NODE_ENV: "development" })).toThrow("DB_ENVIRONMENT_UNSPECIFIED");
      expect(() => resolveDatabaseEnvironment({})).toThrow("DB_ENVIRONMENT_UNSPECIFIED");
    });
    it("has no generic bypass: TLS-disabling variables are ignored in every environment", () => {
      const bypass = { NODE_TLS_REJECT_UNAUTHORIZED: "0", MYSQL_TLS_DISABLED: "1", DISABLE_TLS: "true", ALLOW_INSECURE_DB: "1", DB_TLS_BYPASS: "1", L4CKOS_LOCAL_DB_EXCEPTION: "disposable-loopback" };
      reject(localUrl, { ...production, ...bypass }, "MYSQL_TLS_HOST_MISMATCH");
      reject(localUrl, { ...staging, ...bypass }, "STAGING_DB_TLS_HOST_MISMATCH");
      reject(localUrl, { NODE_ENV: "test", ...bypass }, "DB_ENVIRONMENT_UNSPECIFIED");
      expect(() => createMysqlConnectionOptionsForEnvironment("", production)).toThrow("DATABASE_URL_REQUIRED");
      expect(() => createMysqlConnectionOptionsForEnvironment("not a url", production)).toThrow("DATABASE_URL_INVALID");
    });
  });
});
