import { createConnection, type Connection, type RowDataPacket } from "mysql2/promise";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { TARGET } from "./policy";
import {
  assertLoopbackListener,
  parseTunnelOutput,
  type TunnelEndpoint,
} from "../financialWindow/privateMysqlTunnel";

/** Separate financial read capability. This does not use or alter the backup policy. */
export const FINANCIAL_READ_SCOPE = Object.freeze({
  purpose: "STAGING_FINANCIAL_READ_ONLY",
  projectId: TARGET.projectId,
  environmentId: TARGET.environmentId,
  mysqlServiceId: "bcda5d78-4a0d-4682-8659-8316847addb7",
  mysqlDeploymentId: "23828bf1-c7d6-4ef2-b6d5-91dfe812fd89",
  apiServiceId: TARGET.serviceId,
  apiDeploymentId: TARGET.deploymentId,
  database: TARGET.database,
  mysqlUuidHash: TARGET.mysqlUuidHash,
  mysqlVersion: "8.4.11",
  expectedLogin: "l4ckos_app",
  expectedAccount: "l4ckos_app@%",
});

export const FINANCIAL_CONNECT_ARGS = Object.freeze([
  "connect", "mysql", "--project", FINANCIAL_READ_SCOPE.projectId,
  "--environment", FINANCIAL_READ_SCOPE.environmentId, "--tunnel-only",
]);
export function assertFinancialConnectArgs(args: readonly string[]) {
  if (args.length !== FINANCIAL_CONNECT_ARGS.length ||
      args.some((arg, index) => arg !== FINANCIAL_CONNECT_ARGS[index]))
    throw Error("STAGING_FINANCIAL_CONNECT_SCOPE");
}
const RAILWAY = "/home/yan/.railway/bin/railway";
const RAILWAY_SHA256 = "47869b61196e463670bbe870f2c8c5053a09ddbe5dffc0833396c2355857d747";
const MARKER = "Press Ctrl+C to close the tunnel.";
const READY_TIMEOUT_MS = 15_000;

export function assertFinancialReadScope(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw Error("STAGING_FINANCIAL_SCOPE_INVALID");
  const candidate = input as Record<string, unknown>;
  const keys = Object.keys(FINANCIAL_READ_SCOPE).sort();
  if (Object.keys(candidate).sort().join(",") !== keys.join(","))
    throw Error("STAGING_FINANCIAL_SCOPE_INVALID");
  for (const key of keys)
    if (candidate[key] !== FINANCIAL_READ_SCOPE[key as keyof typeof FINANCIAL_READ_SCOPE])
      throw Error("STAGING_FINANCIAL_SCOPE_MISMATCH");
}

export function assertFinancialMysqlIdentity(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw Error("STAGING_FINANCIAL_IDENTITY_MISMATCH");
  const row = input as Record<string, unknown>;
  if (Object.keys(row).sort().join(",") !== "account,database,login,uuidHash,version" ||
      row.database !== FINANCIAL_READ_SCOPE.database ||
      row.uuidHash !== FINANCIAL_READ_SCOPE.mysqlUuidHash ||
      row.version !== FINANCIAL_READ_SCOPE.mysqlVersion ||
      row.account !== FINANCIAL_READ_SCOPE.expectedAccount ||
      typeof row.login !== "string" ||
      row.login.slice(0, row.login.lastIndexOf("@")) !== FINANCIAL_READ_SCOPE.expectedLogin ||
      row.login.lastIndexOf("@") < 1)
    throw Error("STAGING_FINANCIAL_IDENTITY_MISMATCH");
}

