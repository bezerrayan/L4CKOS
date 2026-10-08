import { PRE, POST, fail, type Plan } from "./policy";

const SQL = {
  ledger: "INSERT INTO _l4ckos_schema_migrations (name,kind,checksum,applicationCommit,description,preFingerprint,postFingerprint,manifestVersion,runnerVersion,executionDurationMs) VALUES (?,?,?,?,?,?,?,?,?,?)",
  started: "INSERT INTO _l4ckos_schema_executions (operation,checksum,applicationCommit,state,preFingerprint) VALUES (?,?,?,'STARTED',?)",
  checkpoint: "UPDATE _l4ckos_schema_executions SET completedStatements=? WHERE id=? AND state='STARTED'",
  failed: "UPDATE _l4ckos_schema_executions SET state='FAILED', observedFingerprint=?,errorCode='RECOVERY_REQUIRED',finishedAt=CURRENT_TIMESTAMP(3) WHERE id=? AND state='STARTED'",
  completed: "UPDATE _l4ckos_schema_executions SET state='COMPLETED',observedFingerprint=?,finishedAt=CURRENT_TIMESTAMP(3) WHERE id=? AND state='STARTED'",
  acquire: "SELECT GET_LOCK(?, ?) acquired",
  release: "SELECT RELEASE_LOCK(?) released",
} as const;

const BACKUP_SESSION_SQL = new Set([
  "SET time_zone = '+00:00'",
  "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ",
  "START TRANSACTION WITH CONSISTENT SNAPSHOT",
]);

export function assert0021SqlScope(
  sql: unknown,
  params: unknown,
  plan: Pick<Plan, "migration" | "applicationCommit">,
  allowedDdl: ReadonlySet<string>,
  backupPhase = false,
): void {
  if (typeof sql !== "string" || !sql.trim()) {
    fail("STAGING_WRITE_SCOPE_VIOLATION");
  }

  if (BACKUP_SESSION_SQL.has(sql)) {
    if (
      !backupPhase ||
      (params !== undefined &&
        (!Array.isArray(params) || params.length !== 0))
    ) {
      fail("STAGING_WRITE_SCOPE_VIOLATION");
    }
    return;
  }

  const values = Array.isArray(params) ? params : null;
  const validId = (v: unknown) =>
    Number.isSafeInteger(v) && (v as number) > 0;

  // Only the exact, checksum-reviewed migration statements.
  if (allowedDdl.has(sql)) {
    if (params !== undefined) fail("STAGING_WRITE_SCOPE_VIOLATION");
    return;
  }

  if (sql === SQL.ledger) {
    if (!values || values.length !== 10 ||
        values[0] !== plan.migration.name ||
        values[1] !== "MIGRATION" ||
        values[2] !== plan.migration.checksum ||
        values[3] !== plan.applicationCommit ||
        typeof values[4] !== "string" ||
        values[5] !== PRE ||
        values[6] !== POST ||
        values[7] !== 2 ||
        values[8] !== "2.0.0" ||
        !Number.isSafeInteger(values[9]) ||
        values[9] < 0) {
      fail("STAGING_WRITE_SCOPE_VIOLATION");
    }
    return;
  }

  if (sql === SQL.started) {
    if (!values || values.length !== 4 ||
        values[0] !== plan.migration.name ||
        values[1] !== plan.migration.checksum ||
        values[2] !== plan.applicationCommit ||
        values[3] !== PRE) {
      fail("STAGING_WRITE_SCOPE_VIOLATION");
    }
    return;
  }

  if (sql === SQL.checkpoint) {
    if (!values || values.length !== 2 ||
        !Number.isInteger(values[0]) ||
        values[0] < 1 || values[0] > 4 ||
        !validId(values[1])) {
      fail("STAGING_WRITE_SCOPE_VIOLATION");
    }
    return;
  }

  if (sql === SQL.failed) {
    if (!values || values.length !== 2 ||
        !(values[0] === null ||
          (typeof values[0] === "string" &&
           /^[a-f0-9]{64}$/.test(values[0]))) ||
        !validId(values[1])) {
      fail("STAGING_WRITE_SCOPE_VIOLATION");
    }
    return;
  }

  if (sql === SQL.completed) {
    if (!values || values.length !== 2 ||
        values[0] !== POST || !validId(values[1])) {
      fail("STAGING_WRITE_SCOPE_VIOLATION");
    }
    return;
  }

  if (sql === SQL.acquire || sql === SQL.release) {
    if (!values ||
        !new RegExp("^l4ckos_schema_v2_[a-f0-9]{32}$").test(String(values[0]))) {
      fail("STAGING_WRITE_SCOPE_VIOLATION");
    }
    if (sql === SQL.acquire &&
        (values.length !== 2 ||
         !Number.isInteger(values[1]) ||
         values[1] < 0 || values[1] > 10)) {
      fail("STAGING_WRITE_SCOPE_VIOLATION");
    }
    if (sql === SQL.release && values.length !== 1) {
      fail("STAGING_WRITE_SCOPE_VIOLATION");
    }
    return;
  }

  // Read-only introspection and backup queries. No SQL control statements,
  // multiple statements, locking reads, file operations or lock functions.
  const normalized = sql.trim();
  if (!/^(SELECT|SHOW|DESCRIBE)\b/i.test(normalized) ||
      /;|\/\*|--|#|:=|\bINTO\b|\bFOR\s+UPDATE\b|\bLOCK\s+IN\s+SHARE\s+MODE\b/i.test(normalized) ||
      /\b(?:GET_LOCK|RELEASE_LOCK|LOAD_FILE|SLEEP|BENCHMARK)\s*\(/i.test(normalized)) {
    fail("STAGING_WRITE_SCOPE_VIOLATION");
  }
}
