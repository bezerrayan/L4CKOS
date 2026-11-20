import {
  hasIsolatedHomologationIdentityMarker,
  isIsolatedHomologationIdentity,
} from "../_core/railwayEnvironment";
import { TRPCError } from "@trpc/server";

export const STAGING_SYNTHETIC_BUYER_GATE_ENABLED = "STAGING_SYNTHETIC_BUYER_GATE_ENABLED";
export const STAGING_SYNTHETIC_BUYER_IDS = "STAGING_SYNTHETIC_BUYER_IDS";

export class SyntheticBuyerGateError extends Error {
  constructor(
    readonly code: "STAGING_SYNTHETIC_BUYER_GATE_MISCONFIGURED" | "STAGING_SYNTHETIC_BUYER_AUTH_REQUIRED" | "STAGING_SYNTHETIC_BUYER_NOT_ALLOWED",
  ) {
    super(code);
    this.name = "SyntheticBuyerGateError";
  }
}

function configuredBuyerIds(env: NodeJS.ProcessEnv): Set<number> | null {
  if (!hasIsolatedHomologationIdentityMarker(env)) return null;
  if (!isIsolatedHomologationIdentity(env) || env.NODE_ENV !== "production" ||
      env[STAGING_SYNTHETIC_BUYER_GATE_ENABLED] !== "true") {
    throw new SyntheticBuyerGateError("STAGING_SYNTHETIC_BUYER_GATE_MISCONFIGURED");
  }
  const raw = env[STAGING_SYNTHETIC_BUYER_IDS]?.trim();
  if (!raw) throw new SyntheticBuyerGateError("STAGING_SYNTHETIC_BUYER_GATE_MISCONFIGURED");
  const values = raw.split(",").map(value => value.trim());
  if (values.length > 32 || values.some(value => !/^[1-9]\d{0,9}$/.test(value))) {
    throw new SyntheticBuyerGateError("STAGING_SYNTHETIC_BUYER_GATE_MISCONFIGURED");
  }
  const ids = values.map(Number);
  if (new Set(ids).size !== ids.length || ids.some(id => !Number.isSafeInteger(id))) {
    throw new SyntheticBuyerGateError("STAGING_SYNTHETIC_BUYER_GATE_MISCONFIGURED");
  }
  return new Set(ids);
}

/**
 * Restricts financial homologation only on the exact isolated Railway runtime.
 * Authenticated user IDs must come from server auth context, never request data.
 * Outside that exact runtime the function is a no-op, so staging policy cannot
 * change production behavior.
 */
export function assertStagingSyntheticBuyer(
  authenticatedUserId: number | undefined,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const allowedIds = configuredBuyerIds(env);
  if (!allowedIds) return;
  if (!Number.isSafeInteger(authenticatedUserId) || Number(authenticatedUserId) <= 0) {
    throw new SyntheticBuyerGateError("STAGING_SYNTHETIC_BUYER_AUTH_REQUIRED");
  }
  if (!allowedIds.has(Number(authenticatedUserId))) {
    throw new SyntheticBuyerGateError("STAGING_SYNTHETIC_BUYER_NOT_ALLOWED");
  }
}

export function assertStagingSyntheticBuyerTrpc(authenticatedUserId: number | undefined): void {
  try {
    assertStagingSyntheticBuyer(authenticatedUserId);
  } catch (error) {
    if (!(error instanceof SyntheticBuyerGateError)) throw error;
    const code = error.code === "STAGING_SYNTHETIC_BUYER_AUTH_REQUIRED" ? "UNAUTHORIZED" :
      error.code === "STAGING_SYNTHETIC_BUYER_NOT_ALLOWED" ? "FORBIDDEN" : "SERVICE_UNAVAILABLE";
    throw new TRPCError({ code, message: error.code });
  }
}

export function syntheticBuyerGateHttpFailure(error: unknown): { status: number; code: string } | null {
  if (!(error instanceof SyntheticBuyerGateError)) return null;
  return {
    status: error.code === "STAGING_SYNTHETIC_BUYER_AUTH_REQUIRED" ? 401 :
      error.code === "STAGING_SYNTHETIC_BUYER_NOT_ALLOWED" ? 403 : 503,
    code: error.code,
  };
}
