import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { launchAfterFinancialBootstrap, inspectFinancialBootstrap } from "./financialRuntimeBootstrap";
import { hasIsolatedHomologationIdentityMarker, ISOLATED_HOMOLOGATION_IDENTITY, LEGACY_STAGING_IDENTITY } from "./railwayEnvironment";
import { initializeBeforeBackgroundEffects } from "./startupEffects";

const base = {
  NODE_ENV: "production",
  APP_ENV: "staging",
  RAILWAY_PROJECT_ID: ISOLATED_HOMOLOGATION_IDENTITY.projectId,
  RAILWAY_ENVIRONMENT_ID: ISOLATED_HOMOLOGATION_IDENTITY.environmentId,
  RAILWAY_SERVICE_ID: ISOLATED_HOMOLOGATION_IDENTITY.serviceId,
  RAILWAY_DEPLOYMENT_ID: "dpl-synthetic-bootstrap-01",
  RAILWAY_REPLICA_ID: "replica-synthetic-bootstrap-01",
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
  ASAAS_API_KEY: "synthetic-key-never-logged",
};
const pid = 4312;

async function assertBlocked(env: Record<string, string | undefined>) {
  const start = vi.fn(async () => undefined);
  const emit = vi.fn();
  const result = await launchAfterFinancialBootstrap(env, pid, start, emit);
  expect(result.allowed).toBe(false);
  expect(result.applicationStarted).toBe(false);
  expect(start).not.toHaveBeenCalled();
  expect(emit).toHaveBeenCalledOnce();
  const json = JSON.stringify(emit.mock.calls[0][0]);
  expect(json).not.toContain("synthetic-key");
  expect(json).not.toContain("https://");
}

