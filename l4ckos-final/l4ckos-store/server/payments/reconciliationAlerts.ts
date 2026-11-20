import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import type { PoolConnection } from "mysql2/promise";

/**
 * Durable operator alerts for financial divergences. NO external delivery: the row only exists so that a divergence can never be
 * acknowledged to the provider without a recoverable, queryable operational record.
 *
 * Storage: the existing `notificationOutbox` (no migration). Guarantees relied upon, and nothing more:
 *  - `dedupeKey` is UNIQUE  -> one logical alert per divergence, idempotent and safe under concurrency.
 *  - the insert happens in the CALLER's transaction -> the alert commits (or rolls back) with the divergence audit and the inbox
 *    state, so a failed write fails the webhook closed (503) and the provider redelivers.
 *  - `type` is a private value that the e-mail/notification worker does not drain (it selects explicit types), and `nextAttemptAt`
 *    is parked far in the future as defense in depth. A future delivery worker needs its own explicit authorization.
 * It does NOT rely on any unique key of `auditLogs` (there is none).
 */
export const RECONCILIATION_ALERT_TYPE = "financial-reconciliation-alert-v1";
const PARKED_UNTIL = "2037-12-31 00:00:00"; // TIMESTAMP range ends in 2038
const MAX_PAYLOAD_BYTES = 4096;

export type ReconciliationAlertCategory =
  | "payment_without_correlation"
  | "payment_deleted_unconfirmed"
  | "payment_after_release"
  | "order_attempt_payment_inconsistent"
  | "reference_conflict"
  | "provider_state_unavailable"
  | "observation_requires_review";

const CATEGORY_BY_KIND: Record<string, ReconciliationAlertCategory> = {
  PAYMENT_WITHOUT_CORRELATION: "payment_without_correlation",
  PAID_AFTER_TERMINAL_FAILURE: "payment_after_release",
  PAID_AFTER_RELEASE: "payment_after_release",
  PAID_FOR_UNSTARTED_ATTEMPT: "payment_after_release",
  PAID_WITH_DIFFERENT_PAYMENT_ID: "order_attempt_payment_inconsistent",
  PAYMENT_ID_MISMATCH: "order_attempt_payment_inconsistent",
  PAYMENT_REFERENCE_MISMATCH: "reference_conflict",
  PAYMENT_ORDER_BINDING_MISMATCH: "order_attempt_payment_inconsistent",
  PAID_AMOUNT_MISMATCH: "order_attempt_payment_inconsistent",
  PAYMENT_AMOUNT_MISMATCH: "order_attempt_payment_inconsistent",
  STOCK_PAYMENT_DELETED_UNCONFIRMED: "payment_deleted_unconfirmed",
  PAYMENT_DELETED_PREFLIGHT_ESCALATED: "provider_state_unavailable",
  STOCK_REFERENCE_RECONCILIATION: "reference_conflict",
  STOCK_RECONCILIATION_REQUIRED: "observation_requires_review",
  STOCK_OVERDUE_OBSERVED: "observation_requires_review",
  ASAAS_WEBHOOK_RECONCILIATION: "observation_requires_review",
  ASAAS_WEBHOOK_FINANCIAL_EXCEPTION: "order_attempt_payment_inconsistent",
};

export type ReconciliationAlertInput = {
  /** Machine reason, e.g. a StockFinancialDivergenceKind or one of the controller reasons above. */
  kind: string;
  /** Logical identity of the divergence (NOT the delivery): same subject + kind == same alert. */
  subject: { attemptId?: string | null; orderId?: number | string | null; paymentId?: string | null; eventKey?: string | null };
  /** Only when the order row is known to exist (FK): otherwise leave undefined. */
  orderId?: number | null;
  providerEventId?: string | null;
  reference?: string | null;
  observed?: { status?: string | null; billingType?: string | null; amountCents?: number | null; expectedAmountCents?: number | null };
  reason?: string | null;
};

export type ReconciliationAlertState = "pending" | "in_review" | "resolved";

export type BuiltAlert = { dedupeKey: string; type: string; orderId: number | null; payload: string; category: ReconciliationAlertCategory };

