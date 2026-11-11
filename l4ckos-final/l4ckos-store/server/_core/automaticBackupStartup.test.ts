import { describe, expect, it } from "vitest";
import { ISOLATED_HOMOLOGATION_IDENTITY, LEGACY_STAGING_IDENTITY } from "./railwayEnvironment";
import { shouldScheduleAutomaticBackup } from "./automaticBackupStartup";

describe("automatic JSON backup startup policy", () => {
  const railwayEnv = (identity: typeof ISOLATED_HOMOLOGATION_IDENTITY) => ({
    RAILWAY_PROJECT_ID: identity.projectId,
    RAILWAY_ENVIRONMENT_ID: identity.environmentId,
    RAILWAY_SERVICE_ID: identity.serviceId,
  });

  it("uses the approved encrypted Gate 4 recovery point in isolated homologation", () => {
    expect(shouldScheduleAutomaticBackup({ ...railwayEnv(ISOLATED_HOMOLOGATION_IDENTITY), APP_ENV: "staging", NODE_ENV: "production" })).toBe(false);
  });

  it("preserves the existing production and legacy-staging behavior", () => {
    expect(shouldScheduleAutomaticBackup({ NODE_ENV: "production", APP_ENV: "production" })).toBe(true);
    expect(shouldScheduleAutomaticBackup({ ...railwayEnv(LEGACY_STAGING_IDENTITY), NODE_ENV: "production", APP_ENV: "staging" })).toBe(true);
  });

  it("does not treat an incomplete or unknown identity as the isolated project", () => {
    expect(shouldScheduleAutomaticBackup({
      APP_ENV: "staging",
      NODE_ENV: "production",
      RAILWAY_PROJECT_ID: ISOLATED_HOMOLOGATION_IDENTITY.projectId,
    })).toBe(true);
  });
});
