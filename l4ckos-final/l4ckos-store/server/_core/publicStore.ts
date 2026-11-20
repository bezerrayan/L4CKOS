import type { NextFunction, Request, Response } from "express";
import { buildApiErrorResponse, createAppError } from "./appErrors";
import { hasIsolatedHomologationIdentityMarker } from "./railwayEnvironment";
import { resolveFinancialPhasePolicy } from "./financialPhasePolicy";
import { assertStagingSyntheticBuyer } from "../payments/syntheticBuyerGate";

export const PUBLIC_SITE_MODE_ENV = "PUBLIC_SITE_MODE";
export const PUBLIC_STORE_CLOSED_CODE = "PUBLIC_STORE_CLOSED";
export const PUBLIC_STORE_CLOSED_MESSAGE = "A loja está temporariamente fechada para novos pedidos.";
export const PUBLIC_CHECKOUT_DISABLED_CODE = "PUBLIC_CHECKOUT_DISABLED";
export const PUBLIC_CHECKOUT_DISABLED_MESSAGE = "O checkout está temporariamente indisponível para homologação.";

export { isPublicCheckoutEnabled, isPublicStoreOpen, resolvePublicSiteMode } from "./publicStorePolicy";
export type { PublicSiteMode } from "./publicStorePolicy";
import { isPublicCheckoutEnabled, isPublicStoreOpen } from "./publicStorePolicy";
type Environment = Record<string, string | undefined>;

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

/**
 * Preserves public checkout behavior outside the isolated rehearsal service.
 * In that service only the authenticated, allowlisted synthetic buyer can use
 * STOCK checkout during an explicitly approved sandbox checkout/recovery phase.
 */
export function assertPublicOrSyntheticSandboxCheckoutEnabled(
  authenticatedUserId: number | undefined,
  env: Environment = process.env,
): void {
  if (!hasIsolatedHomologationIdentityMarker(env)) {
    assertPublicCheckoutEnabled(env);
    return;
  }

  const policy = resolveFinancialPhasePolicy(env);
  if (policy.allowed && policy.checkoutEnabled &&
      env.PUBLIC_SITE_MODE?.trim().toLowerCase() === "coming-soon" &&
      env.PUBLIC_CHECKOUT_ENABLED === "false") {
    try {
      assertStagingSyntheticBuyer(authenticatedUserId, env as NodeJS.ProcessEnv);
      return;
    } catch {
      // Keep the public error surface generic; identity never comes from input.
    }
  }
  if (!isPublicStoreOpen(env)) throw new PublicStoreClosedError();
  throw new PublicCheckoutDisabledError();
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
