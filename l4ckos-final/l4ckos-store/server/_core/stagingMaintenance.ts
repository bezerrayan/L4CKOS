import type { RequestHandler } from "express";

type RuntimeEnvironment = Record<string, string | undefined>;

const STAGING = Object.freeze({
  projectId: "2bb90c8e-eb65-43ee-826b-f93750f0499c",
  environmentId: "15545eee-bc02-4b70-afc4-19a5db9e6f46",
  serviceId: "9f1c7705-f2f9-48cf-b957-8f63a6bba4db",
});

export function isStagingMaintenanceEnabled(
  env: RuntimeEnvironment = process.env,
): boolean {
  return (
    env.STAGING_MAINTENANCE_MODE === "true" &&
    env.NODE_ENV === "production" &&
    env.RAILWAY_PROJECT_ID === STAGING.projectId &&
    env.RAILWAY_ENVIRONMENT_ID === STAGING.environmentId &&
    env.RAILWAY_SERVICE_ID === STAGING.serviceId
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
