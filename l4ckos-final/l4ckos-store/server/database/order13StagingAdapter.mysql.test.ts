import {
  proposeAuthorization,
  validateRenewable,
} from "../../database/order13Reconciliation/authorization";
const renewalClaims = vi.hoisted(() => ({
  claims: [] as { id: number; orderId: number; rowHash: string }[],
}));
vi.mock(
  "../../database/order13Reconciliation/operationalDrainage",
  async original => {
    const actual =
      await original<
        typeof import("../../database/order13Reconciliation/operationalDrainage")
      >();
    return {
      ...actual,
      ORDER13_DRAINAGE_WINDOW: {
        ...actual.ORDER13_DRAINAGE_WINDOW,
        claims: renewalClaims.claims,
      },
    };
  }
);
import { PassThrough } from "node:stream";
import { createInterface } from "node:readline";
import {
  createSupervisedObserver,
  FRAME,
} from "../../database/order13Reconciliation/supervisedObserver";
import { mysqlAdministrativeObserver } from "../../database/order13Reconciliation/administrativeObserver";
import { build } from "esbuild";
import { execFileSync, spawn } from "node:child_process";
import { verifiedLoader } from "../../database/order13Reconciliation/packaging";
import { DECISION } from "../../database/order13Reconciliation/decision";
import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { createConnection, type Connection } from "mysql2/promise";
import { randomUUID, generateKeyPairSync } from "node:crypto";
import { readFile, readdir, writeFile, rm } from "node:fs/promises";
import {
  createStagingAdapter,
  STAGING,
  validateEnvironment,
  observerTarget,
  type Readiness,
} from "../../database/order13Reconciliation/staging";
import {
  readOrder13Snapshot,
  digest,
  OPERATION,
  PAYMENT,
  CREATED,
} from "../../database/order13Reconciliation/operator";
import {
  sealBackup,
  openBackup,
} from "../../database/order13Reconciliation/backup";
const socketPath =
  process.env.L4CKOS_ORDER13_LOCAL_SOCKET ??
  "/tmp/l4ckos-order13-adapter/mysqld.sock";
const database =
  "l4ckos_order13_test_" + randomUUID().replaceAll("-", "").slice(0, 12);
const artifactHash = "a".repeat(64);
let root: Connection, c: Connection;
const env = () => ({
  RAILWAY_PROJECT_ID: STAGING.project,
  RAILWAY_ENVIRONMENT_ID: STAGING.environment,
  RAILWAY_SERVICE_ID: STAGING.service,
  RAILWAY_DEPLOYMENT_ID: STAGING.deployment,
  ASAAS_API_URL: STAGING.asaas,
  ASAAS_API_KEY: "$aact_hmlg_synthetic",
  DATABASE_URL:
    "mysql://fixture:fixture@mysql.railway.internal:3306/l4ckos_staging",
  NODE_ENV: "production",
  STAGING_MAINTENANCE_MODE: "true",
});
const q = async (sql: string, args: unknown[] = []) =>
  (await c.query<any[]>(sql, args))[0];
let calls: string[],
  paymentBody: any,
  refundBody: any,
  maintenance: boolean,
  expectedBundle: string,
  identityOK: boolean;
const open = () =>
  createConnection({
    user: "root",
    socketPath,
    database,
    dateStrings: true,
    timezone: "Z",
  });
