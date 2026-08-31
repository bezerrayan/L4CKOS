import { afterEach, describe, expect, it } from "vitest";
import { validateEnvironmentIsolation, validateStagingIsolation } from "./_core/environmentSafety";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

function safeStagingEnv() {
  Object.assign(process.env, {
    NODE_ENV: "production",
    APP_ENV: "staging",
    DATABASE_URL: "mysql://user:password@staging-db.example.invalid:3306/l4ckos_staging",
    EXPECTED_DATABASE_HOST: "staging-db.example.invalid",
    EXPECTED_DATABASE_NAME: "l4ckos_staging",
    PRODUCTION_DATABASE_HOST: "production-db.example.invalid",
    PRODUCTION_DATABASE_NAME: "l4ckos_production",
    FRONTEND_URL: "https://staging.example.invalid",
    APP_URL: "https://staging.example.invalid",
    API_PUBLIC_URL: "https://api-staging.example.invalid",
    EXPECTED_FRONTEND_ORIGIN: "https://staging.example.invalid",
    EXPECTED_API_ORIGIN: "https://api-staging.example.invalid",
    PRODUCTION_FRONTEND_ORIGIN: "https://example.invalid",
    PRODUCTION_API_ORIGIN: "https://api.example.invalid",
    CORS_ORIGINS: "https://staging.example.invalid",
    GOOGLE_REDIRECT_URI: "https://api-staging.example.invalid/api/oauth/callback",
    ASAAS_API_URL: "https://api-sandbox.asaas.com/v3",
    ASAAS_CHECKOUT_BASE_URL: "https://sandbox.asaas.com",
    ASAAS_API_KEY: "$aact_hmlg_example",
    ASAAS_WEBHOOK_TOKEN: "webhook-staging-exclusive-token",
    ASAAS_WEBHOOK_ENV: "staging",
    CRON_SECRET: "x".repeat(32),
    CRON_SECRET_ENV: "staging",
    EMAIL_MODE: "restricted",
    EMAIL_ENV: "staging",
    STAGING_EMAIL_ALLOWLIST: "qa@example.test",
    STORAGE_MODE: "remote",
    STORAGE_ENV: "staging",
    BUILT_IN_FORGE_API_URL: "https://storage-staging.example.invalid",
    BUILT_IN_FORGE_API_KEY: "storage-staging-key",
    STORAGE_NAMESPACE: "l4ckos-staging",
    PRODUCTION_STORAGE_NAMESPACE: "l4ckos-production",
    SESSION_COOKIE_NAME: "l4ckos_staging_session",
    PRODUCTION_SESSION_COOKIE_NAME: "l4ckos_production_session",
    SESSION_COOKIE_DOMAIN: "",
    COOKIE_SECURE: "true",
    COOKIE_SAME_SITE: "lax",
    SESSION_SECRET_ENV: "staging",
    JWT_SECRET: "staging-session-secret-at-least-32-characters",
    CHECKOUT_ENABLED: "false",
    MAINTENANCE_MODE: "false",
    OPERATIONAL_JOBS_ENABLED: "true",
    JOB_ENDPOINTS_ENABLED: "true",
    JOB_SCHEDULER_MODE: "external",
    AUTOMATIC_BACKUPS_ENABLED: "false",
    RELEASE_VERSION: "staging-candidate",
    GIT_COMMIT_SHA: "0123456789abcdef",
    DEPLOYED_AT: "2026-08-28T00:00:00Z",
    MELHOR_ENVIO_TOKEN: "",
  });
}