/** Expose only a bounded failure phase/category; never a driver message or connection detail. */
export function classifyFinancialConnectFailure(phase: "mysql_connect" | "identity_query" | "identity_validation", error: unknown) {
  if (error instanceof Error && /^STAGING_FINANCIAL_[A-Z_]+$/.test(error.message)) return error.message;
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code : "";
  if (phase === "mysql_connect" && code === "ER_ACCESS_DENIED_ERROR")
    return "STAGING_FINANCIAL_MYSQL_AUTH_FAILED";
  if (phase === "mysql_connect" && ["ECONNREFUSED", "ETIMEDOUT", "ECONNRESET", "EHOSTUNREACH", "ENOTFOUND"].includes(code))
    return "STAGING_FINANCIAL_MYSQL_TRANSPORT_FAILED";
  if (phase === "mysql_connect") return "STAGING_FINANCIAL_MYSQL_CONNECT_FAILED";
  if (phase === "identity_query") return "STAGING_FINANCIAL_IDENTITY_QUERY_FAILED";
  return "STAGING_FINANCIAL_IDENTITY_MISMATCH";
}

type SqlConnection = Pick<Connection, "query" | "execute" | "beginTransaction" | "commit" | "rollback" | "end">;
type QueryRows = RowDataPacket[];
// DATABASE is a reserved word: quote every result alias consistently.
export const FINANCIAL_IDENTITY_SQL = "SELECT DATABASE() AS `database`,SHA2(@@server_uuid,256) AS `uuidHash`,@@version AS `version`,CURRENT_USER() AS `account`,USER() AS `login`";
type CleanupProof = { mysql: "PASS" | "FAIL" | "NOT_OPENED"; tunnel: "PASS" | "FAIL" };
type ReadCleanupProof = CleanupProof & { rollback?: "PASS" | "FAIL"; rollbackDiagnostic?: ReadDiagnostic; resourcesDiagnostic?: ReadDiagnostic;
  mysqlDiagnostic?: ReadDiagnostic; tunnelDiagnostic?: ReadDiagnostic; destroyDiagnostic?: ReadDiagnostic };
