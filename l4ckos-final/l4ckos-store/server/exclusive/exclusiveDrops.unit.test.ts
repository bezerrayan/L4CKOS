import { describe, expect, it } from "vitest";
import { generateAccessCode, hashAccessCode, isWellFormedAccessCode, normalizeAccessCode } from "./codes";
import {
  adminSaveDropInputSchema,
  canPurchaseExclusive,
  computeDropState,
  isPurchaseWindowOpen,
  isRequestWindowOpen,
  type DropLike,
  type ProductDropView,
} from "../../shared/exclusiveDropsV1";

const drop = (over: Partial<DropLike> = {}): DropLike => ({
  storedStatus: "published",
  requestStartsAt: new Date("2026-11-01T03:00:00Z"),
  requestEndsAt: new Date("2026-11-25T02:59:00Z"),
  purchaseStartsAt: new Date("2026-11-20T12:00:00Z"),
  purchaseEndsAt: new Date("2026-11-30T15:00:00Z"),
  ...over,
});

describe("individual access codes", () => {
  it("are random, well formed, non-sequential and unique", () => {
    const codes = new Set(Array.from({ length: 2000 }, () => generateAccessCode()));
    expect(codes.size).toBe(2000);
    for (const code of [...codes].slice(0, 50)) {
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/);
      expect(isWellFormedAccessCode(code)).toBe(true);
    }
    // not sequential: consecutive codes share no long common prefix
    const [a, b] = [generateAccessCode(), generateAccessCode()];
    expect(a.slice(0, 8)).not.toBe(b.slice(0, 8));
  });

  it("are normalized (case, separators, look-alikes) before hashing, and only the hash is derived", () => {
    const code = generateAccessCode();
    expect(hashAccessCode(code.toLowerCase().replace(/-/g, " "))).toBe(hashAccessCode(code));
    expect(hashAccessCode(code)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashAccessCode(code)).not.toContain(normalizeAccessCode(code));
    expect(hashAccessCode(code, "pepper")).not.toBe(hashAccessCode(code, ""));
    expect(isWellFormedAccessCode("short")).toBe(false);
    expect(isWellFormedAccessCode("!!!!!-!!!!!-!!!!!-!!!!!")).toBe(false);
  });
});

describe("drop lifecycle and timezone", () => {
  it("derives scheduled / active / closed from UTC instants (explicit -03:00 inputs)", () => {
    expect(computeDropState(drop(), new Date("2026-11-20T11:59:59Z"))).toBe("scheduled");
    expect(computeDropState(drop(), new Date("2026-11-20T12:00:00Z"))).toBe("active"); // 09:00 BRT
    expect(computeDropState(drop(), new Date("2026-11-30T15:00:00Z"))).toBe("closed"); // 12:00 BRT, end is exclusive
    expect(computeDropState(drop({ storedStatus: "draft" }), new Date("2026-11-21T00:00:00Z"))).toBe("hidden");
    expect(computeDropState(drop({ storedStatus: "closed" }), new Date("2026-11-21T00:00:00Z"))).toBe("closed");
  });

  it("opens purchase and requests independently", () => {
    const now = new Date("2026-11-26T00:00:00Z");
    expect(isPurchaseWindowOpen(drop(), now)).toBe(true);
    expect(isRequestWindowOpen(drop(), now)).toBe(false); // request window ended 25/11
    expect(isRequestWindowOpen(drop({ requestStartsAt: null, requestEndsAt: null }), now)).toBe(true);
    expect(isRequestWindowOpen(drop({ storedStatus: "closed" }), now)).toBe(false);
  });

  it("requires an explicit UTC offset on admin input and a valid IANA timezone", () => {
    const base = { slug: "xiv-bis", name: "XIV Bis", purchaseStartsAt: "2026-11-20T09:00:00-03:00", purchaseEndsAt: "2026-11-30T12:00:00-03:00", productIds: [4] };
    expect(adminSaveDropInputSchema.safeParse(base).success).toBe(true);
    expect(adminSaveDropInputSchema.safeParse({ ...base, purchaseStartsAt: "2026-11-20T09:00:00" }).success).toBe(false);
    expect(adminSaveDropInputSchema.safeParse({ ...base, timezone: "Mars/Olympus" }).success).toBe(false);
    expect(adminSaveDropInputSchema.safeParse({ ...base, purchaseEndsAt: "2026-11-20T09:00:00-03:00" }).success).toBe(false);
    const parsed = adminSaveDropInputSchema.parse(base);
    expect(parsed.purchaseStartsAt.toISOString()).toBe("2026-11-20T12:00:00.000Z");
    expect(parsed.timezone).toBe("America/Sao_Paulo");
  });
});

describe("storefront purchase rule", () => {
  const view = (status: any, remaining = 2, open = true): ProductDropView => ({
    exclusive: true,
    drop: { id: 1, slug: "x", name: "X", description: null, state: open ? "active" : "closed", timezone: "America/Sao_Paulo", requiresAuthorization: true,
      requestWindow: { startsAt: null, endsAt: null, open: true }, purchaseWindow: { startsAt: "", endsAt: "", open } },
    viewer: { status, unitsRemaining: remaining },
  });

  it("only an unlocked viewer with units left inside an open window may buy", () => {
    expect(canPurchaseExclusive({ exclusive: false })).toBe(true);
    expect(canPurchaseExclusive(view("unlocked"))).toBe(true);
    for (const status of ["login_required", "none", "pending", "rejected", "revoked", "approved", "expired"]) expect(canPurchaseExclusive(view(status))).toBe(false);
    expect(canPurchaseExclusive(view("unlocked", 0))).toBe(false);
    expect(canPurchaseExclusive(view("unlocked", 2, false))).toBe(false);
  });
});
