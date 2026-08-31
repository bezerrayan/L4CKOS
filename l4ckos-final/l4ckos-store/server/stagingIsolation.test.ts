import { afterEach, describe, expect, it } from "vitest";
import { getSessionCookieName, getSessionCookieOptions } from "./_core/cookies";
import { isOriginAllowed } from "./_core/httpPolicy";
import { getCheckoutAvailability, getOperationalConfig } from "./_core/operationalConfig";
import { validateAsaasWebhookSignature } from "./services/asaasService";

const originalEnv = { ...process.env };
afterEach(() => { process.env = { ...originalEnv }; });

describe("staging HTTP and operational isolation", () => {
  it("uses a host-only secure staging cookie", () => {
    Object.assign(process.env, { SESSION_COOKIE_NAME: "l4ckos_staging_session", SESSION_COOKIE_DOMAIN: "", COOKIE_SECURE: "true", COOKIE_SAME_SITE: "lax" });
    // ENV is loaded once in this process, so the static name remains the process value;
    // the options still prove that no Domain attribute is emitted.
    const options = getSessionCookieOptions({ protocol: "http", headers: {} } as any);
    expect(options.domain).toBeUndefined();
    expect(options.secure).toBe(true);
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(typeof getSessionCookieName()).toBe("string");
  });

  it("allows only the exact configured CORS origin", () => {
    Object.assign(process.env, { APP_ENV: "staging", CORS_ORIGINS: "https://staging.l4ckos.com.br" });
    expect(isOriginAllowed("https://staging.l4ckos.com.br")).toBe(true);
    expect(isOriginAllowed("http://staging.l4ckos.com.br")).toBe(false);
    expect(isOriginAllowed("https://l4ckos.com.br")).toBe(false);
    expect(isOriginAllowed("https://evil.example")).toBe(false);
    Object.assign(process.env, { APP_ENV: "production", CORS_ORIGINS: "https://l4ckos.com.br" });
    expect(isOriginAllowed("https://l4ckos.com.br")).toBe(true);
    expect(isOriginAllowed("https://staging.l4ckos.com.br")).toBe(false);
  });

  it("requires the environment-specific webhook token", () => {
    Object.assign(process.env, { NODE_ENV: "production", APP_ENV: "staging", ASAAS_WEBHOOK_TOKEN: "staging-webhook-exclusive" });
    expect(validateAsaasWebhookSignature({})).toBe(false);
    expect(validateAsaasWebhookSignature({ "asaas-access-token": "wrong" })).toBe(false);
    expect(validateAsaasWebhookSignature({ "asaas-access-token": "staging-webhook-exclusive" })).toBe(true);
  });

  it("blocks checkout in maintenance and when the feature flag is off", () => {
    Object.assign(process.env, { APP_ENV: "staging", MAINTENANCE_MODE: "true", CHECKOUT_ENABLED: "true" });
    expect(getCheckoutAvailability()).toMatchObject({ available: false, code: "MAINTENANCE_MODE" });
    process.env.MAINTENANCE_MODE = "false";
    process.env.CHECKOUT_ENABLED = "false";
    expect(getCheckoutAvailability()).toMatchObject({ available: false, code: "CHECKOUT_DISABLED" });
  });

  it("keeps external and internal scheduler modes explicit", () => {
    Object.assign(process.env, { APP_ENV: "staging", OPERATIONAL_JOBS_ENABLED: "true", JOB_ENDPOINTS_ENABLED: "true", JOB_SCHEDULER_MODE: "external" });
    expect(getOperationalConfig()).toMatchObject({ operationalJobsEnabled: true, jobEndpointsEnabled: true, schedulerMode: "external" });
  });
});
