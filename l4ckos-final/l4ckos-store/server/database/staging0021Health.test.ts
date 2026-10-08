import { describe, expect, it } from "vitest";
import { isExpectedStagingHealth } from "../../database/staging0021/healthContract";

describe("staging 0021 health contract", () => {
  it("aceita o backend original saudável", () => {
    expect(isExpectedStagingHealth(200, {
      ok: true,
      service: "backend",
    })).toBe(true);
  });

  it("aceita manutenção explicitamente identificada", () => {
    expect(isExpectedStagingHealth(200, {
      ok: true,
      service: "staging-maintenance",
      maintenance: true,
    })).toBe(true);
  });

  it("rejeita manutenção sem marcador explícito", () => {
    expect(isExpectedStagingHealth(200, {
      ok: true,
      service: "staging-maintenance",
    })).toBe(false);
  });

  it("rejeita respostas inválidas", () => {
    for (const [status, body] of [
      [503, { ok: true, service: "staging-maintenance", maintenance: true }],
      [200, { ok: false, service: "backend" }],
      [200, { ok: true, service: "unknown" }],
      [200, null],
      [200, []],
    ] as const) {
      expect(isExpectedStagingHealth(status, body)).toBe(false);
    }
  });
});
