import { TABLE_ORDER } from "../../server/database/tableManifest";
const details = ["RESTORE_SCHEMA_PREPARATION_FAILED", "RESTORE_IMPORT_FAILED", "RESTORE_FK_FAILED", "RESTORE_CHECKSUM_FAILED", "RESTORE_ROWCOUNT_FAILED", "RESTORE_FINGERPRINT_FAILED", "RESTORE_VALIDATION_FAILED", "RESTORE_MYSQL_STARTUP_FAILED"];
/** Allowlist only: never return message, SQL, stack, values, URL or cause text. */
export function restoreDiagnostic(error: unknown, fallback = "RESTORE_VALIDATION_FAILED") {
  const e = error as any, d = e?.diagnostic || {};
  const code = typeof e?.code === "string" && /^[A-Z_0-9]+$/.test(e.code) ? e.code : undefined;
  const detail = details.includes(d.detail) ? d.detail : code === "INCOMPATIBLE_SCHEMA" ? "RESTORE_SCHEMA_PREPARATION_FAILED" : code?.startsWith("ORPHAN_") || d.errno === 1452 || d.errno === 1451 ? "RESTORE_FK_FAILED" : details.includes(fallback) ? fallback : "RESTORE_VALIDATION_FAILED";
  const result: Record<string, string | number | boolean> = { detail };
  if (code) result.originCode = code;
  if (TABLE_ORDER.includes(d.table)) result.table = d.table;
  for (const key of ["ordinal", "expectedCount", "observedCount", "errno"]) if (Number.isSafeInteger(d[key]) && d[key] >= 0) result[key] = d[key];
  for (const key of ["expectedChecksum", "observedChecksum"]) if (typeof d[key] === "string" && /^[a-f0-9]{64}$/.test(d[key])) result[key] = d[key];
  if (typeof d.mysqlCode === "string" && /^[A-Z_0-9]+$/.test(d.mysqlCode)) result.mysqlCode = d.mysqlCode;
  if (typeof d.sqlState === "string" && /^[A-Z0-9]{5}$/.test(d.sqlState)) result.sqlState = d.sqlState;
  if (typeof d.rolledBack === "boolean") result.rolledBack = d.rolledBack;
  return result;
}
export class RestoreProofError extends Error {
  readonly code = "STAGING_RESTORE_PROOF_REQUIRED";
  constructor(public readonly diagnostic: Record<string, string | number | boolean>) { super("STAGING_RESTORE_PROOF_REQUIRED"); }
}
