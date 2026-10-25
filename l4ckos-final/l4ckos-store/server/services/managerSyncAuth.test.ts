import { describe, expect, it } from "vitest";
import { isManagerSyncAuthorizationValid, resolveManagerSyncConfig } from "./managerSyncAuth";

const expected = {
  MANAGER_SYNC_TOKEN: "ab".repeat(32),
  MANAGER_SYNC_ENVIRONMENT: "staging",
  MANAGER_SYNC_PROJECT_ID: "2bb90c8e-eb65-43ee-826b-f93750f0499c",
  MANAGER_SYNC_ENVIRONMENT_ID: "15545eee-bc02-4b70-afc4-19a5db9e6f46",
  MANAGER_SYNC_SERVICE_ID: "9f1c7705-f2f9-48cf-b957-8f63a6bba4db",
};

describe("Manager sync source authorization", () => {
  it("requires the exact staging identity and a 32-byte token", () => {
    expect(resolveManagerSyncConfig(expected)?.identity.environment).toBe("staging");
    expect(resolveManagerSyncConfig({ ...expected, MANAGER_SYNC_ENVIRONMENT: "production" })).toBeNull();
    expect(resolveManagerSyncConfig({ ...expected, MANAGER_SYNC_PROJECT_ID: "wrong" })).toBeNull();
    expect(resolveManagerSyncConfig({ ...expected, MANAGER_SYNC_TOKEN: "short" })).toBeNull();
  });

  it("uses a bearer token comparison and rejects absent or invalid credentials", () => {
    expect(isManagerSyncAuthorizationValid(`Bearer ${expected.MANAGER_SYNC_TOKEN}`, expected.MANAGER_SYNC_TOKEN)).toBe(true);
    expect(isManagerSyncAuthorizationValid(undefined, expected.MANAGER_SYNC_TOKEN)).toBe(false);
    expect(isManagerSyncAuthorizationValid(`Bearer ${"cd".repeat(32)}`, expected.MANAGER_SYNC_TOKEN)).toBe(false);
    expect(isManagerSyncAuthorizationValid(`Bearer ${expected.MANAGER_SYNC_TOKEN}`, "malformed")).toBe(false);
  });
});
