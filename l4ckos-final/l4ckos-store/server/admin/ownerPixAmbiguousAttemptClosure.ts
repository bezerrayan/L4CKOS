import { createHash } from "node:crypto";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";
import {
  STOCK_PAYMENT_CUSTOMER_ACTION,
  STOCK_PAYMENT_REFERENCE_ACTION,
  isStrongStockPaymentReference,
} from "../stock/stockPaymentReference";

/** A one-off, owner PIX maintenance action. This is intentionally not exposed through an HTTP router. */
export const OWNER_PIX_CLOSE_ACTION = "stock.owner_pix_ambiguous_close.v1";
const EXPECTED = Object.freeze({
  ownerRole: "admin",
  orderTotalCents: 1000,
  productId: 46,
  variantId: 113,
  quantity: 1,
  physicalStock: 1,
  reservedStock: 1,
});
const REQUIRED_EVENT_TABLES = [
  "asaasWebhookInbox",
  "asaasWebhookEvents",
  "stockWebhookEvents",
] as const;
const MAX_IN_FLIGHT_AGE_SECONDS = 900;

export type OwnerPixClosureMode = "preflight" | "apply" | "status";
export type OwnerPixClosureResult =
  | { result: "ready"; financialOutcome: "unknown" }
  | {
      result: "closed";
      financialOutcome: "unknown";
      providerStatePreserved: "ambiguous";
    }
  | {
      result: "already_closed";
      financialOutcome: "unknown";
      providerStatePreserved: "ambiguous";
    }
  | { result: "commit_not_observed"; financialOutcome: "unknown" };

export class OwnerPixClosureError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "OwnerPixClosureError";
    this.code = code;
  }
}

type DbRow = RowDataPacket & Record<string, unknown>;
type AttemptRow = DbRow & {
  attemptId: string;
  ownerUserId: number | string;
  orderId: number | string;
  status: string;
  providerState: string;
  paymentId: string | null;
  amountCents: number | string;
  expired: number | string;
  expiryReviewed: number | string;
  reconciliationRequired: number | string;
  oldEnough: number | string;
};
type OrderRow = DbRow & {
  id: number | string;
  userId: number | string;
  stockAttemptId: string | null;
  stockPaymentId: string | null;
  asaasCheckoutId: string | null;
  status: string;
  paymentStatus: string;
  totalPrice: number | string;
  fulfillmentStatus?: string;
};

const fail = (code: string): never => {
  throw new OwnerPixClosureError(code);
};
const n = (value: unknown): number => {
  const valueAsNumber = Number(value);
  if (!Number.isSafeInteger(valueAsNumber))
    return fail("OWNER_PIX_CLOSE_UNSAFE_DATABASE_VALUE");
  return valueAsNumber;
};

async function rows<T extends DbRow>(
  connection: PoolConnection,
  sql: string,
  values: unknown[] = []
): Promise<T[]> {
  const [result] = await connection.execute<T[]>(sql, values);
  return result;
}

function operationCorrelationId(
  attemptId: string,
  auditReference: string
): string {
  return `ownerpix-close:v1:${createHash("sha256").update(`${attemptId}\n${auditReference}`, "utf8").digest("hex")}`;
}

function validateAuditReference(value: string | undefined): string {
  const reference = value?.trim() ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,190}$/.test(reference))
    fail("OWNER_PIX_CLOSE_AUDIT_REFERENCE_REQUIRED");
  return reference;
}

async function tableNames(connection: PoolConnection): Promise<Set<string>> {
  const result = await rows<DbRow & { tableName: string }>(
    connection,
    `SELECT table_name AS tableName FROM information_schema.tables WHERE table_schema = DATABASE()`
  );
  return new Set(
    result.map((row: DbRow & { tableName: string }) => String(row.tableName))
  );
}

async function columnsFor(
  connection: PoolConnection,
  table: string
): Promise<Set<string>> {
  const result = await rows<DbRow & { columnName: string }>(
    connection,
    `SELECT column_name AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?`,
    [table]
  );
  return new Set(
    result.map((row: DbRow & { columnName: string }) => String(row.columnName))
  );
}

