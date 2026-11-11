import { describe, expect, it } from "vitest";
import { formatDropInstant, isoToZonedLocal, zonedLocalToIso } from "./dropTime";

describe("drop timezone helpers", () => {
  it("turns a local time typed for America/Sao_Paulo into an ISO string with an explicit -03:00 offset", () => {
    expect(zonedLocalToIso("2026-11-30T12:00", "America/Sao_Paulo")).toBe("2026-11-30T12:00:00-03:00");
    expect(new Date(zonedLocalToIso("2026-11-30T12:00", "America/Sao_Paulo")).toISOString()).toBe("2026-11-30T15:00:00.000Z");
  });

  it("does not depend on the browser zone: the same wall time in other zones gets that zone's offset", () => {
    expect(zonedLocalToIso("2026-11-30T12:00", "UTC")).toBe("2026-11-30T12:00:00+00:00");
    expect(zonedLocalToIso("2026-07-01T12:00", "Europe/Lisbon")).toBe("2026-07-01T12:00:00+01:00"); // DST
    expect(zonedLocalToIso("2026-01-01T12:00", "Europe/Lisbon")).toBe("2026-01-01T12:00:00+00:00");
  });

  it("round-trips and rejects empty input", () => {
    const iso = zonedLocalToIso("2026-11-20T09:00", "America/Sao_Paulo");
    expect(isoToZonedLocal(new Date(iso).toISOString(), "America/Sao_Paulo")).toBe("2026-11-20T09:00");
    expect(zonedLocalToIso("", "America/Sao_Paulo")).toBe("");
  });

  it("formats an instant in the drop's own zone", () => {
    expect(formatDropInstant("2026-11-30T15:00:00.000Z", "America/Sao_Paulo")).toContain("12:00");
    expect(formatDropInstant(null, "America/Sao_Paulo")).toBe("");
  });
});
