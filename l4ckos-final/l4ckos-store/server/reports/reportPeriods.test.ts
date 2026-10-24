import { describe, expect, it } from "vitest";
import { isValidDateKey, localDateRange, reportComparisonDescription, reportComparisonRange } from "../../shared/reportPeriods";

describe("gerencial reporting periods", () => {
  it("converts local calendar boundaries to UTC without losing the final selected day", () => {
    expect(localDateRange("2026-10-01", "2026-10-19")).toEqual({
      from: "2026-10-01T03:00:00.000Z",
      to: "2026-10-20T02:59:59.999Z",
    });
  });

  it("compares a completed month with the previous completed month", () => {
    const input = { period: "month" as const, from: "2026-09-01", to: "2026-09-30", today: "2026-10-24" };
    expect(reportComparisonRange(input)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(reportComparisonDescription(input)).toBe("mês completo versus mês completo anterior");
  });

  it("compares an in-progress month over the same elapsed local dates, clamped at February's end", () => {
    const input = { period: "thisMonth" as const, from: "2026-03-01", to: "2026-03-31", today: "2026-03-31" };
    expect(reportComparisonRange(input)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(reportComparisonDescription(input)).toBe("mesmo intervalo transcorrido no mês anterior");
  });

  it("compares custom periods with the immediately preceding interval of equal duration", () => {
    const input = { period: "custom" as const, from: "2026-10-01", to: "2026-10-19", today: "2026-10-24" };
    expect(reportComparisonRange(input)).toEqual({ from: "2026-09-12", to: "2026-09-30" });
    expect(reportComparisonDescription(input)).toBe("intervalos consecutivos de igual duração");
  });

  it("compares a year in progress with the same calendar interval in the previous year", () => {
    const input = { period: "year" as const, from: "2026-01-01", to: "2026-10-24", selectedYear: 2026, today: "2026-10-24" };
    expect(reportComparisonRange(input)).toEqual({ from: "2025-01-01", to: "2025-10-24" });
    expect(reportComparisonDescription(input)).toBe("mesmas datas do ano anterior");
  });

  it("rejects impossible calendar days and handles leap February ranges", () => {
    expect(isValidDateKey("2026-02-29")).toBe(false);
    expect(isValidDateKey("2024-02-29")).toBe(true);
    const february = { period: "month" as const, from: "2024-02-01", to: "2024-02-29", today: "2026-10-24" };
    expect(reportComparisonRange(february)).toEqual({ from: "2024-01-01", to: "2024-01-31" });
  });
});
