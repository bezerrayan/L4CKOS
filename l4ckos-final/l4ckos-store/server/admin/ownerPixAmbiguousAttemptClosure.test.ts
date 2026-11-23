import { describe, expect, it, vi } from "vitest";
import {
  closeOwnerPixAmbiguousAttempt,
  ownerPixCloseOperationKey,
} from "./ownerPixAmbiguousAttemptClosure";
import {
  assertOwnerPixClosureTarget,
  isOwnerPixCloseEntrypoint,
  parseOwnerPixCloseArgs,
} from "./ownerPixAmbiguousAttemptClosureCli";

describe("owner PIX ambiguous closure maintenance guard", () => {
  it("requires a single explicit mode and an audit reference plus both acknowledgements for apply", () => {
    expect(() => parseOwnerPixCloseArgs([])).toThrow(
      "OWNER_PIX_CLOSE_ARGUMENTS_INVALID"
    );
    expect(() =>
      parseOwnerPixCloseArgs([
        "--apply",
        "--audit-reference",
        "owner-review-2026-11-23",
      ])
    ).toThrow("OWNER_PIX_CLOSE_ARGUMENTS_INVALID");
    expect(() =>
      parseOwnerPixCloseArgs([
        "--apply",
        "--preflight",
        "--audit-reference",
        "owner-review-2026-11-23",
        "--acknowledge-financial-uncertainty",
        "--acknowledge-single-unit-release",
      ])
    ).toThrow("OWNER_PIX_CLOSE_ARGUMENTS_INVALID");
    expect(
      parseOwnerPixCloseArgs([
        "--apply",
        "--audit-reference",
        "owner-review-2026-11-23",
        "--acknowledge-financial-uncertainty",
        "--acknowledge-single-unit-release",
      ])
    ).toMatchObject({
      mode: "apply",
      acknowledgeUncertainty: true,
      acknowledgeSingleUnit: true,
    });
    expect(() =>
      parseOwnerPixCloseArgs([
        "--apply",
        "--attempt-id",
        "arbitrary",
        "--audit-reference",
        "owner-review-2026-11-23",
        "--acknowledge-financial-uncertainty",
        "--acknowledge-single-unit-release",
      ])
    ).toThrow("OWNER_PIX_CLOSE_ARGUMENTS_INVALID");
    expect(() =>
      parseOwnerPixCloseArgs([
        "--status",
        "--audit-reference",
        "contains spaces",
      ])
    ).toThrow("OWNER_PIX_CLOSE_AUDIT_REFERENCE_REQUIRED");
  });

  it("derives an opaque, deterministic idempotency key without embedding input identifiers", () => {
    const key = ownerPixCloseOperationKey(
      "synthetic-attempt",
      "owner-review-2026-11-23"
    );
    expect(key).toMatch(/^ownerpix-close:v1:[a-f0-9]{64}$/);
    expect(key).toBe(
      ownerPixCloseOperationKey("synthetic-attempt", "owner-review-2026-11-23")
    );
    expect(key).not.toContain("synthetic-attempt");
    expect(key).not.toContain("owner-review-2026-11-23");
    expect(() =>
      ownerPixCloseOperationKey("synthetic-attempt", "contains spaces")
    ).toThrow("OWNER_PIX_CLOSE_AUDIT_REFERENCE_REQUIRED");
  });

  it("refuses local and public-checkout-enabled targets before database connection", () => {
    const validShape = {
      NODE_ENV: "production",
      APP_ENV: "production",
      RAILWAY_PROJECT_ID: "5937dcf3-18ae-4df8-83f0-5bb60ec9b8db",
      RAILWAY_ENVIRONMENT_ID: "7d065409-7cc2-44ba-9fff-5524653b0484",
      RAILWAY_SERVICE_ID: "743f3f4e-af1b-44f7-95c8-bb152e3c2f4b",
      DATABASE_URL:
        "mysql://synthetic:synthetic@mysql-l4ckos-c7.railway.internal/railway",
      STOCK_DATABASE_ENV: "production",
      STOCK_EXPECTED_DATABASE: "railway",
      PUBLIC_CHECKOUT_ENABLED: "false",
      STOCK_CHECKOUT_ENABLED: "false",
      OWNER_PIX_TEST_ENABLED: "false",
      PUBLIC_SITE_MODE: "coming-soon",
      OWNER_OPEN_ID: "synthetic-owner",
      OWNER_PIX_TEST_ATTEMPT_ID: "synthetic-attempt",
    };
    expect(() =>
      assertOwnerPixClosureTarget({ ...validShape, NODE_ENV: "test" })
    ).toThrow("OWNER_PIX_CLOSE_TARGET_OR_FLAGS_INVALID");
    expect(() =>
      assertOwnerPixClosureTarget({
        ...validShape,
        PUBLIC_CHECKOUT_ENABLED: "true",
      })
    ).toThrow("OWNER_PIX_CLOSE_TARGET_OR_FLAGS_INVALID");
    expect(() =>
      assertOwnerPixClosureTarget({
        ...validShape,
        DATABASE_URL:
          "mysql://synthetic:synthetic@mysql-w5fk.railway.internal/railway",
      })
    ).toThrow("OWNER_PIX_CLOSE_TARGET_OR_FLAGS_INVALID");
  });

  it("requires both owner acknowledgements before an apply mode can acquire a connection", async () => {
    const getConnection = vi.fn();
    await expect(
      closeOwnerPixAmbiguousAttempt({ getConnection } as never, {
        mode: "apply",
        attemptId: "synthetic-attempt",
        ownerOpenId: "synthetic-owner",
        auditReference: "owner-review-2026-11-23",
      })
    ).rejects.toMatchObject({
      code: "OWNER_PIX_CLOSE_ACKNOWLEDGEMENTS_REQUIRED",
    });
    expect(getConnection).not.toHaveBeenCalled();
  });

  it("recognizes the compiled maintenance artifact and the direct TypeScript entrypoint", () => {
    expect(
      isOwnerPixCloseEntrypoint("/app/dist/owner-pix-ambiguous-close.js")
    ).toBe(true);
    expect(
      isOwnerPixCloseEntrypoint(
        "/app/server/admin/ownerPixAmbiguousAttemptClosureCli.ts"
      )
    ).toBe(true);
    expect(isOwnerPixCloseEntrypoint("/app/dist/unrelated.js")).toBe(false);
    expect(isOwnerPixCloseEntrypoint(undefined)).toBe(false);
  });
});
