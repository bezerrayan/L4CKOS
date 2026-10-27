import type { NextFunction, Request, Response } from "express";
import { buildApiErrorResponse, createAppError } from "./appErrors";

export const PUBLIC_CHECKOUT_DISABLED_CODE = "PUBLIC_CHECKOUT_DISABLED";
export const PUBLIC_CHECKOUT_DISABLED_MESSAGE = "O checkout está temporariamente indisponível para novas compras.";

type Environment = Record<string, string | undefined>;

/** Checkout is fail-closed everywhere unless both server-side flags opt in. */
export function isPublicCheckoutEnabled(env: Environment = process.env): boolean {
  const siteMode = String(env.PUBLIC_SITE_MODE ?? "").trim().toLowerCase();
  const checkoutEnabled = String(env.PUBLIC_CHECKOUT_ENABLED ?? "").trim().toLowerCase();
  return siteMode === "store" && checkoutEnabled === "true";
}
export function assertPublicCheckoutEnabled(env: Environment = process.env): void {
  if (isPublicCheckoutEnabled(env)) return;

  throw createAppError({
    trpcCode: "FORBIDDEN",
    appCode: PUBLIC_CHECKOUT_DISABLED_CODE,
    message: PUBLIC_CHECKOUT_DISABLED_MESSAGE,
  });
}

/** Place before auth/handlers on endpoints that can create provider state. */
export function requirePublicCheckoutEnabled(_req: Request, res: Response, next: NextFunction): void {
  if (isPublicCheckoutEnabled()) {
    next();
    return;
  }

  res.status(403).json(buildApiErrorResponse({
    status: 403,
    code: PUBLIC_CHECKOUT_DISABLED_CODE,
    message: PUBLIC_CHECKOUT_DISABLED_MESSAGE,
  }));
}
