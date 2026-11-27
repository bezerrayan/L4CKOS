import { describe, expect, it } from "vitest";
import { filterEligibleMarketingEmails } from "./audiencePolicy";

describe("marketing audience consent policy", () => {
  it("deduplicates normalized recipients and excludes unsubscribed or unconsented addresses", () => {
    expect(filterEligibleMarketingEmails(
      [" Person@example.invalid ", "person@example.invalid", "no-consent@example.invalid", "left@example.invalid"],
      ["PERSON@example.invalid", "left@example.invalid"],
      [" LEFT@example.invalid "],
    )).toEqual(["person@example.invalid"]);
  });

  it("fails closed for an empty consent list", () => {
    expect(filterEligibleMarketingEmails(["customer@example.invalid"], [], [])).toEqual([]);
  });
});
