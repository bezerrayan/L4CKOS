import { PRODUCTION_RAILWAY_IDENTITY } from "../_core/productionFinancialPolicy";

const MAX_OWNER_PIX_WINDOW_MS = 15 * 60 * 1000;
const MYSQL_SIGNED_INT_MAX = 2_147_483_647;

export type OwnerPixTestActor = { id: number; openId: string; role: string };
export type OwnerPixTestAuthorization = { attemptId: string; maxAmountCents: number; expiresAtMs: number };
export type OwnerPixTestReadAuthorization = { attemptId: string };
type RuntimeEnvironment = Record<string, string | undefined>;

/** Read-only recovery for the configured owner attempt after the temporary create window closes. */
export function resolveOwnerPixTestReadAuthorization(
  actor: OwnerPixTestActor | null | undefined,
  env: RuntimeEnvironment = process.env,
): OwnerPixTestReadAuthorization | null {
  if (env.NODE_ENV !== "production" || env.APP_ENV !== "production" ||
      env.RAILWAY_PROJECT_ID !== PRODUCTION_RAILWAY_IDENTITY.projectId ||
      env.RAILWAY_ENVIRONMENT_ID !== PRODUCTION_RAILWAY_IDENTITY.environmentId ||
      env.RAILWAY_SERVICE_ID !== PRODUCTION_RAILWAY_IDENTITY.serviceId) return null;
  if (env.PUBLIC_SITE_MODE !== "coming-soon" || env.PUBLIC_CHECKOUT_ENABLED !== "false" ||
      env.STOCK_CHECKOUT_ENABLED !== "false" || env.STOCK_RUNTIME_ENABLED !== "true") return null;

  const configuredOwner = env.OWNER_OPEN_ID?.trim();
  if (!actor || !Number.isSafeInteger(actor.id) || actor.id <= 0 || actor.role !== "admin" ||
      !configuredOwner || actor.openId !== configuredOwner) return null;

  const attemptId = env.OWNER_PIX_TEST_ATTEMPT_ID ?? "";
  if (!/^[A-Za-z0-9_-]{32,120}$/.test(attemptId)) return null;
  return { attemptId };
}

/** A temporary, single-attempt admission. It never changes the public checkout policy. */
export function resolveOwnerPixTestAuthorization(
  actor: OwnerPixTestActor | null | undefined,
  env: RuntimeEnvironment = process.env,
  nowMs = Date.now(),
): OwnerPixTestAuthorization | null {
  if (env.OWNER_PIX_TEST_ENABLED !== "true") return null;
  if (env.NODE_ENV !== "production" || env.APP_ENV !== "production" ||
      env.RAILWAY_PROJECT_ID !== PRODUCTION_RAILWAY_IDENTITY.projectId ||
      env.RAILWAY_ENVIRONMENT_ID !== PRODUCTION_RAILWAY_IDENTITY.environmentId ||
      env.RAILWAY_SERVICE_ID !== PRODUCTION_RAILWAY_IDENTITY.serviceId) return null;
  if (env.PUBLIC_SITE_MODE !== "coming-soon" || env.PUBLIC_CHECKOUT_ENABLED !== "false" ||
      env.STOCK_CHECKOUT_ENABLED !== "false" || env.STOCK_RUNTIME_ENABLED !== "true") return null;

  const configuredOwner = env.OWNER_OPEN_ID?.trim();
  if (!actor || !Number.isSafeInteger(actor.id) || actor.id <= 0 || actor.role !== "admin" ||
      !configuredOwner || actor.openId !== configuredOwner) return null;

  const attemptId = env.OWNER_PIX_TEST_ATTEMPT_ID ?? "";
  if (!/^[A-Za-z0-9_-]{32,120}$/.test(attemptId)) return null;
  const expiry = env.OWNER_PIX_TEST_EXPIRES_AT ?? "";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(expiry)) return null;
  const expiresAtMs = Date.parse(expiry);
  if (!Number.isFinite(expiresAtMs)) return null;
  const canonicalExpiry = new Date(expiresAtMs).toISOString();
  if ((canonicalExpiry !== expiry && canonicalExpiry.replace(/\.000Z$/, "Z") !== expiry) ||
      expiresAtMs <= nowMs || expiresAtMs > nowMs + MAX_OWNER_PIX_WINDOW_MS) return null;

  const rawMaximum = env.OWNER_PIX_TEST_MAX_AMOUNT_CENTS ?? "";
  if (!/^\d{1,10}$/.test(rawMaximum)) return null;
  const maxAmountCents = Number(rawMaximum);
  if (!Number.isSafeInteger(maxAmountCents) || maxAmountCents <= 0 || maxAmountCents > MYSQL_SIGNED_INT_MAX) return null;

  return { attemptId, maxAmountCents, expiresAtMs };
}
