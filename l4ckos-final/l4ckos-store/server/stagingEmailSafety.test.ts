import { afterEach, describe, expect, it } from "vitest";
import { assertStagingRecipientsAllowed } from "./services/email/emailService.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("staging email allowlist", () => {
  it("accepts only explicitly controlled recipients", () => {
    process.env.APP_ENV = "staging";
    process.env.STAGING_EMAIL_ALLOWLIST = "qa@example.test,delivered@resend.dev";
    expect(() => assertStagingRecipientsAllowed(["qa@example.test", "delivered@resend.dev"])).not.toThrow();
  });

  it("blocks an arbitrary real recipient", () => {
    process.env.APP_ENV = "staging";
    process.env.STAGING_EMAIL_ALLOWLIST = "qa@example.test";
    expect(() => assertStagingRecipientsAllowed(["customer@example.com"])).toThrow(
      "Staging email recipient is not allowlisted",
    );
  });
});
