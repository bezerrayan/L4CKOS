import { describe, expect, it } from "vitest";
import { getStockHostedCardReturnUrl } from "./configuredStockAsaasProvider";

describe("hosted card return URL", () => {
  it("uses only the configured HTTPS storefront origin and returns to the existing Coming Soon route", () => {
    expect(getStockHostedCardReturnUrl({
      NODE_ENV: "production",
      FRONTEND_URL: "https://l4ckos.com.br",
      CORS_ORIGINS: "https://l4ckos.com.br,https://www.l4ckos.com.br",
    } as NodeJS.ProcessEnv)).toBe("https://l4ckos.com.br/em-breve");
  });

  it.each([
    { NODE_ENV: "production", FRONTEND_URL: "http://l4ckos.com.br", CORS_ORIGINS: "https://l4ckos.com.br" },
    { NODE_ENV: "production", FRONTEND_URL: "https://attacker.example.invalid", CORS_ORIGINS: "https://l4ckos.com.br" },
    { NODE_ENV: "production", CORS_ORIGINS: "https://l4ckos.com.br" },
  ])("fails closed for an untrusted or missing origin", environment => {
    expect(getStockHostedCardReturnUrl(environment as NodeJS.ProcessEnv)).toBeNull();
  });
});