const clip = (value: unknown, max = 120): string | null => (value === null || value === undefined ? null : String(value).slice(0, max));

/** Pure: builds the sanitized alert. Identifiers, amounts and reasons only: never payer data nor the raw provider payload. */
export function buildReconciliationAlert(input: ReconciliationAlertInput): BuiltAlert {
  const category = CATEGORY_BY_KIND[input.kind] ?? "observation_requires_review";
  const identity = JSON.stringify([
    input.kind, clip(input.subject.attemptId), clip(input.subject.orderId), clip(input.subject.paymentId), clip(input.subject.eventKey, 191),
  ]);
  const dedupeKey = `reconciliation-alert:v1:${createHash("sha256").update(identity).digest("hex")}`;
  const payload = JSON.stringify({
    v: 1, kind: clip(input.kind, 80), category,
    attemptId: clip(input.subject.attemptId), orderId: clip(input.subject.orderId ?? input.orderId), paymentId: clip(input.subject.paymentId),
    providerEventId: clip(input.providerEventId, 191), reason: clip(input.reason, 160),
    referenceHint: input.reference ? truncateIdentifier(input.reference) : null,
    referenceHash: input.reference ? createHash("sha256").update(String(input.reference).trim()).digest("hex") : null,
    observedStatus: clip(input.observed?.status, 40), observedBillingType: clip(input.observed?.billingType, 40),
    observedAmountCents: input.observed?.amountCents ?? null,
    expectedAmountCents: input.observed?.expectedAmountCents ?? null,
    financialMutation: false, stockMutation: false, externalNotification: false,
  });
  if (Buffer.byteLength(payload) > MAX_PAYLOAD_BYTES) throw new Error("RECONCILIATION_ALERT_PAYLOAD_LIMIT");
  const orderId = Number.isSafeInteger(input.orderId) && (input.orderId as number) > 0 ? (input.orderId as number) : null;
  return { dedupeKey, type: RECONCILIATION_ALERT_TYPE, orderId, payload, category };
}

/** Minimal executor so the same logic runs on a mysql2 connection (STOCK store) and on a drizzle transaction (webhook controller). */
export type AlertExecutor = (query: string, params: unknown[]) => Promise<{ rows: Array<Record<string, any>>; affectedRows: number }>;

export const alertExecutorForConnection = (connection: PoolConnection): AlertExecutor => async (query, params) => {
  const [result] = await connection.execute(query, params as any[]);
  return Array.isArray(result) ? { rows: result as Array<Record<string, any>>, affectedRows: 0 } : { rows: [], affectedRows: Number((result as any).affectedRows ?? 0) };
};

type DrizzleLike = { execute(query: SQL): Promise<unknown> };
export const alertExecutorForDrizzle = (tx: DrizzleLike): AlertExecutor => async (query, params) => {
  const parts = query.split("?");
  let composed: SQL = sql.raw(parts[0]);
  params.forEach((value, index) => { composed = sql`${composed}${value}${sql.raw(parts[index + 1])}`; });
  const raw = await tx.execute(composed);
  const first = Array.isArray(raw) ? raw[0] : raw;
  return Array.isArray(first) ? { rows: first as Array<Record<string, any>>, affectedRows: 0 } : { rows: [], affectedRows: Number((first as any)?.affectedRows ?? 0) };
};

/**
 * Idempotent: the first writer creates the alert, later writers (redelivery, concurrent events of the same divergence) are no-ops.
 * MUST run in the transaction that records the divergence; a throw propagates so the webhook is not acknowledged.
 */
