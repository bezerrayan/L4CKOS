import {
  validateRenewable,
  validPeriod,
  type Renewable,
} from "./authorization";
import { ORDER13_DRAINAGE_WINDOW } from "./operationalDrainage";
import { runtimeSupervisedObserver } from "./supervisedObserver";
import {
  mysqlAdministrativeObserver,
  observeAdministrativeGate,
  type AdministrativeObserver,
} from "./administrativeObserver";
import { DECISION } from "./decision";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createConnection, type Connection } from "mysql2/promise";
import { z } from "zod";
import {
  digest,
  evidenceFromSandbox,
  runOrder13Transaction,
  readOrder13Snapshot,
  inspectOrder13Outcome,
  OPERATION,
  type Approval,
  type Evidence,
  type Checkpoint,
  type Order13Runtime,
} from "./operator";

export const STAGING = Object.freeze({
  project: "2bb90c8e-eb65-43ee-826b-f93750f0499c",
  environment: "15545eee-bc02-4b70-afc4-19a5db9e6f46",
  service: "9f1c7705-f2f9-48cf-b957-8f63a6bba4db",
  deployment: "a75f3a82-3b4e-4c25-bf2d-de5cc358eaf6",
  mysqlService: "bcda5d78-4a0d-4682-8659-8316847addb7",
  database: "l4ckos_staging",
  uuidHash: "92e96ae744d2112c5b4a430abc9a75d557a43d293652dd68369aa81786479f09",
  bundleHash:
    "bddfa32b7a24b2aaa71c405143b499329212fa3e7c6001749b067aa8d4f7f457",
  backend: "https://api-staging.l4ckos.com.br",
  asaas: "https://api-sandbox.asaas.com/v3",
  webhook: "7f9041aa-8df5-4e35-af6c-84b4ef5e18bb",
});
export const observerTarget = Object.freeze({
  project: STAGING.project,
  environment: STAGING.environment,
  mysqlService: STAGING.mysqlService,
  database: STAGING.database,
  uuidHash: STAGING.uuidHash,
});
const hash = z.string().regex(/^[a-f0-9]{64}$/),
  stamp = z.string().datetime({ offset: true });
export const readinessSchema = z
  .object({
    operation: z.literal(OPERATION),
    deployment: z.literal(STAGING.deployment),
    bundleHash: z.literal(STAGING.bundleHash),
    artifactHash: hash,
    decisionHash: hash,
    checkpointHash: hash,
    panel: z
      .object({
        status: z.literal("REVIEWED_NO_CONFLICTING_EVENTS"),
        reference: z.string().min(8),
        reviewedAt: stamp,
      })
      .strict(),
    backup: z
      .object({
        status: z.literal("RESTORE_VERIFIED"),
        archiveSha256: hash,
        sourceStateHash: hash,
        restoredStateHash: hash,
        manifestReference: z.string().min(8),
        custodyReference: z.string().min(8),
        verifiedAt: stamp,
      })
      .strict(),
    quiescence: z
      .object({
        status: z.literal("ALL_FINANCIAL_WRITERS_EXCLUDED"),
        reference: z.string().min(8),
        externalWritersExcluded: z.literal(true),
        inFlightDrained: z.literal(true),
        verifiedAt: stamp,
      })
      .strict(),
  })
  .strict();
export type Readiness = z.infer<typeof readinessSchema>;
export const commitSchema = z
  .object({
    command: z.literal("COMMIT_ORDER13_ONCE"),
    artifactHash: hash,
    decisionHash: hash,
    checkpoint: z
      .object({
        operation: z.literal(OPERATION),
        observedAt: stamp,
        stateHash: hash,
        evidenceHash: hash,
      })
      .strict(),
    evidence: z.unknown(),
    approval: z.unknown(),
    readiness: readinessSchema,
  })
  .strict();
