import { afterEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  assertPublicCheckoutEnabled,
  isPublicCheckoutEnabled,
  PUBLIC_CHECKOUT_DISABLED_CODE,
} from "./publicStore";

describe("public checkout gate", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    [{}, false],
    [{ PUBLIC_SITE_MODE: "store" }, false],
    [{ PUBLIC_CHECKOUT_ENABLED: "true" }, false],
    [{ PUBLIC_SITE_MODE: "coming-soon", PUBLIC_CHECKOUT_ENABLED: "true" }, false],
    [{ PUBLIC_SITE_MODE: "store", PUBLIC_CHECKOUT_ENABLED: "false" }, false],
    [{ PUBLIC_SITE_MODE: "store", PUBLIC_CHECKOUT_ENABLED: "unknown" }, false],
    [{ PUBLIC_SITE_MODE: "store", PUBLIC_CHECKOUT_ENABLED: "true" }, true],
    [{ PUBLIC_SITE_MODE: " STORE ", PUBLIC_CHECKOUT_ENABLED: " TRUE " }, true],
  ])("requires both explicit opt-ins for %o", (env, expected) => {
    expect(isPublicCheckoutEnabled(env)).toBe(expected);
  });

  it("returns a stable forbidden app error when checkout is not enabled", () => {
    vi.stubEnv("PUBLIC_SITE_MODE", "store");
    vi.stubEnv("PUBLIC_CHECKOUT_ENABLED", "false");

    try {
      assertPublicCheckoutEnabled();
      throw new Error("expected checkout gate to deny");
    } catch (error) {
      expect(error).toBeInstanceOf(TRPCError);
      expect((error as TRPCError).code).toBe("FORBIDDEN");
      expect((error as TRPCError & { appCode?: string }).appCode).toBe(PUBLIC_CHECKOUT_DISABLED_CODE);
    }
  });
});