async function assertTables(connection: PoolConnection): Promise<Set<string>> {
  const tables = await tableNames(connection);
  for (const table of [
    "users",
    "orders",
    "orderItems",
    "productVariants",
    "stockCheckoutAttempts",
    "stockCheckoutItems",
    "stockReservations",
    "payments",
    "auditLogs",
    ...REQUIRED_EVENT_TABLES,
  ]) {
    if (!tables.has(table)) fail("OWNER_PIX_CLOSE_REQUIRED_TABLE_MISSING");
  }
  if (!(await columnsFor(connection, "payments")).has("externalReference"))
    fail("OWNER_PIX_CLOSE_PAYMENT_REFERENCE_COLUMN_MISSING");
  return tables;
}

async function readAttempt(
  connection: PoolConnection,
  attemptId: string
): Promise<AttemptRow> {
  const [attempt] = await rows<AttemptRow>(
    connection,
    `SELECT attemptId, ownerUserId, orderId, status, providerState, paymentId, amountCents,
            (reservationExpiresAt <= UTC_TIMESTAMP(3)) AS expired,
            (expiryReviewedAt IS NOT NULL) AS expiryReviewed,
            (reconciliationRequiredAt IS NOT NULL) AS reconciliationRequired,
            (createdAt <= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ${MAX_IN_FLIGHT_AGE_SECONDS} SECOND)) AS oldEnough
       FROM stockCheckoutAttempts WHERE attemptId = ? FOR UPDATE`,
    [attemptId]
  );
  if (!attempt) fail("OWNER_PIX_CLOSE_ATTEMPT_NOT_FOUND");
  return attempt;
}

async function readOwner(
  connection: PoolConnection,
  ownerOpenId: string
): Promise<number> {
  const owners = await rows<DbRow & { id: number | string }>(
    connection,
    `SELECT id FROM users WHERE openId = ? AND role = ? AND isBlocked = 0 ORDER BY id LIMIT 2 FOR UPDATE`,
    [ownerOpenId, EXPECTED.ownerRole]
  );
  if (owners.length !== 1) fail("OWNER_PIX_CLOSE_AUTHORIZED_OWNER_NOT_UNIQUE");
  return n(owners[0].id);
}

async function readOrder(
  connection: PoolConnection,
  orderId: number,
  fulfillmentColumn: boolean
): Promise<OrderRow> {
  const fulfillment = fulfillmentColumn ? ", fulfillmentStatus" : "";
  const [order] = await rows<OrderRow>(
    connection,
    `SELECT id, userId, stockAttemptId, stockPaymentId, asaasCheckoutId, status, paymentStatus, totalPrice${fulfillment}
       FROM orders WHERE id = ? FOR UPDATE`,
    [orderId]
  );
  if (!order) fail("OWNER_PIX_CLOSE_ORDER_NOT_FOUND");
  return order;
}

