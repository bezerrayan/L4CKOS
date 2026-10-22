import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertPublicStoreOpen,
  isPublicStoreOpen,
  PublicStoreClosedError,
  PUBLIC_STORE_CLOSED_CODE,
  requirePublicStoreOpen,
  resolvePublicSiteMode,
  isPublicCheckoutEnabled,
} from "./publicStore";

afterEach(() => vi.unstubAllEnvs());

describe("server-side public store mode", () => {
  it("defaults to closed in production when the backend setting is absent", () => {
    expect(resolvePublicSiteMode({ NODE_ENV: "production" })).toBe("coming-soon");
    expect(isPublicStoreOpen({ NODE_ENV: "production" })).toBe(false);
    expect(resolvePublicSiteMode({})).toBe("coming-soon");
  });

  it("fails closed for an invalid mode and accepts only an explicit store mode", () => {
    expect(resolvePublicSiteMode({ NODE_ENV: "test", PUBLIC_SITE_MODE: "open-ish" })).toBe("coming-soon");
    expect(resolvePublicSiteMode({ NODE_ENV: "production", PUBLIC_SITE_MODE: " STORE " })).toBe("store");
    expect(resolvePublicSiteMode({ NODE_ENV: "production", PUBLIC_SITE_MODE: "coming-soon" })).toBe("coming-soon");
  });

  it("does not infer the public store mode from NODE_ENV", () => {
    expect(resolvePublicSiteMode({ NODE_ENV: "development" })).toBe("coming-soon");
    expect(resolvePublicSiteMode({ NODE_ENV: "test" })).toBe("coming-soon");
    expect(resolvePublicSiteMode({ NODE_ENV: "production", PUBLIC_SITE_MODE: "store" })).toBe("store");
    expect(() => assertPublicStoreOpen({ NODE_ENV: "development", PUBLIC_SITE_MODE: "store" })).not.toThrow();
  });

  it("requires explicit checkout enablement in production while allowing store browsing", () => {
    const staging = { NODE_ENV: "production", PUBLIC_SITE_MODE: "store" };
    expect(isPublicStoreOpen(staging)).toBe(true);
    expect(isPublicCheckoutEnabled(staging)).toBe(false);
    expect(isPublicCheckoutEnabled({ NODE_ENV: "development", APP_ENV: "staging", PUBLIC_SITE_MODE: "store" })).toBe(false);
    expect(isPublicCheckoutEnabled({ ...staging, PUBLIC_CHECKOUT_ENABLED: "true" })).toBe(true);
    expect(isPublicCheckoutEnabled({ ...staging, PUBLIC_CHECKOUT_ENABLED: "false" })).toBe(false);
    expect(isPublicCheckoutEnabled({ NODE_ENV: "production", PUBLIC_SITE_MODE: "coming-soon", PUBLIC_CHECKOUT_ENABLED: "true" })).toBe(false);
  });

  it("returns a structured closed-store response through the HTTP gate", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PUBLIC_SITE_MODE", "coming-soon");
    const status = vi.fn().mockReturnThis();
    const type = vi.fn().mockReturnThis();
    const json = vi.fn();
    const next = vi.fn();

    requirePublicStoreOpen({} as any, { status, type, json } as any, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(type).toHaveBeenCalledWith("application/json");
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      code: PUBLIC_STORE_CLOSED_CODE,
      status: 403,
    }));
    expect(next).not.toHaveBeenCalled();
  });

  it("allows the HTTP gate to continue only when the backend explicitly opens the store", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PUBLIC_SITE_MODE", "store");
    const next = vi.fn();
    requirePublicStoreOpen({} as any, {} as any, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("exposes a typed domain error for transaction-boundary enforcement", () => {
    expect(() => assertPublicStoreOpen({ NODE_ENV: "production", PUBLIC_SITE_MODE: "coming-soon" }))
      .toThrow(PublicStoreClosedError);
  });
});