export function financialDriverDiagnostic(error: unknown) {
  const e = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const codes = new Set(["ER_PARSE_ERROR", "ER_ACCESS_DENIED_ERROR", "ER_DBACCESS_DENIED_ERROR",
    "ER_SPECIFIC_ACCESS_DENIED_ERROR", "ER_UNKNOWN_SYSTEM_VARIABLE", "ER_BAD_DB_ERROR",
    "ER_UNKNOWN_ERROR", "PROTOCOL_CONNECTION_LOST", "ECONNRESET", "ETIMEDOUT", "ECONNREFUSED"]);
  const mysqlCode = typeof e.code === "string" && codes.has(e.code) ? e.code : null;
  const category = mysqlCode === "ER_PARSE_ERROR" ? "sql_syntax"
    : mysqlCode?.includes("ACCESS_DENIED") ? "sql_permission"
    : mysqlCode === "ER_UNKNOWN_SYSTEM_VARIABLE" ? "server_variable" : "sql_execution";
  return { phase: "identity", substep: "execute_identity_select", category,
    mysqlCode, errno: mysqlCode && Number.isInteger(e.errno) && Number(e.errno) > 0 && Number(e.errno) <= 65535 ? Number(e.errno) : null,
    sqlState: mysqlCode && typeof e.sqlState === "string" && ["42000", "28000", "HY000", "08S01", "3D000"].includes(e.sqlState) ? e.sqlState : null };
}
export class FinancialReadError extends Error {
  cleanup?: ReadCleanupProof;
  constructor(code: string, readonly diagnostic?: ReturnType<typeof financialDriverDiagnostic> | ReadDiagnostic) { super(code); }
}
function identityMismatchDiagnostic() {
  return { ...financialDriverDiagnostic(null), substep: "compare_reference", category: "identity_mismatch" };
}
export async function readFinancialMysqlIdentity(c: Pick<Connection, "execute">) {
  let rows: QueryRows;
  try { [rows] = await c.execute<QueryRows>(FINANCIAL_IDENTITY_SQL, []); }
  catch (error) { throw new FinancialReadError("STAGING_FINANCIAL_IDENTITY_QUERY_FAILED", financialDriverDiagnostic(error)); }
  if (!Array.isArray(rows) || rows.length !== 1) throw new FinancialReadError("STAGING_FINANCIAL_IDENTITY_MISMATCH", identityMismatchDiagnostic());
  return { ...rows[0] };
}
async function boundedClose(run: () => Promise<void>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([Promise.resolve().then(run), new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Error("STAGING_FINANCIAL_CLEANUP_TIMEOUT")), timeoutMs);
  })]); } finally { clearTimeout(timer); }
}
/** Only receives references created by this launcher. Never enumerates/kills MySQL sessions. */
export async function closeOwnedFinancialResources(connection: Pick<Connection, "end" | "destroy"> | undefined,
  tunnel: { close(): Promise<void> }) {
  const proof: ReadCleanupProof = { mysql: connection ? "FAIL" : "NOT_OPENED", tunnel: "FAIL" };
  try {
    if (connection) {
      try { await boundedClose(() => connection.end(), 3000); proof.mysql = "PASS"; }
      catch (error) {
        proof.mysqlDiagnostic = readDiagnostic({ operation: "resources_mysql_end", phase: "cleanup", substep: "close" }, error);
        try { connection.destroy(); }
        catch (destroyError) { proof.destroyDiagnostic = readDiagnostic({ operation: "resources_mysql_destroy", phase: "cleanup", substep: "close" }, destroyError); }
      }
    }
  } finally {
    try { await boundedClose(() => tunnel.close(), 5000); proof.tunnel = "PASS"; }
    catch (error) { proof.tunnelDiagnostic = readDiagnostic({ operation: "resources_tunnel_close", phase: "cleanup", substep: "close" }, error); }
  }
  if (proof.mysql === "FAIL" || proof.tunnel === "FAIL") {
    const error = new FinancialReadError("STAGING_FINANCIAL_CLEANUP_FAILED"); error.cleanup = proof; throw error;
  }
  return proof;
}
const READS = Object.freeze({
  order: "SELECT id,status,paymentStatus,totalPrice,paymentConfirmationSource,paymentConfirmedAt,fulfillmentStatus FROM orders WHERE id = ?",
  payment: "SELECT id,orderId,provider,providerPaymentId,billingType,amount,status,creationStatus,externalReference,paidAmount,refundedAmount,netAmount,receivedAt,confirmedAt,refundedAt,statusSource FROM payments WHERE orderId = ? OR providerPaymentId = ?",
  reservation: "SELECT id,orderId,productId,variantId,orderItemId,quantity,status,expiresAt,createdAt,updatedAt FROM stockReservations WHERE id = ?",
  stock: "SELECT p.stock,COALESCE(SUM(CASE WHEN r.id <> ? AND r.status = 'active' AND r.expiresAt >= UTC_TIMESTAMP() THEN r.quantity ELSE 0 END),0) reservedElsewhere FROM products p LEFT JOIN stockReservations r ON r.productId = p.id WHERE p.id = ? GROUP BY p.id,p.stock",
  paymentEvents: "SELECT eventType,processingStatus,COUNT(*) count FROM paymentEvents WHERE orderId = ? OR providerPaymentId = ? GROUP BY eventType,processingStatus ORDER BY eventType,processingStatus",
  webhookLedger: "SELECT eventId,eventType,paymentId,orderId,payloadHash,status,processedAt FROM asaasWebhookEvents WHERE orderId = ? OR paymentId = ? OR eventId = ? ORDER BY createdAt,eventId",
  audit: "SELECT action,entity,entityId,actorType,createdAt FROM auditLogs WHERE orderId = ? OR (entity = 'order' AND entityId = ?) ORDER BY createdAt,id",
  inboxTarget: "SELECT eventId,payloadHash,state,attempts,errorCode,nextAttemptAt,completedAt,createdAt,updatedAt FROM asaasWebhookInbox WHERE eventId = ?",
  inboxCounts: "SELECT state,COUNT(*) count FROM asaasWebhookInbox GROUP BY state ORDER BY state",
  outboxTarget: "SELECT id,dedupeKey,type,status,attempts,createdAt,updatedAt,sentAt,nextAttemptAt,lockedAt,leaseExpiresAt FROM notificationOutbox WHERE orderId = ? OR dedupeKey = ? ORDER BY id",
  outboxCounts: "SELECT status,COUNT(*) count FROM notificationOutbox GROUP BY status ORDER BY status",
  emailTarget: "SELECT id,eventType,status,attemptCount,scheduledAt,processingAt,sentAt,failedAt,createdAt,updatedAt FROM orderEmailEvents WHERE orderId = ? ORDER BY id",
  emailCounts: "SELECT status,COUNT(*) count FROM orderEmailEvents GROUP BY status ORDER BY status",
  sessions: "SELECT CASE WHEN PROCESSLIST_USER = ? THEN 'staging_app' WHEN PROCESSLIST_USER IS NULL THEN 'background' ELSE 'other' END accountClass,COALESCE(PROCESSLIST_COMMAND,'') command,COALESCE(PROCESSLIST_STATE,'') state,COUNT(*) count FROM performance_schema.threads WHERE TYPE = 'FOREGROUND' AND PROCESSLIST_DB = DATABASE() AND PROCESSLIST_ID <> CONNECTION_ID() GROUP BY accountClass,command,state ORDER BY accountClass,command,state",
  transactions: "SELECT COUNT(*) count FROM information_schema.innodb_trx WHERE trx_mysql_thread_id <> CONNECTION_ID()",
  scheduler: "SELECT @@GLOBAL.event_scheduler eventScheduler,(SELECT COUNT(*) FROM information_schema.EVENTS WHERE EVENT_SCHEMA = DATABASE()) scheduledEvents",
});
export const FINANCIAL_READ_SQL = Object.freeze(Object.values(READS));

