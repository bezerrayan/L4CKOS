import { describe, expect, it } from "vitest";
import {
  resolveFinancialRuntimeAttestation,
  shouldEmitFinancialRuntimeAttestation,
} from "./financialRuntimeAttestation";
import {
  ISOLATED_HOMOLOGATION_IDENTITY,
  LEGACY_STAGING_IDENTITY,
} from "./railwayEnvironment";

const isolatedClosedSandbox = {
  NODE_ENV: "production",
  APP_ENV: "staging",
  RAILWAY_PROJECT_ID: ISOLATED_HOMOLOGATION_IDENTITY.projectId,
  RAILWAY_ENVIRONMENT_ID: ISOLATED_HOMOLOGATION_IDENTITY.environmentId,
  RAILWAY_SERVICE_ID: ISOLATED_HOMOLOGATION_IDENTITY.serviceId,
  RAILWAY_DEPLOYMENT_ID: "dpl-synthetic-financial-01",
  RAILWAY_REPLICA_ID: "replica-synthetic-01",
  RAILWAY_GIT_COMMIT_SHA: "a".repeat(40),
  PUBLIC_SITE_MODE: "coming-soon",
  PUBLIC_CHECKOUT_ENABLED: "false",
  STOCK_RUNTIME_ENABLED: "false",
  STOCK_CHECKOUT_ENABLED: "false",
  ASAAS_WEBHOOK_INBOUND_ENABLED: "false",
  ASAAS_WEBHOOK_RECOVERY_WORKER_ENABLED: "false",
  PAYMENT_NOTIFICATION_RECOVERY_WORKER_ENABLED: "false",
  ASAAS_ENV: "sandbox",
  ASAAS_API_URL: "https://api-sandbox.asaas.com/v3",
  ASAAS_CHECKOUT_BASE_URL: "https://sandbox.asaas.com",
  ASAAS_API_KEY: "synthetic-secret-must-not-be-returned",
  ASAAS_WEBHOOK_TOKEN: "synthetic-token-must-not-be-returned",
};

const processId = 4312;

