export const PAYMENT_NOTIFICATION_RECOVERY_FLAG =
  "PAYMENT_NOTIFICATION_RECOVERY_WORKER_ENABLED";
export const ASAAS_WEBHOOK_RECOVERY_FLAG =
  "ASAAS_WEBHOOK_RECOVERY_WORKER_ENABLED";

export type RecoveryWorkerStartup = {
  paymentNotifications: boolean;
  asaasWebhookRecovery: boolean;
};

export type RecoveryWorkerStarters = {
  startPaymentNotifications: () => unknown;
  startAsaasWebhookRecovery: () => unknown;
};

type StartupEnvironment = Record<string, string | undefined>;

function parseExplicitFlag(
  name: string,
  value: string | undefined,
  fallback: boolean
): boolean {
  if (value === undefined) return fallback;

  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;

  throw new Error(`INVALID_RECOVERY_WORKER_FLAG:${name}`);
}

export function resolveRecoveryWorkerStartup(
  env: StartupEnvironment
): RecoveryWorkerStartup {
  // APP_ENV is authoritative for staging even when NODE_ENV=production.
  // Outside staging, absent flags preserve the existing startup behavior.
  const staging =
    String(env.APP_ENV ?? "")
      .trim()
      .toLowerCase() === "staging";
  const defaultEnabled = !staging;

  return {
    paymentNotifications: parseExplicitFlag(
      PAYMENT_NOTIFICATION_RECOVERY_FLAG,
      env[PAYMENT_NOTIFICATION_RECOVERY_FLAG],
      defaultEnabled
    ),
    asaasWebhookRecovery: parseExplicitFlag(
      ASAAS_WEBHOOK_RECOVERY_FLAG,
      env[ASAAS_WEBHOOK_RECOVERY_FLAG],
      defaultEnabled
    ),
  };
}

export function startEnabledRecoveryWorkers(
  config: RecoveryWorkerStartup,
  starters: RecoveryWorkerStarters
): void {
  if (config.asaasWebhookRecovery) starters.startAsaasWebhookRecovery();
  if (config.paymentNotifications) starters.startPaymentNotifications();
}

export function prepareRecoveryWorkerStartup(
  env: StartupEnvironment,
  starters: RecoveryWorkerStarters
) {
  const config = resolveRecoveryWorkerStartup(env);
  return {
    config,
    start: () => startEnabledRecoveryWorkers(config, starters),
  };
}
