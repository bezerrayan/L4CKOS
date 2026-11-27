import { describe, expect, it } from "vitest";
import { resolveCardCheckoutEnabled } from "./cardCheckout";

describe("resolveCardCheckoutEnabled", () => {
  it("never opens a production build by omission", () => {
    expect(resolveCardCheckoutEnabled({ VITE_DEPLOY_TARGET: "production" })).toBe(false);
    expect(resolveCardCheckoutEnabled({ VITE_DEPLOY_TARGET: "production", VITE_CARD_CHECKOUT_ENABLED: "" })).toBe(false);
    expect(resolveCardCheckoutEnabled({ VITE_DEPLOY_TARGET: " Production ", VITE_CARD_CHECKOUT_ENABLED: "yes" })).toBe(false);
  });

  it("opens production only with an explicit true", () => {
    expect(resolveCardCheckoutEnabled({ VITE_DEPLOY_TARGET: "production", VITE_CARD_CHECKOUT_ENABLED: "true" })).toBe(true);
    expect(resolveCardCheckoutEnabled({ VITE_DEPLOY_TARGET: "production", VITE_CARD_CHECKOUT_ENABLED: " TRUE " })).toBe(true);
  });

  it("lets staging and local builds rehearse the flow, and honors an explicit false everywhere", () => {
    expect(resolveCardCheckoutEnabled({ VITE_DEPLOY_TARGET: "staging" })).toBe(true);
    expect(resolveCardCheckoutEnabled({})).toBe(true);
    expect(resolveCardCheckoutEnabled({ VITE_DEPLOY_TARGET: "staging", VITE_CARD_CHECKOUT_ENABLED: "false" })).toBe(false);
  });
});
