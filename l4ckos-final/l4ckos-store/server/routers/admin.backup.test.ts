import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBackupPayload: vi.fn(),
  createAuditLog: vi.fn(),
  createBackupFile: vi.fn(),
  listBackupFileNames: vi.fn(),
}));

vi.mock("../db", async importOriginal => ({
  ...await importOriginal<typeof import("../db")>(),
  getBackupPayload: mocks.getBackupPayload,
  createAuditLog: mocks.createAuditLog,
}));

vi.mock("../database/backupFiles", () => ({
  createBackupFile: mocks.createBackupFile,
  listBackupFileNames: mocks.listBackupFileNames,
}));

const admin = { id: 10, openId: "synthetic-admin", email: "admin@local.dev", role: "admin" };
const customer = { id: 11, openId: "synthetic-customer", email: "customer@example.invalid", role: "user" };

async function caller(user: typeof admin | typeof customer | null) {
  const { adminRouter } = await import("./admin");
  return adminRouter.createCaller({ user, req: {} as any, res: {} as any } as any);
}

describe("admin backup procedures", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([null, customer])("denies backup listing and creation to unauthenticated or non-admin callers", async user => {
    const api = await caller(user);
    await expect(api.backupsList()).rejects.toMatchObject({ code: user ? "FORBIDDEN" : "UNAUTHORIZED" });
    await expect(api.backupManual()).rejects.toMatchObject({ code: user ? "FORBIDDEN" : "UNAUTHORIZED" });
    expect(mocks.listBackupFileNames).not.toHaveBeenCalled();
    expect(mocks.getBackupPayload).not.toHaveBeenCalled();
    expect(mocks.createBackupFile).not.toHaveBeenCalled();
  });

  it("uses the authorized snapshot flow, audits the file, and returns no internal path", async () => {
    const fileName = "backup-2026-10-20T12-30-00-000Z-550e8400-e29b-41d4-a716-446655440000.json";
    mocks.getBackupPayload.mockResolvedValue({ fixture: "synthetic" });
    mocks.createBackupFile.mockResolvedValue({ fileName });
    mocks.createAuditLog.mockResolvedValue(undefined);
    mocks.listBackupFileNames.mockResolvedValue([fileName]);
    const api = await caller(admin);

    await expect(api.backupManual()).resolves.toEqual({ fileName });
    await expect(api.backupsList()).resolves.toEqual([fileName]);
    expect(mocks.createBackupFile).toHaveBeenCalledWith("backups", "manual", mocks.getBackupPayload);
    expect(mocks.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: admin.id,
      action: "backup.manual",
      entity: "backup",
      entityId: fileName,
    }));
  });

  it("does not return filesystem diagnostics when backup creation fails", async () => {
    mocks.getBackupPayload.mockResolvedValue({ fixture: "synthetic" });
    mocks.createBackupFile.mockRejectedValue(new Error("/private/path/backup.json permission denied"));
    await expect((await caller(admin)).backupManual()).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "BACKUP_OPERATION_FAILED",
    });
    expect(mocks.createAuditLog).not.toHaveBeenCalled();
  });
});