function fixedParams(id: keyof typeof READS): unknown[] {
  switch (id) {
    case "order": return [13];
    case "payment": return [13, TARGET.paymentId];
    case "reservation": return [10];
    case "stock": return [10, 1];
    case "paymentEvents": return [13, TARGET.paymentId];
    case "webhookLedger": return [13, TARGET.paymentId, TARGET.eventId];
    case "audit": return [13, "13"];
    case "inboxTarget": return [TARGET.eventId];
    case "inboxCounts": return [];
    case "outboxTarget": return [13, TARGET.outboxKey];
    case "outboxCounts": return [];
    case "emailTarget": return [13];
    case "emailCounts": return [];
    case "sessions": return [FINANCIAL_READ_SCOPE.expectedLogin];
    case "transactions": return [];
    case "scheduler": return [];
  }
}

function plain(rows: QueryRows): Record<string, unknown>[] {
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== "object" || Array.isArray(row)))
    throw Error("STAGING_FINANCIAL_RESULT_INVALID");
  return rows.map(row => ({ ...row }));
}
export const FINANCIAL_READ_OPERATION_IDS = Object.freeze(Object.keys(READS) as Array<keyof typeof READS>);
type ReadOperation = keyof typeof READS | "tx_isolation" | "tx_read_only" | "tx_begin" | "tx_commit"
  | "tx_rollback" | "inventory_result" | "tunnel_continuity" | "resources_close" | "preconditions"
  | "resources_mysql_end" | "resources_mysql_destroy" | "resources_tunnel_close" | "output_serialize";
type ReadContext = { operation: ReadOperation; phase: "read" | "transaction" | "result_processing" | "cleanup" | "preconditions";
  substep: "execute" | "validate_rows" | "configure" | "begin" | "commit" | "rollback" | "assemble" | "verify" | "close" };
type ReadDiagnostic = ReadContext & { category: string; causeCategory: string; mysqlCode: string | null; errno: number | null;
  sqlState: string | null; timeout: boolean; connection: boolean; permission: boolean; syntax: boolean; processing: boolean };
