import { it, expect, vi, beforeEach } from "vitest";
vi.mock("../../database/financialRecovery/operator", async () => {
  const actual = await vi.importActual<any>(
    "../../database/financialRecovery/operator"
  );
  return { ...actual, runRecovery: vi.fn() };
});
import {
  runRecovery,
  RecoveryIncident,
} from "../../database/financialRecovery/operator";
import {
  runIsolatedRecovery,
  runIsolatedPreflight,
} from "../../database/financialIsolation/adapter";
import { TARGET, digest } from "../../database/financialRecovery/policy";
const hash = "a".repeat(64);
function request() {
  const snapshot = {
    capturedAt: new Date().toISOString(),
    targetHash: hash,
    historicalHash: hash,
    immutableTargetHash: hash,
    tableHashes: {},
    financialHash: hash,
    createdHash: hash,
    stock: 98,
    originalExpiresAt: "synthetic-expired",
  };
  const checkpoint = {
    version: 1,
    operation: "financial-b",
    artifactHash: hash,
    deploymentId: TARGET.deploymentId,
    snapshot,
  };
  return {
    operation: "financial-b",
    mode: "execute",
    checkpoint,
    approval: {
      operation: "financial-b",
      projectId: TARGET.projectId,
      environmentId: TARGET.environmentId,
      serviceId: TARGET.serviceId,
      deploymentId: TARGET.deploymentId,
      artifactHash: hash,
      checkpointHash: digest(checkpoint),
      reference: "LOCAL_MOCK_APPROVAL",
      actorUserId: 14,
      justification:
        "Synthetic mock adapter contract only, no financial kernel",
      validFrom: new Date(Date.now() - 1000).toISOString(),
      validUntil: new Date(Date.now() + 60000).toISOString(),
      confirmation: "AUTHORIZE_ONE_STAGING_OPERATION_ONLY",
      expiredReservationException: true,
      unknownFinancialReceiptTime: true,
      createdRetryMayAck: false,
      pendingNotificationIntent: "create-one-order13",
      notificationDispatch: false,
      queueResume: false,
      writersQuiesced: true,
      dispatchersQuiesced: true,
      backupRestoreReference: "LOCAL_MOCK_RESTORE",
      financialReceiptHash: null,
    },
  };
}
const runtime: any = { artifactHash: hash };
let channel: any;
beforeEach(() => {
  vi.clearAllMocks();
  channel = {
    lease: vi.fn().mockResolvedValue(vi.fn()),
    revoke: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
  };
});
it("rejects unapproved operation before acquiring the channel", async () => {
  await expect(
    runIsolatedRecovery(
      { operation: "financial-b", mode: "execute" },
      runtime,
      channel
    )
  ).rejects.toThrow("EXPLICIT_APPROVAL");
  expect(channel.lease).not.toHaveBeenCalled();
  expect(runRecovery).not.toHaveBeenCalled();
});
it("does not turn default DRY-RUN into execution", async () => {
  await expect(
    runIsolatedRecovery({ operation: "financial-b" }, runtime, channel)
  ).rejects.toThrow("LEASE");
  expect(runRecovery).not.toHaveBeenCalled();
});
it("revokes after mock confirmed commit, never releases isolation automatically", async () => {
  vi.mocked(runRecovery).mockResolvedValue({
    status: "mock",
    commitState: "confirmed",
  } as any);
  const r = await runIsolatedRecovery(request(), runtime, channel);
  expect(r.commitState).toBe("confirmed");
  expect(channel.revoke).toHaveBeenCalledOnce();
  expect(channel.release).not.toHaveBeenCalled();
});
it.each(["rolled_back", "confirmed", "unknown"] as const)(
  "preserves %s on mocked failure and revokes",
  async state => {
    const error = new RecoveryIncident(state, "synthetic-fixture");
    vi.mocked(runRecovery).mockRejectedValue(error);
    await expect(runIsolatedRecovery(request(), runtime, channel)).rejects.toBe(
      error
    );
    expect(channel.revoke).toHaveBeenCalledOnce();
    expect(channel.release).not.toHaveBeenCalled();
  }
);
it("revocation failure after confirmed commit remains an incident with confirmed state", async () => {
  vi.mocked(runRecovery).mockResolvedValue({ commitState: "confirmed" } as any);
  channel.revoke.mockRejectedValue(Error("synthetic"));
  try {
    await runIsolatedRecovery(request(), runtime, channel);
    throw Error("EXPECTED_FAILURE");
  } catch (e) {
    expect(e).toBeInstanceOf(RecoveryIncident);
    expect((e as RecoveryIncident).commitState).toBe("confirmed");
    expect((e as Error).message).toBe("ISOLATION_REVOKE_FAILED");
  }
});

it("isolated preflight uses only the read lease, never acquires a write lease", async () => {
  channel.readLease = vi.fn().mockResolvedValue(vi.fn());
  vi.mocked(runRecovery).mockResolvedValue({
    status: "dry-run",
    commitState: "not_started",
    writes: false,
  } as any);
  await runIsolatedPreflight({ operation: "financial-b" }, runtime, channel);
  expect(channel.readLease).toHaveBeenCalledOnce();
  expect(channel.lease).not.toHaveBeenCalled();
  expect(channel.revoke).not.toHaveBeenCalled();
});
