import { createServer } from "node:http";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import { describe, expect, it } from "vitest";
import {
  assertStagingApiAccessConfiguration,
  createStagingApiAccessMiddleware,
  STAGING_API_ACCESS_HEADER,
} from "./stagingApiAccess";
import { ISOLATED_HOMOLOGATION_IDENTITY } from "./railwayEnvironment";
import { resolveFinancialPhasePolicy } from "./financialPhasePolicy";

const token = "synthetic-staging-api-access-token-0123456789";
const environment = {
  NODE_ENV: "production",
  APP_ENV: "staging",
  RAILWAY_PROJECT_ID: ISOLATED_HOMOLOGATION_IDENTITY.projectId,
  RAILWAY_ENVIRONMENT_ID: ISOLATED_HOMOLOGATION_IDENTITY.environmentId,
  RAILWAY_SERVICE_ID: ISOLATED_HOMOLOGATION_IDENTITY.serviceId,
  STAGING_API_ACCESS_TOKEN: token,
  PUBLIC_SITE_MODE: "coming-soon",
  PUBLIC_CHECKOUT_ENABLED: "false",
  STOCK_CHECKOUT_ENABLED: "false",
  STOCK_RUNTIME_ENABLED: "false",
  ASAAS_WEBHOOK_INBOUND_ENABLED: "false",
  ASAAS_WEBHOOK_RECOVERY_WORKER_ENABLED: "false",
  PAYMENT_NOTIFICATION_RECOVERY_WORKER_ENABLED: "false",
  ADMIN_EMAILS: "admin@example.invalid",
  LOCAL_AUTH_ALLOWED_EMAILS: "admin@example.invalid",
  ALLOW_LOCAL_AUTH_IN_PRODUCTION: "true",
  ALLOW_PUBLIC_LOCAL_SIGNUP_IN_PRODUCTION: "false",
};