describe("isolated homologation financial bootstrap", () => {
  it("permits the exact isolated identity, explicitly closed flags, correlated process and Sandbox", async () => {
    const start = vi.fn(async () => undefined);
    const result = await launchAfterFinancialBootstrap(base, pid, start);
    expect(result.allowed).toBe(true);
    expect(result.applicationStarted).toBe(true);
    expect(start).toHaveBeenCalledOnce();
    expect(result.report).toMatchObject({
      verdict: "PASS",
      stockReservationExpirySchedulerEnabled: false,
      asaasWebhookRecoveryWorkerEnabled: false,
      paymentNotificationRecoveryWorkerEnabled: false,
      asaasMode: "sandbox",
      asaasModeConsistent: true,
    });
  });

  it.each([
    ["wrong project", { RAILWAY_PROJECT_ID: "wrong" }],
    ["wrong environment", { RAILWAY_ENVIRONMENT_ID: "wrong" }],
    ["wrong service", { RAILWAY_SERVICE_ID: "wrong" }],
    ["missing project", { RAILWAY_PROJECT_ID: undefined }],
    ["missing environment", { RAILWAY_ENVIRONMENT_ID: undefined }],
    ["missing service", { RAILWAY_SERVICE_ID: undefined }],
  ])("does not import the application for %s", async (_label, patch) => {
    await assertBlocked({ ...base, ...patch });
  });

  it.each([
    "PUBLIC_CHECKOUT_ENABLED",
    "STOCK_RUNTIME_ENABLED",
    "STOCK_CHECKOUT_ENABLED",
    "ASAAS_WEBHOOK_INBOUND_ENABLED",
    "ASAAS_WEBHOOK_RECOVERY_WORKER_ENABLED",
    "PAYMENT_NOTIFICATION_RECOVERY_WORKER_ENABLED",
  ])("does not import the application when %s is enabled or missing", async flag => {
    await assertBlocked({ ...base, [flag]: "true" });
    const missing = { ...base } as Record<string, string | undefined>;
    delete missing[flag];
    await assertBlocked(missing);
  });

  it("rejects non-coming-soon storefront mode", async () => {
    await assertBlocked({ ...base, PUBLIC_SITE_MODE: "store" });
  });

  it.each([
    ["Production", { ASAAS_ENV: "production", ASAAS_API_URL: "https://api.asaas.com/v3", ASAAS_CHECKOUT_BASE_URL: "https://www.asaas.com" }],
    ["inconsistent mode", { ASAAS_ENV: "production" }],
    ["missing sandbox key", { ASAAS_API_KEY: undefined }],
    ["implicit environment mode", { ASAAS_ENV: undefined }],
    ["unconfigured endpoint", { ASAAS_API_URL: undefined }],
  ])("rejects Asaas %s before application import", async (_label, patch) => {
    await assertBlocked({ ...base, ...patch });
  });

  it.each([
    ["deployment ID", { RAILWAY_DEPLOYMENT_ID: undefined }],
    ["replica ID", { RAILWAY_REPLICA_ID: undefined }],
  ])("rejects incomplete %s correlation", async (_label, patch) => {
    await assertBlocked({ ...base, ...patch });
  });

  it("rejects the invalid process ID", async () => {
    const result = inspectFinancialBootstrap(base, 0);
    expect(result.allowed).toBe(false);
    expect(result.report.verdict).toBe("NOT_VERIFIED");
  });

  it("does not load application imports from the entrypoint before the gate", async () => {
    const source = await readFile(new URL("./isolatedHomologation.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/^import .*application/m);
    expect(source).not.toContain("dotenv/config");
    expect(source.indexOf("launchAfterFinancialBootstrap")).toBeLessThan(source.indexOf('import("./application")'));
  });

  it("does not activate startup effects when listener initialization fails", async () => {
    const effects = vi.fn();
    await expect(initializeBeforeBackgroundEffects(async () => {
      throw new Error("synthetic initialization failure");
    }, effects)).rejects.toThrow("synthetic initialization failure");
    expect(effects).not.toHaveBeenCalled();
  });

  it("keeps the normal entrypoint outside the isolated-only gate and blocks unsafe fallback", async () => {
    const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
    expect(source).not.toContain("financialRuntimeBootstrap");
    expect(source).toContain("hasIsolatedHomologationIdentityMarker(process.env)");
    expect(source).toContain('requires start:isolated-homologation');
    expect(source).toContain('await import("./application")');
  });

  it("points the protected package script directly at the isolated compiled entry", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
    expect(packageJson.scripts["start:isolated-homologation"]).toBe(
      "NODE_ENV=production HOST=0.0.0.0 node dist/isolated/isolatedHomologation.js",
    );
  });

  it("does not apply the isolated policy to Production or legacy staging", () => {
    const production = { ...base, RAILWAY_PROJECT_ID: "5937dcf3-18ae-4df8-83f0-5bb60ec9b8db", RAILWAY_ENVIRONMENT_ID: "prod-env-synthetic", RAILWAY_SERVICE_ID: "prod-api-synthetic" };
    const legacy = {
      ...base,
      RAILWAY_PROJECT_ID: LEGACY_STAGING_IDENTITY.projectId,
      RAILWAY_ENVIRONMENT_ID: LEGACY_STAGING_IDENTITY.environmentId,
      RAILWAY_SERVICE_ID: LEGACY_STAGING_IDENTITY.serviceId,
    };
    expect(inspectFinancialBootstrap(production, pid).allowed).toBe(false);
    expect(inspectFinancialBootstrap(legacy, pid).allowed).toBe(false);
    expect(inspectFinancialBootstrap({}, pid).allowed).toBe(false);
    expect(hasIsolatedHomologationIdentityMarker(production)).toBe(false);
    expect(hasIsolatedHomologationIdentityMarker(legacy)).toBe(false);
    expect(hasIsolatedHomologationIdentityMarker({ RAILWAY_SERVICE_ID: ISOLATED_HOMOLOGATION_IDENTITY.serviceId })).toBe(true);
  });
});
