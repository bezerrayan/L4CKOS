import { describe, expect, it } from "vitest";
import { localDateKey, localDateRange, monthDateRange, previousEquivalentRange, saoPauloMidnightUtc } from "../../shared/reportPeriods";

describe("report business periods", () => {
  it("converts Sao Paulo calendar boundaries to UTC without changing stored timestamps", () => {
    expect(saoPauloMidnightUtc("2026-10-01").toISOString()).toBe("2026-10-01T03:00:00.000Z");
    expect(localDateRange("2026-10-01", "2026-10-31")).toEqual({
      from: "2026-10-01T03:00:00.000Z",
      to: "2026-11-01T02:59:59.999Z",
    });
    expect(localDateKey(new Date("2026-10-01T02:59:59.999Z"))).toBe("2026-09-30");
    expect(localDateKey(new Date("2026-10-01T03:00:00.000Z"))).toBe("2026-10-01");
  });

  it("selects leap-month boundaries and equivalent previous ranges", () => {
    expect(monthDateRange(2024, 2)).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(previousEquivalentRange("2026-10-01", "2026-10-31")).toEqual({ from: "2026-08-31", to: "2026-09-30" });
  });

  it("does not include a future portion when the selected range ends today", () => {
    const now = new Date("2026-10-24T12:30:00.000Z");
    expect(localDateRange("2026-10-24", "2026-10-24", now).to).toBe(now.toISOString());
  });
});
