import { describe, it, expect } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import {
  WindowAuthorizer,
  signWindowCommand,
} from "../../database/financialWindow/authorization";
import { WindowSession } from "../../database/financialWindow/session";
import { controlRecoveryPlan } from "../../database/financialWindow/recovery";
import { collectDrainage } from "../../database/financialWindow/drainage";
import { restoreFullBackup } from "../../database/financialWindow/backup";
const hash = "b".repeat(64);
const keys = generateKeyPairSync("ed25519");
const pub = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const priv = keys.privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
const command = {
  mode: "execute",
  operation: "activate",
  isolationApproval: { reference: "LOCAL_APPROVAL" },
};
const sign = () =>
  signWindowCommand(command, "activate", hash, "LOCAL_APPROVAL", priv);
describe("private signed window authorization and fail-closed controls", () => {
  it("accepts exactly the signed command once", () => {
    const a = new WindowAuthorizer(pub, hash),
      s = sign();
    expect(a.accept(command, "activate", s).artifactHash).toBe(hash);
    expect(() => a.accept(command, "activate", s)).toThrow();
  });
  it.each([
    "command",
    "operation",
    "artifact",
    "signature",
    "expiry",
    "identity",
  ])("rejects %s divergence", field => {
    const a = new WindowAuthorizer(pub, hash),
      s = sign();
    if (field === "signature") s.signature = "x";
    if (field === "expiry") s.body.expiresAt = "2020-01-01T00:00:00.000Z";
    if (field === "identity")
      (s.body as any).projectId = "00000000-0000-0000-0000-000000000000";
    expect(() =>
      a.accept(
        field === "command" ? { ...command, extra: true } : command,
        field === "operation" ? "release" : "activate",
        field === "artifact"
          ? { ...s, body: { ...s.body, artifactHash: "a".repeat(64) } }
          : s
      )
    ).toThrow();
  });
  it("persistent nonce consumer blocks restart replay", () => {
    const used = new Set<string>(),
      consume = (n: string) => {
        if (used.has(n)) throw Error("REPLAY");
        used.add(n);
      };
    const s = sign();
    new WindowAuthorizer(pub, hash, consume).accept(command, "activate", s);
    expect(() =>
      new WindowAuthorizer(pub, hash, consume).accept(command, "activate", s)
    ).toThrow("REPLAY");
  });
  it("dry-run is default; writes require authorization and identity before dispatch", async () => {
    let checks = 0;
    const session = new WindowSession(
      new WindowAuthorizer(pub, hash),
      {} as any,
      undefined,
      {} as any,
      async () => {
        checks++;
      }
    );
    expect(await session.dispatch({ operation: "inspect" })).toMatchObject({
      writes: false,
    });
    await expect(
      session.dispatch({ operation: "financial-b" })
    ).rejects.toThrow("WINDOW_DRY_RUN_INSPECT_ONLY");
    await expect(
      session.dispatch({ operation: "financial-b", mode: "execute" })
    ).rejects.toThrow();
    expect(checks).toBe(3);
  });
  it.each([undefined, NaN, "fresh", Infinity])(
    "rejects invalid drainage timestamp %s before any SQL",
    async observedAt => {
      let calls = 0;
      const c = {
        query: () => {
          calls++;
          throw Error("NO_SQL");
        },
      } as any;
      await expect(
        collectDrainage(c, {
          observedAt,
          httpStatus: 503,
          oldInstancesTerminated: true,
          workersPaused: true,
          dispatchersPaused: true,
          externalWriterInventoryComplete: true,
          providerCallsInFlight: 0,
          reference: "LOCAL_PROOF",
        } as any)
      ).rejects.toThrow();
      expect(calls).toBe(0);
    }
  );
  it("does not classify missing transaction-start evidence as not_started", async () => {
    const session = new WindowSession(
      new WindowAuthorizer(pub, hash),
      {} as any,
      undefined,
      {} as any,
      async () => {}
    );
    await expect(
      session.dispatch({ operation: "verify-recovery", mode: "execute" })
    ).rejects.toThrow("WINDOW_EXECUTION_START_EVIDENCE_REQUIRED");
  });
  it("control recovery needs explicit scoped approval and intact journal; no automatic retry", () => {
    expect(() => controlRecoveryPlan(false, "LOCAL_APPROVAL", hash)).toThrow();
    expect(() => controlRecoveryPlan(true, "LOCAL_APPROVAL", "bad")).toThrow();
    const p = controlRecoveryPlan(true, "LOCAL_APPROVAL", hash);
    expect(p.automaticRetry).toBe(false);
    expect(p.sql).not.toMatch(
      /skip-grant|ACCOUNT UNLOCK.*financial_window|PASSWORD/
    );
    expect(p.mysqlArgs).toContain("--skip-networking");
  });
  it("restore rejects remote socket before parsing data or connecting", async () => {
    await expect(
      restoreFullBackup(
        {
          config: {
            socketPath: "/var/run/mysqld/mysqld.sock",
            database: "l4ckos_staging",
          },
        } as any,
        {} as any,
        "/var/run/mysqld/mysqld.sock"
      )
    ).rejects.toThrow("WINDOW_RESTORE_LOCAL_ONLY");
  });
});