const READ_ERROR_CATEGORIES: Readonly<Record<string, string>> = Object.freeze({
  ER_NO_SUCH_TABLE: "schema_incompatible", ER_BAD_FIELD_ERROR: "schema_incompatible", ER_BAD_DB_ERROR: "schema_incompatible",
  ER_UNKNOWN_SYSTEM_VARIABLE: "schema_incompatible", ER_TABLEACCESS_DENIED_ERROR: "sql_permission",
  ER_COLUMNACCESS_DENIED_ERROR: "sql_permission", ER_SPECIFIC_ACCESS_DENIED_ERROR: "sql_permission",
  ER_ACCESS_DENIED_ERROR: "sql_permission", ER_DBACCESS_DENIED_ERROR: "sql_permission", ER_PARSE_ERROR: "sql_syntax",
  ER_QUERY_TIMEOUT: "timeout", ER_LOCK_WAIT_TIMEOUT: "timeout", ETIMEDOUT: "timeout", PROTOCOL_SEQUENCE_TIMEOUT: "timeout",
  PROTOCOL_CONNECTION_LOST: "connection", ECONNRESET: "connection", ECONNREFUSED: "connection", EPIPE: "connection",
  PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR: "connection", PROTOCOL_ENQUEUE_AFTER_QUIT: "connection",
  ER_QUERY_INTERRUPTED: "sql_execution", ER_UNKNOWN_ERROR: "sql_execution",
});
function readDiagnostic(context: ReadContext, error: unknown): ReadDiagnostic {
  const e = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const mysqlCode = typeof e.code === "string" && Object.hasOwn(READ_ERROR_CATEGORIES, e.code) ? e.code : null;
  const causeCategory = error instanceof Error && error.message === "STAGING_FINANCIAL_CLEANUP_TIMEOUT" ? "timeout" : mysqlCode ? READ_ERROR_CATEGORIES[mysqlCode]
    : context.phase === "result_processing" ? "result_processing" : "sql_execution";
  return { ...context, category: context.phase === "transaction" ? "transaction_control"
      : context.phase === "cleanup" ? "resource_cleanup" : causeCategory, causeCategory, mysqlCode,
    errno: mysqlCode && Number.isInteger(e.errno) && Number(e.errno) > 0 && Number(e.errno) <= 65535 ? Number(e.errno) : null,
    sqlState: mysqlCode && typeof e.sqlState === "string" && ["42S02", "42S22", "42000", "28000", "HY000", "08S01", "3D000", "70100"].includes(e.sqlState) ? e.sqlState : null,
    timeout: causeCategory === "timeout", connection: causeCategory === "connection", permission: causeCategory === "sql_permission",
    syntax: causeCategory === "sql_syntax", processing: context.phase === "result_processing" };
}
async function readOperation<T>(context: ReadContext, run: () => T | Promise<T>): Promise<T> {
  try { return await run(); }
  catch (error) { throw new FinancialReadError("STAGING_FINANCIAL_READ_FAILED", readDiagnostic(context, error)); }
}
export function serializeFinancialReadOutput(inventory: unknown) {
  return readOperation({ operation: "output_serialize", phase: "result_processing", substep: "assemble" },
    () => JSON.stringify({ status: "READ_ONLY_INVENTORY_COMPLETE", inventory }) + "\n");
}
async function select(c: SqlConnection, id: keyof typeof READS) {
  const response = await readOperation({ operation: id, phase: "read", substep: "execute" }, () => c.execute<QueryRows>(READS[id], fixedParams(id)));
  return readOperation({ operation: id, phase: "result_processing", substep: "validate_rows" }, () => {
    if (!Array.isArray(response) || response.length < 1) throw Error("STAGING_FINANCIAL_RESULT_INVALID");
    return plain(response[0]);
  });
}

export type ReadOnlyInventoryTransport = {
  connection: SqlConnection;
  alive(): boolean;
  close(): Promise<void>;
};

