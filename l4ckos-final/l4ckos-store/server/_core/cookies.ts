import type { CookieOptions, Request } from "express";
import { ENV } from "./env";

function isSecureRequest(req: Request) {
  if (req.protocol === "https") return true;

  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;

  const protoList = Array.isArray(forwardedProto)
    ? forwardedProto
    : forwardedProto.split(",");

  return protoList.some(proto => proto.trim().toLowerCase() === "https");
}

export function getSessionCookieOptions(
  req: Request
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  const configuredSecure = String(process.env.COOKIE_SECURE ?? "").trim().toLowerCase();
  const secure = configuredSecure ? configuredSecure === "true" : ENV.cookieSecure || isSecureRequest(req);
  const domain = String(process.env.SESSION_COOKIE_DOMAIN ?? ENV.sessionCookieDomain).trim();
  const configuredSameSite = String(process.env.COOKIE_SAME_SITE ?? ENV.cookieSameSite).trim().toLowerCase();
  const sameSite = (["lax", "strict", "none"].includes(configuredSameSite) ? configuredSameSite : "lax") as "lax" | "strict" | "none";

  return {
    ...(domain ? { domain } : {}),
    httpOnly: true,
    path: "/",
    sameSite,
    secure,
  };
}

export function getSessionCookieName() {
  return String(process.env.SESSION_COOKIE_NAME ?? ENV.sessionCookieName).trim() || "app_session_id";
}
