import type { Request, Response } from "express";
import { buildApiErrorResponse } from "./appErrors";

export const API_NOT_FOUND_RESPONSE = {
  error: "ROUTE_NOT_FOUND",
  message: "Route not found",
};

export function sendApiError(res: Response, status: number, code: string, message: string) {
  res.status(status).type("application/json").json(buildApiErrorResponse({ status, code, message }));
}

export function sendApiRouteNotFound(res: Response) {
  res.status(404).type("application/json").json(API_NOT_FOUND_RESPONSE);
}

export function methodNotAllowed(allowedMethods: string[]) {
  return (_req: Request, res: Response) => {
    res.setHeader("Allow", allowedMethods.join(", "));
    sendApiError(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed");
  };
}

function normalizePathname(input: string) {
  const pathname = (input || "").split("?")[0] || "/";
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

export function getAllowedMethodsForApiPath(pathname: string) {
  const path = normalizePathname(pathname);
  if (path === "/api" || path === "/api/csrf" || path === "/api/image-proxy" || path === "/api/oauth/login" || path === "/api/oauth/callback" || path === "/api/email/unsubscribe") {
    return ["GET"];
  }
  if (path === "/api/cep/:cep" || /^\/api\/cep\/[^/]+$/.test(path)) {
    return ["GET"];
  }
  if (
    path === "/api/payments/create-customer" ||
    path === "/api/payments/create-checkout" ||
    path === "/api/webhooks/asaas" ||
    path === "/api/shipping/quote" ||
    path === "/api/waitlist" ||
    path === "/api/contact" ||
    path === "/api/contact/test" ||
    path === "/api/upload" ||
    path === "/api/review-images"
  ) {
    return ["POST"];
  }
  if (path === "/api/trpc" || path.startsWith("/api/trpc/")) {
    return ["GET", "POST"];
  }
  return null;
}
