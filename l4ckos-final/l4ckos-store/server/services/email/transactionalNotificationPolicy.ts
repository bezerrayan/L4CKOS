/** Shared, side-effect-free policy for the existing notification outboxes. */
export const PAYMENT_NOTIFICATION_WORKER_FLAG =
  "PAYMENT_NOTIFICATION_RECOVERY_WORKER_ENABLED";
export const NOTIFICATION_MAX_ATTEMPTS = 5;
export const RESEND_IDEMPOTENCY_SAFETY_WINDOW_MS = 23 * 60 * 60 * 1000;

export type TransactionalEmailEvent =
  | "order.created"
  | "payment.pending"
  | "payment.confirmed"
  | "order.cancelled"
  | "exclusive.request_received"
  | "exclusive.access_approved"
  | "exclusive.access_rejected"
  | "exclusive.access_revoked";

const ORDER_EVENT_KEY_PREFIX: Partial<Record<TransactionalEmailEvent, string>> =
  {
    "order.created": "order-created-email:v1:order",
    "payment.pending": "payment-pending-email:v1:order",
    "payment.confirmed": "payment-approved-email:v1:order",
    "order.cancelled": "order-cancelled-email:v1:order",
  };

/**
 * Returns the same logical key for duplicate delivery of one domain transition.
 * `revision` distinguishes a later legitimate transition (such as a second
 * access decision); it is metadata, never user-supplied email content.
 */
export function buildTransactionalEmailEventKey(input: {
  event: TransactionalEmailEvent;
  aggregateId: number;
  revision?: number;
  grantId?: number;
}): string {
  if (!Number.isSafeInteger(input.aggregateId) || input.aggregateId <= 0)
    throw new Error("NOTIFICATION_AGGREGATE_ID_INVALID");
  const revision = input.revision ?? 1;
  if (!Number.isSafeInteger(revision) || revision <= 0)
    throw new Error("NOTIFICATION_REVISION_INVALID");

  const orderPrefix = ORDER_EVENT_KEY_PREFIX[input.event];
  if (orderPrefix) return `${orderPrefix}:${input.aggregateId}`;

  switch (input.event) {
    case "exclusive.request_received":
      return `req:${input.aggregateId}:received:${revision}`;
    case "exclusive.access_approved":
      return `req:${input.aggregateId}:approved:${revision}`;
    case "exclusive.access_rejected":
      return `req:${input.aggregateId}:rejected:${revision}`;
    case "exclusive.access_revoked":
      if (!Number.isSafeInteger(input.grantId) || Number(input.grantId) <= 0)
        throw new Error("NOTIFICATION_GRANT_ID_INVALID");
      return `grant:${input.grantId}:revoked`;
    default:
      throw new Error("NOTIFICATION_EVENT_INVALID");
  }
}

export type NotificationFailureKind = "permanent" | "transient" | "ambiguous";
export type NotificationTerminalState = "dead" | "review";
export type NotificationRetryPlan =
  | { action: "retry"; errorCode: string; nextAttemptAt: Date; attempt: number }
  | { action: NotificationTerminalState; errorCode: string; attempt: number };

const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "PAYMENT_NOTIFICATION_PROVIDER_TIMEOUT",
  "PAYMENT_NOTIFICATION_ACCEPTANCE_UNPROVEN",
]);
const POLICY_CODES = new Set([
  "EMAIL_POLICY_BLOCKED",
  "STAGING_EMAIL_CONFIG_INVALID",
  "STAGING_EMAIL_ALLOWLIST_INVALID",
  "STAGING_EMAIL_RECIPIENT_BLOCKED",
  "PAYMENT_NOTIFICATION_PAYLOAD_INVALID",
  "PAYMENT_NOTIFICATION_RECIPIENT_UNAVAILABLE",
]);

function errorFields(error: unknown): {
  code: string | null;
  status: number | null;
} {
  if (!error || typeof error !== "object") return { code: null, status: null };
  const value = error as {
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };
  const code = typeof value.code === "string" ? value.code : null;
  const status = Number.isInteger(value.statusCode)
    ? Number(value.statusCode)
    : Number.isInteger(value.status)
      ? Number(value.status)
      : null;
  return { code, status };
}

