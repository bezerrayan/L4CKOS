import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return { ...actual, updateUserRole: vi.fn(), createAuditLog: vi.fn() };
});

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { ENV } from "./_core/env";
import { resolveProvisionedUserRole } from "./_core/adminAccess";
import { createAuditLog, updateUserRole } from "./db";

const databaseUrl = process.env.DATABASE_URL;
const ownerOpenId = ENV.ownerOpenId;

beforeAll(() => {
  // This is an authorization-contract test, not a database integration test.
  delete process.env.DATABASE_URL;
});

afterAll(() => {
  if (databaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = databaseUrl;
  ENV.ownerOpenId = ownerOpenId;
});

beforeEach(() => {
  vi.mocked(updateUserRole).mockResolvedValue({} as never);
  vi.mocked(createAuditLog).mockResolvedValue({} as never);
});

function caller(role: "user" | "admin", email = ENV.adminEmails[0]) {
  const now = new Date();
  return appRouter.createCaller({
    user: {
      id: 1,
      openId: "admin-role-hardening",
      name: "Admin de teste",
      email,
      role,
      isVip: 0,
      isBlocked: 0,
      sessionVersion: 1,
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    },
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  });
}

describe("admin role hardening", () => {
  it("does not provision admin from an allowlisted email alone", () => {
    ENV.ownerOpenId = "owner-open-id";
    expect(resolveProvisionedUserRole("allowlisted-user")).toBeUndefined();
    expect(resolveProvisionedUserRole("allowlisted-user", "admin")).toBe("user");
  });

  it("preserves the owner bootstrap path", () => {
    ENV.ownerOpenId = "owner-open-id";
    expect(resolveProvisionedUserRole("owner-open-id")).toBe("admin");
  });

  it("keeps normal admin reads available to an allowlisted admin", async () => {
    await expect(caller("admin").admin.reviewsList()).resolves.toEqual({ items: [], nextCursor: null });
  });

  it("does not rely on the frontend to block promotion to admin", async () => {
    await expect(caller("admin").admin.userSetRole({ userId: 2, role: "admin" as never })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(updateUserRole).not.toHaveBeenCalled();
  });

  it("keeps the non-elevating role change available", async () => {
    await expect(caller("admin").admin.userSetRole({ userId: 2, role: "user" })).resolves.toEqual({ success: true });
    expect(updateUserRole).toHaveBeenCalledWith(2, "user");
  });

  it("continues to require both the stored role and the admin allowlist", async () => {
    await expect(caller("user").admin.reviewsList()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("admin", "outside@example.test").admin.reviewsList()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
