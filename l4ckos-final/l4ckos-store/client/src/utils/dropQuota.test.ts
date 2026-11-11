import { describe, expect, it } from "vitest";
import { additionalUnitsAllowed, computeDropQuota, describeDropGroup, type DropViewInput } from "./dropQuota";

const unlocked = (remaining: number | undefined, dropId = 1, open = true): DropViewInput => ({
  exclusive: true,
  drop: { id: dropId, name: "Drop XIV", requiresAuthorization: true, purchaseWindow: { open } },
  viewer: { status: "unlocked", unitsRemaining: remaining, unitLimit: 1 },
});

describe("computeDropQuota", () => {
  it("ignores products that are not exclusive or whose view is unknown (no invented cap)", () => {
    const result = computeDropQuota([{ productId: 1, quantity: 5 }, { productId: 2, quantity: 1 }], { 1: { exclusive: false }, 2: undefined });
    expect(result.groups).toEqual([]);
    expect(additionalUnitsAllowed(result.byProduct[1])).toBeNull();
  });

  it("shares ONE cap across products, sizes and variants of the same drop", () => {
    const views = { 10: unlocked(1), 11: unlocked(1) };
    const lines = [{ productId: 10, quantity: 1 }, { productId: 11, quantity: 1 }];
    const { groups, byProduct } = computeDropQuota(lines, views);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ requested: 2, cap: 1, excess: 1, reason: "over_limit", blocking: true });
    expect(additionalUnitsAllowed(byProduct[10])).toBe(0);
  });

  it("sums several lines (sizes/variants) of one product and allows what is left", () => {
    const { groups, byProduct } = computeDropQuota([{ productId: 10, quantity: 1 }, { productId: 10, quantity: 1 }], { 10: unlocked(3) });
    expect(groups[0]).toMatchObject({ requested: 2, cap: 3, excess: 0, reason: "ok", blocking: false });
    expect(additionalUnitsAllowed(byProduct[10])).toBe(1);
  });

  it("marks the exact limit as reached without blocking", () => {
    const { groups, byProduct } = computeDropQuota([{ productId: 10, quantity: 1 }], { 10: unlocked(1) });
    expect(groups[0]).toMatchObject({ reason: "limit_reached", blocking: false, excess: 0 });
    expect(additionalUnitsAllowed(byProduct[10])).toBe(0);
  });

  it("keeps separate caps for different drops", () => {
    const { groups } = computeDropQuota([{ productId: 10, quantity: 1 }, { productId: 20, quantity: 2 }], { 10: unlocked(1, 1), 20: unlocked(2, 2) });
    expect(groups.map(g => [g.dropId, g.requested, g.cap, g.blocking])).toEqual([[1, 1, 1, false], [2, 2, 2, false]]);
  });

  it("blocks when the account is not unlocked, signed out or the window is closed", () => {
    const base = { exclusive: true as const, drop: { id: 1, name: "D", requiresAuthorization: true, purchaseWindow: { open: true } } };
    const line = [{ productId: 10, quantity: 1 }];
    expect(computeDropQuota(line, { 10: { ...base, viewer: { status: "login_required" } } }).groups[0]).toMatchObject({ reason: "login_required", blocking: true, cap: 0 });
    for (const status of ["none", "pending", "rejected", "revoked", "approved", "expired"]) {
      expect(computeDropQuota(line, { 10: { ...base, viewer: { status } } }).groups[0]).toMatchObject({ reason: "needs_access", blocking: true });
    }
    expect(computeDropQuota(line, { 10: unlocked(1, 1, false) }).groups[0]).toMatchObject({ reason: "window_closed", blocking: true });
  });

  it("does not cap an open drop that does not require authorization, nor an unlocked viewer with no usable number", () => {
    const open: DropViewInput = { exclusive: true, drop: { id: 1, name: "Aberto", requiresAuthorization: false, purchaseWindow: { open: true } }, viewer: { status: "none" } };
    expect(computeDropQuota([{ productId: 1, quantity: 9 }], { 1: open }).groups[0]).toMatchObject({ cap: null, blocking: false });
    const unknown = computeDropQuota([{ productId: 1, quantity: 9 }], { 1: unlocked(undefined) }).groups[0];
    expect(unknown).toMatchObject({ cap: null, blocking: false });
    expect(additionalUnitsAllowed(unknown)).toBeNull();
  });

  it("reacts to a changed quota (cap lowered below the cart)", () => {
    const lines = [{ productId: 10, quantity: 2 }];
    expect(computeDropQuota(lines, { 10: unlocked(2) }).groups[0].blocking).toBe(false);
    expect(computeDropQuota(lines, { 10: unlocked(1) }).groups[0]).toMatchObject({ blocking: true, excess: 1 });
  });
});

describe("describeDropGroup", () => {
  it("states the maximum, never promises stock or capacity, and warns on excess", () => {
    const ok = computeDropQuota([{ productId: 10, quantity: 1 }], { 10: unlocked(2) }).groups[0];
    expect(describeDropGroup(ok).text).toMatch(/até 2 unidades/);
    expect(describeDropGroup(ok).text).toMatch(/confirmados ao finalizar o pedido/);
    const over = computeDropQuota([{ productId: 10, quantity: 3 }], { 10: unlocked(1) }).groups[0];
    expect(describeDropGroup(over)).toMatchObject({ tone: "warning" });
    expect(describeDropGroup(over).text).toMatch(/Remova 2 unidades/);
  });
});