const dependencies = () => ({
  administrativeObserver: async (
    request: Parameters<ReturnType<typeof mysqlAdministrativeObserver>>[0]
  ) => {
    const probe = await open();
    let uuidHash: string;
    try {
      const [rows] = await probe.query<any[]>(
        "SELECT SHA2(@@server_uuid,256) h"
      );
      uuidHash = rows[0].h;
      if (uuidHash === STAGING.uuidHash) throw Error("LOCAL_DB_ONLY");
    } finally {
      await probe.end();
    }
    const localTarget = { ...observerTarget, database, uuidHash };
    const result = await mysqlAdministrativeObserver(
      open,
      localTarget
    )({ ...request, target: localTarget });
    return { ...result, target: request.target };
  },
  environment: env(),
  artifactHash,
  open,
  identity: async () => ({
    database: identityOK ? STAGING.database : "wrong",
    uuidHash: STAGING.uuidHash,
  }),
  bundleHash: async () => expectedBundle,
  fetch: vi.fn(async (url: any, opts: any) => {
    expect(opts.method).toBe("GET");
    expect(opts.redirect).toBe("error");
    calls.push(String(url));
    let body: any;
    if (String(url).endsWith("/api/webhooks/asaas"))
      return new Response(
        JSON.stringify({
          code: maintenance ? "STAGING_MAINTENANCE" : "METHOD_NOT_ALLOWED",
        }),
        { status: maintenance ? 503 : 405 }
      );
    if (String(url).endsWith("/health")) body = { ok: true, maintenance };
    else if (String(url).includes("/webhooks/"))
      body = {
        id: STAGING.webhook,
        url: STAGING.backend + "/api/webhooks/asaas",
        enabled: true,
        interrupted: true,
      };
    else if (String(url).includes("/refunds?")) body = refundBody;
    else body = paymentBody;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as any,
});
function gates(cp: any): Readiness {
  return {
    operation: OPERATION,
    deployment: STAGING.deployment,
    bundleHash: STAGING.bundleHash,
    artifactHash,
    decisionHash: digest(DECISION),
    checkpointHash: digest(cp),
    panel: {
      status: "REVIEWED_NO_CONFLICTING_EVENTS",
      reference: "SYNTHETIC_PANEL_ONLY",
      reviewedAt: new Date().toISOString(),
    },
    backup: {
      status: "RESTORE_VERIFIED",
      archiveSha256: "b".repeat(64),
      sourceStateHash: cp.stateHash,
      restoredStateHash: cp.stateHash,
      manifestReference: "SYNTHETIC_MANIFEST",
      custodyReference: "SYNTHETIC_CUSTODY",
      verifiedAt: new Date().toISOString(),
    },
    quiescence: {
      status: "ALL_FINANCIAL_WRITERS_EXCLUDED",
      reference: "SYNTHETIC_WRITERS_ONLY",
      externalWritersExcluded: true,
      inFlightDrained: true,
      verifiedAt: new Date().toISOString(),
    },
  };
}
async function plan(adapter = createStagingAdapter(dependencies())) {
  const dry = await adapter.dryRun();
  if (dry.result.status !== "dry-run") throw Error("DRY_REQUIRED");
  const cp = dry.result.checkpoint,
    r = gates(cp);
  const request = {
    command: "COMMIT_ORDER13_ONCE",
    artifactHash,
    decisionHash: r.decisionHash,
    checkpoint: cp,
    evidence: dry.evidence,
    readiness: r,
    approval: {
      operation: OPERATION,
      actorUserId: 14,
      reference: "SYNTHETIC_ADAPTER_APPROVAL",
      justification:
        "Synthetic exception for order13 current available stock only",
      expiredReservationDecision: "FULFILL_WITH_CURRENT_AVAILABLE_STOCK",
      unknownReceiptTimeAccepted: true,
      stockHistoryGapAccepted: true,
      panelReviewReference: r.panel.reference,
      backupRestoreReference: r.backup.manifestReference,
      writersQuiesced: true,
      dispatchersQuiesced: true,
      notification: "ONE_HELD_INTENT_NO_DISPATCH",
      webhook: "KEEP_INTERRUPTED",
      validFrom: new Date(Date.now() - 1000).toISOString(),
      validUntil: new Date(Date.now() + 60000).toISOString(),
    },
  };
  return { adapter, request, dry };
}
describe("order13 staging adapter boundaries", () => {
  it("rejects production, wrong deployment and noninternal DB before any I/O", () => {
    for (const e of [
      { ...env(), ASAAS_API_URL: "https://api.asaas.com/v3" },
      { ...env(), RAILWAY_PROJECT_ID: "other" },
      { ...env(), RAILWAY_DEPLOYMENT_ID: "other" },
      { ...env(), DATABASE_URL: "mysql://u:p@public.example/l4ckos_staging" },
    ])
      expect(() => validateEnvironment(e)).toThrow();
  });
  it("read entry rejects accidental execute/approval/runtime configuration", async () => {
    const deps = dependencies(),
      a = createStagingAdapter(deps);
    for (const value of [
      { mode: "execute" },
      { approval: {} },
      { open: "override" },
      { command: "COMMIT_ORDER13_ONCE" },
    ])
      await expect(a.dryRun(value)).rejects.toThrow();
    expect(deps.fetch).not.toHaveBeenCalled();
  });
  it("commit requires exact separately approved request hash before I/O", async () => {
    const deps = dependencies();
    await expect(
      createStagingAdapter(deps).commit({}, "f".repeat(64))
    ).rejects.toThrow("EXPLICIT_APPROVAL_HASH_REQUIRED");
    expect(deps.fetch).not.toHaveBeenCalled();
  });
});
describe.skipIf(process.env.L4CKOS_ORDER13_ADAPTER_MYSQL !== "1")(
  "order13 staging adapter on disposable MySQL (no remote targets)",
  () => {
    beforeAll(async () => {
      if (!/^\/tmp\/l4ckos-order13-[a-z0-9-]+\/mysqld\.sock$/.test(socketPath))
        throw Error("LOCAL_ONLY");
      root = await createConnection({ user: "root", socketPath });
      await root.query("CREATE DATABASE `" + database + "`");
      c = await open();
      await q("SET time_zone='+00:00'");
      await q("SET FOREIGN_KEY_CHECKS=0");
      for (const file of await readdir("database/bootstrap/v2"))
        if (file.endsWith(".sql"))
          await q(await readFile("database/bootstrap/v2/" + file, "utf8"));
      await q(
        await readFile(
          "database/migrations/0023_asaas_webhook_inbox.sql",
          "utf8"
        )
      );
      await q("SET FOREIGN_KEY_CHECKS=1");
    });
    beforeEach(async () => {
      for (const t of [
        "notificationOutbox",
        "orderEmailEvents",
        "paymentEvents",
        "payments",
        "asaasWebhookInbox",
        "asaasWebhookEvents",
        "auditLogs",
        "stockReservations",
        "orderItems",
        "orders",
        "products",
        "users",
      ])
        await q("DELETE FROM `" + t + "`");
      await q(
        "INSERT INTO users(id,openId,role) VALUES(14,'admin-fixture','admin'),(594,'buyer-fixture','user')"
      );
      await q(
        "INSERT INTO products(id,name,category,price,stock) VALUES(1,'fixture','fixture',9900,98)"
      );
      await q(
        "INSERT INTO orders(id,userId,totalPrice,createdAt) VALUES(13,594,9900,DATE_SUB(NOW(),INTERVAL 2 HOUR)),(2,594,9900,NOW()),(3,594,9900,NOW())"
      );
      await q(
        "INSERT INTO orderItems(id,orderId,productId,productName,unitPrice,totalPrice,quantity) VALUES(14,13,1,'fixture',9900,9900,1)"
      );
      await q(
        "INSERT INTO stockReservations(id,orderId,userId,productId,orderItemId,quantity,status,expiresAt) VALUES(10,13,594,1,14,1,'active',DATE_SUB(NOW(),INTERVAL 1 HOUR))"
      );
      await q(
        "INSERT INTO auditLogs(id,action,entity,entityId,metadata) VALUES(72,'checkout.charge_created','order','13',?)",
        [JSON.stringify({ payment: { paymentId: PAYMENT, method: "PIX" } })]
      );
      const p = {
        id: CREATED,
        event: "PAYMENT_CREATED",
        payment: {
          id: PAYMENT,
          externalReference: "13",
          status: "PENDING",
          value: 99,
        },
      };
      await q(
        "INSERT INTO asaasWebhookInbox(eventId,payloadHash,payload,state,attempts,errorCode) VALUES(?,?,?,'rejected',1,'WEBHOOK_VALIDATION_REJECTED')",
        [CREATED, digest(p), JSON.stringify(p)]
      );
      await q(
        "INSERT INTO notificationOutbox(dedupeKey,type,orderId) VALUES('legacy2','payment-approved',2),('legacy3','payment-approved',3)"
      );
      calls = [];
      paymentBody = {
        id: PAYMENT,
        externalReference: "13",
        status: "RECEIVED",
        billingType: "PIX",
        value: 99,
        netValue: 98.01,
        deleted: false,
      };
      refundBody = {
        object: "list",
        data: null,
        totalCount: 0,
        hasMore: false,
        offset: 0,
        limit: 100,
      };
      maintenance = true;
      expectedBundle = STAGING.bundleHash;
      identityOK = true;
    });
    afterAll(async () => {
      await c?.end();
      if (root) {
        await root.query("DROP DATABASE `" + database + "`");
        await root.end();
      }
    });
    const snap = () => readOrder13Snapshot(c);
    describe("renewable authorization V2", () => {
      beforeEach(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      });
      async function renewable(deps = dependencies()) {
        // Synthetic historical email rows: hashes are obtained from this disposable DB only.
        await q("INSERT INTO orders(id,userId,totalPrice) VALUES(6,594,9900)");
        await q(
          "INSERT INTO orderEmailEvents(id,orderId,eventType,idempotencyKey,status) VALUES(1,6,'order_delivered_email','synthetic-6-delivered','processing'),(2,6,'review_request_email','synthetic-6-review','processing')"
        );
        const rows = await q(
          "SELECT * FROM orderEmailEvents WHERE id IN (1,2) ORDER BY id"
        );
        renewalClaims.claims.splice(
          0,
          99,
          ...rows.map(r => ({ id: r.id, orderId: 6, rowHash: digest(r) }))
        );
        const { adapter, request } = await plan(createStagingAdapter(deps));
        const now = Date.now();
        const authorization = proposeAuthorization(
          request,
          new Date(now - 300000).toISOString(),
          new Date(now + 600000).toISOString()
        );
        const approval: any = request.approval;
        approval.validFrom = authorization.validFrom;
        approval.validUntil = authorization.validUntil;
        const body = {
          authorization,
          request,
          claimsWindow: {
            id: "disposable-renewed-window",
            validFrom: new Date(now - 1000).toISOString(),
            validUntil: new Date(now + 600000).toISOString(),
          },
        };
        return { adapter, body, hash: digest(authorization) };
      }
      async function renewableLauncher(lost = false) {
        const p = await renewable();
        const bytes = Buffer.from(
          (
            await build({
              entryPoints: [
                "scripts/local-financial/order13-launcher-fixture.ts",
              ],
              bundle: true,
              platform: "node",
              format: "cjs",
              packages: "external",
              write: false,
              logLevel: "silent",
              plugins: [
                {
                  name: "local-only-claim-fixture",
                  setup(build) {
                    build.onLoad(
                      { filter: /operationalDrainage\.ts$/ },
                      () => ({
                        contents:
                          "export const ORDER13_DRAINAGE_WINDOW=" +
                          JSON.stringify({ claims: renewalClaims.claims }),
                        loader: "ts",
                      })
                    );
                  },
                },
              ],
            })
          ).outputFiles[0].contents
        );
        const { createHash } = await import("node:crypto");
        p.body.request.artifactHash = createHash("sha256")
          .update(bytes)
          .digest("hex");
        p.body.request.readiness.artifactHash = p.body.request.artifactHash;
        p.body.authorization = proposeAuthorization(
          p.body.request,
          p.body.authorization.validFrom,
          p.body.authorization.validUntil
        );
        const approvalHash = digest(p.body.authorization);
        const loader = verifiedLoader(
          bytes,
          ["--commit-order13-once", approvalHash],
          JSON.stringify({
            target: { socketPath, database },
            request: p.body,
            loseCommitAcknowledgement: lost,
          })
        );
        return {
          adapter: p.adapter,
          request: p.body.request,
          approvalHash,
          loader,
          invoke: () => "",
        };
      }
      it("integrated launcher requires runtime approval then binds the human digest across both gates", async () => {
        const p = await renewableLauncher(),
          before = await snap();
        expect((await integratedLauncher(p, "unarmed")).status).toBe(64);
        expect(await snap()).toEqual(before);
        await new Promise(r => setTimeout(r, 150));
        expect(await integratedLauncher(p)).toMatchObject({
          status: 0,
          gates: 2,
          result: { status: "completed" },
        });
        expect(
          await p.adapter.verifyOutcome({
            baselineStateHash: p.request.checkpoint.stateHash,
          })
        ).toMatchObject({
          status: "APPLIED_VERIFIED",
          approvedRequestHash: p.approvalHash,
        });
      });
      it("integrated launcher resolves lost response independently and does not retry", async () => {
        const p = await renewableLauncher(true);
        expect(await integratedLauncher(p)).toMatchObject({
          status: 1,
          gates: 2,
          result: { commitState: "unknown" },
        });
        expect(
          await p.adapter.verifyOutcome({
            baselineStateHash: p.request.checkpoint.stateHash,
          })
        ).toMatchObject({
          status: "APPLIED_VERIFIED",
          approvedRequestHash: p.approvalHash,
        });
        expect(
          (await q("SELECT COUNT(*) n FROM payments WHERE orderId=13"))[0].n
        ).toBe(1);
      });
      it("accepts five-minute-old human approval with fresh evidence and stores both digests", async () => {
        const { adapter, body, hash } = await renewable();
        expect(await adapter.commit(body, hash)).toMatchObject({
          status: "completed",
          commitState: "confirmed",
        });
        expect(
          await adapter.verifyOutcome({
            baselineStateHash: body.request.checkpoint.stateHash,
          })
        ).toMatchObject({
          status: "APPLIED_VERIFIED",
          approvedRequestHash: hash,
        });
        expect(
          (await q("SELECT stock FROM products WHERE id=1"))[0].stock
        ).toBe(97);
      });
      it.each([
        "expired authorization",
        "expired claims",
        "tampered digest",
        "financial change",
        "stale evidence",
      ])("blocks %s with baseline intact", async kind => {
        const { adapter, body, hash } = await renewable();
        const before = await snap();
        let approved = hash;
        if (kind === "expired authorization") {
          body.authorization.validUntil = new Date(
            Date.now() - 1
          ).toISOString();
          approved = digest(body.authorization);
        }
        if (kind === "expired claims")
          body.claimsWindow.validUntil = new Date(Date.now() - 1).toISOString();
        if (kind === "tampered digest") approved = "f".repeat(64);
        if (kind === "financial change")
          (body.request.evidence as any).amountCents = 10000;
        if (kind === "stale evidence")
          (body.request.evidence as any).observedAt = new Date(
            Date.now() - 120001
          ).toISOString();
        await expect(adapter.commit(body, approved)).rejects.toThrow();
        expect(await snap()).toEqual(before);
      });
      it("rejects competing transaction through the preserved administrative gate", async () => {
        const deps = dependencies();
        const blocker = await open();
        try {
          const { adapter, body, hash } = await renewable(deps);
          const before = await snap();
          await blocker.beginTransaction();
          await blocker.query("SELECT id FROM orders WHERE id=6 FOR UPDATE");
          await expect(adapter.commit(body, hash)).rejects.toThrow();
          await blocker.rollback();
          expect(await snap()).toEqual(before);
        } finally {
          await blocker.end();
        }
      });
      it("second gate failure rolls back all effects under renewed authorization", async () => {
        const deps = dependencies(),
          observe = deps.administrativeObserver;
        let calls = 0;
        deps.administrativeObserver = async r => {
          if (++calls === 2) throw Error("SECOND_GATE_LOST");
          return observe(r);
        };
        const { adapter, body, hash } = await renewable(deps),
          before = await snap();
        await expect(adapter.commit(body, hash)).rejects.toMatchObject({
          commitState: "rolled_back",
        });
        expect(calls).toBe(2);
        expect(await snap()).toEqual(before);
      });
      it("lost commit response resolves independently with authorization digest and no retry", async () => {
        const deps = dependencies();
        let commits = 0;
        deps.open = async () => {
          const c = await open(),
            commit = c.commit.bind(c);
          c.commit = async () => {
            commits++;
            await commit();
            throw Error("LOST_RESPONSE");
          };
          return c;
        };
        const { adapter, body, hash } = await renewable(deps);
        await expect(adapter.commit(body, hash)).rejects.toMatchObject({
          commitState: "unknown",
        });
        expect(
          await adapter.verifyOutcome({
            baselineStateHash: body.request.checkpoint.stateHash,
          })
        ).toMatchObject({
          status: "APPLIED_VERIFIED",
          approvedRequestHash: hash,
        });
        expect(commits).toBe(1);
        expect(
          (await q("SELECT stock FROM products WHERE id=1"))[0].stock
        ).toBe(97);
      });
      it("changed historical claim blocks the renewed operational exception", async () => {
        const { adapter, body, hash } = await renewable();
        await q(
          "UPDATE orderEmailEvents SET attemptCount=attemptCount+1 WHERE id=1"
        );
        const before = await snap();
        await expect(adapter.commit(body, hash)).rejects.toThrow();
        expect(await snap()).toEqual(before);
      });
    });
    it("dry-run delegates to the shared core and leaves all scoped rows unchanged", async () => {
      const before = await snap(),
        r = await createStagingAdapter(dependencies()).dryRun();
      expect(r.result).toMatchObject({
        status: "dry-run",
        mutations: 0,
        stock: { stock: 98, available: 98 },
      });
      expect(await snap()).toEqual(before);
    });
    it.each(["identity", "bundle"])(
      "refuses %s mismatch before any business write",
      async kind => {
        const before = await snap();
        if (kind === "identity") identityOK = false;
        else expectedBundle = "f".repeat(64);
        await expect(
          createStagingAdapter(dependencies()).dryRun()
        ).rejects.toThrow();
        expect(await snap()).toEqual(before);
      }
    );
    it("refuses missing backup or quiescence attestations", async () => {
      const { adapter, request } = await plan();
      delete (request.readiness as any).backup;
      const before = await snap();
      await expect(adapter.commit(request, digest(request))).rejects.toThrow();
      expect(await snap()).toEqual(before);
    });
    it("requires proven live maintenance, not an approval boolean", async () => {
      const { adapter, request } = await plan();
      maintenance = false;
      const before = await snap();
      await expect(adapter.commit(request, digest(request))).rejects.toThrow(
        "LIVE_MAINTENANCE_NOT_PROVEN"
      );
      expect(await snap()).toEqual(before);
    });
    it("refuses a backup restored from another checkpoint", async () => {
      const { adapter, request } = await plan();
      request.readiness.backup.restoredStateHash = "f".repeat(64);
      const before = await snap();
      await expect(adapter.commit(request, digest(request))).rejects.toThrow(
        "BACKUP_BASELINE_MISMATCH"
      );
      expect(await snap()).toEqual(before);
    });
    it("executes only the reused core, then verifies independently and does not duplicate on reentry", async () => {
      const { adapter, request } = await plan();
      const initial = await snap();
      expect(await adapter.commit(request, digest(request))).toMatchObject({
        status: "completed",
        independentlyVerified: true,
      });
      const after = await snap();
      expect(await adapter.commit(request, digest(request))).toMatchObject({
        status: "already_completed",
      });
      expect(await snap()).toEqual(after);
      expect(after.state.asaasWebhookInbox).toEqual(
        initial.state.asaasWebhookInbox
      );
      expect(
        after.state.notificationOutbox.filter((v: any) => v.orderId !== 13)
      ).toEqual(initial.state.notificationOutbox);
      expect(after.state.asaasWebhookEvents).toHaveLength(0);
      expect(after.state.paymentEvents).toHaveLength(0);
    });
    it("a refund appearing at the final GET rolls back the full transaction", async () => {
      const deps = dependencies(),
        fetcher = deps.fetch;
      let reads = 0;
      deps.fetch = (async (url: any, options: any) => {
        if (String(url).includes("/refunds?") && ++reads === 3)
          return new Response(
            JSON.stringify({
              ...refundBody,
              totalCount: 1,
              data: [{ status: "PENDING", value: 99 }],
            }),
            { status: 200 }
          );
        return fetcher(url, options);
      }) as any;
      const { adapter, request } = await plan(createStagingAdapter(deps)),
        before = await snap();
      await expect(
        adapter.commit(request, digest(request))
      ).rejects.toMatchObject({ commitState: "rolled_back" });
      expect(await snap()).toEqual(before);
    });
    it("denied transaction visibility blocks before any financial write", async () => {
      const deps = dependencies();
      deps.administrativeObserver = async () => {
        throw Error("OBSERVER_VISIBILITY_INCOMPLETE");
      };
      const { adapter, request } = await plan(createStagingAdapter(deps)),
        before = await snap();
      await expect(adapter.commit(request, digest(request))).rejects.toThrow(
        "OBSERVER_VISIBILITY_INCOMPLETE"
      );
      expect(await snap()).toEqual(before);
    });
    it("administrative observer failure at second gate rolls back all financial effects", async () => {
      const deps = dependencies(),
        observer = deps.administrativeObserver;
      let gates = 0;
      deps.administrativeObserver = async request => {
        if (++gates === 2) throw Error("OBSERVER_VISIBILITY_INCOMPLETE");
        return observer(request);
      };
      const { adapter, request } = await plan(createStagingAdapter(deps)),
        before = await snap();
      await new Promise(resolve => setTimeout(resolve, 150));
      await expect(
        adapter.commit(request, digest(request))
      ).rejects.toMatchObject({ commitState: "rolled_back" });
      expect(gates).toBe(2);
      expect(await snap()).toEqual(before);
    });
    function bridge(deps: ReturnType<typeof dependencies>, loseSecond = false) {
      const input = new PassThrough(),
        output = new PassThrough(),
        runId = randomUUID();
      const original = deps.administrativeObserver;
      let gates = 0;
      const lines = createInterface({ input: output });
      lines.on("line", line => {
        void (async () => {
          const frame = JSON.parse(line.slice(FRAME.length));
          ++gates;
          if (loseSecond && gates === 2) {
            input.end();
            return;
          }
          const observation = await original(frame.request);
          const admin = await open();
          try {
            const [rows] = await admin.execute<any[]>(
              "SELECT COUNT(*) n FROM information_schema.INNODB_TRX WHERE trx_mysql_thread_id=?",
              [frame.request.operatorSession]
            );
            input.write(
              FRAME +
                JSON.stringify({
                  version: 1,
                  runId,
                  gate: frame.gate,
                  ...frame.request.target,
                  nonce: observation.nonce,
                  operatorSession: observation.operatorSession,
                  account: "root@localhost",
                  observedAt: observation.observedAt,
                  otherTransactions: observation.otherTransactions,
                  operatorVisible: observation.operatorVisible ? 1 : 0,
                  operatorInTransaction: Number(rows[0].n),
                }) +
                "\n"
            );
          } finally {
            await admin.end();
          }
        })().catch(() => input.end());
      });
      deps.administrativeObserver = createSupervisedObserver(
        input,
        output,
        runId
      );
      return {
        gates: () => gates,
        close: () => {
          input.end();
          output.end();
          lines.close();
        },
      };
    }
    it("supervised bridge loss between financial gates rolls back the complete snapshot", async () => {
      const deps = dependencies(),
        channel = bridge(deps, true);
      try {
        const { adapter, request } = await plan(createStagingAdapter(deps)),
          before = await snap();
        await new Promise(resolve => setTimeout(resolve, 150));
        await expect(
          adapter.commit(request, digest(request))
        ).rejects.toMatchObject({ commitState: "rolled_back" });
        expect(channel.gates()).toBe(2);
        expect(await snap()).toEqual(before);
      } finally {
        channel.close();
      }
    });
    it("supervised bridge recovers a lost commit response by independent read only", async () => {
      const deps = dependencies(),
        channel = bridge(deps);
      deps.open = async () => {
        const c = await open(),
          commit = c.commit.bind(c);
        c.commit = async () => {
          await commit();
          throw Error("synthetic lost response");
        };
        return c;
      };
      try {
        const { adapter, request } = await plan(createStagingAdapter(deps));
        await new Promise(resolve => setTimeout(resolve, 150));
        await expect(
          adapter.commit(request, digest(request))
        ).rejects.toMatchObject({ commitState: "unknown" });
        expect(channel.gates()).toBe(2);
        expect(
          await adapter.verifyOutcome({
            baselineStateHash: request.checkpoint.stateHash,
          })
        ).toMatchObject({ status: "APPLIED_VERIFIED" });
        expect(
          (await q("SELECT COUNT(*) n FROM payments WHERE orderId=13"))[0].n
        ).toBe(1);
        expect(
          (await q("SELECT stock FROM products WHERE id=1"))[0].stock
        ).toBe(97);
      } finally {
        channel.close();
      }
    });
    async function launcherPlan(loseCommitAcknowledgement = false) {
      const bytes = Buffer.from(
        (
          await build({
            entryPoints: [
              "scripts/local-financial/order13-launcher-fixture.ts",
            ],
            bundle: true,
            platform: "node",
            format: "cjs",
            packages: "external",
            write: false,
            logLevel: "silent",
          })
        ).outputFiles[0].contents
      );
      const { adapter, request } = await plan();
      const { createHash } = await import("node:crypto");
      const h = createHash("sha256").update(bytes).digest("hex");
      request.artifactHash = h;
      request.readiness.artifactHash = h;
      const approvalHash = digest(request);
      const loader = verifiedLoader(
        bytes,
        ["--commit-order13-once", approvalHash],
        JSON.stringify({
          target: { socketPath, database },
          request,
          loseCommitAcknowledgement,
        })
      );
      const invoke = (armed: boolean) =>
        execFileSync(
          process.execPath,
          [
            "--input-type=commonjs",
            "-",
            ...(armed ? ["--authorize-order13-at-runtime", approvalHash] : []),
          ],
          {
            input: loader,
            encoding: "utf8",
            env: {
              ...process.env,
              NODE_PATH: process.cwd() + "/node_modules",
              L4CKOS_ORDER13_LAUNCHER_TEST: "1",
            },
            stdio: ["pipe", "pipe", "pipe"],
          }
        );
      return { adapter, request, invoke, loader, approvalHash };
    }
    async function integratedLauncher(
      p: Awaited<ReturnType<typeof launcherPlan>>,
      fault = ""
    ) {
      const runId = randomUUID();
      const code = execFileSync(
        "python3",
        [
          "-c",
          "import importlib.util,json,sys; s=importlib.util.spec_from_file_location('s','scripts/order13-supervised-observer.py'); m=importlib.util.module_from_spec(s);s.loader.exec_module(m);v=json.load(sys.stdin);print(m.loader_bootstrap(v['loader'].encode(),v['run'],v['approval']))",
        ],
        {
          input: JSON.stringify({
            loader: p.loader,
            run: runId,
            approval: fault === "unarmed" ? null : p.approvalHash,
          }),
          encoding: "utf8",
        }
      ).trim();
      const child = spawn(process.execPath, ["-e", code], {
        env: {
          ...process.env,
          NODE_PATH: process.cwd() + "/node_modules",
          L4CKOS_ORDER13_LAUNCHER_TEST: "1",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const lines = createInterface({ input: child.stdout });
      let gates = 0,
        result: any,
        other: any;
      let failure: unknown;
      const tasks: Promise<unknown>[] = [];
      lines.on("line", line => {
        tasks.push(
          (async () => {
            if (!line.startsWith(FRAME)) {
              result = JSON.parse(line);
              child.stdin.end();
              return;
            }
            const frame = JSON.parse(line.slice(FRAME.length));
            ++gates;
            expect(frame.runId).toBe(runId);
            if (fault === "eof" && gates === 2) {
              child.stdin.end();
              return;
            }
            if (fault === "concurrent" && gates === 2) {
              other = await open();
              await other.beginTransaction();
              await other.query("SELECT id FROM users WHERE id=14");
              await new Promise(r => setTimeout(r, 150));
            }
            const observation = await dependencies().administrativeObserver(
                frame.request
              ),
              admin = await open();
            try {
              const [active] = await admin.execute<any[]>(
                "SELECT COUNT(*) n FROM information_schema.INNODB_TRX WHERE trx_mysql_thread_id=?",
                [frame.request.operatorSession]
              );
              child.stdin.write(
                FRAME +
                  JSON.stringify({
                    version: 1,
                    runId,
                    gate: frame.gate,
                    ...frame.request.target,
                    nonce: observation.nonce,
                    operatorSession: observation.operatorSession,
                    account: "root@localhost",
                    observedAt: observation.observedAt,
                    operatorVisible: observation.operatorVisible ? 1 : 0,
                    operatorInTransaction: Number(active[0].n),
                    otherTransactions: observation.otherTransactions,
                  }) +
                  "\n"
              );
            } finally {
              await admin.end();
            }
          })().catch(e => {
            failure = e;
            child.stdin.end();
          })
        );
      });
      const status = await new Promise<number | null>(resolve =>
        child.on("close", resolve)
      );
      await Promise.all(tasks);
      lines.close();
      if (other) {
        await other.rollback();
        await other.end();
      }
      if (failure) throw failure;
      return { status, result, gates };
    }
    it("integrated supervisor bootstrap keeps runtime authorization mandatory", async () => {
      const p = await launcherPlan(),
        before = await snap();
      expect((await integratedLauncher(p, "unarmed")).status).toBe(64);
      expect(await snap()).toEqual(before);
    });
    it("integrated supervisor launcher executes once and preserves idempotent reentry", async () => {
      const p = await launcherPlan();
      await new Promise(r => setTimeout(r, 150));
      expect(await integratedLauncher(p)).toMatchObject({
        status: 0,
        gates: 2,
        result: { status: "completed" },
      });
      const completed = await snap();
      expect(await integratedLauncher(p)).toMatchObject({
        status: 0,
        gates: 0,
        result: { status: "already_completed" },
      });
      expect(await snap()).toEqual(completed);
    });
    it("integrated supervisor loss between gates rolls back the full snapshot", async () => {
      const p = await launcherPlan(),
        before = await snap();
      await new Promise(r => setTimeout(r, 150));
      expect(await integratedLauncher(p, "eof")).toMatchObject({
        status: 1,
        gates: 2,
        result: { commitState: "rolled_back" },
      });
      expect(await snap()).toEqual(before);
    });
    it("integrated supervisor refuses a competing transaction at the final gate", async () => {
      const p = await launcherPlan(),
        before = await snap();
      await new Promise(r => setTimeout(r, 150));
      expect(await integratedLauncher(p, "concurrent")).toMatchObject({
        status: 1,
        gates: 2,
        result: { commitState: "rolled_back" },
      });
      expect(await snap()).toEqual(before);
    });
    it("integrated supervisor lost commit response resolves through independent read without retry", async () => {
      const p = await launcherPlan(true);
      await new Promise(r => setTimeout(r, 150));
      expect(await integratedLauncher(p)).toMatchObject({
        status: 1,
        gates: 2,
        result: { commitState: "unknown" },
      });
      expect(
        await p.adapter.verifyOutcome({
          baselineStateHash: p.request.checkpoint.stateHash,
        })
      ).toMatchObject({
        status: "APPLIED_VERIFIED",
        approvedRequestHash: p.approvalHash,
      });
      expect(
        (await q("SELECT COUNT(*) n FROM payments WHERE orderId=13"))[0].n
      ).toBe(1);
      expect((await q("SELECT stock FROM products WHERE id=1"))[0].stock).toBe(
        97
      );
    });
    it("integrated supervisor package binds the actual artifacts and refuses tampering", async () => {
      const path =
          "/tmp/l4ckos-order13-approved-fixture-" +
          randomUUID().replaceAll("-", ""),
        input = path + "-request.json";
      try {
        const { request } = await plan();
        const bytes = (
          await build({
            entryPoints: ["scripts/order13-staging-commit.ts"],
            bundle: true,
            platform: "node",
            packages: "external",
            format: "cjs",
            write: false,
            logLevel: "silent",
          })
        ).outputFiles[0].contents;
        const { createHash } = await import("node:crypto");
        const sha = (b: any) => createHash("sha256").update(b).digest("hex");
        request.artifactHash = sha(bytes);
        request.readiness.artifactHash = request.artifactHash;
        const approved = digest(request);
        await writeFile(input, JSON.stringify(request), {
          mode: 0o600,
          flag: "wx",
        });
        const manifest = JSON.parse(
          execFileSync(
            process.execPath,
            [
              "--import",
              "tsx",
              "scripts/prepare-order13-staging.ts",
              "--out",
              path,
              "--approval-file",
              input,
              "--approval-sha256",
              approved,
            ],
            { encoding: "utf8" }
          )
        );
        expect(manifest.commitPrepared).toBe(true);
        expect(manifest.commitHash).toBe(request.artifactHash);
        expect(manifest.files["supervisor.py"]).toBe(
          sha(await readFile("scripts/order13-supervised-observer.py"))
        );
        const verify = () =>
          execFileSync(
            "python3",
            [
              "-c",
              "import importlib.util,sys; s=importlib.util.spec_from_file_location('s','scripts/order13-supervised-observer.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m); f=m.load_package(*sys.argv[1:]);assert 'verify-outcome.loader.cjs' in f;print('PASS')",
              path,
              manifest.manifestSha256,
              approved,
            ],
            { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
          );
        expect(verify().trim()).toBe("PASS");
        await writeFile(path + "/socket-observer.sh", "# tampered fixture", {
          mode: 0o600,
        });
        expect(verify).toThrow();
      } finally {
        await rm(path, { recursive: true, force: true });
        await rm(input, { force: true });
      }
    });
    it("actual launcher refuses accidental invocation, then executes once only on the disposable DB", async () => {
      const { adapter, request, invoke } = await launcherPlan();
      const before = await snap();
      expect(() => invoke(false)).toThrow();
      expect(await snap()).toEqual(before);
      expect(JSON.parse(invoke(true))).toMatchObject({
        status: "completed",
        independentlyVerified: true,
      });
      const after = await snap();
      expect(JSON.parse(invoke(true))).toMatchObject({
        status: "already_completed",
      });
      expect(await snap()).toEqual(after);
      const count = calls.length;
      expect(
        await adapter.verifyOutcome({
          baselineStateHash: request.checkpoint.stateHash,
        })
      ).toMatchObject({ status: "APPLIED_VERIFIED", mutations: 0 });
      expect(calls.length).toBe(count);
    });
    it("lost launcher response is resolved by read-only outcome inspection without executing again", async () => {
      const { adapter, request, invoke } = await launcherPlan(true);
      expect(() => invoke(true)).toThrow();
      const after = await snap();
      expect(
        await adapter.verifyOutcome({
          baselineStateHash: request.checkpoint.stateHash,
        })
      ).toMatchObject({ status: "APPLIED_VERIFIED" });
      expect(await snap()).toEqual(after);
    });
    it("outcome inspection distinguishes untouched baseline from partial/divergent state", async () => {
      const { adapter, request } = await plan();
      expect(
        await adapter.verifyOutcome({
          baselineStateHash: request.checkpoint.stateHash,
        })
      ).toMatchObject({ status: "NOT_APPLIED_BASELINE_INTACT", mutations: 0 });
      await q("UPDATE products SET stock=97 WHERE id=1");
      const after = await snap();
      expect(
        await adapter.verifyOutcome({
          baselineStateHash: request.checkpoint.stateHash,
        })
      ).toMatchObject({ status: "DIVERGED_OR_PARTIAL", mutations: 0 });
      expect(await snap()).toEqual(after);
    });
    it("encrypted scoped backup detects tampering and restores identical row hashes in the disposable DB", async () => {
      const before = await snap();
      const keys = generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
      });
      const sealed = sealBackup(before, keys.publicKey);
      expect(JSON.stringify(sealed)).not.toContain("buyer-fixture");
      const recovered = openBackup(sealed, keys.privateKey);
      expect(recovered).toEqual(before);
      expect(() =>
        openBackup(
          { ...sealed, ciphertext: sealed.ciphertext.slice(0, -4) + "AAAA" },
          keys.privateKey
        )
      ).toThrow();
      // Restore fixture only; production has no restore entrypoint.
      await q("SET FOREIGN_KEY_CHECKS=0");
      for (const t of Object.keys(recovered.state))
        await q("DELETE FROM `" + t + "`");
      for (const [t, rows] of Object.entries(recovered.state))
        for (const row of rows as Record<string, unknown>[])
          await c.query("INSERT INTO ?? SET ?", [t, row]);
      await q("SET FOREIGN_KEY_CHECKS=1");
      expect(await snap()).toEqual(before);
    });
  }
);
