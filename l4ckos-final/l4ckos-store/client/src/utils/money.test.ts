import { describe, expect, it } from "vitest";
import { parseCurrencyToCents } from "@shared/money";

describe("exact currency-to-cents parsing", () => {
  it.each([
    ["R$ 1.234,56", 123456],
    ["1234,5", 123450],
    ["1234.56", 123456],
    ["12", 1200],
    ["2.147.483,64", 214748364],
  ])("parses %s into integer cents", (input, expected) => {
    expect(parseCurrencyToCents(input)).toBe(expected);
  });

  it.each(["-1,00", "1,234", "1.234,567", "1,2.3", "abc", "21.474.836,48"])("rejects invalid or unrepresentable value %s", input => {
    expect(parseCurrencyToCents(input)).toBeNaN();
  });
});