describe("financial runtime attestation", () => {
  it("passes only for the exact isolated identity, correlated execution, closed flags, and Sandbox", () => {
    const report = resolveFinancialRuntimeAttestation(
      isolatedClosedSandbox,
      processId
    );

    expect(report).toMatchObject({
      schemaVersion: 2,
      verdict: "PASS",
      issues: [],
      identity: {
        status: "VERIFIED",
        projectId: ISOLATED_HOMOLOGATION_IDENTITY.projectId,
        environmentId: ISOLATED_HOMOLOGATION_IDENTITY.environmentId,
        serviceId: ISOLATED_HOMOLOGATION_IDENTITY.serviceId,
      },
      execution: {
        deploymentId: "dpl-synthetic-financial-01",
        replicaId: "replica-synthetic-01",
        processId,
        sourceCommitSha: "a".repeat(40),
      },
      publicSiteMode: "coming-soon",
      publicCheckoutFlagEnabled: false,
      publicCheckoutEnabled: false,
      stockRuntimeEnabled: false,
      stockCheckoutEnabled: false,
      stockCheckoutEffective: false,
      asaasWebhookInboundEnabled: false,
      asaasWebhookRecoveryWorkerEnabled: false,
      paymentNotificationRecoveryWorkerEnabled: false,
      asaasMode: "sandbox",
      asaasModeConsistent: true,
      asaasCredentialsPresent: true,
    });
    expect(shouldEmitFinancialRuntimeAttestation(isolatedClosedSandbox)).toBe(
      true
    );
  });

  it.each([
    ["project", "RAILWAY_PROJECT_ID", "wrong-project"],
    ["environment", "RAILWAY_ENVIRONMENT_ID", "wrong-environment"],
    ["service", "RAILWAY_SERVICE_ID", "wrong-service"],
  ])(
    "fails and suppresses emission for a wrong Railway %s",
    (_label, key, value) => {
      const env = { ...isolatedClosedSandbox, [key]: value };
      expect(resolveFinancialRuntimeAttestation(env, processId)).toMatchObject({
        verdict: "FAIL",
        identity: { status: "MISMATCH" },
        issues: expect.arrayContaining(["RAILWAY_IDENTITY_MISMATCH"]),
      });
      expect(shouldEmitFinancialRuntimeAttestation(env)).toBe(false);
    }
  );

  it.each([
    [
      "all identity identifiers absent",
      {
        RAILWAY_PROJECT_ID: undefined,
        RAILWAY_ENVIRONMENT_ID: undefined,
        RAILWAY_SERVICE_ID: undefined,
      },
    ],
    ["project identifier absent", { RAILWAY_PROJECT_ID: undefined }],
    ["environment identifier absent", { RAILWAY_ENVIRONMENT_ID: undefined }],
    ["service identifier absent", { RAILWAY_SERVICE_ID: undefined }],
  ])("returns NOT_VERIFIED for %s", (_label, overrides) => {
    const report = resolveFinancialRuntimeAttestation(
      { ...isolatedClosedSandbox, ...overrides },
      processId
    );
    expect(report.verdict).toBe("NOT_VERIFIED");
    expect(report.identity.status).toBe("NOT_VERIFIED");
    expect(
      shouldEmitFinancialRuntimeAttestation({
        ...isolatedClosedSandbox,
        ...overrides,
      })
    ).toBe(false);
  });

  it.each([
    ["deployment ID absent", { RAILWAY_DEPLOYMENT_ID: undefined }],
    ["replica ID absent", { RAILWAY_REPLICA_ID: undefined }],
    ["process ID invalid", {}],
  ])("returns NOT_VERIFIED when %s", (_label, overrides) => {
    const report = resolveFinancialRuntimeAttestation(
      { ...isolatedClosedSandbox, ...overrides },
      _label === "process ID invalid" ? 0 : processId
    );
    expect(report.verdict).toBe("NOT_VERIFIED");
  });

  it("does not pass when deployment metadata contains an invalid commit identifier", () => {
    const report = resolveFinancialRuntimeAttestation(
      { ...isolatedClosedSandbox, RAILWAY_GIT_COMMIT_SHA: "not-a-sha" },
      processId
    );
    expect(report.verdict).toBe("NOT_VERIFIED");
    expect(report.execution.sourceCommitSha).toBeNull();
  });

  it("fails if any public, STOCK, webhook, or recovery feature is enabled", () => {
    const report = resolveFinancialRuntimeAttestation(
      {
        ...isolatedClosedSandbox,
        PUBLIC_CHECKOUT_ENABLED: "true",
        STOCK_RUNTIME_ENABLED: "true",
        ASAAS_WEBHOOK_INBOUND_ENABLED: "true",
      },
      processId
    );
    expect(report.verdict).toBe("FAIL");
    expect(report.issues).toContain("FINANCIAL_FLAG_OPEN");
  });

  it("fails on malformed financial flags even when the effective resolver closes them", () => {
    const report = resolveFinancialRuntimeAttestation(
      { ...isolatedClosedSandbox, STOCK_CHECKOUT_ENABLED: "yes" },
      processId
    );
    expect(report.verdict).toBe("FAIL");
    expect(report.issues).toContain("FINANCIAL_FLAG_INVALID");
  });

  it("fails when Asaas Production is selected in the isolated homologation identity", () => {
    const report = resolveFinancialRuntimeAttestation(
      {
        ...isolatedClosedSandbox,
        ASAAS_ENV: "production",
        ASAAS_API_URL: "https://api.asaas.com/v3",
        ASAAS_CHECKOUT_BASE_URL: "https://www.asaas.com",
      },
      processId
    );
    expect(report.verdict).toBe("FAIL");
    expect(report.asaasMode).toBe("production");
    expect(report.issues).toContain("ASAAS_PRODUCTION_SELECTED");
  });

  it("fails when Asaas endpoint and declared mode disagree", () => {
    const report = resolveFinancialRuntimeAttestation(
      {
        ...isolatedClosedSandbox,
        ASAAS_ENV: "production",
      },
      processId
    );
    expect(report.verdict).toBe("FAIL");
    expect(report.asaasModeConsistent).toBe(false);
    expect(report.issues).toContain("ASAAS_CONFIGURATION_INVALID");
  });

  it("returns NOT_VERIFIED when the Asaas endpoint is not configured", () => {
    const report = resolveFinancialRuntimeAttestation(
      {
        ...isolatedClosedSandbox,
        ASAAS_ENV: undefined,
        ASAAS_API_URL: undefined,
        ASAAS_CHECKOUT_BASE_URL: undefined,
      },
      processId
    );
    expect(report.verdict).toBe("NOT_VERIFIED");
    expect(report.asaasMode).toBe("unconfigured");
  });

  it("never returns credentials, webhook tokens, or endpoint URLs", () => {
    const serialized = JSON.stringify(
      resolveFinancialRuntimeAttestation(isolatedClosedSandbox, processId)
    );
    expect(serialized).not.toContain("synthetic-secret");
    expect(serialized).not.toContain("synthetic-token");
    expect(serialized).not.toContain("https://");
    expect(serialized).toContain("dpl-synthetic-financial-01");
    expect(serialized).toContain("replica-synthetic-01");
  });

  it("does not emit evidence from Production, legacy staging, or a local process", () => {
    const production = {
      ...isolatedClosedSandbox,
      RAILWAY_PROJECT_ID: "5937dcf3-18ae-4df8-83f0-5bb60ec9b8db",
      RAILWAY_ENVIRONMENT_ID: "production-environment",
      RAILWAY_SERVICE_ID: "production-api",
    };
    const legacy = {
      ...isolatedClosedSandbox,
      RAILWAY_PROJECT_ID: LEGACY_STAGING_IDENTITY.projectId,
      RAILWAY_ENVIRONMENT_ID: LEGACY_STAGING_IDENTITY.environmentId,
      RAILWAY_SERVICE_ID: LEGACY_STAGING_IDENTITY.serviceId,
    };

    expect(shouldEmitFinancialRuntimeAttestation(production)).toBe(false);
    expect(shouldEmitFinancialRuntimeAttestation(legacy)).toBe(false);
    expect(shouldEmitFinancialRuntimeAttestation({})).toBe(false);
  });
});
