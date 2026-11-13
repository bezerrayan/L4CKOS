import { resolveAsaasWebhookInboundEnabled } from "./asaasWebhookIngress";
import { classifyAsaasRuntime } from "../services/asaasConfig";
import { isPublicCheckoutEnabled, resolvePublicSiteMode } from "./publicStorePolicy";
import { resolveRecoveryWorkerStartup } from "./recoveryWorkerStartup";
import {
  ISOLATED_HOMOLOGATION_IDENTITY,
  isApprovedStagingIdentity,
  isIsolatedHomologationIdentity,
} from "./railwayEnvironment";

type RuntimeEnvironment = Record<string, string | undefined>;

export type AttestationVerdict = "PASS" | "FAIL" | "NOT_VERIFIED";

export type AttestationIssue =
  | "RAILWAY_IDENTITY_INCOMPLETE"
  | "RAILWAY_IDENTITY_MISMATCH"
  | "DEPLOYMENT_ID_UNAVAILABLE"
  | "REPLICA_ID_UNAVAILABLE"
  | "PROCESS_ID_UNAVAILABLE"
  | "SOURCE_COMMIT_INVALID"
  | "FINANCIAL_FLAG_INVALID"
  | "FINANCIAL_FLAG_OPEN"
  | "ASAAS_UNCONFIGURED"
  | "ASAAS_PRODUCTION_SELECTED"
  | "ASAAS_CONFIGURATION_INVALID";

export type FinancialRuntimeAttestation = {
  schemaVersion: 2;
  verdict: AttestationVerdict;
  issues: AttestationIssue[];
  identity: {
    status: "VERIFIED" | "MISMATCH" | "NOT_VERIFIED";
    source: "RAILWAY_SYSTEM_ENVIRONMENT";
    projectId: string | null;
    environmentId: string | null;
    serviceId: string | null;
  };
  execution: {
    deploymentId: string | null;
    replicaId: string | null;
    processId: number | null;
    sourceCommitSha: string | null;
  };
  publicSiteMode: "store" | "coming-soon";
  publicCheckoutFlagEnabled: boolean;
  publicCheckoutEnabled: boolean;
  stockRuntimeEnabled: boolean;
  stockCheckoutEnabled: boolean;
  stockCheckoutEffective: boolean;
  stockReservationExpirySchedulerEnabled: boolean;
  automaticBackupSchedulerEnabled: boolean;
  asaasWebhookInboundEnabled: boolean | null;
  asaasWebhookRecoveryWorkerEnabled: boolean | null;
  paymentNotificationRecoveryWorkerEnabled: boolean | null;
  asaasMode: "sandbox" | "production" | "unconfigured" | "invalid";
  asaasModeConsistent: boolean;
  asaasCredentialsPresent: boolean;
};

const SAFE_PLATFORM_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_COMMIT_SHA = /^[a-fA-F0-9]{40,64}$/;

function platformId(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized && SAFE_PLATFORM_ID.test(normalized) ? normalized : null;
}

function resolveAsaasMode(env: RuntimeEnvironment): {
  mode: FinancialRuntimeAttestation["asaasMode"];
  consistent: boolean;
} {
  const classification = classifyAsaasRuntime(env);
  return { mode: classification.mode, consistent: classification.consistent };
}

function identityState(
  env: RuntimeEnvironment
): FinancialRuntimeAttestation["identity"] {
  const projectId = platformId(env.RAILWAY_PROJECT_ID);
  const environmentId = platformId(env.RAILWAY_ENVIRONMENT_ID);
  const serviceId = platformId(env.RAILWAY_SERVICE_ID);
  const supplied = [projectId, environmentId, serviceId].filter(Boolean).length;

  let status: FinancialRuntimeAttestation["identity"]["status"];
  if (supplied === 0 || supplied < 3) status = "NOT_VERIFIED";
  else if (!isIsolatedHomologationIdentity(env)) status = "MISMATCH";
  else status = "VERIFIED";

  return {
    status,
    source: "RAILWAY_SYSTEM_ENVIRONMENT",
    projectId,
    environmentId,
    serviceId,
  };
}

