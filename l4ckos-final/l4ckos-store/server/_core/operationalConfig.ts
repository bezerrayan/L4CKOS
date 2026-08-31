import { getAppEnvironment } from "./runtime";

export type SchedulerMode = "disabled" | "internal" | "external";
export type StorageMode = "disabled" | "local" | "remote";

function read(name: string) {
  return String(process.env[name] ?? "").trim();
}

export function readBoolean(name: string, fallback: boolean) {
  const raw = read(name).toLowerCase();
  if (!raw) return fallback;
  return raw === "true";
}

function readEnum<T extends string>(name: string, values: readonly T[], fallback: T): T {
  const raw = read(name).toLowerCase();
  return values.includes(raw as T) ? raw as T : fallback;
}

export function getOperationalConfig() {
  const environment = getAppEnvironment();
  const deployed = environment === "staging" || environment === "production";
  return {
    environment,
    checkoutEnabled: readBoolean("CHECKOUT_ENABLED", !deployed),
    maintenanceMode: readBoolean("MAINTENANCE_MODE", false),
    operationalJobsEnabled: readBoolean("OPERATIONAL_JOBS_ENABLED", false),
    jobEndpointsEnabled: readBoolean("JOB_ENDPOINTS_ENABLED", false),
    schedulerMode: readEnum<SchedulerMode>("JOB_SCHEDULER_MODE", ["disabled", "internal", "external"], "disabled"),
    storageMode: readEnum<StorageMode>("STORAGE_MODE", ["disabled", "local", "remote"], "disabled"),
  };
}

export function getCheckoutAvailability() {
  const config = getOperationalConfig();
  if (config.maintenanceMode) {
    return { available: false, code: "MAINTENANCE_MODE", message: "A loja está em manutenção. O catálogo continua disponível, mas o checkout está temporariamente bloqueado." } as const;
  }
  if (!config.checkoutEnabled) {
    return { available: false, code: "CHECKOUT_DISABLED", message: "O checkout está temporariamente indisponível." } as const;
  }
  return { available: true, code: null, message: null } as const;
}

export function assertCheckoutAvailable() {
  const status = getCheckoutAvailability();
  if (status.available) return;
  const error = new Error(status.message);
  Object.assign(error, { code: status.code, operational: true });
  throw error;
}

export function isOperationalWriteBlocked() {
  return getOperationalConfig().maintenanceMode;
}

export function canRunJobEndpoint() {
  const config = getOperationalConfig();
  return !config.maintenanceMode && config.operationalJobsEnabled && config.jobEndpointsEnabled;
}