/** No caller-controlled SQL, table, identifier, or parameter can enter this capability. */
export async function readStagingFinancialInventory(
  transport: ReadOnlyInventoryTransport,
  ...unexpected: unknown[]
) {
  const c = transport.connection;
  let transaction = false;
  let primary: FinancialReadError | undefined;
  let rollback: Pick<ReadCleanupProof, "rollback" | "rollbackDiagnostic"> = {};
  try {
    if (unexpected.length) throw Error("STAGING_FINANCIAL_PARAMETERS_UNEXPECTED");
    if (!transport.alive()) throw Error("STAGING_FINANCIAL_TUNNEL_LOST");
    assertFinancialMysqlIdentity(await readFinancialMysqlIdentity(c));
    await readOperation({ operation: "tx_isolation", phase: "transaction", substep: "configure" }, () => c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"));
    await readOperation({ operation: "tx_read_only", phase: "transaction", substep: "configure" }, () => c.query("SET TRANSACTION READ ONLY"));
    await readOperation({ operation: "tx_begin", phase: "transaction", substep: "begin" }, () => c.beginTransaction());
    transaction = true;
    const order = await select(c, "order");
    const payment = await select(c, "payment");
    const reservation = await select(c, "reservation");
    const stock = await select(c, "stock");
    const paymentEvents = await select(c, "paymentEvents");
    const webhookLedger = await select(c, "webhookLedger");
    const audit = await select(c, "audit");
    const inboxTarget = await select(c, "inboxTarget");
    const inboxCounts = await select(c, "inboxCounts");
    const outboxTarget = await select(c, "outboxTarget");
    const outboxCounts = await select(c, "outboxCounts");
    const emailTarget = await select(c, "emailTarget");
    const emailCounts = await select(c, "emailCounts");
    const sessions = await select(c, "sessions");
    const transactions = await select(c, "transactions");
    const scheduler = await select(c, "scheduler");
    if (!transport.alive()) throw new FinancialReadError("STAGING_FINANCIAL_TUNNEL_LOST",
      readDiagnostic({ operation: "tunnel_continuity", phase: "read", substep: "verify" }, { code: "PROTOCOL_CONNECTION_LOST" }));
    await readOperation({ operation: "tx_commit", phase: "transaction", substep: "commit" }, () => c.commit());
    transaction = false;
    return await readOperation({ operation: "inventory_result", phase: "result_processing", substep: "assemble" }, () => {
    const stockRow = stock[0];
    const stockCount = stockRow ? Number(stockRow.stock) : null;
    const reservedElsewhere = stockRow ? Number(stockRow.reservedElsewhere) : null;
    if ((stockCount !== null && !Number.isFinite(stockCount)) || (reservedElsewhere !== null && !Number.isFinite(reservedElsewhere)))
      throw Error("STAGING_FINANCIAL_RESULT_INVALID");
    return {
      capturedAt: new Date().toISOString(),
      identity: { validated: true, database: FINANCIAL_READ_SCOPE.database,
        mysqlUuidHash: FINANCIAL_READ_SCOPE.mysqlUuidHash, mysqlVersion: FINANCIAL_READ_SCOPE.mysqlVersion,
        accountMatched: true },
      order: order[0] ?? null,
      payment,
      reservation: reservation[0] ?? null,
      stock: { stock: stockCount, reservedElsewhere,
        available: stockCount === null || reservedElsewhere === null ? null : stockCount - reservedElsewhere },
      paymentEvents,
      webhookLedger,
      audit,
      inbox: { target: inboxTarget[0] ?? null, countsByState: inboxCounts },
      notificationOutbox: { order13: outboxTarget, countsByStatus: outboxCounts },
      orderEmailEvents: { order13: emailTarget, countsByStatus: emailCounts },
      writers: { observedSessions: sessions, activeTransactions: transactions[0]?.count ?? null,
        eventScheduler: scheduler[0]?.eventScheduler ?? null, scheduledEvents: scheduler[0]?.scheduledEvents ?? null,
        externalWriterInventoryComplete: false, quiescenceProven: false },
    };
    });
  } catch (error) {
    if (transaction) {
      try { await readOperation({ operation: "tx_rollback", phase: "transaction", substep: "rollback" }, () => c.rollback()); rollback = { rollback: "PASS" }; }
      catch (rollbackError) { rollback = { rollback: "FAIL", rollbackDiagnostic: rollbackError instanceof FinancialReadError ? rollbackError.diagnostic as ReadDiagnostic : undefined }; }
    }
    primary = error instanceof FinancialReadError ? error : new FinancialReadError(
      error instanceof Error && /^STAGING_FINANCIAL_[A-Z_]+$/.test(error.message) ? error.message : "STAGING_FINANCIAL_READ_FAILED",
      error instanceof Error && error.message === "STAGING_FINANCIAL_IDENTITY_MISMATCH" ? identityMismatchDiagnostic() : undefined);
    throw primary;
  } finally {
    try { await transport.close(); if (primary) primary.cleanup = { mysql: "PASS", tunnel: "PASS", ...rollback }; }
    catch (error) {
      const cleanup = { ...(error instanceof FinancialReadError && error.cleanup ? error.cleanup : { mysql: "FAIL" as const, tunnel: "FAIL" as const }), ...rollback,
        resourcesDiagnostic: readDiagnostic({ operation: "resources_close", phase: "cleanup", substep: "close" }, error) };
      if (!primary) {
        const failure = new FinancialReadError("STAGING_FINANCIAL_READ_FAILED", readDiagnostic({ operation: "resources_close", phase: "cleanup", substep: "close" }, error));
        failure.cleanup = cleanup; throw failure;
      }
      primary.cleanup = cleanup;
    }
  }
}

type TunnelHandle = { endpoint: TunnelEndpoint; alive(): boolean; close(): Promise<void> };
type SpawnLike = (file: string, args: readonly string[], options: object) => ChildProcess;

function processGroupExists(pgid: number) {
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
      if (Number(fields[2]) === pgid && fields[0] !== "Z") return true;
    } catch { /* process exited during the scan */ }
  }
  return false;
}