function addIssue(issues: AttestationIssue[], issue: AttestationIssue) {
  if (!issues.includes(issue)) issues.push(issue);
}

function hasInvalidBoolean(env: RuntimeEnvironment, name: string): boolean {
  const value = env[name];
  return value !== undefined && value !== "true" && value !== "false";
}

export function shouldEmitFinancialRuntimeAttestation(
  env: RuntimeEnvironment = process.env
): boolean {
  // Do not emit financial configuration evidence from Production, legacy
  // staging, local runs, or a partial/mismatched Railway identity.
  return isIsolatedHomologationIdentity(env);
}

export function resolveFinancialRuntimeAttestation(
  env: RuntimeEnvironment = process.env,
  processId: number = process.pid
): FinancialRuntimeAttestation {
  const issues: AttestationIssue[] = [];
  const identity = identityState(env);
  if (identity.status === "NOT_VERIFIED")
    addIssue(issues, "RAILWAY_IDENTITY_INCOMPLETE");
  if (identity.status === "MISMATCH")
    addIssue(issues, "RAILWAY_IDENTITY_MISMATCH");

  const deploymentId = platformId(env.RAILWAY_DEPLOYMENT_ID);
  const replicaId = platformId(env.RAILWAY_REPLICA_ID);
  const sourceShaRaw = env.RAILWAY_GIT_COMMIT_SHA;
  const sourceCommitSha =
    sourceShaRaw && SAFE_COMMIT_SHA.test(sourceShaRaw) ? sourceShaRaw : null;
  if (!deploymentId) addIssue(issues, "DEPLOYMENT_ID_UNAVAILABLE");
  if (!replicaId) addIssue(issues, "REPLICA_ID_UNAVAILABLE");
  if (!Number.isSafeInteger(processId) || processId <= 0)
    addIssue(issues, "PROCESS_ID_UNAVAILABLE");
  if (sourceShaRaw && !sourceCommitSha)
    addIssue(issues, "SOURCE_COMMIT_INVALID");

  const publicSiteMode = resolvePublicSiteMode(env);
  const publicCheckoutFlagEnabled = env.PUBLIC_CHECKOUT_ENABLED === "true";
  const publicCheckoutEnabled = isPublicCheckoutEnabled(env);
  const stockRuntimeEnabled = env.STOCK_RUNTIME_ENABLED === "true";
  const stockCheckoutEnabled = env.STOCK_CHECKOUT_ENABLED === "true";
  let asaasWebhookInboundEnabled: boolean | null = null;
  let asaasWebhookRecoveryWorkerEnabled: boolean | null = null;
  let paymentNotificationRecoveryWorkerEnabled: boolean | null = null;
  let financialFlagsInvalid = false;
  try {
    asaasWebhookInboundEnabled = resolveAsaasWebhookInboundEnabled(env);
    const workers = resolveRecoveryWorkerStartup(env);
    asaasWebhookRecoveryWorkerEnabled = workers.asaasWebhookRecovery;
    paymentNotificationRecoveryWorkerEnabled = workers.paymentNotifications;
  } catch {
    financialFlagsInvalid = true;
  }

  const isolatedHomologation = isIsolatedHomologationIdentity(env);
  const publicSiteRaw = env.PUBLIC_SITE_MODE?.trim().toLowerCase();
  if (publicSiteRaw && !["store", "coming-soon"].includes(publicSiteRaw))
    financialFlagsInvalid = true;
  if (isolatedHomologation && (
    publicSiteRaw !== "coming-soon" ||
    ["PUBLIC_CHECKOUT_ENABLED", "STOCK_RUNTIME_ENABLED", "STOCK_CHECKOUT_ENABLED",
      "ASAAS_WEBHOOK_INBOUND_ENABLED", "ASAAS_WEBHOOK_RECOVERY_WORKER_ENABLED",
      "PAYMENT_NOTIFICATION_RECOVERY_WORKER_ENABLED"].some(name => env[name] !== "false")
  )) financialFlagsInvalid = true;
  if (
    hasInvalidBoolean(env, "PUBLIC_CHECKOUT_ENABLED") ||
    hasInvalidBoolean(env, "STOCK_RUNTIME_ENABLED") ||
    hasInvalidBoolean(env, "STOCK_CHECKOUT_ENABLED")
  )
    financialFlagsInvalid = true;
  if (financialFlagsInvalid) addIssue(issues, "FINANCIAL_FLAG_INVALID");

  const asaas = resolveAsaasMode(env);
  if (isolatedHomologation && !env.ASAAS_API_KEY?.trim())
    addIssue(issues, "ASAAS_UNCONFIGURED");
  if (isolatedHomologation && asaas.mode !== "unconfigured" && env.ASAAS_ENV !== "sandbox")
    addIssue(issues, "ASAAS_CONFIGURATION_INVALID");
  if (asaas.mode === "production")
    addIssue(issues, "ASAAS_PRODUCTION_SELECTED");
  else if (asaas.mode === "unconfigured")
    addIssue(issues, "ASAAS_UNCONFIGURED");
  else if (asaas.mode === "invalid" || !asaas.consistent)
    addIssue(issues, "ASAAS_CONFIGURATION_INVALID");

  const financialFeatureOpen =
    publicSiteMode !== "coming-soon" ||
    publicCheckoutFlagEnabled ||
    publicCheckoutEnabled ||
    stockRuntimeEnabled ||
    stockCheckoutEnabled ||
    asaasWebhookInboundEnabled === true ||
    asaasWebhookRecoveryWorkerEnabled === true ||
    paymentNotificationRecoveryWorkerEnabled === true;
  if (financialFeatureOpen) addIssue(issues, "FINANCIAL_FLAG_OPEN");

  const hasKnownFailure = issues.some(issue =>
    [
      "RAILWAY_IDENTITY_MISMATCH",
      "FINANCIAL_FLAG_INVALID",
      "FINANCIAL_FLAG_OPEN",
      "ASAAS_PRODUCTION_SELECTED",
      "ASAAS_CONFIGURATION_INVALID",
    ].includes(issue)
  );
  const hasUnverifiedEvidence = issues.some(issue =>
    [
      "RAILWAY_IDENTITY_INCOMPLETE",
      "DEPLOYMENT_ID_UNAVAILABLE",
      "REPLICA_ID_UNAVAILABLE",
      "PROCESS_ID_UNAVAILABLE",
      "SOURCE_COMMIT_INVALID",
      "ASAAS_UNCONFIGURED",
    ].includes(issue)
  );
  const verdict: AttestationVerdict = hasKnownFailure
    ? "FAIL"
    : hasUnverifiedEvidence
      ? "NOT_VERIFIED"
      : "PASS";

  return {
    schemaVersion: 2,
    verdict,
    issues,
    identity,
    execution: {
      deploymentId,
      replicaId,
      processId:
        Number.isSafeInteger(processId) && processId > 0 ? processId : null,
      sourceCommitSha,
    },
    publicSiteMode,
    publicCheckoutFlagEnabled,
    publicCheckoutEnabled,
    stockRuntimeEnabled,
    stockCheckoutEnabled,
    stockCheckoutEffective: stockRuntimeEnabled && stockCheckoutEnabled,
    stockReservationExpirySchedulerEnabled: stockRuntimeEnabled,
    automaticBackupSchedulerEnabled: !isIsolatedHomologationIdentity(env),
    asaasWebhookInboundEnabled,
    asaasWebhookRecoveryWorkerEnabled,
    paymentNotificationRecoveryWorkerEnabled,
    asaasMode: asaas.mode,
    asaasModeConsistent: asaas.consistent,
    asaasCredentialsPresent: Boolean(env.ASAAS_API_KEY?.trim()),
  };
}