async function assertNoFinancialOrWebhookEvidence(
  connection: PoolConnection,
  input: {
    attemptId: string;
    orderId: number;
    paymentReference: string;
    tables: Set<string>;
  }
): Promise<void> {
  const payments = await rows<DbRow>(
    connection,
    `SELECT id FROM payments WHERE orderId = ? FOR UPDATE`,
    [input.orderId]
  );
  if (payments.length) fail("OWNER_PIX_CLOSE_PAYMENT_ROW_FOUND");
  const paymentsByStrongReference = await rows<DbRow>(
    connection,
    `SELECT id FROM payments WHERE externalReference = ? FOR UPDATE`,
    [input.paymentReference]
  );
  if (paymentsByStrongReference.length)
    fail("OWNER_PIX_CLOSE_PAYMENT_REFERENCE_ROW_FOUND");

  if (input.tables.has("paymentEvents")) {
    const paymentEvents = await rows<DbRow>(
      connection,
      `SELECT id FROM paymentEvents WHERE orderId = ? FOR UPDATE`,
      [input.orderId]
    );
    if (paymentEvents.length) fail("OWNER_PIX_CLOSE_PAYMENT_EVENT_FOUND");
  }

  const asaasEvents = await rows<DbRow>(
    connection,
    `SELECT id FROM asaasWebhookEvents WHERE orderId = ? FOR UPDATE`,
    [input.orderId]
  );
  if (asaasEvents.length) fail("OWNER_PIX_CLOSE_ASAAS_EVENT_FOUND");

  // The inbox stores provider payloads. Reject malformed rows instead of silently skipping a possible correlation.
  const malformedInbox = await rows<DbRow>(
    connection,
    `SELECT eventId FROM asaasWebhookInbox WHERE payload IS NULL OR JSON_VALID(payload) = 0 LIMIT 1`
  );
  if (malformedInbox.length) fail("OWNER_PIX_CLOSE_WEBHOOK_INBOX_UNPARSEABLE");
  const matchingInbox = await rows<DbRow>(
    connection,
    `SELECT eventId FROM asaasWebhookInbox
      WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, '$.payment.externalReference')) = ?
         OR JSON_UNQUOTE(JSON_EXTRACT(payload, '$.externalReference')) = ?
      `,
    [input.paymentReference, input.paymentReference]
  );
  if (matchingInbox.length) fail("OWNER_PIX_CLOSE_CORRELATED_WEBHOOK_FOUND");

  const reconciliation = await rows<DbRow>(
    connection,
    `SELECT id FROM auditLogs
      WHERE (entityId = ? OR orderId = ?)
        AND action IN ('stock.reconciliation.required', 'payment.webhook_reconciliation_required.v1',
                       'payment.stock_reference_reconciliation.v1', 'payment.stock_overdue_observation.v1',
                       'payment.stock_deleted_reconciliation.v1')`,
    [input.attemptId, input.orderId]
  );
  if (reconciliation.length) fail("OWNER_PIX_CLOSE_RECONCILIATION_EVENT_FOUND");

  const providerCustomer = await rows<DbRow>(
    connection,
    `SELECT id FROM auditLogs WHERE action = ? AND entityId = ? AND orderId = ?`,
    [STOCK_PAYMENT_CUSTOMER_ACTION, input.attemptId, input.orderId]
  );
  if (providerCustomer.length)
    fail("OWNER_PIX_CLOSE_PROVIDER_PAYMENT_EVIDENCE_FOUND");
}

