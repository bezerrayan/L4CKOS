import { describe, expect, it } from "vitest";
import { resolveSiteMode } from "../client/src/config/site";

describe("frontend site mode and release target", () => {
  it("keeps staging navigable while production fails closed when VITE_SITE_MODE is omitted", () => {
    expect(resolveSiteMode({ VITE_DEPLOY_TARGET: "staging" })).toBe("store");
    expect(resolveSiteMode({ VITE_DEPLOY_TARGET: "production" })).toBe("coming-soon");
  });

  it("honors explicit environment mode independently of build runtime", () => {
    expect(resolveSiteMode({ VITE_DEPLOY_TARGET: "staging", VITE_SITE_MODE: "store" })).toBe("store");
    expect(resolveSiteMode({ VITE_DEPLOY_TARGET: "production", VITE_SITE_MODE: "coming-soon" })).toBe("coming-soon");
    expect(resolveSiteMode({ VITE_DEPLOY_TARGET: "production", VITE_SITE_MODE: "store" })).toBe("store");
  });

  it("retains the legacy explicit Coming Soon flag when no site mode is given", () => {
    expect(resolveSiteMode({ VITE_DEPLOY_TARGET: "staging", VITE_COMING_SOON: "true" })).toBe("coming-soon");
  });
});
