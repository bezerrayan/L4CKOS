import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { TARGET, MIGRATION, PRE, POST, TTL, connectionHash, digestPlan, type Plan } from "../../database/staging/policy";
import { remoteOperation } from "../../database/staging/remote";

const state = vi.hoisted(() => ({ connection: undefined as any, release: () => {}, gate: Promise.resolve(), reads: 0, closed: false }));
vi.mock("../../server/database/backupRestore", () => ({ openBackupConnection: async () => state.connection, backupDatabase: vi.fn(() => { throw Error("BACKUP_NOT_AUTHORIZED_IN_TEST"); }) }));
vi.mock("../../database/schema/fingerprint", async original => ({
  ...await original<any>(),
  readStructuralSchema: async () => { state.reads++; await state.gate; if (state.closed) throw Error("CONNECTION_ALREADY_CLOSED"); return { tables: [], unsupported: {} }; },
  rows: async () => [{ n: 0 }],
}));
vi.mock("../../database/migrations/runner", () => ({ reconcileAuthorizedStaging: async () => { state.reads++; await state.gate; if (state.closed) throw Error("CONNECTION_ALREADY_CLOSED"); return { status: "APPLIED", fingerprint: POST }; } }));
vi.mock("../../database/schema/governance", () => ({ ledgerRows: async () => [] }));
vi.mock("../../database/schema/artifacts", () => ({ readArtifact: async () => Buffer.from("synthetic reviewed DDL") }));
afterEach(() => { state.release(); vi.unstubAllEnvs(); });

function setup() {
  state.reads = 0; state.closed = false;
  state.gate = new Promise<void>(resolve => { state.release = resolve; });
  state.connection = { config: { host: "synthetic.railway.internal", port: 3306, user: "synthetic", password: "synthetic", database: "synthetic" }, query: vi.fn(), end: vi.fn(async () => { state.closed = true; }) };
  const identity = { ...TARGET, deploymentId: randomUUID(), connectionHash: connectionHash(state.connection) };
  for (const [key, value] of Object.entries({ RAILWAY_PROJECT_ID: TARGET.projectId, RAILWAY_ENVIRONMENT_ID: TARGET.environmentId, RAILWAY_SERVICE_ID: TARGET.serviceId, RAILWAY_DEPLOYMENT_ID: identity.deploymentId, DATABASE_URL: "mysql://synthetic:synthetic@synthetic.railway.internal/synthetic" })) vi.stubEnv(key, value);
  const now = Date.now(), checksum = "a".repeat(64);
  const plan: Plan = { version: 1, planId: randomUUID(), createdAt: new Date(now).toISOString(), expiresAt: new Date(now + TTL).toISOString(), applicationCommit: "a".repeat(40), target: identity, migration: MIGRATION, expectedPreFingerprint: PRE, observedPreFingerprint: PRE, expectedPostFingerprint: POST, health: { status: 200 }, asaasWebhookEventsBefore: "ABSENT", ledgerStateBefore: "ABSENT",
    backup: { created: true, copiedOffRuntime: true, checksumVerified: true, artifactSha256: checksum, createdAt: new Date(now).toISOString(), sourceFingerprint: PRE, schemaFingerprint: checksum, restoreVerified: true, restoreFingerprint: PRE, rowCounts: Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`table${i}`, 0])), rowChecksums: Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`table${i}`, checksum])) } };
  return { identity, plan };
}
describe("remote staging connection lifecycle (offline only)", () => {
  it("keeps the same connection open until every metadata read completes", async () => {
    const { identity } = setup();
    const pending = remoteOperation("inspect", identity);
    try {
      await vi.waitFor(() => expect(state.reads).toBe(1));
      expect(state.connection.end).not.toHaveBeenCalled();
    } finally { state.release(); }
    const result = await pending;
    expect(result).toHaveProperty("fingerprint");
    expect(state.reads).toBe(3);
    expect(state.connection.end).toHaveBeenCalledTimes(1);
  });
  it("waits for the governance runner before releasing its connection", async () => {
    const { identity, plan } = setup();
    const pending = remoteOperation("apply", identity, plan, digestPlan(plan));
    try {
      await vi.waitFor(() => expect(state.reads).toBe(1));
      expect(state.connection.end).not.toHaveBeenCalled();
    } finally { state.release(); }
    await expect(pending).resolves.toMatchObject({ status: "APPLIED", webhookRows: 0 });
    expect(state.connection.end).toHaveBeenCalledTimes(1);
  });
  it("closes the connection after a metadata read rejects", async () => {
    const { identity } = setup();
    const pending = remoteOperation("inspect", identity);
    const rejection = expect(pending).rejects.toThrow("CONNECTION_ALREADY_CLOSED");
    await vi.waitFor(() => expect(state.reads).toBe(1));
    state.closed = true; state.release();
    await rejection;
    expect(state.connection.end).toHaveBeenCalledTimes(1);
  });
});