async function inspectAndValidate(
  connection: PoolConnection,
  input: {
    attemptId: string;
    ownerOpenId: string;
    auditReference?: string;
    mode: OwnerPixClosureMode;
  }
): Promise<{
  orderId: number;
  reservationId: number;
  ownerUserId: number;
  paymentReference: string;
  fulfillColumn: boolean;
  existingAudit: DbRow | null;
}> {
  const tables = await assertTables(connection);
  const orderColumns = await columnsFor(connection, "orders");
  const fulfillColumn = orderColumns.has("fulfillmentStatus");

  const ownerUserId = await readOwner(connection, input.ownerOpenId);
  const attempt = await readAttempt(connection, input.attemptId);
  const orderId = n(attempt.orderId);

  const expectedOperationId = input.auditReference
    ? operationCorrelationId(
        input.attemptId,
        validateAuditReference(input.auditReference)
      )
    : null;
  const operationAudits = await rows<
    DbRow & {
      id: number | string;
      actorUserId: number | string | null;
      actorType: string;
      event: string | null;
      correlationId: string | null;
      metadata: string | null;
      beforeState: string | null;
      afterState: string | null;
    }
  >(
    connection,
    `SELECT id, actorUserId, actorType, event, correlationId, metadata, beforeState, afterState FROM auditLogs
      WHERE action = ? AND entityId = ? ORDER BY id`,
    [OWNER_PIX_CLOSE_ACTION, input.attemptId]
  );
  if (operationAudits.length > 1)
    fail("OWNER_PIX_CLOSE_DUPLICATE_OPERATION_AUDIT");
  let existingAudit: DbRow | null = operationAudits[0] ?? null;
  if (
    existingAudit &&
    expectedOperationId &&
    existingAudit.correlationId !== expectedOperationId
  )
    fail("OWNER_PIX_CLOSE_DIFFERENT_OPERATION_ALREADY_RECORDED");
  if (existingAudit && input.mode === "apply" && !expectedOperationId)
    fail("OWNER_PIX_CLOSE_AUDIT_REFERENCE_REQUIRED");

  if (n(attempt.ownerUserId) !== ownerUserId)
    fail("OWNER_PIX_CLOSE_ATTEMPT_OWNER_MISMATCH");
  if (
    n(attempt.amountCents) !== EXPECTED.orderTotalCents ||
    attempt.paymentId !== null
  )
    fail("OWNER_PIX_CLOSE_ATTEMPT_FINANCIAL_STATE_MISMATCH");

  const order = await readOrder(connection, orderId, fulfillColumn);
  if (
    n(order.userId) !== ownerUserId ||
    order.stockAttemptId !== input.attemptId ||
    order.stockPaymentId !== null ||
    order.asaasCheckoutId !== null ||
    n(order.totalPrice) !== EXPECTED.orderTotalCents
  ) {
    fail("OWNER_PIX_CLOSE_ORDER_BINDING_MISMATCH");
  }

  const paymentReferenceRows = await rows<
    DbRow & { correlationId: string | null; orderId: number | string | null }
  >(
    connection,
    `SELECT correlationId, orderId FROM auditLogs WHERE action = ? AND entityId = ?`,
    [STOCK_PAYMENT_REFERENCE_ACTION, input.attemptId]
  );
  if (
    paymentReferenceRows.length !== 1 ||
    n(paymentReferenceRows[0].orderId) !== orderId ||
    !isStrongStockPaymentReference(paymentReferenceRows[0].correlationId)
  ) {
    fail("OWNER_PIX_CLOSE_STRONG_PAYMENT_REFERENCE_MISSING_OR_AMBIGUOUS");
  }
  const paymentReference = paymentReferenceRows[0].correlationId!;
  const paymentReferenceSha256 = createHash("sha256")
    .update(paymentReference, "utf8")
    .digest("hex");

  if (existingAudit) {
    let metadata: Record<string, unknown>;
    let beforeState: Record<string, unknown>;
    let afterState: Record<string, unknown>;
    try {
      metadata = JSON.parse(String(existingAudit.metadata ?? ""));
      beforeState = JSON.parse(String(existingAudit.beforeState ?? ""));
      afterState = JSON.parse(String(existingAudit.afterState ?? ""));
    } catch {
      return fail("OWNER_PIX_CLOSE_OPERATION_AUDIT_INVALID");
    }
    if (
      metadata.financialOutcome !== "unknown" ||
      metadata.providerAbsenceConfirmed !== false ||
      metadata.residualUncertainty !== true ||
      metadata.decision !==
        "owner_supervised_manual_close_after_manual_charge_review" ||
      metadata.decisionAuthority !== "owner_approved_explicitly" ||
      metadata.originalProviderState !== "ambiguous" ||
      metadata.lateWebhookPolicy !==
        "reject_without_persisted_payment_correlation" ||
      metadata.releasedQuantity !== EXPECTED.quantity ||
      (input.auditReference !== undefined &&
        metadata.decisionReference !== input.auditReference) ||
      metadata.paymentReferenceSha256 !== paymentReferenceSha256 ||
      beforeState.providerState !== "ambiguous" ||
      afterState.providerState !== "ambiguous" ||
      beforeState.attemptStatus !== "reserved" ||
      beforeState.orderStatus !== "pending" ||
      beforeState.paymentStatus !== "unconfirmed" ||
      beforeState.reservationStatus !== "active" ||
      beforeState.quantity !== EXPECTED.quantity ||
      beforeState.physicalStock !== EXPECTED.physicalStock ||
      beforeState.reservedStock !== EXPECTED.reservedStock ||
      afterState.attemptStatus !== "released" ||
      afterState.orderStatus !== "cancelled" ||
      afterState.paymentStatus !== "unconfirmed" ||
      afterState.reservationStatus !== "released" ||
      afterState.quantity !== EXPECTED.quantity ||
      afterState.physicalStock !== EXPECTED.physicalStock ||
      afterState.reservedStock !== 0 ||
      afterState.financialOutcome !== "unknown" ||
      existingAudit.actorType !== "admin" ||
      n(existingAudit.actorUserId) !== ownerUserId ||
      existingAudit.event !== "OWNER_MANUAL_CLOSE_UNCERTAIN"
    ) {
      fail("OWNER_PIX_CLOSE_OPERATION_AUDIT_INVALID");
    }
    if (
      attempt.status !== "released" ||
      attempt.providerState !== "ambiguous" ||
      attempt.paymentId !== null ||
      order.status !== "cancelled" ||
      order.paymentStatus !== "unconfirmed" ||
      (fulfillColumn && order.fulfillmentStatus !== "cancelled")
    )
      fail("OWNER_PIX_CLOSE_OPERATION_STATE_DIVERGED");
    const closedReservations = await rows<
      DbRow & {
        id: number | string;
        orderId: number | string;
        userId: number | string;
        productId: number | string;
        variantId: number | string;
        quantity: number | string;
        status: string;
      }
    >(
      connection,
      `SELECT id, orderId, userId, productId, variantId, quantity, status
         FROM stockReservations WHERE attemptId = ? ORDER BY id FOR UPDATE`,
      [input.attemptId]
    );
    if (
      closedReservations.length !== 1 ||
      n(closedReservations[0].orderId) !== orderId ||
      n(closedReservations[0].userId) !== ownerUserId ||
      n(closedReservations[0].productId) !== EXPECTED.productId ||
      n(closedReservations[0].variantId) !== EXPECTED.variantId ||
      n(closedReservations[0].quantity) !== EXPECTED.quantity ||
      closedReservations[0].status !== "released"
    ) {
      fail("OWNER_PIX_CLOSE_OPERATION_STATE_DIVERGED");
    }
    const [closedVariant] = await rows<
      DbRow & {
        productId: number | string;
        stock: number | string;
        reservedStock: number | string;
      }
    >(
      connection,
      `SELECT productId, stock, reservedStock FROM productVariants WHERE id = ? FOR UPDATE`,
      [EXPECTED.variantId]
    );
    if (
      !closedVariant ||
      n(closedVariant.productId) !== EXPECTED.productId ||
      n(closedVariant.stock) !== EXPECTED.physicalStock ||
      n(closedVariant.reservedStock) !== 0
    ) {
      fail("OWNER_PIX_CLOSE_OPERATION_STATE_DIVERGED");
    }
    await assertNoFinancialOrWebhookEvidence(connection, {
      attemptId: input.attemptId,
      orderId,
      paymentReference,
      tables,
    });
    return {
      orderId,
      reservationId: n(closedReservations[0].id),
      ownerUserId,
      paymentReference,
      fulfillColumn,
      existingAudit,
    };
  }

  const items = await rows<
    DbRow & {
      id: number | string;
      productId: number | string;
      variantId: number | string;
      quantity: number | string;
      unitPrice: number | string;
      totalPrice: number | string | null;
    }
  >(
    connection,
    `SELECT id, productId, variantId, quantity, unitPrice, totalPrice FROM orderItems WHERE orderId = ? ORDER BY id FOR UPDATE`,
    [orderId]
  );
  const snapshots = await rows<
    DbRow & {
      productId: number | string;
      variantId: number | string;
      quantity: number | string;
      unitPriceCents: number | string;
      totalCents: number | string;
    }
  >(
    connection,
    `SELECT productId, variantId, quantity, unitPriceCents, totalCents FROM stockCheckoutItems WHERE attemptId = ? ORDER BY lineNumber FOR UPDATE`,
    [input.attemptId]
  );
  if (items.length !== 1 || snapshots.length !== 1)
    fail("OWNER_PIX_CLOSE_CART_CARDINALITY_MISMATCH");
  const item = items[0];
  const snapshot = snapshots[0];
  const matchesLine = (row: Record<string, unknown>) =>
    n(row.productId) === EXPECTED.productId &&
    n(row.variantId) === EXPECTED.variantId &&
    n(row.quantity) === EXPECTED.quantity;
  if (
    !matchesLine(item) ||
    !matchesLine(snapshot) ||
    n(item.unitPrice) !== EXPECTED.orderTotalCents ||
    n(item.totalPrice) !== EXPECTED.orderTotalCents ||
    n(snapshot.unitPriceCents) !== EXPECTED.orderTotalCents ||
    n(snapshot.totalCents) !== EXPECTED.orderTotalCents
  ) {
    fail("OWNER_PIX_CLOSE_CART_SNAPSHOT_MISMATCH");
  }

  const allReservations = await rows<
    DbRow & {
      id: number | string;
      orderId: number | string;
      userId: number | string;
      productId: number | string;
      attemptId: string;
      variantId: number | string;
      orderItemId: number | string | null;
      quantity: number | string;
      status: string;
      expired: number | string;
    }
  >(
    connection,
    `SELECT id, orderId, userId, productId, attemptId, variantId, orderItemId, quantity, status,
            (expiresAt <= UTC_TIMESTAMP(3)) AS expired
       FROM stockReservations WHERE attemptId = ? ORDER BY id FOR UPDATE`,
    [input.attemptId]
  );
  if (allReservations.length !== 1)
    fail("OWNER_PIX_CLOSE_RESERVATION_CARDINALITY_MISMATCH");
  const reservation = allReservations[0];
  if (
    n(reservation.orderId) !== orderId ||
    n(reservation.userId) !== ownerUserId ||
    n(reservation.productId) !== EXPECTED.productId ||
    n(reservation.variantId) !== EXPECTED.variantId ||
    n(reservation.orderItemId) !== n(item.id) ||
    n(reservation.quantity) !== EXPECTED.quantity ||
    reservation.status !== "active" ||
    n(reservation.expired) !== 1
  )
    fail("OWNER_PIX_CLOSE_RESERVATION_MISMATCH");

  const activeVariantReservations = await rows<
    DbRow & {
      id: number | string;
      attemptId: string | null;
      quantity: number | string;
    }
  >(
    connection,
    `SELECT id, attemptId, quantity FROM stockReservations WHERE variantId = ? AND status = 'active' ORDER BY id FOR UPDATE`,
    [EXPECTED.variantId]
  );
  if (
    activeVariantReservations.length !== 1 ||
    String(activeVariantReservations[0].id) !== String(reservation.id) ||
    activeVariantReservations[0].attemptId !== input.attemptId ||
    n(activeVariantReservations[0].quantity) !== EXPECTED.quantity
  ) {
    fail("OWNER_PIX_CLOSE_VARIANT_ACTIVE_RESERVATION_MISMATCH");
  }

  const [variant] = await rows<
    DbRow & {
      id: number | string;
      productId: number | string;
      stock: number | string;
      reservedStock: number | string;
    }
  >(
    connection,
    `SELECT id, productId, stock, reservedStock FROM productVariants WHERE id = ? FOR UPDATE`,
    [EXPECTED.variantId]
  );
  if (
    !variant ||
    n(variant.productId) !== EXPECTED.productId ||
    n(variant.stock) !== EXPECTED.physicalStock ||
    n(variant.reservedStock) !== EXPECTED.reservedStock
  ) {
    fail("OWNER_PIX_CLOSE_VARIANT_STOCK_MISMATCH");
  }

  if (
    attempt.status !== "reserved" ||
    attempt.providerState !== "ambiguous" ||
    n(attempt.expired) !== 1 ||
    n(attempt.expiryReviewed) !== 1 ||
    n(attempt.reconciliationRequired) !== 1 ||
    n(attempt.oldEnough) !== 1 ||
    order.status !== "pending" ||
    order.paymentStatus !== "unconfirmed" ||
    (fulfillColumn && order.fulfillmentStatus !== "awaiting_payment")
  ) {
    fail("OWNER_PIX_CLOSE_EXPECTED_AMBIGUOUS_EXPIRED_STATE_MISMATCH");
  }
  await assertNoFinancialOrWebhookEvidence(connection, {
    attemptId: input.attemptId,
    orderId,
    paymentReference,
    tables,
  });
  if (input.mode === "status")
    return {
      orderId,
      reservationId: n(reservation.id),
      ownerUserId,
      paymentReference,
      fulfillColumn,
      existingAudit: null,
    };
  return {
    orderId,
    reservationId: n(reservation.id),
    ownerUserId,
    paymentReference,
    fulfillColumn,
    existingAudit: null,
  };
}

