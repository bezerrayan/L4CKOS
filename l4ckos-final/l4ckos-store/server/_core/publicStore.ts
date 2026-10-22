import type { NextFunction, Request, Response } from "express";
import { buildApiErrorResponse, createAppError } from "./appErrors";

export const PUBLIC_SITE_MODE_ENV = "PUBLIC_SITE_MODE";
export const PUBLIC_STORE_CLOSED_CODE = "PUBLIC_STORE_CLOSED";
export const PUBLIC_STORE_CLOSED_MESSAGE = "A loja está temporariamente fechada para novos pedidos.";
export const PUBLIC_CHECKOUT_DISABLED_CODE = "PUBLIC_CHECKOUT_DISABLED";
export const PUBLIC_CHECKOUT_DISABLED_MESSAGE = "O checkout está temporariamente indisponível para homologação.";

export type PublicSiteMode = "store" | "coming-soon";
type Environment = Record<string, string | undefined>;

/** The backend is authoritative; the VITE_* client flags never grant commerce access. */
export function resolvePublicSiteMode(env: Environment = process.env): PublicSiteMode {
  const configured = String(env[PUBLIC_SITE_MODE_ENV] ?? "").trim().toLowerCase();

  if (!configured) return "coming-soon";

  if (configured === "store") return "store";
  if (configured === "coming-soon") return "coming-soon";

  // Unknown configuration must never open sales.
  return "coming-soon";
}

export function isPublicStoreOpen(env: Environment = process.env): boolean {
  return resolvePublicSiteMode(env) === "store";
}

/** Checkout is a separate capability from storefront visibility. Production-like
 * deployments must opt in explicitly; local development and tests keep their
 * existing open-store behavior unless the flag is explicitly disabled. */
export function isPublicCheckoutEnabled(env: Environment = process.env): boolean {
  if (!isPublicStoreOpen(env)) return false;
  const configured = String(env.PUBLIC_CHECKOUT_ENABLED ?? "").trim().toLowerCase();
  if (configured === "true") return true;
  if (configured === "false" || configured) return false;
  if (String(env.APP_ENV ?? "").trim().toLowerCase() === "staging" ||
      String(env.EMAIL_ENV ?? "").trim().toLowerCase() === "staging") return false;
  return env.NODE_ENV !== "production";
}

export class PublicStoreClosedError extends Error {
  readonly code = PUBLIC_STORE_CLOSED_CODE;

  constructor() {
    super(PUBLIC_STORE_CLOSED_MESSAGE);
    this.name = "PublicStoreClosedError";
  }
}

export function assertPublicStoreOpen(env: Environment = process.env): void {
  if (!isPublicStoreOpen(env)) throw new PublicStoreClosedError();
}

export class PublicCheckoutDisabledError extends Error {
  readonly code = PUBLIC_CHECKOUT_DISABLED_CODE;

  constructor() {
    super(PUBLIC_CHECKOUT_DISABLED_MESSAGE);
    this.name = "PublicCheckoutDisabledError";
  }
}

export function assertPublicCheckoutEnabled(env: Environment = process.env): void {
  assertPublicStoreOpen(env);
  if (!isPublicCheckoutEnabled(env)) throw new PublicCheckoutDisabledError();
}

export function publicStoreClosedTrpcError() {
  return createAppError({
    trpcCode: "FORBIDDEN",
    appCode: PUBLIC_STORE_CLOSED_CODE,
    message: PUBLIC_STORE_CLOSED_MESSAGE,
  });
}

export function publicCheckoutDisabledTrpcError() {
  return createAppError({
    trpcCode: "FORBIDDEN",
    appCode: PUBLIC_CHECKOUT_DISABLED_CODE,
    message: PUBLIC_CHECKOUT_DISABLED_MESSAGE,
  });
}

/** Express gate for public endpoints that create provider-side or purchase records. */
export function requirePublicStoreOpen(_req: Request, res: Response, next: NextFunction): void {
  if (!isPublicStoreOpen()) {
    res.status(403).type("application/json").json(
      buildApiErrorResponse({
        status: 403,
        code: PUBLIC_STORE_CLOSED_CODE,
        message: PUBLIC_STORE_CLOSED_MESSAGE,
      }),
    );
    return;
  }

  next();
}

/** Independent server gate for checkout and provider-side customer creation. */
export function requirePublicCheckoutEnabled(_req: Request, res: Response, next: NextFunction): void {
  if (!isPublicCheckoutEnabled()) {
    const closed = !isPublicStoreOpen();
    res.status(403).type("application/json").json(
      buildApiErrorResponse({
        status: 403,
        code: closed ? PUBLIC_STORE_CLOSED_CODE : PUBLIC_CHECKOUT_DISABLED_CODE,
        message: closed ? PUBLIC_STORE_CLOSED_MESSAGE : PUBLIC_CHECKOUT_DISABLED_MESSAGE,
      }),
    );
    return;
  }

  next();
}
