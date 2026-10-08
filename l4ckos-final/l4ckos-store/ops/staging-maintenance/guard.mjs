const STAGING = Object.freeze({
  RAILWAY_PROJECT_ID: "2bb90c8e-eb65-43ee-826b-f93750f0499c",
  RAILWAY_ENVIRONMENT_ID: "15545eee-bc02-4b70-afc4-19a5db9e6f46",
  RAILWAY_SERVICE_ID: "9f1c7705-f2f9-48cf-b957-8f63a6bba4db",
  NODE_ENV: "production",
});

export function assertStagingIdentity(env) {
  for (const [key, expected] of Object.entries(STAGING)) {
    if (env[key] !== expected) {
      throw new Error("STAGING_IDENTITY_MISMATCH");
    }
  }
}
