import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { ISOLATED_HOMOLOGATION_IDENTITY, matchesRailwayIdentity, type RailwayEnvironment } from "./railwayEnvironment";

export const STAGING_API_ACCESS_TOKEN_ENV = "STAGING_API_ACCESS_TOKEN";
export const STAGING_API_ACCESS_HEADER = "x-l4ckos-staging-token";
const TOKEN_MIN_BYTES = 32;

export function isIsolatedHomologationRuntime(env: RailwayEnvironment): boolean {
  return env.APP_ENV === "staging" || matchesRailwayIdentity(env, ISOLATED_HOMOLOGATION_IDENTITY) ||
    env.RAILWAY_PROJECT_ID === ISOLATED_HOMOLOGATION_IDENTITY.projectId ||
    env.RAILWAY_ENVIRONMENT_ID === ISOLATED_HOMOLOGATION_IDENTITY.environmentId ||
    env.RAILWAY_SERVICE_ID === ISOLATED_HOMOLOGATION_IDENTITY.serviceId;
}

export function assertStagingApiAccessConfiguration(env: RailwayEnvironment): void {
  if (!isIsolatedHomologationRuntime(env)) return;
  if (!matchesRailwayIdentity(env, ISOLATED_HOMOLOGATION_IDENTITY) || env.NODE_ENV !== "production") {
    throw new Error("STAGING_API_RAILWAY_IDENTITY_INVALID");
  }
  const token = env[STAGING_API_ACCESS_TOKEN_ENV];
  if (!token || Buffer.byteLength(token, "utf8") < TOKEN_MIN_BYTES) {
    throw new Error("STAGING_API_ACCESS_TOKEN_REQUIRED");
  }

  const mustRemainClosed = [
    "PUBLIC_CHECKOUT_ENABLED",
    "STOCK_CHECKOUT_ENABLED",
    "STOCK_RUNTIME_ENABLED",
    "ASAAS_WEBHOOK_INBOUND_ENABLED",
    "ASAAS_WEBHOOK_RECOVERY_WORKER_ENABLED",
    "PAYMENT_NOTIFICATION_RECOVERY_WORKER_ENABLED",
  ];
  if (mustRemainClosed.some(name => env[name] !== "false")) {
    throw new Error("STAGING_API_FEATURE_FLAGS_MUST_BE_EXPLICITLY_CLOSED");
  }

  if (env.RESEND_API_KEY || env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_SECRET || env.OWNER_OPEN_ID) {
    throw new Error("STAGING_API_EXTERNAL_IDENTITY_OR_EMAIL_PROVIDER_MUST_BE_DISABLED");
  }

  const admins = splitEmails(env.ADMIN_EMAILS);
  const localAuth = splitEmails(env.LOCAL_AUTH_ALLOWED_EMAILS);
  if (env.ALLOW_LOCAL_AUTH_IN_PRODUCTION !== "true" || env.ALLOW_PUBLIC_LOCAL_SIGNUP_IN_PRODUCTION === "true" ||
    admins.length === 0 || localAuth.length === 0 || admins.some(email => !localAuth.includes(email)) ||
    [...admins, ...localAuth].some(email => !email.endsWith("@example.invalid"))) {
    throw new Error("STAGING_API_SYNTHETIC_LOCAL_AUTH_REQUIRED");
  }
}

function splitEmails(value: string | undefined): string[] {
  return String(value ?? "").split(",").map(email => email.trim().toLowerCase()).filter(Boolean);
}

function tokenMatches(presented: string | undefined, expected: string): boolean {
  if (!presented) return false;
  const left = Buffer.from(presented, "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createStagingApiAccessMiddleware(
  env: RailwayEnvironment = process.env,
): RequestHandler {
  const protectedRuntime = isIsolatedHomologationRuntime(env);
  const expectedToken = env[STAGING_API_ACCESS_TOKEN_ENV];
  const validIdentity = matchesRailwayIdentity(env, ISOLATED_HOMOLOGATION_IDENTITY) && env.NODE_ENV === "production";
  const configured = Boolean(expectedToken && Buffer.byteLength(expectedToken, "utf8") >= TOKEN_MIN_BYTES);

  return (req, res, next) => {
    if (!protectedRuntime) {
      next();
      return;
    }

    // The Railway health probe receives no application data and remains available.
    if (req.method === "GET" && req.path === "/health") {
      next();
      return;
    }

    if (!validIdentity || !configured) {
      res.setHeader("Cache-Control", "no-store");
      res.status(503).json({ success: false, code: "STAGING_API_ACCESS_UNAVAILABLE" });
      return;
    }

    if (!tokenMatches(req.header(STAGING_API_ACCESS_HEADER), expectedToken ?? "")) {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("WWW-Authenticate", "Bearer realm=\"l4ckos-staging-api\"");
      res.status(401).json({ success: false, code: "STAGING_API_ACCESS_REQUIRED" });
      return;
    }

    next();
  };
}