/**
 * Executes a one-off close under row locks. It never calls Asaas. `preflight` and `status` are read-only.
 * The only financial state mutation allowed here is reservedStock 1 -> 0; physical stock is asserted and left unchanged.
 */
export async function closeOwnerPixAmbiguousAttempt(
  pool: Pool,
  input: {
    mode: OwnerPixClosureMode;
    attemptId: string;
    ownerOpenId: string;
    auditReference?: string;
    acknowledgeFinancialUncertainty?: boolean;
    acknowledgeSingleUnitRelease?: boolean;
  }
): Promise<OwnerPixClosureResult> {
  if (
    !input.attemptId ||
    input.attemptId.length > 120 ||
    !input.ownerOpenId ||
    input.ownerOpenId.length > 64
  )
    fail("OWNER_PIX_CLOSE_SERVER_IDENTITY_REQUIRED");
  if (input.mode === "apply") {
    validateAuditReference(input.auditReference);
    if (
      input.acknowledgeFinancialUncertainty !== true ||
      input.acknowledgeSingleUnitRelease !== true
    )
      fail("OWNER_PIX_CLOSE_ACKNOWLEDGEMENTS_REQUIRED");
  }
  const connection = await pool.getConnection();
  let commitStarted = false;
  let connectionDestroyed = false;
  try {
    await connection.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await connection.beginTransaction();
    const result = await inspectAndValidate(connection, input);
    if (input.mode === "status") {
      await connection.rollback();
      if (!result.existingAudit)
        return { result: "commit_not_observed", financialOutcome: "unknown" };
      return {
        result: "already_closed",
        financialOutcome: "unknown",
        providerStatePreserved: "ambiguous",
      };
    }
    if (result.existingAudit) {
      await connection.rollback();
      return {
        result: "already_closed",
        financialOutcome: "unknown",
        providerStatePreserved: "ambiguous",
      };
    }
    if (input.mode === "preflight") {
      await connection.rollback();
      return { result: "ready", financialOutcome: "unknown" };
    }

    const auditReference = validateAuditReference(input.auditReference);
    const operationId = operationCorrelationId(input.attemptId, auditReference);
    const beforeState = {
      attemptStatus: "reserved",
      providerState: "ambiguous",
      paymentIdPresent: false,
      orderStatus: "pending",
      paymentStatus: "unconfirmed",
      reservationStatus: "active",
      quantity: EXPECTED.quantity,
      physicalStock: EXPECTED.physicalStock,
      reservedStock: EXPECTED.reservedStock,
    };
    const afterState = {
      attemptStatus: "released",
      providerState: "ambiguous",
      paymentIdPresent: false,
      orderStatus: "cancelled",
      paymentStatus: "unconfirmed",
      reservationStatus: "released",
      quantity: EXPECTED.quantity,
      physicalStock: EXPECTED.physicalStock,
      reservedStock: 0,
      financialOutcome: "unknown",
    };
    const metadata = {
      decision: "owner_supervised_manual_close_after_manual_charge_review",
      decisionAuthority: "owner_approved_explicitly",
      decisionReference: auditReference,
      decisionBasis:
        "owner_reviewed_27_production_charges_and_prior_searches_without_match",
      providerAbsenceConfirmed: false,
      financialOutcome: "unknown",
      residualUncertainty: true,
      originalProviderState: "ambiguous",
      lateWebhookPolicy: "reject_without_persisted_payment_correlation",
      releasedQuantity: EXPECTED.quantity,
      paymentReferenceSha256: createHash("sha256")
        .update(result.paymentReference, "utf8")
        .digest("hex"),
    };

    const [attemptUpdate] = await connection.execute<ResultSetHeader>(
      `UPDATE stockCheckoutAttempts
          SET status = 'released', releasedAt = UTC_TIMESTAMP(3)
        WHERE attemptId = ? AND status = 'reserved' AND providerState = 'ambiguous'
          AND paymentId IS NULL AND reconciliationRequiredAt IS NOT NULL
          AND reservationExpiresAt <= UTC_TIMESTAMP(3) AND expiryReviewedAt IS NOT NULL`,
      [input.attemptId]
    );
    if (attemptUpdate.affectedRows !== 1)
      fail("OWNER_PIX_CLOSE_ATTEMPT_UPDATE_DIVERGED");

    const [reservationUpdate] = await connection.execute<ResultSetHeader>(
      `UPDATE stockReservations SET status = 'released'
        WHERE id = ? AND attemptId = ? AND orderId = ? AND variantId = ? AND quantity = 1 AND status = 'active'`,
      [
        result.reservationId,
        input.attemptId,
        result.orderId,
        EXPECTED.variantId,
      ]
    );
    if (reservationUpdate.affectedRows !== 1)
      fail("OWNER_PIX_CLOSE_RESERVATION_UPDATE_DIVERGED");

    const [variantUpdate] = await connection.execute<ResultSetHeader>(
      `UPDATE productVariants SET reservedStock = reservedStock - 1
        WHERE id = ? AND productId = ? AND stock = 1 AND reservedStock = 1`,
      [EXPECTED.variantId, EXPECTED.productId]
    );
    if (variantUpdate.affectedRows !== 1)
      fail("OWNER_PIX_CLOSE_VARIANT_UPDATE_DIVERGED");

    const orderSet = result.fulfillColumn
      ? "status = 'cancelled', fulfillmentStatus = 'cancelled'"
      : "status = 'cancelled'";
    const [orderUpdate] = await connection.execute<ResultSetHeader>(
      `UPDATE orders SET ${orderSet}
        WHERE id = ? AND stockAttemptId = ? AND userId = ? AND status = 'pending' AND paymentStatus = 'unconfirmed' AND stockPaymentId IS NULL`,
      [result.orderId, input.attemptId, result.ownerUserId]
    );
    if (orderUpdate.affectedRows !== 1)
      fail("OWNER_PIX_CLOSE_ORDER_UPDATE_DIVERGED");

    const [variantAfter] = await rows<
      DbRow & { stock: number | string; reservedStock: number | string }
    >(
      connection,
      `SELECT stock, reservedStock FROM productVariants WHERE id = ? FOR UPDATE`,
      [EXPECTED.variantId]
    );
    if (
      !variantAfter ||
      n(variantAfter.stock) !== EXPECTED.physicalStock ||
      n(variantAfter.reservedStock) !== 0
    ) {
      fail("OWNER_PIX_CLOSE_POSTCONDITION_STOCK_MISMATCH");
    }

    await connection.execute(
      `INSERT INTO auditLogs (actorUserId, actorType, action, entity, entityId, orderId, event, correlationId, metadata, beforeState, afterState)
       VALUES (?, 'admin', ?, 'stockCheckoutAttempt', ?, ?, 'OWNER_MANUAL_CLOSE_UNCERTAIN', ?, ?, ?, ?)`,
      [
        result.ownerUserId,
        OWNER_PIX_CLOSE_ACTION,
        input.attemptId,
        result.orderId,
        operationId,
        JSON.stringify(metadata),
        JSON.stringify(beforeState),
        JSON.stringify(afterState),
      ]
    );

    commitStarted = true;
    await connection.commit();
    return {
      result: "closed",
      financialOutcome: "unknown",
      providerStatePreserved: "ambiguous",
    };
  } catch (error) {
    if (commitStarted) {
      connection.destroy();
      connectionDestroyed = true;
      throw new OwnerPixClosureError("OWNER_PIX_CLOSE_COMMIT_RESULT_UNKNOWN");
    }
    try {
      await connection.rollback();
    } catch {
      /* original failure is reported as a sanitized code */
    }
    if (error instanceof OwnerPixClosureError) throw error;
    const databaseCode =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
    throw new OwnerPixClosureError(
      /^ER_[A-Z0-9_]+$/.test(databaseCode)
        ? `OWNER_PIX_CLOSE_MYSQL_${databaseCode}`
        : "OWNER_PIX_CLOSE_VALIDATION_OR_TRANSACTION_FAILED"
    );
  } finally {
    if (!connectionDestroyed) connection.release();
  }
}

export function ownerPixCloseOperationKey(
  attemptId: string,
  auditReference: string
): string {
  return operationCorrelationId(
    attemptId,
    validateAuditReference(auditReference)
  );
}