async function withApi(run: (base: string) => Promise<void>, env = environment) {
  const app = express();
  app.use(createStagingApiAccessMiddleware(env));
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.post("/api/webhooks/asaas", (_req, res) => res.json({ handled: true }));
  app.get("/api/trpc/admin.secret", (_req, res) => res.json({ authenticated: false }));
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

describe("isolated staging API access gate", () => {
  it("requires the exact Railway identity and a server-only strong token at startup", () => {
    expect(() => assertStagingApiAccessConfiguration(environment)).not.toThrow();
    expect(() => assertStagingApiAccessConfiguration({ ...environment, RAILWAY_SERVICE_ID: "wrong" }))
      .toThrow("STAGING_API_RAILWAY_IDENTITY_INVALID");
    expect(() => assertStagingApiAccessConfiguration({ ...environment, STAGING_API_ACCESS_TOKEN: "short" }))
      .toThrow("STAGING_API_ACCESS_TOKEN_REQUIRED");
    expect(() => assertStagingApiAccessConfiguration({ ...environment, STOCK_RUNTIME_ENABLED: undefined }))
      .toThrow("STAGING_API_FEATURE_FLAGS_MUST_BE_EXPLICITLY_CLOSED");
    expect(() => assertStagingApiAccessConfiguration({ ...environment, ADMIN_EMAILS: "real@example.com" }))
      .toThrow("STAGING_API_SYNTHETIC_LOCAL_AUTH_REQUIRED");
    expect(() => assertStagingApiAccessConfiguration({ ...environment, GOOGLE_CLIENT_ID: "configured" }))
      .toThrow("STAGING_API_EXTERNAL_IDENTITY_OR_EMAIL_PROVIDER_MUST_BE_DISABLED");
    expect(() => assertStagingApiAccessConfiguration({ APP_ENV: "staging", NODE_ENV: "production" }))
      .toThrow("STAGING_API_RAILWAY_IDENTITY_INVALID");
  });

  it("allows only the authenticated webhook path through the proxy token gate in SANDBOX_WEBHOOK", async () => {
    const ca = "-----BEGIN CERTIFICATE-----\nU1lO\n-----END CERTIFICATE-----";
    const webhookPhase = {
      ...environment,
      G4_FINANCIAL_PHASE: "SANDBOX_WEBHOOK",
      ASAAS_WEBHOOK_INBOUND_ENABLED: "true",
      G4_SANDBOX_WEBHOOK_APPROVED: "true",
      G4_SANDBOX_WEBHOOK_VALIDATED: "false",
      G4_SANDBOX_CHECKOUT_APPROVED: "false",
      G4_SANDBOX_CHECKOUT_VALIDATED: "false",
      G4_SANDBOX_RECOVERY_APPROVED: "false",
      ASAAS_ENV: "sandbox",
      STOCK_ASAAS_MODE: "sandbox",
      ASAAS_API_URL: "https://api-sandbox.asaas.com/v3",
      ASAAS_CHECKOUT_BASE_URL: "https://sandbox.asaas.com",
      ASAAS_SANDBOX_API_KEY: "$aact_hmlg_synthetic",
      ASAAS_WEBHOOK_TOKEN: "synthetic-webhook-token-with-at-least-32-bytes",
      ASAAS_WEBHOOK_ACCOUNT_ID: "synthetic-account-id",
      ASAAS_WEBHOOK_ACCOUNT_CURRENCY: "BRL",
      ASAAS_WEBHOOK_RECOVERY_MODE: "review_only",
      EMAIL_ENV: "staging",
      EMAIL_MODE: "restricted",
      DATABASE_URL: "mysql://stage:synthetic@mysql-stock-homologation.railway.internal/railway",
      STOCK_DATABASE_ENV: "staging",
      STOCK_EXPECTED_DATABASE: "railway",
      STAGING_DB_TLS_HOST: "mysql-stock-homologation.railway.internal",
      STAGING_DB_TLS_CA_PEM: ca,
      STAGING_DB_TLS_CA_SHA256: createHash("sha256").update(`${ca}\n`).digest("hex"),
    };
    expect(resolveFinancialPhasePolicy(webhookPhase)).toMatchObject({ phase: "SANDBOX_WEBHOOK", allowed: true });
    expect(() => assertStagingApiAccessConfiguration(webhookPhase)).not.toThrow();
    await withApi(async base => {
      const hook = await fetch(`${base}/api/webhooks/asaas`, { method: "POST" });
      expect(hook.status).toBe(200);
      const other = await fetch(`${base}/api/trpc/admin.secret`);
      expect(other.status).toBe(401);
      const hookGet = await fetch(`${base}/api/webhooks/asaas`);
      expect(hookGet.status).toBe(401);
    }, webhookPhase);
  });

  it("rejects direct API calls without the gate token, including webhook routes", async () => {
    await withApi(async base => {
      const api = await fetch(`${base}/api/trpc/admin.secret`);
      expect(api.status).toBe(401);
      expect((await api.json()).code).toBe("STAGING_API_ACCESS_REQUIRED");

      const webhook = await fetch(`${base}/api/webhooks/asaas`, { method: "POST" });
      expect(webhook.status).toBe(401);
    });
  });

  it("accepts only the server proxy token and does not confer administrator authorization", async () => {
    await withApi(async base => {
      const bad = await fetch(`${base}/api/trpc/admin.secret`, {
        headers: { [STAGING_API_ACCESS_HEADER]: "wrong-token-value-012345678901234567890" },
      });
      expect(bad.status).toBe(401);

      const gated = await fetch(`${base}/api/trpc/admin.secret`, {
        headers: { [STAGING_API_ACCESS_HEADER]: token },
      });
      expect(gated.status).toBe(200);
      expect(await gated.json()).toEqual({ authenticated: false });

      const health = await fetch(`${base}/health`);
      expect(health.status).toBe(200);
    });
  });
});
