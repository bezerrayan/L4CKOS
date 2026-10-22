export type CleanupStep = { name: string; run: () => Promise<void> };
const safeCode = (error: unknown) => error instanceof Error &&
  /^(?:WINDOW|PROOF)_[A-Z_0-9]+$/.test(error.message) ? error.message : "WINDOW_BACKUP_UNCLASSIFIED";
const mysqlCodes = new Set(["ER_ACCESS_DENIED_ERROR", "ER_TABLEACCESS_DENIED_ERROR", "ER_DBACCESS_DENIED_ERROR",
  "ER_SPECIFIC_ACCESS_DENIED_ERROR", "ER_LOCK_WAIT_TIMEOUT", "ER_QUERY_INTERRUPTED", "ER_PARSE_ERROR",
  "ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION", "PROTOCOL_CONNECTION_LOST", "ECONNRESET", "EPIPE", "ETIMEDOUT"]);
export class BackupPhaseFailure extends Error {
  constructor(readonly phase: string, readonly primaryError: unknown) {
    super(safeCode(primaryError), { cause: primaryError });
  }
}
export async function inBackupPhase<T>(phase: string, operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (error) { throw new BackupPhaseFailure(phase, error); }
}
function sanitizedPrimary(error: unknown): {code: string; phase?: string; category: string; causeCode?: string} {
  if (error instanceof BackupPhaseFailure) return { ...sanitizedPrimary(error.primaryError), phase: error.phase };
  const code = error instanceof Error && error.message === "Can\'t add new command when connection is in closed state" ? "WINDOW_BACKUP_CONNECTION_CLOSED" : safeCode(error), native = error as {code?: unknown; name?: unknown};
  const causeCode = typeof native?.code === "string" && mysqlCodes.has(native.code) ? native.code : undefined;
  const category = causeCode ? "MYSQL_OR_TRANSPORT" : code !== "WINDOW_BACKUP_UNCLASSIFIED" ? "CONTROLLED_GUARD" :
    error instanceof TypeError ? "TYPE_ERROR" : error instanceof RangeError ? "RANGE_ERROR" : "UNCLASSIFIED_ERROR";
  return {code, category, ...(causeCode ? {causeCode} : {})};
}

export class BackupLifecycleFailure extends Error {
  constructor(readonly primaryError: unknown | undefined,
    readonly cleanupErrors: { step: string; error: unknown }[]) {
    super(primaryError === undefined ? "WINDOW_BACKUP_CLEANUP_FAILED" : safeCode(primaryError),
      { cause: primaryError ?? cleanupErrors[0]?.error });
  }
}

/** Every cleanup runs, and cleanup can never replace the original exception. */
export async function withBackupCleanup<T>(operation: () => Promise<T>, steps: CleanupStep[]): Promise<T> {
  let value: T | undefined;
  let primaryError: unknown;
  let operationFailed = false;
  try { value = await operation(); }
  catch (error) { primaryError = error; operationFailed = true; }
  const cleanupErrors: { step: string; error: unknown }[] = [];
  for (const step of steps) {
    try { await step.run(); }
    catch (error) { cleanupErrors.push({ step: step.name, error }); }
  }
  if (cleanupErrors.length) throw new BackupLifecycleFailure(operationFailed ? primaryError : undefined, cleanupErrors);
  if (operationFailed) throw primaryError;
  return value as T;
}

export function backupFailureDetails(error: unknown): {
  primary: { code: string; phase?: string; category?: string; causeCode?: string } | null; cleanupErrors: { step: string; code: string }[];
} {
  if (error instanceof BackupLifecycleFailure) {
    const nested = error.primaryError === undefined ? { primary: null, cleanupErrors: [] } : backupFailureDetails(error.primaryError);
    return { primary: nested.primary, cleanupErrors: [...nested.cleanupErrors,
      ...error.cleanupErrors.map(e => ({ step: e.step, code: safeCode(e.error) }))] };
  }
  if (error instanceof BackupPhaseFailure && error.primaryError instanceof BackupLifecycleFailure) {
    const nested = backupFailureDetails(error.primaryError);
    return { ...nested, primary: nested.primary ? {...nested.primary, phase: error.phase} : null };
  }
  return { primary: sanitizedPrimary(error), cleanupErrors: [] };
}
