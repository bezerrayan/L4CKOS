import type { Connection } from "mysql2/promise";

export type CapturePhase = "LOCKED_IDENTITY" | "SOURCE_IDENTITY" | "STRUCTURE_BEFORE" |
  "SNAPSHOT_START" | "TABLE_DATA" | "STRUCTURE_AFTER" | "SNAPSHOT_COMMIT" |
  "ENCRYPTION" | "VERIFY_FINAL" | "COMPLETE";
export type CaptureWaiting = "NONE" | "MYSQL_QUERY" | "IDENTITY_CHECK";
/** Only counters, fixed categories and durations leave this object; never SQL or row values. */
export class BackupCaptureProgress {
  private started = performance.now();
  private changed = this.started;
  private lastProgress = this.started;
  private phase: CapturePhase = "LOCKED_IDENTITY";
  private durations: Partial<Record<CapturePhase, number>> = {};
  private waiting: CaptureWaiting = "NONE";
  private waitStarted = this.started;
  private tablesStarted = 0;
  private tablesCompleted = 0;
  private bytesProcessed = 0;
  private queriesCompleted = 0;
  private lockChecks = 0;
  private lastLockCheck?: number;
  private frozenAt?: number;
  private stopReason?: string;
  constructor(private readonly observe?: (snapshot: ReturnType<BackupCaptureProgress["snapshot"]>) => void) {}
  phaseStarted(phase: CapturePhase) {
    if (this.frozenAt !== undefined) return;
    const now = performance.now();
    this.durations[this.phase] = (this.durations[this.phase] ?? 0) + now - this.changed;
    this.changed = now; this.phase = phase;
    if (phase === "COMPLETE") this.frozenAt = now;
    this.publish();
  }
  waitingFor(kind: CaptureWaiting) { if (this.frozenAt !== undefined) return; this.waiting = kind; this.waitStarted = performance.now(); this.publish(); }
  workCompleted(query = false) {
    if (this.frozenAt !== undefined) return;
    this.lastProgress = performance.now(); if (query) this.queriesCompleted++;
    this.waiting = "NONE"; this.publish();
  }
  tableStarted() { if (this.frozenAt !== undefined) return; this.tablesStarted++; this.publish(); }
  tableCompleted(bytes: number) {
    if (this.frozenAt !== undefined) return;
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw Error("WINDOW_BACKUP_PROGRESS_BYTES");
    this.tablesCompleted++; this.bytesProcessed += bytes; this.workCompleted();
  }
  /** Deliberately does NOT reset lastProgress: a healthy lock is not exporter progress. */
  lockVerified() { if (this.frozenAt !== undefined) return; this.lockChecks++; this.lastLockCheck = performance.now(); this.publish(); }
  idleMs() { return performance.now() - this.lastProgress; }
  stop(code: string) {
    if (this.frozenAt !== undefined) return;
    const allowed = new Set(["WINDOW_BACKUP_CAPTURE_DEADLINE", "WINDOW_BACKUP_NO_PROGRESS",
      "WINDOW_BACKUP_LOCK_SESSION_LOST", "WINDOW_BACKUP_LOCK_ACQUISITION_TIMEOUT", "WINDOW_BACKUP_LOCK_IDENTITY",
      "WINDOW_BACKUP_LOCK_MISSING", "WINDOW_BACKUP_LOCK_CONTINUITY", "WINDOW_BACKUP_PROGRESS_EVIDENCE"]);
    this.stopReason = allowed.has(code) ? code : "WINDOW_BACKUP_CAPTURE_FAILED";
    this.frozenAt = performance.now(); this.publish();
  }
  snapshot() {
    const now = this.frozenAt ?? performance.now();
    return { phase: this.phase, stopReason: this.stopReason ?? null, elapsedMs: Math.round(now - this.started),
      phaseElapsedMs: Math.round(now - this.changed),
      phaseDurationsMs: Object.fromEntries(Object.entries({...this.durations,
        [this.phase]: (this.durations[this.phase] ?? 0) + now - this.changed}).map(([k,v]) => [k,Math.round(v!)])),
      tablesStarted: this.tablesStarted, tablesCompleted: this.tablesCompleted,
      bytesProcessed: this.bytesProcessed, byteMetric: "UTF8_ENCODED_TABLE_ROWS",
      queriesCompleted: this.queriesCompleted, msSinceProgress: Math.round(now - this.lastProgress),
      waitingFor: this.waiting, waitMs: this.waiting === "NONE" ? 0 : Math.round(now - this.waitStarted),
      backpressure: "NOT_MEASURED_BUFFERED_MYSQL2_QUERY", lockChecks: this.lockChecks,
      msSinceLockCheck: this.lastLockCheck === undefined ? null : Math.round(now - this.lastLockCheck) };
  }
  publish() { this.observe?.(this.snapshot()); }
}

/** Same physical connection/transaction; proxy only measures completed exporter queries. */
export function observeCaptureQueries(connection: Connection, progress: BackupCaptureProgress): Connection {
  return new Proxy(connection, { get(target, property) {
    if (property === "query") return async (...args: unknown[]) => {
      progress.waitingFor("MYSQL_QUERY");
      const result = await Reflect.apply(target.query, target, args);
      progress.workCompleted(true); return result;
    };
    const value = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

export async function boundedBackupPhase<T>(operation: () => Promise<T>, ms: number, code: string,
  cancel: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([Promise.resolve().then(operation), new Promise<never>((_, reject) => {
    timer = setTimeout(() => { reject(Error(code)); cancel(); }, ms);
  })]); } finally { clearTimeout(timer); }
}
