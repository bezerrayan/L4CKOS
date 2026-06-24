import rateLimit from "express-rate-limit";
import type { Express } from "express";

function isPrivateProxyAddress(ip: string) {
  const value = String(ip || "").trim().toLowerCase();
  if (!value) return false;
  if (value === "::1" || value === "127.0.0.1" || value === "::ffff:127.0.0.1") return true;
  if (value.startsWith("10.") || value.startsWith("192.168.")) return true;

  const match172 = value.match(/^172\.(\d{1,3})\./);
  if (match172) {
    const second = Number(match172[1]);
    if (second >= 16 && second <= 31) return true;
  }

  return value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80:");
}

export function configureTrustProxy(app: Express, isProduction: boolean) {
  if (!isProduction) return;

  // Trust only the immediate private/loopback platform proxy. This avoids blindly
  // trusting arbitrary X-Forwarded-For values sent directly by clients.
  app.set("trust proxy", (ip: string) => isPrivateProxyAddress(ip));
}

export function createRateLimiter(options: {
  windowMs: number;
  max: number;
  message?: unknown;
  skipSuccessfulRequests?: boolean;
}) {
  // Current adapter is memory-backed. It is acceptable for development and
  // single-instance staging, but it is not horizontally scalable. A shared-store
  // adapter can be added behind this factory in a later Redis-specific change.
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: options.skipSuccessfulRequests,
    message: options.message,
  });
}

export const RATE_LIMIT_SHARED_STORE_ENV = "REDIS_URL";
