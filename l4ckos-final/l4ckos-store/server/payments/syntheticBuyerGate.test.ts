import { describe, expect, it } from "vitest";
import { assertStagingSyntheticBuyer, SyntheticBuyerGateError } from "./syntheticBuyerGate";

const isolated = {
  NODE_ENV: "production",
  RAILWAY_PROJECT_ID: "66faf690-a068-40d1-b85c-cb5d8595560a",
  RAILWAY_ENVIRONMENT_ID: "5335340d-311c-47e9-9713-6e5a86969c88",
  RAILWAY_SERVICE_ID: "d66762a4-422a-4656-94a1-502215a27aa2",
  STAGING_SYNTHETIC_BUYER_GATE_ENABLED: "true",
  STAGING_SYNTHETIC_BUYER_IDS: "81,82",
} as NodeJS.ProcessEnv;

describe("isolated synthetic financial buyer gate", () => {
  it("allows only configured authenticated server identities", () => {
    expect(() => assertStagingSyntheticBuyer(81, isolated)).not.toThrow();
    expect(() => assertStagingSyntheticBuyer(82, isolated)).not.toThrow();
    expect(() => assertStagingSyntheticBuyer(83, isolated)).toThrowError(
      expect.objectContaining({ code: "STAGING_SYNTHETIC_BUYER_NOT_ALLOWED" }),
    );
  });

  it("rejects anonymous callers and never accepts an unapproved client supplied identity", () => {
    expect(() => assertStagingSyntheticBuyer(undefined, isolated)).toThrowError(
      expect.objectContaining({ code: "STAGING_SYNTHETIC_BUYER_AUTH_REQUIRED" }),
    );
    // The caller passes only the authenticated session ID; a payload claiming 81 cannot authorize session 83.
    expect(() => assertStagingSyntheticBuyer(83, isolated)).toThrowError(SyntheticBuyerGateError);
  });

  it.each([
    { ...isolated, STAGING_SYNTHETIC_BUYER_GATE_ENABLED: undefined },
    { ...isolated, STAGING_SYNTHETIC_BUYER_IDS: undefined },
    { ...isolated, STAGING_SYNTHETIC_BUYER_IDS: "81,81" },
    { ...isolated, RAILWAY_SERVICE_ID: "wrong-service" },
    { ...isolated, NODE_ENV: "test" },
  ] as NodeJS.ProcessEnv[])("fails closed for incomplete or mismatched isolated configuration", env => {
    expect(() => assertStagingSyntheticBuyer(81, env)).toThrowError(
      expect.objectContaining({ code: "STAGING_SYNTHETIC_BUYER_GATE_MISCONFIGURED" }),
    );
  });

  it("does not apply staging policy to production identities", () => {
    expect(() => assertStagingSyntheticBuyer(83, {
      NODE_ENV: "production",
      RAILWAY_PROJECT_ID: "production-project",
      RAILWAY_ENVIRONMENT_ID: "production-environment",
      RAILWAY_SERVICE_ID: "production-service",
      STAGING_SYNTHETIC_BUYER_GATE_ENABLED: "true",
      STAGING_SYNTHETIC_BUYER_IDS: "81",
    })).not.toThrow();
  });
});
