export type RailwayEnvironmentIdentity = {
  projectId: string;
  environmentId: string;
  serviceId: string;
};

export const LEGACY_STAGING_IDENTITY: RailwayEnvironmentIdentity = Object.freeze({
  projectId: "2bb90c8e-eb65-43ee-826b-f93750f0499c",
  environmentId: "15545eee-bc02-4b70-afc4-19a5db9e6f46",
  serviceId: "9f1c7705-f2f9-48cf-b957-8f63a6bba4db",
});

export const ISOLATED_HOMOLOGATION_IDENTITY: RailwayEnvironmentIdentity = Object.freeze({
  projectId: "66faf690-a068-40d1-b85c-cb5d8595560a",
  environmentId: "5335340d-311c-47e9-9713-6e5a86969c88",
  serviceId: "d66762a4-422a-4656-94a1-502215a27aa2",
});

export type RailwayEnvironment = Record<string, string | undefined>;

export function matchesRailwayIdentity(
  env: RailwayEnvironment,
  identity: RailwayEnvironmentIdentity,
): boolean {
  return env.RAILWAY_PROJECT_ID === identity.projectId &&
    env.RAILWAY_ENVIRONMENT_ID === identity.environmentId &&
    env.RAILWAY_SERVICE_ID === identity.serviceId;
}

export function isApprovedStagingIdentity(env: RailwayEnvironment): boolean {
  return matchesRailwayIdentity(env, LEGACY_STAGING_IDENTITY) ||
    matchesRailwayIdentity(env, ISOLATED_HOMOLOGATION_IDENTITY);
}

export function isIsolatedHomologationIdentity(env: RailwayEnvironment): boolean {
  return matchesRailwayIdentity(env, ISOLATED_HOMOLOGATION_IDENTITY);
}

export function hasIsolatedHomologationIdentityMarker(env: RailwayEnvironment): boolean {
  return env.RAILWAY_PROJECT_ID === ISOLATED_HOMOLOGATION_IDENTITY.projectId ||
    env.RAILWAY_ENVIRONMENT_ID === ISOLATED_HOMOLOGATION_IDENTITY.environmentId ||
    env.RAILWAY_SERVICE_ID === ISOLATED_HOMOLOGATION_IDENTITY.serviceId;
}

export function hasApprovedStagingIdentityMarker(env: RailwayEnvironment): boolean {
  return hasIsolatedHomologationIdentityMarker(env) ||
    env.RAILWAY_PROJECT_ID === LEGACY_STAGING_IDENTITY.projectId ||
    env.RAILWAY_ENVIRONMENT_ID === LEGACY_STAGING_IDENTITY.environmentId ||
    env.RAILWAY_SERVICE_ID === LEGACY_STAGING_IDENTITY.serviceId;
}
