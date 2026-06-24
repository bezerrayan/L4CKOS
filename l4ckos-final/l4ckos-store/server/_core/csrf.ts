import type { NextFunction, Request, Response } from "express";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { COOKIE_NAME } from "@shared/const";
import { parse as parseCookieHeader } from "cookie";
import { ENV } from "./env";
import { sendApiError } from "./httpApi";
import { securityLog } from "./security";

export const CSRF_COOKIE_NAME = "l4ckos_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function getSecret() {
  const secret = ENV.cookieSecret?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET is required for CSRF protection");
  }
  return secret;
}

function hmac(value: string) {
  return createHmac("sha256", getSecret()).update(value, "utf8").digest("base64url");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createCsrfToken() {
  const nonce = randomBytes(32).toString("base64url");
  return `${nonce}.${hmac(nonce)}`;
}

export function isValidCsrfToken(token: string | undefined | null) {
  if (!token || typeof token !== "string") return false;
  const [nonce, mac, extra] = token.split(".");
  if (!nonce || !mac || extra !== undefined) return false;
  return safeEqual(mac, hmac(nonce));
}

function getCookies(req: Request) {
  return parseCookieHeader(req.headers.cookie ?? "");
}

function getHeaderValue(req: Request, name: string) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

export function isWebhookPath(path: string) {
  return path === "/api/webhooks/asaas" || path === "/webhook/asaas";
}

export function shouldRequireCsrf(req: Request) {
  if (!MUTATING_METHODS.has(req.method)) return false;
  if (!req.path.startsWith("/api/")) return false;
  if (isWebhookPath(req.path)) return false;

  const cookies = getCookies(req);
  const hasSessionCookie = Boolean(cookies[COOKIE_NAME]);

  return hasSessionCookie;
}

export function validateCsrfRequest(req: Request) {
  const cookies = getCookies(req);
  const cookieToken = cookies[CSRF_COOKIE_NAME];
  const headerToken = getHeaderValue(req, CSRF_HEADER_NAME);

  if (!isValidCsrfToken(cookieToken) || !isValidCsrfToken(headerToken)) return false;
  return safeEqual(String(cookieToken), String(headerToken));
}

export function csrfMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!shouldRequireCsrf(req)) {
    next();
    return;
  }

  if (validateCsrfRequest(req)) {
    next();
    return;
  }

  securityLog("warn", "csrf.token_check_failed", {
    path: req.path,
    requestIp: req.ip || "unknown",
  });
  sendApiError(res, 403, "CSRF_TOKEN_INVALID", "CSRF token missing or invalid");
}