export type StagingDependencies = {
  environment: Record<string, string | undefined>;
  artifactHash: string;
  open: () => Promise<Connection>;
  identity: (c: Connection) => Promise<{ database: string; uuidHash: string }>;
  bundleHash: () => Promise<string>;
  fetch: typeof fetch;
  administrativeObserver?: AdministrativeObserver;
};
function requireThat(ok: unknown, code: string): asserts ok {
  if (!ok) throw Error(code);
}
export function validateEnvironment(env: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries({
    RAILWAY_PROJECT_ID: STAGING.project,
    RAILWAY_ENVIRONMENT_ID: STAGING.environment,
    RAILWAY_SERVICE_ID: STAGING.service,
    RAILWAY_DEPLOYMENT_ID: STAGING.deployment,
  }))
    requireThat(env[k] === v, "STAGING_IDENTITY_MISMATCH");
  requireThat(
    env.ASAAS_API_URL === STAGING.asaas &&
      env.ASAAS_API_KEY?.startsWith("$aact_hmlg_"),
    "SANDBOX_REQUIRED"
  );
  const u = new URL(env.DATABASE_URL ?? "");
  requireThat(
    u.protocol === "mysql:" &&
      u.hostname === "mysql.railway.internal" &&
      u.pathname === "/" + STAGING.database &&
      (!u.port || u.port === "3306") &&
      !u.search &&
      !u.hash &&
      u.username &&
      u.password,
    "STAGING_DATABASE_TARGET_MISMATCH"
  );
  return u;
}
function young(value: string, ttl = 120000) {
  const age = Date.now() - Date.parse(value);
  requireThat(
    Number.isFinite(age) && age >= -5000 && age <= ttl,
    "READINESS_STALE"
  );
}
function financialIdentity(e: Evidence) {
  const { observedAt, ...rest } = e;
  return digest(rest);
}
/** DI exists only for disposable tests. Entrypoints below always construct fixed live dependencies. */
export function createStagingAdapter(deps: StagingDependencies) {
  const env = Object.freeze({ ...deps.environment });
  async function identity(c: Connection) {
    validateEnvironment(env);
    requireThat(
      (await deps.bundleHash()) === STAGING.bundleHash,
      "STAGING_BUNDLE_CHANGED"
    );
    const i = await deps.identity(c);
    requireThat(
      i.database === STAGING.database && i.uuidHash === STAGING.uuidHash,
      "STAGING_PHYSICAL_DATABASE_MISMATCH"
    );
  }
  async function get(path: string, backend = false) {
    const base = backend ? STAGING.backend : STAGING.asaas;
    const url = base + path;
    const r = await deps.fetch(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: backend ? {} : { access_token: env.ASAAS_API_KEY! },
    });
    requireThat(
      r.status === 200 && !r.redirected && (!r.url || r.url === url),
      "READ_ONLY_GET_FAILED"
    );
    return r.json();
  }
  async function finance() {
    validateEnvironment(env);
    const at = new Date().toISOString();
    const payment = await get("/payments/pay_dog6ppexq4gyw3k6");
    const refunds = await get(
      "/payments/pay_dog6ppexq4gyw3k6/refunds?offset=0&limit=100"
    );
    return evidenceFromSandbox(payment, refunds, at);
  }
  async function pausedWebhook() {
    const w = await get("/webhooks/" + STAGING.webhook);
    requireThat(
      w.id === STAGING.webhook &&
        w.url === STAGING.backend + "/api/webhooks/asaas" &&
        w.enabled === true &&
        w.interrupted === true,
      "WEBHOOK_MUST_REMAIN_INTERRUPTED"
    );
  }
  const runtime: Order13Runtime = {
    open: deps.open,
    assertIdentity: identity,
    localRehearsal: false,
  };
  async function dryRun(raw: unknown = {}) {
    // Read API accepts no execute flag, approval, runtime override or arbitrary configuration.
    z.object({}).strict().parse(raw);
    validateEnvironment(env);
    await pausedWebhook();
    const evidence = await finance();
    const result = await runOrder13Transaction(runtime, {
      mode: "dry-run",
      evidence,
    });
    const data = await captureBackup();
    if (result.status === "dry-run")
      requireThat(
        data.stateHash === result.checkpoint.stateHash,
        "STATE_CHANGED_AFTER_DRY_RUN"
      );
    const observations = {
      inbox: data.state.asaasWebhookInbox.map(r => ({
        eventId: r.eventId,
        state: r.state,
        attempts: r.attempts,
        payloadHash: r.payloadHash,
        eventType: JSON.parse(r.payload ?? "{}").event,
      })),
      ledger: data.state.asaasWebhookEvents.map(r => ({
        eventId: r.eventId,
        eventType: r.eventType,
        status: r.status,
      })),
      paymentEvents: data.state.paymentEvents.map(r => ({
        eventId: r.providerEventId,
        eventType: r.eventType,
        status: r.processingStatus,
      })),
      outbox: data.state.notificationOutbox.map(r => ({
        id: r.id,
        orderId: r.orderId,
        type: r.type,
        status: r.status,
        attempts: r.attempts,
      })),
    };
    return {
      observations,
      phase: "dry-run" as const,
      remoteMutations: 0,
      target: STAGING,
      artifactHash: deps.artifactHash,
      evidence,
      result,
      executionReadiness: "NOT_ATTESTED",
      backup: "NOT_CAPTURED_BY_DRY_RUN",
      quiescence: "NOT_CHANGED",
    };
  }
  async function preflight(raw: unknown = {}) {
    const result = await dryRun(raw);
    return {
      phase: "preflight" as const,
      remoteMutations: 0,
      target: STAGING,
      artifactHash: deps.artifactHash,
      evidence: result.evidence,
      observations: result.observations,
      checksPassed: true,
      executionReadiness: "NOT_ATTESTED",
    };
  }
  async function captureBackup() {
    validateEnvironment(env);
    const c = await deps.open();
    try {
      await identity(c);
      const snapshot = await readOrder13Snapshot(c);
      const schema: Record<string, string> = {};
      for (const table of Object.keys(snapshot.state)) {
        const [rows] = await c.query<any[]>(
          "SHOW CREATE TABLE `" + table + "`"
        );
        schema[table] = rows[0]["Create Table"];
      }
      return { ...snapshot, schema };
    } finally {
      await c.end();
    }
  }
  async function readiness(
    c: Connection,
    r: Readiness,
    checkpoint: Checkpoint,
    observe = true
  ) {
    await identity(c);
    young(r.panel.reviewedAt, 15 * 60000);
    young(r.backup.verifiedAt, 15 * 60000);
    young(r.quiescence.verifiedAt);
    requireThat(
      r.backup.sourceStateHash === checkpoint.stateHash &&
        r.backup.restoredStateHash === checkpoint.stateHash,
      "BACKUP_BASELINE_MISMATCH"
    );
    requireThat(
      env.NODE_ENV === "production" && env.STAGING_MAINTENANCE_MODE === "true",
      "MAINTENANCE_NOT_PROVEN"
    );
    const health = await get("/health", true);
    requireThat(health.ok === true, "LIVE_MAINTENANCE_NOT_PROVEN");
    const probe = await deps.fetch(STAGING.backend + "/api/webhooks/asaas", {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    const probeBody = await probe.json();
    requireThat(
      probe.status === 503 &&
        !probe.redirected &&
        probeBody.code === "STAGING_MAINTENANCE",
      "LIVE_MAINTENANCE_NOT_PROVEN"
    );
    await pausedWebhook();
    if (observe)
      await observeAdministrativeGate(
        c,
        deps.administrativeObserver,
        observerTarget
      );
    const [events] = await c.query<any[]>(
      "SELECT COUNT(*) n FROM information_schema.EVENTS WHERE EVENT_SCHEMA=DATABASE() AND STATUS='ENABLED'"
    );
    requireThat(Number(events[0].n) === 0, "DATABASE_SCHEDULER_NOT_QUIESCED");
    young(r.quiescence.verifiedAt);
    young(r.panel.reviewedAt, 15 * 60000);
    young(r.backup.verifiedAt, 15 * 60000);
  }
  async function commit(raw: unknown, approvedRequestHash: string) {
    // Legacy V1 remains byte-bound and cannot acquire V2 renewal implicitly.
    let renewal: Renewable | undefined;
    if (raw && typeof raw === "object" && "authorization" in raw) {
      renewal = validateRenewable(raw, approvedRequestHash);
      raw = renewal.request;
    }
    const checkAuthorization = () => {
      if (renewal) {
        validateRenewable(renewal, approvedRequestHash);
        validPeriod(renewal.claimsWindow);
      }
    };
    const checkClaims = async (c: Connection) => {
      if (!renewal) return;
      checkAuthorization();
      const [claims] = await c.query<any[]>(
        "SELECT * FROM orderEmailEvents WHERE id IN (1,2) ORDER BY id FOR SHARE NOWAIT"
      );
      for (const expected of ORDER13_DRAINAGE_WINDOW.claims) {
        const rows = claims.filter(r => Number(r.id) === expected.id);
        requireThat(
          rows.length === 1 &&
            Number(rows[0].orderId) === 6 &&
            rows[0].status === "processing" &&
            digest(rows[0]) === expected.rowHash,
          "HISTORICAL_CLAIM_CHANGED"
        );
      }
      const [queues] = await c.query<any[]>(
        "SELECT (SELECT COUNT(*) FROM orderEmailEvents WHERE status='processing' AND id NOT IN (1,2)) emails,(SELECT COUNT(*) FROM asaasWebhookInbox WHERE state='processing') inbox,(SELECT COUNT(*) FROM notificationOutbox WHERE status='processing') outbox"
      );
      requireThat(
        Number(queues[0].emails) === 0 &&
          Number(queues[0].inbox) === 0 &&
          Number(queues[0].outbox) === 0,
        "WRITERS_NOT_DRAINED"
      );
    };
    // This function is never reachable from the read-only CLI.
    requireThat(
      hash.safeParse(approvedRequestHash).success &&
        (renewal !== undefined || digest(raw) === approvedRequestHash),
      "EXPLICIT_APPROVAL_HASH_REQUIRED"
    );
    const request = commitSchema.parse(raw);
    requireThat(
      request.decisionHash === digest(DECISION),
      "OPERATIONAL_DECISION_MISMATCH"
    );
    const references = z
      .object({
        panelReviewReference: z.string(),
        backupRestoreReference: z.string(),
      })
      .parse(request.approval);
    requireThat(
      references.panelReviewReference === request.readiness.panel.reference &&
        references.backupRestoreReference ===
          request.readiness.backup.manifestReference,
      "APPROVAL_REFERENCES_MISMATCH"
    );

    validateEnvironment(env);
    requireThat(
      request.artifactHash === deps.artifactHash &&
        request.readiness.artifactHash === deps.artifactHash &&
        request.readiness.decisionHash === request.decisionHash &&
        request.readiness.checkpointHash === digest(request.checkpoint),
      "APPROVAL_BINDING_MISMATCH"
    );
    const evidence = request.evidence as Evidence; // Core validates the strict evidence schema before SQL.
    const live = await finance();
    requireThat(
      financialIdentity(live) === financialIdentity(evidence),
      "FINANCIAL_EVIDENCE_CHANGED"
    );
    const r: Order13Runtime = {
      ...runtime,
      auditContext: {
        artifactHash: deps.artifactHash,
        decisionHash: request.decisionHash,
        readinessHash: digest(request.readiness),
        approvedRequestHash,
        executionRequestHash: digest(request),
        authorizationPolicy: renewal
          ? "ORDER13_SCOPED_RENEWAL_V2"
          : "EXACT_REQUEST_V1",
        deployment: STAGING.deployment,
      },
      beforeWrite: async (c, cp) => {
        await checkClaims(c);
        await readiness(c, request.readiness, cp);
        checkAuthorization();
      },
      beforeCommit: async c => {
        await checkClaims(c);
        await readiness(c, request.readiness, request.checkpoint, false);
        const last = await finance();
        requireThat(
          financialIdentity(last) === financialIdentity(evidence),
          "FINANCIAL_EVIDENCE_CHANGED_BEFORE_COMMIT"
        );
        young(last.observedAt);
        checkAuthorization();
        young(evidence.observedAt);
        young(request.checkpoint.observedAt);
        young(request.readiness.quiescence.verifiedAt);
        young(request.readiness.panel.reviewedAt, 15 * 60000);
        young(request.readiness.backup.verifiedAt, 15 * 60000);
        requireThat(
          Date.now() >= Date.parse((request.approval as Approval).validFrom) &&
            Date.now() <= Date.parse((request.approval as Approval).validUntil),
          "APPROVAL_EXPIRED"
        );
        checkAuthorization();
        // Final observation follows all provider I/O, while financial locks remain held.
        await observeAdministrativeGate(
          c,
          deps.administrativeObserver,
          observerTarget
        );
        checkAuthorization();
        young(evidence.observedAt);
        young(request.checkpoint.observedAt);
        young(request.readiness.quiescence.verifiedAt);
        young(request.readiness.panel.reviewedAt, 15 * 60000);
        young(request.readiness.backup.verifiedAt, 15 * 60000);
        requireThat(
          Date.now() >= Date.parse((request.approval as Approval).validFrom) &&
            Date.now() <= Date.parse((request.approval as Approval).validUntil),
          "APPROVAL_EXPIRED"
        );
      },
    };
    return runOrder13Transaction(r, {
      mode: "execute-local",
      evidence,
      approval: request.approval as Approval,
      checkpoint: request.checkpoint,
    });
  }
  async function verifyOutcome(raw: unknown) {
    const request = z.object({ baselineStateHash: hash }).strict().parse(raw);
    validateEnvironment(env);
    const c = await deps.open();
    try {
      await identity(c);
      return await inspectOrder13Outcome(c, request.baselineStateHash);
    } finally {
      await c.end();
    }
  }
  return { preflight, dryRun, captureBackup, commit, verifyOutcome };
}
export function liveStagingAdapter(artifactHash: string) {
  requireThat(process.version === "v22.23.2", "NODE_RUNTIME_MISMATCH");
  const env = Object.freeze({ ...process.env });
  const u = validateEnvironment(env);
  const open = () =>
    createConnection({
      host: u.hostname,
      port: 3306,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: STAGING.database,
      multipleStatements: false,
      dateStrings: true,
      timezone: "Z",
      connectTimeout: 10000,
    });
  return createStagingAdapter({
    administrativeObserver:
      runtimeSupervisedObserver() ??
      mysqlAdministrativeObserver(async () => {
        requireThat(
          env.ORDER13_OBSERVER_USER &&
            env.ORDER13_OBSERVER_PASSWORD &&
            env.ORDER13_OBSERVER_USER !== decodeURIComponent(u.username),
          "ADMINISTRATIVE_OBSERVER_UNAVAILABLE"
        );
        return createConnection({
          host: u.hostname,
          port: 3306,
          database: STAGING.database,
          user: env.ORDER13_OBSERVER_USER,
          password: env.ORDER13_OBSERVER_PASSWORD,
          multipleStatements: false,
          connectTimeout: 3000,
        });
      }, observerTarget),
    environment: env,
    artifactHash,
    open,
    identity: async c => {
      const [rows] = await c.query<any[]>(
        "SELECT DATABASE() db,SHA2(@@server_uuid,256) h"
      );
      return { database: rows[0].db, uuidHash: rows[0].h };
    },
    bundleHash: async () =>
      createHash("sha256")
        .update(await readFile("/app/dist/index.js"))
        .digest("hex"),
    fetch,
  });
}
