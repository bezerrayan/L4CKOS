import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ASAAS_SANDBOX_API_URL = "https://api-sandbox.asaas.com/v3";
const ASAAS_WEBHOOK_URL =
  "https://api-staging.l4ckos.com.br/api/webhooks/asaas";
const RAILWAY_STAGING_PROJECT_ID = "2bb90c8e-eb65-43ee-826b-f93750f0499c";
const VERCEL_STAGING_ALIAS = "staging.l4ckos.com.br";

const PRESENT_SECRETS = [
  "ASAAS_API_KEY",
  "ASAAS_WEBHOOK_TOKEN",
  "RESEND_API_KEY",
];

/**
 * Offline-only gate for a future isolated STOCK staging run. It never connects,
 * prints values, changes flags, or applies migrations. A green result is only a
 * configuration-shape check; operators must attest resource identity separately.
 */
export function inspectStockStagingEnvironment(env = process.env) {
  const checks = [];
  const add = (name, ok, reason) =>
    checks.push({ name, status: ok ? "ok" : "blocked", reason });

  add(
    "STOCK_DATABASE_ENV",
    env.STOCK_DATABASE_ENV === "staging",
    "must equal staging"
  );
  const expectedDatabase = String(env.STOCK_EXPECTED_DATABASE ?? "").trim();
  add(
    "STOCK_EXPECTED_DATABASE",
    /^l4ckos_stock_stage_[a-z0-9_]+$/.test(expectedDatabase) &&
      !/(prod|production|live)/i.test(expectedDatabase),
    "must use the dedicated l4ckos_stock_stage_* namespace"
  );

  let databaseUrl;
  try {
    databaseUrl = new URL(String(env.DATABASE_URL ?? ""));
  } catch {
    databaseUrl = null;
  }
  const databaseName = databaseUrl?.pathname.replace(/^\//, "");
  const hostname = databaseUrl?.hostname.toLowerCase() ?? "";
  add(
    "DATABASE_URL",
    Boolean(
      databaseUrl &&
        databaseUrl.username &&
        databaseUrl.password &&
        databaseName === expectedDatabase
    ),
    "must include staging credentials and name the expected isolated schema"
  );
  add(
    "DATABASE_HOST",
    Boolean(
      hostname &&
        !/(prod|production|live)/i.test(hostname) &&
        !["localhost", "127.0.0.1", "::1"].includes(hostname)
    ),
    "must identify a non-local, non-production staging database service"
  );

  for (const name of PRESENT_SECRETS) {
    add(
      name,
      Boolean(String(env[name] ?? "").trim()),
      "must be configured in the staging secret store"
    );
  }
  add(
    "STOCK_DB_TLS_VERIFIED",
    env.STOCK_DB_TLS_VERIFIED === "verified",
    "operator must verify CA and hostname before a live rehearsal"
  );
  add(
    "STOCK_DB_ISOLATION_ACK",
    env.STOCK_DB_ISOLATION_ACK === "verified",
    "operator must confirm this database is dedicated test data"
  );
  add(
    "STOCK_DB_BACKUP_ACK",
    env.STOCK_DB_BACKUP_ACK === "verified",
    "operator must confirm a restorable pre-migration backup"
  );
  add(
    "STOCK_ASAAS_MODE",
    env.STOCK_ASAAS_MODE === "sandbox",
    "must equal sandbox"
  );
  add(
    "ASAAS_API_URL",
    String(env.ASAAS_API_URL ?? "")
      .trim()
      .replace(/\/+$/, "") === ASAAS_SANDBOX_API_URL,
    "must equal the fixed Asaas sandbox API endpoint"
  );
  add(
    "STOCK_ASAAS_WEBHOOK_URL",
    env.STOCK_ASAAS_WEBHOOK_URL === ASAAS_WEBHOOK_URL,
    "must be the authenticated staging webhook endpoint"
  );

  for (const name of [
    "STOCK_RUNTIME_ENABLED",
    "STOCK_CHECKOUT_ENABLED",
    "PUBLIC_CHECKOUT_ENABLED",
  ]) {
    add(
      name,
      String(env[name] ?? "")
        .trim()
        .toLowerCase() !== "true",
      "must remain closed in this preparation run"
    );
  }

  return {
    status: checks.every(check => check.status === "ok")
      ? "ready_for_operator_review"
      : "blocked",
    checks,
    remoteActionsPerformed: false,
    databaseConnectionsAttempted: false,
    secretsPrinted: false,
  };
}

/**
 * Offline validation of a sanitized operator snapshot. Unknown/null values
 * always block; this function performs no network or database operations.
 */
export function inspectStockStagingSnapshot(snapshot = {}) {
  const checks = [];
  const add = (name, ok, reason) =>
    checks.push({ name, status: ok ? "ok" : "blocked", reason });
  const present = value =>
    value !== undefined && value !== null && value !== "";

  add(
    "RAILWAY_PROJECT",
    snapshot.railway?.projectName === "l4ckos-staging" &&
      snapshot.railway?.projectId === RAILWAY_STAGING_PROJECT_ID,
    "must match the approved staging project identity"
  );
  add(
    "RAILWAY_ENVIRONMENT",
    snapshot.railway?.environment === "production",
    "must identify the staging project's deployed environment"
  );
  add(
    "RAILWAY_SERVICE_SHA",
    typeof snapshot.railway?.serviceSha === "string" &&
      /^[a-f0-9]{40}$/i.test(snapshot.railway.serviceSha),
    "must provide the running service SHA"
  );
  add(
    "VERCEL_PROJECT",
    snapshot.vercel?.projectName === "l4ckos-staging",
    "must identify the staging Vercel project"
  );
  add(
    "VERCEL_ALIAS",
    snapshot.vercel?.alias === VERCEL_STAGING_ALIAS,
    "must point to the staging alias"
  );
  add(
    "VERCEL_DEPLOYMENT_SHA",
    typeof snapshot.vercel?.deploymentSha === "string" &&
      /^[a-f0-9]{40}$/i.test(snapshot.vercel.deploymentSha),
    "must provide the staging deployment SHA"
  );

  add(
    "DATABASE_IDENTITY",
    typeof snapshot.database?.identity === "string" &&
      /^l4ckos_stock_stage_[a-z0-9_]+$/.test(snapshot.database.identity) &&
      !/(prod|production|live)/i.test(snapshot.database.identity),
    "must be a dedicated synthetic staging database"
  );
  add(
    "DATABASE_VERSION",
    snapshot.database?.version === "9.7.2",
    "must match the disposable MySQL 9.7.2 validation target"
  );
  add(
    "DATABASE_ISOLATION",
    snapshot.database?.isolated === true &&
      snapshot.database?.syntheticDataOnly === true,
    "must be isolated and contain synthetic data only"
  );
  add(
    "DATABASE_TLS",
    snapshot.database?.tlsVerified === true &&
      snapshot.database?.hostnameVerified === true,
    "must verify the staging database CA and hostname"
  );

  add(
    "STOCK_RUNTIME_FLAG",
    typeof snapshot.flags?.stockRuntimeEnabled === "boolean",
    "must be explicitly observed"
  );
  add(
    "STOCK_CHECKOUT_CLOSED",
    snapshot.flags?.stockCheckoutEnabled === false,
    "checkout must remain closed during preparation"
  );
  add(
    "PUBLIC_CHECKOUT_CLOSED",
    snapshot.flags?.publicCheckoutEnabled === false,
    "public checkout must remain closed during preparation"
  );
  add(
    "PAYMENT_WORKER_CLOSED",
    snapshot.flags?.paymentNotificationWorkerEnabled === false,
    "notification worker must remain disabled until approved"
  );

  add(
    "ASAAS_SANDBOX",
    snapshot.asaas?.mode === "sandbox" &&
      snapshot.asaas?.apiUrl === ASAAS_SANDBOX_API_URL &&
      snapshot.asaas?.credentialConfigured === true,
    "must use the sandbox endpoint and a configured staging credential"
  );
  add(
    "ASAAS_WEBHOOK",
    snapshot.asaas?.webhookUrl === ASAAS_WEBHOOK_URL &&
      snapshot.asaas?.webhookAuthenticationConfigured === true,
    "must use the authenticated staging webhook endpoint"
  );
  add(
    "RESEND",
    snapshot.resend?.credentialConfigured === true &&
      snapshot.resend?.recipientRestrictionEnabled === true &&
      snapshot.resend?.senderDomainVerified === true,
    "must use restricted staging recipients and a verified sender domain"
  );

  add(
    "BACKEND_HEALTH",
    snapshot.health?.backendStatus === 200,
    "backend staging health check must return 200"
  );
  add(
    "FRONTEND_HEALTH",
    snapshot.health?.frontendStatus === 200,
    "frontend staging health check must return 200"
  );
  add(
    "MIGRATION_PREFLIGHT",
    snapshot.migrations?.disposableMysql972PreflightPassed === true &&
      snapshot.migrations?.remoteMigrationPerformed === false,
    "migration compatibility must pass on disposable MySQL 9.7.2 only"
  );
  add(
    "ROLLBACK",
    present(snapshot.rollback?.previousSha) &&
      /^[a-f0-9]{40}$/i.test(snapshot.rollback.previousSha) &&
      snapshot.rollback?.restorationVerified === true &&
      snapshot.rollback?.pauseFlagsTested === true,
    "must identify a verified restorable prior release and tested pause controls"
  );

  return {
    status: checks.every(check => check.status === "ok")
      ? "ready_for_operator_review"
      : "blocked",
    checks,
    remoteActionsPerformed: false,
    databaseConnectionsAttempted: false,
    secretsPrinted: false,
    snapshotValuesPrinted: false,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const snapshotArg = process.argv.indexOf("--snapshot");
  if (snapshotArg !== -1) {
    const path = process.argv[snapshotArg + 1];
    if (!path) {
      console.error("BLOCKED snapshot path required");
      process.exitCode = 1;
    } else {
      try {
        const snapshot = JSON.parse(await readFile(path, "utf8"));
        const result = inspectStockStagingSnapshot(snapshot);
        for (const check of result.checks)
          console.log(
            `${check.status.toUpperCase()} ${check.name}: ${check.reason}`
          );
        console.log(
          `RESULT ${result.status}; offline snapshot validation only; values and secrets not printed`
        );
        if (result.status !== "ready_for_operator_review") process.exitCode = 1;
      } catch {
        console.error(
          "BLOCKED snapshot unreadable or invalid JSON; values not printed"
        );
        process.exitCode = 1;
      }
    }
  } else {
    const result = inspectStockStagingEnvironment();
    for (const check of result.checks)
      console.log(
        `${check.status.toUpperCase()} ${check.name}: ${check.reason}`
      );
    console.log(
      `RESULT ${result.status}; offline config check only; no secrets or values printed`
    );
    if (result.status !== "ready_for_operator_review") process.exitCode = 1;
  }
}
