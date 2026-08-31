import { releaseExpiredStockReservations } from "../db";
import { securityLog } from "../_core/security";
import { runNotificationOutbox } from "./notificationOutboxWorker";
import { runPaymentReconciliation } from "./paymentReconciliation";
import { getOperationalConfig } from "../_core/operationalConfig";

let started = false;

async function runLogged(name: string, job: () => Promise<unknown>) {
  const startedAt = Date.now();
  try {
    const result = await job();
    securityLog("info", `jobs.${name}_completed`, { durationMs: Date.now() - startedAt, result });
    return result;
  } catch (error) {
    securityLog("error", `jobs.${name}_failed`, { durationMs: Date.now() - startedAt, errorType: error instanceof Error ? error.name : "unknown" });
    throw error;
  }
}

export const operationalJobs = {
  reservations: () => runLogged("reservation_expiry", () => releaseExpiredStockReservations(new Date(), 100)),
  notifications: () => runLogged("notification_outbox", () => runNotificationOutbox()),
  reconciliation: () => runLogged("payment_reconciliation", () => runPaymentReconciliation()),
};

export function startOperationalJobScheduler() {
  const config = getOperationalConfig();
  if (started || !config.operationalJobsEnabled || config.schedulerMode !== "internal" || config.maintenanceMode) return;
  started = true;
  const schedule = (job: () => Promise<unknown>, intervalMs: number) => {
    const timer = setInterval(() => void job().catch(() => undefined), intervalMs);
    timer.unref();
  };
  schedule(operationalJobs.reservations, Number(process.env.RESERVATION_JOB_INTERVAL_MS || 60_000));
  schedule(operationalJobs.notifications, Number(process.env.OUTBOX_JOB_INTERVAL_MS || 15_000));
  schedule(operationalJobs.reconciliation, Number(process.env.RECONCILIATION_JOB_INTERVAL_MS || 5 * 60_000));
}

export function getOperationalJobStatus() {
  const config = getOperationalConfig();
  return {
    enabled: config.operationalJobsEnabled,
    endpointEnabled: config.jobEndpointsEnabled,
    schedulerMode: config.schedulerMode,
    maintenanceMode: config.maintenanceMode,
    schedulerStarted: started,
    jobs: Object.keys(operationalJobs),
  };
}