function startFinancialTunnel(start: SpawnLike = spawn): Promise<TunnelHandle> {
  assertFinancialConnectArgs(FINANCIAL_CONNECT_ARGS);
  if (createHash("sha256").update(readFileSync(RAILWAY)).digest("hex") !== RAILWAY_SHA256)
    throw Error("STAGING_FINANCIAL_CLI_INTEGRITY");
  const child = start(RAILWAY, FINANCIAL_CONNECT_ARGS, {
    shell: false, detached: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NO_COLOR: "1", CLICOLOR: "0", TERM: "dumb" },
  });
  return new Promise((resolve, reject) => {
    let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), settled = false, closePromise: Promise<void> | undefined;
    const clear = () => { stdout.fill(0); stderr.fill(0); stdout = Buffer.alloc(0); stderr = Buffer.alloc(0); };
    const timer = setTimeout(() => finishError("STAGING_FINANCIAL_TUNNEL_TIMEOUT"), READY_TIMEOUT_MS);
    const close = () => closePromise ??= (async () => {
      clearTimeout(timer); clear();
      if (child.pid) { try { process.kill(-child.pid, "SIGINT"); } catch { /* already exited */ } }
      const exited = await new Promise<boolean>(done => {
        if (!child.pid || child.exitCode !== null || child.signalCode !== null) return done(true);
        const force = setTimeout(() => { if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch {} } }, 1000);
        const limit = setTimeout(() => { clearTimeout(force); done(false); }, 2500);
        child.once("exit", () => { clearTimeout(force); clearTimeout(limit); done(true); });
      });
      if (child.pid && processGroupExists(child.pid)) {
        try { process.kill(-child.pid, "SIGKILL"); } catch {}
      }
      if (!exited || (child.pid && processGroupExists(child.pid))) throw Error("STAGING_FINANCIAL_CLEANUP_FAILED");
    })();
    const finishError = (code: string) => {
      if (settled) return;
      settled = true; clearTimeout(timer); clear();
      void close().catch(() => {});
      reject(Error(code));
    };
    child.once("error", () => finishError("STAGING_FINANCIAL_TUNNEL_START_FAILED"));
    child.once("exit", () => { if (!settled) finishError("STAGING_FINANCIAL_TUNNEL_EXITED"); });
    const consume = (which: "stdout" | "stderr", chunk: Buffer) => {
      if (settled) return;
      const current = which === "stdout" ? stdout : stderr;
      const next = Buffer.concat([current, chunk]);
      current.fill(0);
      if (which === "stdout") stdout = next; else stderr = next;
      if (stdout.length + stderr.length > 16384) return finishError("STAGING_FINANCIAL_TUNNEL_OUTPUT_LIMIT");
      const output = Buffer.concat([stdout, Buffer.from("\n"), stderr]).toString("utf8");
      if (!output.includes(MARKER)) return;
      try {
        const endpoint = parseTunnelOutput(output);
        if (endpoint.database !== FINANCIAL_READ_SCOPE.database || endpoint.user !== FINANCIAL_READ_SCOPE.expectedLogin)
          throw Error("STAGING_FINANCIAL_ENDPOINT_MISMATCH");
        void assertLoopbackListener(endpoint.port).then(() => {
          if (settled || child.exitCode !== null) { endpoint.password = ""; return finishError("STAGING_FINANCIAL_TUNNEL_EXITED"); }
          settled = true; clearTimeout(timer); clear();
          resolve({ endpoint, alive: () => child.exitCode === null && child.signalCode === null,
            close: async () => { endpoint.password = ""; await close(); } });
        }).catch(() => { endpoint.password = ""; finishError("STAGING_FINANCIAL_LOOPBACK_INVALID"); });
      } catch (error) {
        finishError(error instanceof Error && /^STAGING_FINANCIAL_[A-Z_]+$/.test(error.message)
          ? error.message : "STAGING_FINANCIAL_TUNNEL_OUTPUT_INVALID");
      }
    };
    child.stdout?.on("data", (chunk: Buffer) => consume("stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => consume("stderr", chunk));
  });
}

