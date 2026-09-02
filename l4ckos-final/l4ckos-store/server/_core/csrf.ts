import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { getSessionCookieName, getSessionCookieOptions } from "./cookies";
import { securityLog } from "./security";

export const CSRF_COOKIE_NAME = "l4ckos_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function readSecret() {
  const secret = String(process.env.JWT_SECRET ?? "").trim();
  if (secret.length < 32) throw new Error("JWT_SECRET is required for CSRF protection");
  return secret;
}

function sign(nonce: string) {
  return createHmac("sha256", readSecret()).update(nonce, "utf8").digest("base64url");
}

function safelyEquals(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readCookies(req: Request) {
  return Object.fromEntries(
    String(req.headers.cookie ?? "")
      .split(";")
      .map(value => value.trim())
      .filter(Boolean)
      .map(value => {
        const separator = value.indexOf("=");
        return separator < 0 ? [value, ""] : [value.slice(0, separator), decodeURIComponent(value.slice(separator + 1))];
      }),
  );
}

function header(req: Request, name: string) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

export function createCsrfToken() {
  const nonce = randomBytes(32).toString("base64url");
  return `${nonce}.${sign(nonce)}`;
}

export function isValidCsrfToken(token: string | undefined | null) {
  if (!token || typeof token !== "string") return false;
  const [nonce, mac, extra] = token.split(".");
  return Boolean(nonce && mac && extra === undefined && safelyEquals(mac, sign(nonce)));
}

export function isAsaasWebhookPath(path: string) {
  return path === "/api/webhooks/asaas" || path === "/webhook/asaas";
}

export function shouldRequireCsrf(req: Request) {
  if (!MUTATING_METHODS.has(req.method) || !req.path.startsWith("/api/") || isAsaasWebhookPath(req.path)) return false;
  return Boolean(readCookies(req)[getSessionCookieName()]);
}

export const csrfEndpoint: RequestHandler = (req, res) => {
  const token = createCsrfToken();
  res.cookie(CSRF_COOKIE_NAME, token, {
    ...getSessionCookieOptions(req),
    httpOnly: false,
    maxAge: Number(process.env.SESSION_TTL_HOURS || 12) * 60 * 60 * 1000,
  });
  res.setHeader("Cache-Control", "no-store, private");
  res.status(200).json({ csrfToken: token });
};

export function csrfMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!shouldRequireCsrf(req)) return next();
  const cookies = readCookies(req);
  const cookieToken = cookies[CSRF_COOKIE_NAME];
  const headerToken = header(req, CSRF_HEADER_NAME);
  if (isValidCsrfToken(cookieToken) && isValidCsrfToken(headerToken) && safelyEquals(String(cookieToken), String(headerToken))) return next();
  securityLog("warn", "csrf.token_check_failed", { path: req.path, requestIp: req.ip || "unknown" });
  res.status(403).json({ error: "CSRF token missing or invalid", code: "CSRF_TOKEN_INVALID" });
}
