import type { RequestHandler } from "express";
import { isApprovedStagingIdentity } from "./railwayEnvironment";

type RuntimeEnvironment = Record<string, string | undefined>;

export function isStagingMaintenanceEnabled(
  env: RuntimeEnvironment = process.env,
): boolean {
  return (
    env.STAGING_MAINTENANCE_MODE === "true" &&
    env.NODE_ENV === "production" &&
    isApprovedStagingIdentity(env)
  );
}

export function createStagingMaintenanceMiddleware(
  env: RuntimeEnvironment = process.env,
): RequestHandler {
  const enabled = isStagingMaintenanceEnabled(env);

  return (_req, res, next) => {
    if (!enabled) {
      next();
      return;
    }

    res
      .status(503)
      .set({
        "Cache-Control": "no-store",
        "Retry-After": "120",
        "X-Content-Type-Options": "nosniff",
      })
      .json({
        success: false,
        code: "STAGING_MAINTENANCE",
        message: "Ambiente de homologação temporariamente indisponível.",
      });
  };
}