export function classifyNotificationFailure(error: unknown): {
  kind: NotificationFailureKind;
  errorCode: string;
} {
  const { code, status } = errorFields(error);
  if (code && POLICY_CODES.has(code))
    return { kind: "permanent", errorCode: code };
  if (status === 408 || status === 429 || (status !== null && status >= 500))
    return {
      kind: "transient",
      errorCode:
        status === 429 ? "PROVIDER_RATE_LIMITED" : "PROVIDER_TEMPORARY_FAILURE",
    };
  if (status !== null && status >= 400 && status < 500)
    return { kind: "permanent", errorCode: "PROVIDER_REJECTED_REQUEST" };
  if (code && NETWORK_CODES.has(code))
    return {
      kind: "ambiguous",
      errorCode:
        code === "ETIMEDOUT" || code.includes("TIMEOUT")
          ? "PROVIDER_TIMEOUT_UNCONFIRMED"
          : "PROVIDER_CONNECTION_UNCONFIRMED",
    };
  return { kind: "ambiguous", errorCode: "DELIVERY_OUTCOME_UNCONFIRMED" };
}

export function planNotificationRetry(input: {
  error: unknown;
  attempt: number;
  firstAttemptAt: Date;
  now?: Date;
  random?: number;
  maxAttempts?: number;
  idempotencyWindowMs?: number;
}): NotificationRetryPlan {
  const now = input.now ?? new Date();
  const maxAttempts = input.maxAttempts ?? NOTIFICATION_MAX_ATTEMPTS;
  const windowMs =
    input.idempotencyWindowMs ?? RESEND_IDEMPOTENCY_SAFETY_WINDOW_MS;
  if (
    !Number.isSafeInteger(input.attempt) ||
    input.attempt < 1 ||
    !Number.isFinite(input.firstAttemptAt.getTime()) ||
    !Number.isFinite(now.getTime()) ||
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    !Number.isSafeInteger(windowMs) ||
    windowMs < 1
  ) {
    throw new Error("NOTIFICATION_RETRY_INPUT_INVALID");
  }

  const failure = classifyNotificationFailure(input.error);
  if (failure.kind === "permanent")
    return {
      action: "dead",
      errorCode: failure.errorCode,
      attempt: input.attempt,
    };
  if (input.attempt >= maxAttempts)
    return {
      action: "dead",
      errorCode: "ATTEMPT_LIMIT_REACHED",
      attempt: input.attempt,
    };

  const elapsed = now.getTime() - input.firstAttemptAt.getTime();
  if (elapsed < 0 || elapsed >= windowMs)
    return {
      action: "review",
      errorCode: "IDEMPOTENCY_WINDOW_RECONCILIATION_REQUIRED",
      attempt: input.attempt,
    };

  const baseDelay = Math.min(
    60_000 * 2 ** (input.attempt - 1),
    6 * 60 * 60 * 1000
  );
  const random = Math.min(1, Math.max(0, input.random ?? Math.random()));
  const jitteredDelay = Math.round(baseDelay * (0.8 + random * 0.4));
  const nextAttemptAt = new Date(now.getTime() + jitteredDelay);
  if (nextAttemptAt.getTime() - input.firstAttemptAt.getTime() >= windowMs)
    return {
      action: "review",
      errorCode: "IDEMPOTENCY_WINDOW_RECONCILIATION_REQUIRED",
      attempt: input.attempt,
    };
  return {
    action: "retry",
    errorCode: failure.errorCode,
    nextAttemptAt,
    attempt: input.attempt,
  };
}

/** Never persist/log provider messages, recipient addresses, payloads or access codes. */
export function notificationFailureLogFields(input: {
  eventKey: string;
  error: unknown;
  attempt: number;
  action: NotificationRetryPlan["action"];
}): { eventKey: string; errorCode: string; attempt: number; action: string } {
  const failure = classifyNotificationFailure(input.error);
  return {
    eventKey: input.eventKey,
    errorCode: failure.errorCode,
    attempt: input.attempt,
    action: input.action,
  };
}

/** Explicit opt-in only. Invalid strings fail closed instead of silently enabling a worker. */
export function isTransactionalNotificationWorkerEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  const value = env[PAYMENT_NOTIFICATION_WORKER_FLAG];
  if (
    value === undefined ||
    value.trim() === "" ||
    value.trim().toLowerCase() === "false"
  )
    return false;
  if (value.trim().toLowerCase() === "true") return true;
  throw new Error(
    `INVALID_NOTIFICATION_WORKER_FLAG:${PAYMENT_NOTIFICATION_WORKER_FLAG}`
  );
}