describe("environment isolation", () => {
  it("accepts a fully isolated staging configuration", () => {
    safeStagingEnv();
    expect(validateStagingIsolation()).toEqual([]);
  });

  it("blocks production database, origins, Asaas and storage", () => {
    safeStagingEnv();
    process.env.DATABASE_URL = "mysql://user:password@production-db.example.invalid:3306/l4ckos_production";
    process.env.ASAAS_API_URL = "https://api.asaas.com/v3";
    process.env.ASAAS_CHECKOUT_BASE_URL = "https://www.asaas.com";
    process.env.ASAAS_API_KEY = "$aact_prod_example";
    process.env.FRONTEND_URL = "https://example.invalid";
    process.env.CORS_ORIGINS = "https://example.invalid";
    process.env.STORAGE_NAMESPACE = "l4ckos-production";
    const issues = validateStagingIsolation();
    expect(issues).toContain("DATABASE_URL aponta para o host de producao.");
    expect(issues).toContain("ASAAS_API_URL precisa apontar para api-sandbox.asaas.com.");
    expect(issues).toContain("ASAAS_CHECKOUT_BASE_URL precisa apontar para sandbox.asaas.com.");
    expect(issues).toContain("FRONTEND_URL aponta para o ambiente proibido.");
    expect(issues).toContain("CORS_ORIGINS contem origem do ambiente proibido.");
    expect(issues).toContain("STORAGE_NAMESPACE coincide com o ambiente proibido.");
  });

  it("requires canonical APP_ENV even when a platform implies staging", () => {
    safeStagingEnv();
    delete process.env.APP_ENV;
    process.env.RAILWAY_ENVIRONMENT_NAME = "staging";
    expect(validateStagingIsolation()).toContain("APP_ENV precisa ser explicitamente staging.");
  });

  it("rejects wildcard CORS and a production OAuth callback", () => {
    safeStagingEnv();
    process.env.CORS_ORIGINS = "*";
    process.env.GOOGLE_REDIRECT_URI = "https://api.example.invalid/api/oauth/callback";
    const issues = validateStagingIsolation();
    expect(issues).toContain("CORS_ORIGINS nao pode conter wildcard.");
    expect(issues).toContain("GOOGLE_REDIRECT_URI precisa usar EXPECTED_API_ORIGIN e /api/oauth/callback.");
  });

  it("rejects inherited Google OAuth credentials without an environment marker", () => {
    safeStagingEnv();
    process.env.GOOGLE_CLIENT_ID = "inherited-client";
    process.env.GOOGLE_CLIENT_SECRET = "inherited-secret";
    delete process.env.GOOGLE_OAUTH_ENV;
    expect(validateStagingIsolation()).toContain("GOOGLE_OAUTH_ENV precisa ser staging.");
  });

  it("rejects simultaneous internal scheduler and external job endpoints", () => {
    safeStagingEnv();
    process.env.JOB_SCHEDULER_MODE = "internal";
    expect(validateStagingIsolation()).toContain("Scheduler interno e endpoints externos nao podem ficar ativos juntos.");
  });

  it("rejects unapproved local storage fallback", () => {
    safeStagingEnv();
    process.env.STORAGE_MODE = "local";
    process.env.ALLOW_EPHEMERAL_STAGING_STORAGE = "false";
    expect(validateStagingIsolation()).toContain("Storage local exige staging e ALLOW_EPHEMERAL_STAGING_STORAGE=true.");
  });

  it("rejects a session cookie name shared with production", () => {
    safeStagingEnv();
    process.env.SESSION_COOKIE_NAME = process.env.PRODUCTION_SESSION_COOKIE_NAME;
    expect(validateStagingIsolation()).toContain("SESSION_COOKIE_NAME coincide com o ambiente proibido.");
  });

  it("rejects sandbox configuration in production", () => {
    safeStagingEnv();
    process.env.APP_ENV = "production";
    process.env.EXPECTED_DATABASE_HOST = "production-db.example.invalid";
    process.env.EXPECTED_DATABASE_NAME = "l4ckos_production";
    process.env.STAGING_DATABASE_HOST = "staging-db.example.invalid";
    process.env.STAGING_DATABASE_NAME = "l4ckos_staging";
    process.env.DATABASE_URL = "mysql://user:password@production-db.example.invalid:3306/l4ckos_production";
    process.env.EXPECTED_FRONTEND_ORIGIN = "https://example.invalid";
    process.env.EXPECTED_API_ORIGIN = "https://api.example.invalid";
    process.env.STAGING_FRONTEND_ORIGIN = "https://staging.example.invalid";
    process.env.STAGING_API_ORIGIN = "https://api-staging.example.invalid";
    process.env.FRONTEND_URL = "https://example.invalid";
    process.env.APP_URL = "https://example.invalid";
    process.env.API_PUBLIC_URL = "https://api.example.invalid";
    process.env.CORS_ORIGINS = "https://example.invalid";
    process.env.GOOGLE_REDIRECT_URI = "https://api.example.invalid/api/oauth/callback";
    const issues = validateEnvironmentIsolation();
    expect(issues).toContain("ASAAS_API_URL precisa apontar para api.asaas.com.");
    expect(issues).toContain("ASAAS_API_KEY de sandbox nao pode ser usada em producao.");
  });
});
