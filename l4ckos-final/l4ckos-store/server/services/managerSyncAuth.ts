import { timingSafeEqual } from "node:crypto";

export const MANAGER_SYNC_STAGING_IDENTITY = Object.freeze({
  system: "l4ckos-store" as const,
  environment: "staging" as const,
  projectId: "2bb90c8e-eb65-43ee-826b-f93750f0499c",
  environmentId: "15545eee-bc02-4b70-afc4-19a5db9e6f46",
  serviceId: "9f1c7705-f2f9-48cf-b957-8f63a6bba4db",
});

export function resolveManagerSyncConfig(env: NodeJS.ProcessEnv = process.env) {
  const token = env.MANAGER_SYNC_TOKEN?.trim();
  const environment = env.MANAGER_SYNC_ENVIRONMENT?.trim();
  const identity = {
    system: "l4ckos-store" as const,
    environment: "staging" as const,
    projectId: env.MANAGER_SYNC_PROJECT_ID?.trim() ?? "",
    environmentId: env.MANAGER_SYNC_ENVIRONMENT_ID?.trim() ?? "",
    serviceId: env.MANAGER_SYNC_SERVICE_ID?.trim() ?? "",
  };
  if (
    environment !== "staging" ||
    identity.projectId !== MANAGER_SYNC_STAGING_IDENTITY.projectId ||
    identity.environmentId !== MANAGER_SYNC_STAGING_IDENTITY.environmentId ||
    identity.serviceId !== MANAGER_SYNC_STAGING_IDENTITY.serviceId
  ) return null;
  if (!token || !/^[a-f0-9]{64}$/i.test(token)) return null;
  return { token, identity };
}

export function isManagerSyncAuthorizationValid(authorization: string | undefined, expectedToken: string) {
  const match = /^Bearer\s+([a-f0-9]{64})$/i.exec(authorization ?? "");
  if (!match) return false;
  const supplied = Buffer.from(match[1]!, "hex");
  const expected = Buffer.from(expectedToken, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
