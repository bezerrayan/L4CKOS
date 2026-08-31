export type AppEnvironment = "local" | "test" | "staging" | "production";

function read(name: string) {
  return String(process.env[name] ?? "").trim();
}

export function getAppEnvironment(): AppEnvironment {
  const explicit = read("APP_ENV").toLowerCase();
  if (["local", "test", "staging", "production"].includes(explicit)) {
    return explicit as AppEnvironment;
  }

  // Compatibility during the transition to APP_ENV. Deploy templates must set
  // APP_ENV explicitly; validation rejects an absent value in staging/prod.
  const legacy = read("DEPLOY_ENV").toLowerCase();
  if (["local", "staging", "production"].includes(legacy)) {
    return legacy as AppEnvironment;
  }
  if (process.env.NODE_ENV === "test") return "test";
  if (read("VERCEL_ENV").toLowerCase() === "preview") return "staging";
  if (/^(staging|stage|hml|homolog|homologation)$/i.test(read("RAILWAY_ENVIRONMENT_NAME"))) return "staging";
  return process.env.NODE_ENV === "production" ? "production" : "local";
}

export function getBuildInfo() {
  return {
    version: read("RELEASE_VERSION") || read("BUILD_VERSION") || read("npm_package_version") || "unknown",
    commit: read("GIT_COMMIT_SHA") || read("VERCEL_GIT_COMMIT_SHA") || read("RAILWAY_GIT_COMMIT_SHA") || "unknown",
    deployedAt: read("DEPLOYED_AT") || read("BUILD_TIME") || "unknown",
  };
}

export function getRuntimeMetadata() {
  return {
    environment: getAppEnvironment(),
    ...getBuildInfo(),
  };
}
