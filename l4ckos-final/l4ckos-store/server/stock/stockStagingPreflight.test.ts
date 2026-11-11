import { describe, expect, it } from "vitest";
import {
  inspectStockStagingEnvironment,
  inspectStockStagingSnapshot,
} from "../../scripts/stock-staging-preflight.mjs";

const validStaging = {
  STOCK_DATABASE_ENV: "staging",
  STOCK_EXPECTED_DATABASE: "l4ckos_stock_stage_v1",
  DATABASE_URL:
    "mysql://synthetic:synthetic@mysql-staging.internal/l4ckos_stock_stage_v1",
  ASAAS_API_KEY: "synthetic-sandbox-key",
  ASAAS_WEBHOOK_TOKEN: "synthetic-webhook-token",
  RESEND_API_KEY: "synthetic-resend-key",
  STOCK_DB_TLS_VERIFIED: "verified",
  STOCK_DB_ISOLATION_ACK: "verified",
  STOCK_DB_BACKUP_ACK: "verified",
  STOCK_ASAAS_MODE: "sandbox",
  ASAAS_API_URL: "https://api-sandbox.asaas.com/v3",
  STOCK_ASAAS_WEBHOOK_URL:
    "https://api-staging.l4ckos.com.br/api/webhooks/asaas",
  STOCK_RUNTIME_ENABLED: "false",
  STOCK_CHECKOUT_ENABLED: "false",
  PUBLIC_CHECKOUT_ENABLED: "false",
};

describe("STOCK staging preflight", () => {
  it("accepts only a fully attested isolated staging shape with closed checkout flags", () => {
    const result = inspectStockStagingEnvironment(validStaging);
    expect(result.status).toBe("ready_for_operator_review");
    expect(result.remoteActionsPerformed).toBe(false);
    expect(result.databaseConnectionsAttempted).toBe(false);
    expect(JSON.stringify(result)).not.toContain("synthetic-sandbox-key");
    expect(JSON.stringify(result)).not.toContain("mysql://");
  });

  it.each([
    [
      "production Asaas endpoint",
      { ASAAS_API_URL: "https://api.asaas.com/v3" },
    ],
    [
      "production-like database name",
      { STOCK_EXPECTED_DATABASE: "l4ckos_production" },
    ],
    [
      "database/schema mismatch",
      { DATABASE_URL: "mysql://test:test@mysql-staging.internal/other" },
    ],
    [
      "local database target",
      { DATABASE_URL: "mysql://test:test@127.0.0.1/l4ckos_stock_stage_v1" },
    ],
    ["unverified TLS", { STOCK_DB_TLS_VERIFIED: "" }],
    ["open checkout", { STOCK_CHECKOUT_ENABLED: "true" }],
    [
      "wrong webhook destination",
      {
        STOCK_ASAAS_WEBHOOK_URL: "https://api.l4ckos.com.br/api/webhooks/asaas",
      },
    ],
  ])("blocks %s", (_label, override) => {
    const result = inspectStockStagingEnvironment({
      ...validStaging,
      ...override,
    });
    expect(result.status).toBe("blocked");
  });

  it("never treats the config check as evidence that a remote identity is verified", () => {
    const result = inspectStockStagingEnvironment({
      ...validStaging,
      STOCK_DB_ISOLATION_ACK: "",
    });
    expect(result.status).toBe("blocked");
    expect(
      result.checks.find(check => check.name === "STOCK_DB_ISOLATION_ACK")
        ?.status
    ).toBe("blocked");
  });

  it("accepts a complete synthetic staging snapshot without printing its values", () => {
    const result = inspectStockStagingSnapshot({
      railway: {
        projectName: "l4ckos-staging",
        projectId: "2bb90c8e-eb65-43ee-826b-f93750f0499c",
        environment: "production",
        serviceSha: "a".repeat(40),
      },
      vercel: {
        projectName: "l4ckos-staging",
        alias: "staging.l4ckos.com.br",
        deploymentSha: "b".repeat(40),
      },
      database: {
        identity: "l4ckos_stock_stage_synthetic",
        version: "9.7.2",
        isolated: true,
        syntheticDataOnly: true,
        tlsVerified: true,
        hostnameVerified: true,
      },
      flags: {
        stockRuntimeEnabled: false,
        stockCheckoutEnabled: false,
        publicCheckoutEnabled: false,
        paymentNotificationWorkerEnabled: false,
      },
      asaas: {
        mode: "sandbox",
        apiUrl: "https://api-sandbox.asaas.com/v3",
        credentialConfigured: true,
        webhookUrl: "https://api-staging.l4ckos.com.br/api/webhooks/asaas",
        webhookAuthenticationConfigured: true,
      },
      resend: {
        credentialConfigured: true,
        recipientRestrictionEnabled: true,
        senderDomainVerified: true,
      },
      health: { backendStatus: 200, frontendStatus: 200 },
      migrations: {
        disposableMysql972PreflightPassed: true,
        remoteMigrationPerformed: false,
      },
      rollback: {
        previousSha: "c".repeat(40),
        restorationVerified: true,
        pauseFlagsTested: true,
      },
    });
    expect(result.status).toBe("ready_for_operator_review");
    expect(result.remoteActionsPerformed).toBe(false);
    expect(result.databaseConnectionsAttempted).toBe(false);
    expect(result.snapshotValuesPrinted).toBe(false);
    expect(JSON.stringify(result)).not.toContain(
      "l4ckos_stock_stage_synthetic"
    );
  });

  it.each([
    ["unknown Railway access", { railway: {} }],
    [
      "production database identity",
      { database: { identity: "l4ckos_production" } },
    ],
    ["wrong MySQL version", { database: { version: "8.4.11" } }],
    [
      "unverified TLS",
      { database: { tlsVerified: false, hostnameVerified: false } },
    ],
    ["open STOCK checkout", { flags: { stockCheckoutEnabled: true } }],
    [
      "active notification worker",
      { flags: { paymentNotificationWorkerEnabled: true } },
    ],
    [
      "production Asaas",
      { asaas: { mode: "production", apiUrl: "https://api.asaas.com/v3" } },
    ],
    ["unhealthy frontend", { health: { frontendStatus: 503 } }],
    ["unverified rollback", { rollback: { restorationVerified: false } }],
  ])("blocks %s", (_label, partial) => {
    const result = inspectStockStagingSnapshot(partial);
    expect(result.status).toBe("blocked");
  });
});