export async function recordReconciliationAlert(exec: AlertExecutor, input: ReconciliationAlertInput): Promise<"recorded" | "duplicate"> {
  const alert = buildReconciliationAlert(input);
  const existing = await exec("SELECT id FROM notificationOutbox WHERE dedupeKey = ? LIMIT 1", [alert.dedupeKey]);
  if (existing.rows[0]) return "duplicate";
  try {
    await exec(
      `INSERT INTO notificationOutbox (dedupeKey, type, orderId, payload, status, nextAttemptAt)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
      [alert.dedupeKey, alert.type, alert.orderId, alert.payload, PARKED_UNTIL],
    );
  } catch (error) {
    const candidate = error as { code?: unknown; errno?: unknown };
    // A duplicate dedupeKey proves another transaction persisted the same
    // logical alert. Catch only that constraint; other write failures must
    // still abort the caller's transaction and keep the webhook retryable.
    if (candidate.code === "ER_DUP_ENTRY" || Number(candidate.errno) === 1062) return "duplicate";
    throw error;
  }
  return "recorded";
}

export type ReconciliationPriority = "P1" | "P2" | "P3";
export const RECONCILIATION_PRIORITY_BY_CATEGORY: Record<ReconciliationAlertCategory, ReconciliationPriority> = {
  payment_without_correlation: "P1", payment_after_release: "P1", order_attempt_payment_inconsistent: "P1", reference_conflict: "P1",
  payment_deleted_unconfirmed: "P2", provider_state_unavailable: "P2", observation_requires_review: "P3",
};
const CATEGORIES_BY_PRIORITY = (p: ReconciliationPriority) =>
  (Object.keys(RECONCILIATION_PRIORITY_BY_CATEGORY) as ReconciliationAlertCategory[]).filter(c => RECONCILIATION_PRIORITY_BY_CATEGORY[c] === p);
export const RECONCILIATION_CATEGORY_TEXT: Record<ReconciliationAlertCategory, string> = {
  payment_without_correlation: "Pagamento recebido sem vínculo com a tentativa (cobrança não correlacionada).",
  payment_after_release: "Pagamento recebido depois que a reserva foi liberada ou nunca iniciada.",
  order_attempt_payment_inconsistent: "Pedido, tentativa e cobrança não são consistentes (identificador ou valor divergente).",
  reference_conflict: "A referência da cobrança não corresponde ao pedido ou é desconhecida.",
  payment_deleted_unconfirmed: "Cobrança removida sem confirmação autoritativa do provedor.",
  provider_state_unavailable: "Estado atual da cobrança indisponível no provedor após tentativas.",
  observation_requires_review: "Observação financeira que requer revisão (vencimento ou resultado do provedor desconhecido).",
};

/** Sanitized, read-only projection: no payload/metadata, no payer data, ids truncated. */
export type ReconciliationAlertView = {
  id: number; state: ReconciliationAlertState; priority: ReconciliationPriority; category: ReconciliationAlertCategory; kind: string | null;
  reasonText: string; orderId: number | null; attemptRef: string | null; paymentRef: string | null; detectedAt: string; ageSeconds: number; reviewer: string | null;
};

/** 8 leading + 4 trailing characters; short values are masked entirely. Never returns the full identifier. */
export function truncateIdentifier(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value);
  if (text.length <= 12) return `${text.slice(0, 2)}…${text.slice(-2)}`;
  return `${text.slice(0, 8)}…${text.slice(-4)}`;
}

const asCategory = (value: unknown): ReconciliationAlertCategory =>
  typeof value === "string" && value in RECONCILIATION_PRIORITY_BY_CATEGORY ? (value as ReconciliationAlertCategory) : "observation_requires_review";

const STATE_SQL: Record<ReconciliationAlertState, string> = {
  resolved: "status = 'sent'",
  in_review: "(status = 'processing' AND leaseExpiresAt IS NOT NULL AND leaseExpiresAt > CURRENT_TIMESTAMP)",
  pending: "(status = 'pending' OR (status = 'processing' AND (leaseExpiresAt IS NULL OR leaseExpiresAt <= CURRENT_TIMESTAMP)))",
};
const CASE_STATE_SQL = `CASE WHEN status = 'sent' THEN 'resolved'
  WHEN status = 'processing' AND leaseExpiresAt IS NOT NULL AND leaseExpiresAt > CURRENT_TIMESTAMP THEN 'in_review' ELSE 'pending' END`;

function view(row: Record<string, any>): ReconciliationAlertView {
  let p: Record<string, any> = {};
  try { p = JSON.parse(String(row.payload ?? "{}")); } catch { /* corrupt payload stays listed, without details */ }
  const category = asCategory(p.category);
  const orderId = row.orderId === null || row.orderId === undefined ? (p.orderId && /^\d+$/.test(String(p.orderId)) ? Number(p.orderId) : null) : Number(row.orderId);
  return {
    id: Number(row.id), state: row.caseState as ReconciliationAlertState, priority: RECONCILIATION_PRIORITY_BY_CATEGORY[category], category,
    kind: typeof p.kind === "string" ? p.kind.slice(0, 80) : null, reasonText: RECONCILIATION_CATEGORY_TEXT[category], orderId,
    attemptRef: truncateIdentifier(p.attemptId), paymentRef: truncateIdentifier(p.paymentId),
    detectedAt: new Date(row.createdAt).toISOString(), ageSeconds: Math.max(0, Number(row.ageSeconds ?? 0)), reviewer: row.lockedBy ?? null,
  };
}

export type ReconciliationAlertFilter = { state?: ReconciliationAlertState; priority?: ReconciliationPriority; category?: ReconciliationAlertCategory; limit?: number; cursor?: number | null };
export const RECONCILIATION_PAGE_MAX = 100;

/**
 * Read-only. Filters are part of the WHERE clause (applied BEFORE the limit) and pagination is keyset by the primary key (`id < cursor`,
 * `ORDER BY id DESC`), so pages are deterministic and stable while new alerts arrive. Time-based state/age come from the DATABASE clock.
 */
export async function queryReconciliationAlerts(exec: AlertExecutor, filter: ReconciliationAlertFilter = {}): Promise<{ items: ReconciliationAlertView[]; nextCursor: number | null }> {
  const limit = Math.min(Math.max(Math.trunc(Number(filter.limit ?? 25)) || 25, 1), RECONCILIATION_PAGE_MAX);
  const where: string[] = ["type = ?"]; const params: unknown[] = [RECONCILIATION_ALERT_TYPE];
  if (filter.state) { if (!(filter.state in STATE_SQL)) throw new Error("RECONCILIATION_FILTER_INVALID"); where.push(STATE_SQL[filter.state]); }
  const categories = filter.category ? [filter.category] : filter.priority ? CATEGORIES_BY_PRIORITY(filter.priority) : null;
  if (filter.category && !(filter.category in RECONCILIATION_PRIORITY_BY_CATEGORY)) throw new Error("RECONCILIATION_FILTER_INVALID");
  if (categories) {
    if (filter.category && filter.priority && RECONCILIATION_PRIORITY_BY_CATEGORY[filter.category] !== filter.priority) return { items: [], nextCursor: null };
    if (!categories.length) throw new Error("RECONCILIATION_FILTER_INVALID");
    where.push(`JSON_UNQUOTE(JSON_EXTRACT(payload, '$.category')) IN (${categories.map(() => "?").join(",")})`); params.push(...categories);
  }
  if (filter.cursor !== undefined && filter.cursor !== null) { if (!Number.isSafeInteger(filter.cursor) || filter.cursor <= 0) throw new Error("RECONCILIATION_CURSOR_INVALID"); where.push("id < ?"); params.push(filter.cursor); }
  const { rows } = await exec(
    `SELECT id, orderId, payload, createdAt, lockedBy, ${CASE_STATE_SQL} AS caseState, TIMESTAMPDIFF(SECOND, createdAt, CURRENT_TIMESTAMP) AS ageSeconds
       FROM notificationOutbox WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ${limit + 1}`,
    params,
  );
  const page = rows.slice(0, limit).map(view);
  return { items: page, nextCursor: rows.length > limit ? page[page.length - 1].id : null };
}

/** Compatibility alias (items only). */
export async function listReconciliationAlerts(exec: AlertExecutor, options: ReconciliationAlertFilter = {}): Promise<ReconciliationAlertView[]> {
  return (await queryReconciliationAlerts(exec, options)).items;
}

export type ReconciliationSummary = { pending: number; inReview: number; resolved: number; openByPriority: Record<ReconciliationPriority, number>; oldestOpenAgeSeconds: number | null };
export async function summarizeReconciliationAlerts(exec: AlertExecutor): Promise<ReconciliationSummary> {
  const { rows } = await exec(
    `SELECT ${CASE_STATE_SQL} AS caseState, JSON_UNQUOTE(JSON_EXTRACT(payload, '$.category')) AS category, COUNT(*) AS n, MAX(TIMESTAMPDIFF(SECOND, createdAt, CURRENT_TIMESTAMP)) AS oldest
       FROM notificationOutbox WHERE type = ? GROUP BY caseState, category`,
    [RECONCILIATION_ALERT_TYPE],
  );
  const out: ReconciliationSummary = { pending: 0, inReview: 0, resolved: 0, openByPriority: { P1: 0, P2: 0, P3: 0 }, oldestOpenAgeSeconds: null };
  for (const r of rows) {
    const n = Number(r.n); const state = r.caseState as ReconciliationAlertState;
    if (state === "resolved") { out.resolved += n; continue; }
    if (state === "pending") out.pending += n; else out.inReview += n;
    out.openByPriority[RECONCILIATION_PRIORITY_BY_CATEGORY[asCategory(r.category)]] += n;
    out.oldestOpenAgeSeconds = Math.max(out.oldestOpenAgeSeconds ?? 0, Number(r.oldest ?? 0));
  }
  return out;
}

const REVIEWER = /^[A-Za-z0-9_.:@-]{3,80}$/;

/** pending (or stale in_review) -> in_review. Lease-based so an interrupted review is recoverable without duplicating the alert. */
export async function claimReconciliationAlertForReview(exec: AlertExecutor, alertId: number, reviewer: string, leaseSeconds = 900): Promise<"claimed" | "not_claimable"> {
  if (!REVIEWER.test(reviewer) || !Number.isSafeInteger(alertId) || alertId <= 0) throw new Error("RECONCILIATION_ALERT_REVIEWER_INVALID");
  const lease = Math.min(Math.max(Math.trunc(leaseSeconds), 30), 86_400);
  const result = await exec(
    `UPDATE notificationOutbox SET status = 'processing', lockedBy = ?, lockedAt = CURRENT_TIMESTAMP, leaseExpiresAt = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ${lease} SECOND)
      WHERE id = ? AND type = ? AND (status = 'pending' OR (status = 'processing' AND leaseExpiresAt <= CURRENT_TIMESTAMP))`,
    [reviewer, alertId, RECONCILIATION_ALERT_TYPE],
  );
  return result.affectedRows === 1 ? "claimed" : "not_claimable";
}

/**
 * in_review -> resolved, only by the reviewer holding the lease. It records that a human closed the case; it changes NO order,
 * payment, stock or reservation (those need their own authorized procedure).
 */
export async function resolveReconciliationAlert(exec: AlertExecutor, alertId: number, reviewer: string): Promise<"resolved" | "not_resolvable"> {
  if (!REVIEWER.test(reviewer)) throw new Error("RECONCILIATION_ALERT_REVIEWER_INVALID");
  const result = await exec(
    `UPDATE notificationOutbox SET status = 'sent', sentAt = CURRENT_TIMESTAMP, leaseExpiresAt = NULL
      WHERE id = ? AND type = ? AND status = 'processing' AND lockedBy = ? AND leaseExpiresAt > CURRENT_TIMESTAMP`,
    [alertId, RECONCILIATION_ALERT_TYPE, reviewer],
  );
  return result.affectedRows === 1 ? "resolved" : "not_resolvable";
}

/**
 * Resolves a strong STOCK payment reference to its numeric order id, in the caller's transaction. Returns null when the reference is
 * unknown (e.g. a charge issued before a database restore), ambiguous, or stale (the order no longer belongs to the same attempt).
 */
export async function resolveStrongStockReferenceOrderId(exec: AlertExecutor, reference: string): Promise<number | null> {
  const { rows } = await exec(
    `SELECT a.orderId AS orderId, a.entityId AS attemptId, o.stockAttemptId AS stockAttemptId
       FROM auditLogs a LEFT JOIN orders o ON o.id = a.orderId
      WHERE a.correlationId = ? AND a.action = 'stock.payment_reference.v1' LIMIT 2`,
    [reference],
  );
  if (rows.length !== 1) return null;
  const row = rows[0];
  const orderId = Number(row.orderId);
  if (!Number.isSafeInteger(orderId) || orderId <= 0 || !row.stockAttemptId || row.stockAttemptId !== row.attemptId) return null;
  return orderId;
}
