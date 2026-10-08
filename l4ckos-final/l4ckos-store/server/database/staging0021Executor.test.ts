import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, symlink, unlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { TARGET, MIGRATION, PRE, POST, TTL, assertIdentity, assertPlan, digestPlan, createAuthorizedStagingContext, verifyStagingCapability, type Identity, type Plan } from "../../database/staging0021/policy";
import { createPlanFiles, withPlan, planPath } from "../../database/staging0021/store";
import { applyStaging, type StagingAdapter } from "../../database/staging0021/executor";
const identity = { ...TARGET, deploymentId: randomUUID(), connectionHash: "a".repeat(64) } as Identity;
export function testPlan(): Plan {
  const now = Date.now();
  return { version: 2, planId: randomUUID(), createdAt: new Date(now).toISOString(), expiresAt: new Date(now + TTL).toISOString(), applicationCommit: "a".repeat(40), target: identity, migration: MIGRATION, expectedPreFingerprint: PRE, observedPreFingerprint: PRE, expectedPostFingerprint: POST,
    backup: { created: true, copiedOffRuntime: true, checksumVerified: true, artifactSha256: "a".repeat(64), createdAt: new Date(now).toISOString(), rowChecksums: Object.fromEntries(Array.from({ length: 26 }, (_, i) => [`table${i}`,"a".repeat(64)])), schemaFingerprint: "a".repeat(64), sourceFingerprint: PRE, restoreVerified: true, restoreFingerprint: PRE, rowCounts: Object.fromEntries(Array.from({ length: 26 }, (_, i) => [`table${i}`,0])) }, health: { status: 200 }, governance: { checksum: "a".repeat(64), ledgerChecksum: "a".repeat(64), executionChecksum: "a".repeat(64) }, restoreProofChecksum: "a".repeat(64) };
}
describe("fixed 0021 staging plan policy", () => {
  afterEach(() => vi.restoreAllMocks());
  it("accepts only exact staging identity and refuses production/name/id/service/backend/database confusion", () => {
    expect(() => assertIdentity(identity)).not.toThrow();
    for (const change of [{ projectName: "wrong" }, { projectName: "l4ckos-production" }, { projectId: randomUUID() }, { environment: "staging" }, { service: "wrong" }, { backendHost: "l4ckos.com.br" }, { backendHost: "api.invalid" }, { connectionHash: "" }]) expect(() => assertIdentity({ ...identity, ...change } as Identity)).toThrow();
  });
  it("requires fresh complete backup and verified restore bound to canonical pre-state", () => {
    const p = testPlan(); expect(() => assertPlan(p)).not.toThrow();
    const changed = [ { ...p, expiresAt: new Date(Date.now()-1).toISOString() }, { ...p, backup: undefined }, ...[{ created: false }, { copiedOffRuntime: false }, { checksumVerified: false }, { restoreVerified: false }, { restoreFingerprint: POST }].map(b => ({ ...p, backup: { ...p.backup, ...b } })) ];
    for (const plan of changed) expect(() => assertPlan(plan as Plan)).toThrow();
  });
  it("binds digest to every plan field and refuses forged opaque capabilities", async () => {
    const p = testPlan(); expect(digestPlan({ ...p, applicationCommit: "b".repeat(40) })).not.toBe(digestPlan(p));
    await expect(verifyStagingCapability({} as any, {} as any)).rejects.toThrow("STAGING_CAPABILITY_REQUIRED");
    expect(() => createAuthorizedStagingContext({ config: {} } as any, p, identity, digestPlan(p))).toThrow("STAGING_CAPABILITY_BINDING_MISMATCH");
  });
  it("rejects edited plan, even with recomputed unkeyed digest; rejects symlinked backup", async () => {
    const p = testPlan(), file = await createPlanFiles(p, Buffer.from("synthetic"));
    const edited = { ...p, applicationCommit: "b".repeat(40) };
    const sealPath = file.replace("plan.json", "seal.json");
    const originalSeal = await readFile(sealPath, "utf8");
    await writeFile(file, JSON.stringify(edited));
    await writeFile(sealPath, JSON.stringify({ ...JSON.parse(originalSeal), planDigest: digestPlan(edited) }));
    await expect(withPlan(file, async () => null)).rejects.toThrow("STAGING_PLAN_TAMPERED");
    await writeFile(file, JSON.stringify(p));
    await writeFile(sealPath, originalSeal);
    const backup = file.replace("plan.json", "backup.json");
    await unlink(backup); await symlink(file, backup);
    await expect(withPlan(file, async () => null)).rejects.toThrow();
  });
  it("rejects relative/path traversal/unreviewed plan locations before adapter invocation", async () => {
    for (const p of ["/tmp/plan.json", "../plan.json", "/tmp/l4ckos-staging-reconciliation/../plan.json", "/etc/passwd"]) await expect(withPlan(p, async () => null)).rejects.toThrow("INVALID_PLAN_PATH");
  });
  it("blocks incorrect confirmation before any source/target/connection call", async () => {
    const p = testPlan(), file = await createPlanFiles(p, Buffer.from("synthetic"));
    await expect(applyStaging({} as StagingAdapter, file, "wrong")).rejects.toThrow("STAGING_CONFIRMATION_MISMATCH");
  });
  it("rejects an expired authenticated plan before opening any target connection", async () => {
    const p = testPlan(), file = await createPlanFiles(p, Buffer.from("synthetic"));
    vi.spyOn(Date,"now").mockReturnValue(Date.parse(p.expiresAt)+1);
    await expect(applyStaging({} as StagingAdapter,file,p.planId)).rejects.toThrow("STAGING_PLAN_EXPIRED");
  });
  it("requires a present private backup file", async () => {
    const p = testPlan(), file = await createPlanFiles(p,Buffer.from("synthetic"));
    await unlink(file.replace("plan.json","backup.json"));
    await expect(applyStaging({} as StagingAdapter,file,p.planId)).rejects.toThrow();
  });
  it("rejects arbitrary-target and generic force flags without running remote transport", () => {
    for (const args of [["prepare", "--project", "production"], ["apply", "--yes"], ["apply", "--database-url", "synthetic"], ["prepare", "--force"]]) {
      const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/staging-preorder.ts", ...args], { env: { PATH: process.env.PATH }, encoding: "utf8" });
      expect(r.status).toBe(1); expect(r.stdout + r.stderr).toContain("INVALID_STAGING_COMMAND_ARGUMENTS");
    }
  });
});