export async function openStagingFinancialReadOnlyTransport(): Promise<ReadOnlyInventoryTransport> {
  assertFinancialReadScope(FINANCIAL_READ_SCOPE);
  const tunnel = await startFinancialTunnel();
  let connection: Connection | undefined;
  let phase: "mysql_connect" | "identity_query" | "identity_validation" = "mysql_connect";
  try {
    connection = await createConnection({ host: "127.0.0.1", port: tunnel.endpoint.port,
      user: tunnel.endpoint.user, password: tunnel.endpoint.password, database: FINANCIAL_READ_SCOPE.database,
      multipleStatements: false, connectTimeout: 10_000, enableKeepAlive: true, dateStrings: true,
      timezone: "Z", supportBigNumbers: true, bigNumberStrings: true });
    connection.config.password = "";
    phase = "identity_query";
    const identity = await readFinancialMysqlIdentity(connection);
    phase = "identity_validation";
    assertFinancialMysqlIdentity(identity);
    let closing: Promise<CleanupProof> | undefined;
    return { connection, alive: tunnel.alive, close: async () => {
      await (closing ??= closeOwnedFinancialResources(connection, tunnel));
    } };
  } catch (error) {
    const primary = error instanceof FinancialReadError ? error : new FinancialReadError(classifyFinancialConnectFailure(phase, error),
      phase === "identity_validation" ? identityMismatchDiagnostic() : undefined);
    try { primary.cleanup = await closeOwnedFinancialResources(connection, tunnel); }
    catch (cleanupError) { primary.cleanup = cleanupError instanceof FinancialReadError ? cleanupError.cleanup : { mysql: "FAIL", tunnel: "FAIL" }; }
    throw primary;
  } finally {
    tunnel.endpoint.password = "";
  }
}
