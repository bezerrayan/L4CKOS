import { describe, expect, it } from "vitest";
import { sortSizeLabels } from "./sizeOrder";

describe("sortSizeLabels", () => {
  it("orders the hash-ordered API result (G, P, M) by the usual alpha scale", () => {
    expect(sortSizeLabels(["G", "P", "M"])).toEqual(["P", "M", "G"]);
    expect(sortSizeLabels(["GG", "G", "PP", "M", "P"])).toEqual(["PP", "P", "M", "G", "GG"]);
  });

  it("honours the product's configured order before the default scale", () => {
    expect(sortSizeLabels(["P", "M", "G"], ["G", "M", "P"])).toEqual(["G", "M", "P"]);
  });

  it("orders numeric sizes ascending and keeps unknown labels last, stable", () => {
    expect(sortSizeLabels(["42", "38", "40"])).toEqual(["38", "40", "42"]);
    expect(sortSizeLabels(["Único", "M", "Especial"])).toEqual(["M", "Único", "Especial"]);
  });

  it("never drops or renames a label and does not mutate the input", () => {
    const input = ["g", "p"];
    expect(sortSizeLabels(input)).toEqual(["p", "g"]);
    expect(input).toEqual(["g", "p"]);
    expect(sortSizeLabels([])).toEqual([]);
  });
});
