import { it, expect, vi } from "vitest";
// Synthetic fixed policy for contract fixtures; real approved-reference behavior is
// covered separately by tcpBackupPolicy.test.ts (no remote credentials).
vi.mock("../../database/financialWindow/tcpBackupPolicy", async () => {
  const { BACKUP_TARGET } = await import("../../database/financialWindow/backupIdentity");
  return {approvedTcpBackupPolicy:()=>Object.freeze({expectedLogin:"root",expectedCurrentUser:"root@localhost"}),
    tcpBackupReference:()=>({...BACKUP_TARGET,login:"root",account:"root@localhost"}),
    verifyTcpAuthenticatedIdentity:async()=>{}};
});
import * as identity from "../../database/financialWindow/backupIdentity";
import { inspectPrivateBackupTransport } from "../../database/financialWindow/externalBackup";
it("runs identity inspection inside a read-only transaction and closes all resources", async () => {
  const verify = vi
    .spyOn(identity, "verifyPhysicalBackupIdentity")
    .mockResolvedValue(undefined);
  const query = vi.fn(async () => []),
    rollback = vi.fn(async () => {}),
    end = vi.fn(async () => {}),
    close = vi.fn(async () => {});
  const c = { query, rollback, end } as any;
  const railway = {
    RAILWAY_PROJECT_ID: identity.BACKUP_TARGET.projectId,
    RAILWAY_ENVIRONMENT_ID: identity.BACKUP_TARGET.environmentId,
    RAILWAY_SERVICE_ID: identity.BACKUP_TARGET.mysqlServiceId,
    RAILWAY_DEPLOYMENT_ID: identity.BACKUP_TARGET.mysqlDeploymentId,
  };
  try {
    const result = await inspectPrivateBackupTransport({
      kind: "tcp",
      attest: async () => ({ authenticated: true, restricted: true, railway }),
      connectTcp: async () => c,
      close,
    });
    expect(query.mock.calls.map(c => c[0])).toEqual([
      "SET TRANSACTION READ ONLY",
      "START TRANSACTION READ ONLY",
    ]);
    expect(verify).toHaveBeenCalledWith(c, {
      ...identity.BACKUP_TARGET,
      account: "root@localhost",
      login: "root",
    });
    expect(result).toEqual({
      status: "READ_ONLY_IDENTITY_VERIFIED",
      businessRowsRead: false,
      backupCreated: false,
      tables: 31,
    });
    expect(rollback).toHaveBeenCalled();
    expect(end).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  } finally {
    verify.mockRestore();
  }
});

it("cleanup errors never expose query or credential content", async () => {
  const verify = vi
    .spyOn(identity, "verifyPhysicalBackupIdentity")
    .mockRejectedValue(Error("SQL synthetic-secret"));
  const c = {
    query: async () => [],
    rollback: async () => {
      throw Error("SQL synthetic-secret");
    },
    end: async () => {
      throw Error("synthetic-secret");
    },
  } as any;
  const railway = {
    RAILWAY_PROJECT_ID: identity.BACKUP_TARGET.projectId,
    RAILWAY_ENVIRONMENT_ID: identity.BACKUP_TARGET.environmentId,
    RAILWAY_SERVICE_ID: identity.BACKUP_TARGET.mysqlServiceId,
    RAILWAY_DEPLOYMENT_ID: identity.BACKUP_TARGET.mysqlDeploymentId,
  };
  const close = vi.fn(async () => {});
  try {
    await expect(
      inspectPrivateBackupTransport({
        kind: "tcp",
        attest: async () => ({
          authenticated: true,
          restricted: true,
          railway,
        }),
        connectTcp: async () => c,
        close,
      })
    ).rejects.toThrow("WINDOW_BACKUP_INSPECTION_STOPPED");
    expect(close).toHaveBeenCalled();
  } finally {
    verify.mockRestore();
  }
});
