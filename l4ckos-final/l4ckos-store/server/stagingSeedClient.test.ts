import { describe, expect, it } from "vitest";
import { assertStagingSeedTarget, readClientFixtureInput, upsertStagingClientFixture } from "../scripts/stagingSeedCommon.mjs";

const safeEnvironment = () => ({
  APP_ENV: "staging",
  DATABASE_URL: "mysql://user:password@mysql.staging.internal/l4ckos_staging",
  EXPECTED_DATABASE_HOST: "mysql.staging.internal",
  EXPECTED_DATABASE_NAME: "l4ckos_staging",
  PRODUCTION_DATABASE_HOST: "mysql.production.internal",
  PRODUCTION_DATABASE_NAME: "l4ckos_production",
  STAGING_CLIENT_EMAIL: "checkout-client@example.test",
  STAGING_CLIENT_PASSWORD: "a-staging-password",
  APP_URL: "https://staging.example.test",
});

describe("staging client seed guards", () => {
  it("accepts only the guarded staging target and client fixture input", () => {
    const environment = safeEnvironment();
    expect(assertStagingSeedTarget(environment).databaseName).toBe("l4ckos_staging");
    expect(readClientFixtureInput(environment)).toMatchObject({
      email: "checkout-client@example.test",
      appUrl: "https://staging.example.test",
    });
  });

  it("refuses production and non-staging database targets", () => {
    const productionEnvironment = safeEnvironment();
    productionEnvironment.APP_ENV = "production";
    expect(() => assertStagingSeedTarget(productionEnvironment)).toThrow("APP_ENV must be staging");

    const productionDatabase = safeEnvironment();
    productionDatabase.EXPECTED_DATABASE_NAME = "l4ckos_production";
    productionDatabase.DATABASE_URL = "mysql://user:password@mysql.production.internal/l4ckos_production";
    productionDatabase.EXPECTED_DATABASE_HOST = "mysql.production.internal";
    expect(() => assertStagingSeedTarget(productionDatabase)).toThrow("database name must contain staging");
  });

  it("refuses an unsafe client identity without requiring an admin fixture", () => {
    const unsafeEmail = safeEnvironment();
    unsafeEmail.STAGING_CLIENT_EMAIL = "customer@example.com";
    expect(() => readClientFixtureInput(unsafeEmail)).toThrow("reserved example.test domain");

    const missingPassword = safeEnvironment();
    delete missingPassword.STAGING_CLIENT_PASSWORD;
    expect(() => readClientFixtureInput(missingPassword)).toThrow("at least 12 characters");
  });

  it("writes only the client user, local credential, and synthetic address", async () => {
    const calls: Array<{ sql: string; values?: unknown[] }> = [];
    const connection = {
      async execute(sql: string, values?: unknown[]) {
        calls.push({ sql, values });
        if (sql.startsWith("SELECT id FROM users")) return [[{ id: 42 }]];
        return [];
      },
    };

    await upsertStagingClientFixture(connection, {
      email: "checkout-client@example.test",
      password: "a-staging-password",
      appUrl: "https://staging.example.test",
    });

    expect(calls).toHaveLength(5);
    expect(calls[0].sql).toContain("'user'");
    expect(calls[0].sql).not.toContain("'admin'");
    expect(calls.map(call => call.sql).join("\n")).not.toContain("ADMIN_EMAILS");
    expect(calls.map(call => call.sql).join("\n")).not.toContain("OWNER_OPEN_ID");
    expect(calls.some(call => call.sql.includes("localAuthUsers"))).toBe(true);
    expect(calls.some(call => call.sql.includes("userAddresses"))).toBe(true);
  });
});
