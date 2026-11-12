import { describe, expect, it } from "vitest";
import { formatStorefrontPrice } from "./storefrontPrice";
import { formatPrice } from "../lib/utils";

describe("formatStorefrontPrice", () => {
  it("drops the currency prefix and keeps the Brazilian format with two decimals", () => {
    expect(formatStorefrontPrice(89)).toBe("89,00");
    expect(formatStorefrontPrice(129.9)).toBe("129,90");
    expect(formatStorefrontPrice(0.5)).toBe("0,50");
    expect(formatStorefrontPrice(0)).toBe("0,00");
  });

  it("uses the thousands separator above 1.000", () => {
    expect(formatStorefrontPrice(1289.9)).toBe("1.289,90");
    expect(formatStorefrontPrice(1000)).toBe("1.000,00");
    expect(formatStorefrontPrice(12345.67)).toBe("12.345,67");
  });

  it("never contains a currency symbol, and is the same number the monetary formatter shows", () => {
    for (const value of [89, 129.9, 1289.9, 15000.05]) {
      const shown = formatStorefrontPrice(value);
      expect(shown).not.toMatch(/R\$|BRL/);
      expect(formatPrice(value).replace(/R\$\s?/, "").replace(/ /g, "")).toBe(shown);
    }
  });

  it("does not change the monetary formatter used by cart, checkout and admin", () => {
    expect(formatPrice(89).replace(/ /g, " ")).toBe("R$ 89,00");
    expect(formatPrice(1289.9).replace(/ /g, " ")).toBe("R$ 1.289,90");
  });
});
