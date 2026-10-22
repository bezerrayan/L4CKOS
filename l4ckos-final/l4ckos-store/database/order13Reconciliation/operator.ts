/** Order 13 only. Local rehearsal entrypoint: no env/URL/remote execution fallback. */
import { createHash } from "node:crypto";
import {
  createConnection,
  type Connection,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import { z } from "zod";

export const OPERATION = "order13-asaas-received-reconciliation-v1";
export const PAYMENT = "pay_dog6ppexq4gyw3k6";
export const CREATED = "evt_05b708f961d739ea7eba7e4db318f621&21683762";
const ACTION = "order13.reconciliation_completed";
const HASH = /^[a-f0-9]{64}$/;
const TABLES = [
  "orders",
  "users",
  "orderItems",
  "products",
  "stockReservations",
  "payments",
  "auditLogs",
  "asaasWebhookInbox",
  "asaasWebhookEvents",
  "paymentEvents",
  "notificationOutbox",
  "orderEmailEvents",
] as const;
const stamp = z.string().datetime({ offset: true });
const evidenceSchema = z
  .object({
    source: z.literal("https://api-sandbox.asaas.com/v3"),
    paymentId: z.literal(PAYMENT),
    externalReference: z.literal("13"),
    status: z.literal("RECEIVED"),
    billingType: z.literal("PIX"),
    amountCents: z.literal(9900),
    netAmountCents: z.number().int().min(0).max(9900),
    deleted: z.literal(false),
    refundCount: z.literal(0),
    refundsHasMore: z.literal(false),
    refundShape: z.enum(["empty-array", "sandbox-null-zero-count"]),
    chargebackPresent: z.literal(false),
    observedAt: stamp,
    financialReceivedAt: z.null(),
  })
  .strict();
const approvalSchema = z
  .object({
    operation: z.literal(OPERATION),
    actorUserId: z.literal(14),
    reference: z.string().min(8).max(120),
    justification: z.string().trim().min(20).max(400),
    expiredReservationDecision: z.literal(
      "FULFILL_WITH_CURRENT_AVAILABLE_STOCK"
    ),
    unknownReceiptTimeAccepted: z.literal(true),
    stockHistoryGapAccepted: z.literal(true),
    panelReviewReference: z.string().min(8).max(120),
    backupRestoreReference: z.string().min(8).max(120),
    writersQuiesced: z.literal(true),
    dispatchersQuiesced: z.literal(true),
    notification: z.literal("ONE_HELD_INTENT_NO_DISPATCH"),
    webhook: z.literal("KEEP_INTERRUPTED"),
    validFrom: stamp,
    validUntil: stamp,
  })
  .strict();
export type Evidence = z.infer<typeof evidenceSchema>;
export type Approval = z.infer<typeof approvalSchema>;
export type Checkpoint = {
  operation: typeof OPERATION;
  observedAt: string;
  stateHash: string;
  evidenceHash: string;
};
type Row = RowDataPacket & Record<string, any>;
type State = Record<(typeof TABLES)[number], Row[]>;
export function digest(value: unknown): string {
  function canonical(v: any): any {
    if (Array.isArray(v)) return v.map(canonical);
    if (v !== null && typeof v === "object")
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .map(k => [k, canonical(v[k])])
      );
    return v;
  }
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
function need(ok: unknown, code: string): asserts ok {
  if (!ok) throw Error(code);
}
function fresh(value: string, now: number) {
  const age = now - Date.parse(value);
  need(Number.isFinite(age) && age >= -5000 && age <= 120000, "EVIDENCE_STALE");
}
function milliseconds(value: string) {
  return Date.parse(value.replace(" ", "T") + "Z");
}
function parseJSON(value: string) {
  return JSON.parse(value);
}

/** A contradictory/missing pagination field never becomes zero by default. */
export function zeroRefunds(raw: unknown) {
  const value = z
    .object({
      object: z.literal("list"),
      offset: z.literal(0),
      limit: z.number().int().min(1).max(100),
      totalCount: z.literal(0),
      hasMore: z.literal(false),
      data: z.array(z.unknown()).length(0).nullable(),
    })
    .parse(raw);
  return value.data === null
    ? ("sandbox-null-zero-count" as const)
    : ("empty-array" as const);
}
export function evidenceFromSandbox(
  payment: unknown,
  refunds: unknown,
  observedAt: string
): Evidence {
  const p = z
    .object({
      id: z.literal(PAYMENT),
      externalReference: z.literal("13"),
      status: z.literal("RECEIVED"),
      billingType: z.literal("PIX"),
      value: z.literal(99),
      netValue: z.number().finite().min(0).max(99),
      deleted: z.literal(false),
      refunds: z.array(z.unknown()).length(0).nullable().optional(),
      chargeback: z.null().optional(),
      chargebackStatus: z.null().optional(),
    })
    .parse(payment);
  const net = Math.round(p.netValue * 100);
  need(Math.abs(net - p.netValue * 100) < 0.000001, "NET_AMOUNT_INVALID");
  return evidenceSchema.parse({
    source: "https://api-sandbox.asaas.com/v3",
    paymentId: p.id,
    externalReference: p.externalReference,
    status: p.status,
    billingType: p.billingType,
    amountCents: 9900,
    netAmountCents: net,
    deleted: false,
    refundCount: 0,
    refundsHasMore: false,
    refundShape: zeroRefunds(refunds),
    chargebackPresent: false,
    observedAt,
    financialReceivedAt: null,
  });
}
async function rows(
  c: Connection,
  query: string,
  args: unknown[] = []
): Promise<Row[]> {
  return (await c.query<Row[]>(query, args))[0];
}
async function snapshot(c: Connection, lock: boolean): Promise<State> {
  const suffix = lock ? " FOR UPDATE NOWAIT" : "";
  // Same order lock as normal webhook; product lock serializes stock checkout.
  if (lock) {
    await rows(c, "SELECT id FROM orders WHERE id=13 FOR UPDATE NOWAIT");
    await rows(c, "SELECT id FROM products WHERE id=1 FOR UPDATE NOWAIT");
  }
  const state = {} as State;
  const predicates: Record<(typeof TABLES)[number], string> = {
    orders: "id IN (2,3,13)",
    users: "id IN (14,594)",
    orderItems: "orderId=13",
    products: "id=1",
    stockReservations: "orderId=13 OR productId=1",
    payments:
      "orderId=13 OR providerPaymentId='pay_dog6ppexq4gyw3k6' OR externalReference='13'",
    auditLogs:
      "orderId=13 OR (entity='order' AND entityId='13') OR correlationId='order13-asaas-received-reconciliation-v1'",
    asaasWebhookInbox:
      "eventId='evt_05b708f961d739ea7eba7e4db318f621&21683762' OR JSON_UNQUOTE(JSON_EXTRACT(payload,'$.payment.id'))='pay_dog6ppexq4gyw3k6' OR JSON_UNQUOTE(JSON_EXTRACT(payload,'$.payment.externalReference'))='13'",
    asaasWebhookEvents: "orderId=13 OR paymentId='pay_dog6ppexq4gyw3k6'",
    paymentEvents: "orderId=13 OR providerPaymentId='pay_dog6ppexq4gyw3k6'",
    notificationOutbox:
      "orderId IN (2,3,13) OR dedupeKey='order13-asaas-received-reconciliation-v1'",
    orderEmailEvents: "orderId IN (2,3,13)",
  };
  for (const t of TABLES)
    state[t] = await rows(
      c,
      `SELECT * FROM \`${t}\` WHERE ${predicates[t]} ORDER BY ${t === "asaasWebhookInbox" ? "eventId" : "id"}${suffix}`
    );
  return state;
}
function scoped(s: State) {
  return {
    users: s.users,
    protectedLegacyOrders: s.orders.filter(r => r.id === 2 || r.id === 3),
    protectedLegacyOutbox: s.notificationOutbox.filter(
      r => r.orderId === 2 || r.orderId === 3
    ),
    order: s.orders.filter(r => r.id === 13),
    items: s.orderItems.filter(r => r.orderId === 13),
    product: s.products.filter(r => r.id === 1),
    reserves: s.stockReservations.filter(r => r.productId === 1),
    payments: s.payments.filter(
      r =>
        r.orderId === 13 ||
        r.providerPaymentId === PAYMENT ||
        r.externalReference === "13"
    ),
    audits: s.auditLogs.filter(
      r =>
        (r.entity === "order" && r.entityId === "13") ||
        r.orderId === 13 ||
        r.correlationId === OPERATION
    ),
    inbox: s.asaasWebhookInbox,
    ledger: s.asaasWebhookEvents,
    events: s.paymentEvents,
    outbox: s.notificationOutbox.filter(
      r => r.orderId === 13 || r.dedupeKey === OPERATION
    ),
    emails: s.orderEmailEvents,
  };
}
function preserved(s: State) {
  return {
    ...s,
    orders: s.orders.filter(r => r.id !== 13),
    products: s.products.filter(r => r.id !== 1),
    stockReservations: s.stockReservations.filter(r => r.id !== 10),
    payments: s.payments.filter(r => r.orderId !== 13),
    auditLogs: s.auditLogs.filter(
      r => !(r.action === ACTION && r.correlationId === OPERATION)
    ),
    notificationOutbox: s.notificationOutbox.filter(
      r => r.dedupeKey !== OPERATION
    ),
  };
}
function postFinancial(s: State) {
  return {
    order: s.orders.filter(r => r.id === 13),
    reserve: s.stockReservations.filter(r => r.id === 10),
    payment: s.payments.filter(r => r.orderId === 13),
    outbox: s.notificationOutbox.filter(r => r.orderId === 13),
  };
}
function validateInitial(s: State, now: number) {
  const x = scoped(s),
    o = x.order[0],
    r = x.reserves.find(v => v.id === 10),
    i = x.items[0];
  need(
    x.order.length === 1 &&
      o.userId === 594 &&
      o.totalPrice === 9900 &&
      o.status === "pending" &&
      o.paymentStatus === "unconfirmed" &&
      o.paymentConfirmationSource === null &&
      o.paymentConfirmedAt === null &&
      o.paymentConfirmedBy === null &&
      o.fulfillmentStatus === "awaiting_payment",
    "ORDER_DIVERGED"
  );
  need(
    x.items.length === 1 &&
      i.id === 14 &&
      i.productId === 1 &&
      i.variantId === null &&
      i.quantity === 1 &&
      i.totalPrice === 9900 &&
      i.salesModeAtPurchase === "STOCK",
    "ITEM_DIVERGED"
  );
  need(
    s.stockReservations.filter(v => v.orderId === 13).length === 1 &&
      r &&
      r.orderId === 13 &&
      r.userId === 594 &&
      r.orderItemId === 14 &&
      r.productId === 1 &&
      r.variantId === null &&
      r.quantity === 1 &&
      r.status === "active" &&
      milliseconds(r.expiresAt) < now,
    "EXPIRED_RESERVATION_REQUIRED"
  );
  need(!x.payments.length, "PAYMENT_CONFLICT");
  const audit = s.auditLogs.find(
    v =>
      v.id === 72 &&
      v.action === "checkout.charge_created" &&
      v.entity === "order" &&
      v.entityId === "13"
  );
  const charge = audit ? parseJSON(audit.metadata) : null;
  need(
    charge?.payment?.paymentId === PAYMENT && charge.payment.method === "PIX",
    "CHECKOUT_BINDING_DIVERGED"
  );
  need(
    x.audits.every(v =>
      ["checkout.created", "checkout.charge_created"].includes(v.action)
    ),
    "AUDIT_REQUIRES_REVIEW"
  );
  need(
    !x.outbox.length && !s.orderEmailEvents.some(v => v.orderId === 13),
    "NOTIFICATION_CONFLICT"
  );
  need(
    !s.asaasWebhookEvents.some(
      v => v.orderId === 13 || v.paymentId === PAYMENT
    ) &&
      !s.paymentEvents.some(
        v => v.orderId === 13 || v.providerPaymentId === PAYMENT
      ),
    "LEDGER_REQUIRES_REVIEW"
  );
  const inbox = s.asaasWebhookInbox.filter(v => {
    const p = parseJSON(v.payload ?? "null");
    return (
      v.eventId === CREATED ||
      p?.payment?.id === PAYMENT ||
      p?.payment?.externalReference === "13"
    );
  });
  need(
    inbox.length === 1 &&
      inbox[0].eventId === CREATED &&
      inbox[0].state === "rejected" &&
      inbox[0].attempts === 1 &&
      inbox[0].errorCode === "WEBHOOK_VALIDATION_REJECTED",
    "INBOX_REQUIRES_REVIEW"
  );
  const payload = parseJSON(inbox[0].payload);
  need(
    payload.id === CREATED &&
      payload.event === "PAYMENT_CREATED" &&
      payload.payment.id === PAYMENT &&
      payload.payment.externalReference === "13" &&
      payload.payment.value === 99 &&
      payload.payment.status === "PENDING",
    "CREATED_DIVERGED"
  );
  need(s.products.filter(v => v.id === 1).length === 1, "PRODUCT_MISSING");
  const reserved = x.reserves
    .filter(
      v =>
        v.id !== 10 && v.status === "active" && milliseconds(v.expiresAt) >= now
    )
    .reduce((n, v) => n + v.quantity, 0);
  const stock = x.product[0].stock;
  need(
    Number.isSafeInteger(stock) && stock - reserved >= 1,
    "INSUFFICIENT_AVAILABLE_STOCK"
  );
  return {
    stock,
    reserved,
    available: stock - reserved,
    expiresAt: r.expiresAt,
  };
}
function validateCompletion(s: State) {
  const found = s.auditLogs.filter(
    v => v.action === ACTION && v.correlationId === OPERATION
  );
  if (!found.length) return null;
  need(found.length === 1, "COMPLETION_CONFLICT");
  const metadata = parseJSON(found[0].metadata);
  need(
    metadata.operation === OPERATION &&
      HASH.test(metadata.postFinancialHash) &&
      HASH.test(metadata.preservedHash) &&
      digest(postFinancial(s)) === metadata.postFinancialHash &&
      digest(preserved(s)) === metadata.preservedHash &&
      s.products.find(v => v.id === 1)?.stock === metadata.stockAfter,
    "COMPLETION_DIVERGED"
  );
  return metadata;
}
async function writeOne(c: Connection, query: string, args: unknown[]) {
  const [r] = await c.execute<ResultSetHeader>(query, args);
  need(r.affectedRows === 1, "WRITE_CAS_FAILED");
}
async function assertSchema(c: Connection) {
  const engines = await rows(
    c,
    "SELECT TABLE_NAME name,ENGINE engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()"
  );
  need(
    TABLES.every(t => engines.some(v => v.name === t && v.engine === "InnoDB")),
    "TRANSACTIONAL_SCHEMA_REQUIRED"
  );
  const indexes = await rows(
    c,
    "SELECT TABLE_NAME name,INDEX_NAME idx,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) cols FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND NON_UNIQUE=0 GROUP BY TABLE_NAME,INDEX_NAME"
  );
  for (const [table, col] of [
    ["payments", "orderId"],
    ["payments", "externalReference"],
    ["payments", "providerPaymentId"],
    ["notificationOutbox", "dedupeKey"],
    ["asaasWebhookInbox", "eventId"],
    ["asaasWebhookEvents", "eventId"],
    ["paymentEvents", "providerEventId"],
  ])
    need(
      indexes.some(v => v.name === table && v.cols === col),
      "UNIQUE_CONSTRAINT_REQUIRED"
    );
}
export class Order13Incident extends Error {
  constructor(
    public commitState: "rolled_back" | "unknown" | "confirmed",
    public phase: string
  ) {
    super("ORDER13_STOP_AND_READ_INDEPENDENTLY");
  }
}
export type LocalTarget = { socketPath: string; database: string };
export type Request = {
  mode?: "dry-run" | "execute-local";
  evidence: Evidence;
  approval?: Approval;
  checkpoint?: Checkpoint;
};
/** The only public execution entrypoint rejects staging even with a local socket tunnel. */
export async function runLocalOrder13(target: LocalTarget, request: Request) {
  need(
    /^\/tmp\/l4ckos-order13-[a-z0-9-]+\/mysqld\.sock$/.test(
      target.socketPath
    ) && /^l4ckos_order13_test_[a-f0-9]{12}$/.test(target.database),
    "LOCAL_DISPOSABLE_TARGET_REQUIRED"
  );
  return runOrder13Transaction(
    {
      open: () =>
        createConnection({
          socketPath: target.socketPath,
          user: "root",
          database: target.database,
          multipleStatements: false,
          dateStrings: true,
          timezone: "Z",
        }),
      assertIdentity: async c => {
        const [identity] = await rows(
          c,
          "SELECT DATABASE() db,@@socket socket"
        );
        need(
          identity.db === target.database &&
            identity.socket === "/socket/mysqld.sock",
          "LOCAL_DATABASE_IDENTITY_REQUIRED"
        );
      },
      localRehearsal: true,
    },
    request
  );
}
/** Internal adapter boundary; CLI never accepts runtime functions from input. */
export type Order13Runtime = {
  open: () => Promise<Connection>;
  assertIdentity: (c: Connection) => Promise<void>;
  localRehearsal: boolean;
  beforeWrite?: (c: Connection, checkpoint: Checkpoint) => Promise<void>;
  beforeCommit?: (c: Connection) => Promise<void>;
  auditContext?: Record<string, unknown>;
};
export async function runOrder13Transaction(
  runtime: Order13Runtime,
  request: Request
) {
  const evidence = evidenceSchema.parse(request.evidence),
    mode = request.mode ?? "dry-run";
  need(mode === "dry-run" || mode === "execute-local", "INVALID_MODE");
  fresh(evidence.observedAt, Date.now());
  let approval: Approval | undefined;
  if (mode === "execute-local") {
    approval = approvalSchema.parse(request.approval);
    const now = Date.now();
    need(
      Date.parse(approval.validFrom) <= now &&
        Date.parse(approval.validUntil) >= now &&
        Date.parse(approval.validUntil) - Date.parse(approval.validFrom) <=
          900000,
      "APPROVAL_EXPIRED"
    );
    const cp = request.checkpoint;
    need(
      cp?.operation === OPERATION &&
        HASH.test(cp.stateHash) &&
        cp.evidenceHash === digest(evidence),
      "CHECKPOINT_REQUIRED"
    );
    fresh(cp.observedAt, now);
  }
  const c = await runtime.open();
  let active = false,
    commitState: "not_started" | "rolled_back" | "unknown" | "confirmed" =
      "not_started",
    phase = "identity";
  try {
    await runtime.assertIdentity(c);
    await assertSchema(c);
    await c.query("SET SESSION time_zone='+00:00'");
    await c.query("SET SESSION innodb_lock_wait_timeout=2");
    await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    if (mode === "dry-run") await c.query("SET TRANSACTION READ ONLY");
    await c.beginTransaction();
    active = true;
    phase = "preconditions";
    const before = await snapshot(c, mode === "execute-local");
    const [clock] = await rows(c, "SELECT UTC_TIMESTAMP(6) now");
    const now = milliseconds(clock.now);
    fresh(evidence.observedAt, now);
    const completed = validateCompletion(before);
    if (completed) {
      await c.rollback();
      active = false;
      return {
        status: "already_completed" as const,
        mutations: 0,
        operation: OPERATION,
      };
    }
    need(
      before.auditLogs.find(v => v.correlationId === OPERATION) === undefined,
      "OPERATION_CONFLICT"
    );
    need(
      (
        await rows(
          c,
          "SELECT id FROM users WHERE id=14 AND role='admin'" +
            (mode === "execute-local" ? " FOR SHARE NOWAIT" : "")
        )
      ).length === 1,
      "ADMIN_REQUIRED"
    );
    const stock = validateInitial(before, now);
    const checkpoint: Checkpoint = {
      operation: OPERATION,
      observedAt: new Date(now).toISOString(),
      stateHash: digest(scoped(before)),
      evidenceHash: digest(evidence),
    };
    if (mode === "dry-run") {
      await c.rollback();
      active = false;
      return {
        status: "dry-run" as const,
        mutations: 0,
        checkpoint,
        stock,
        changes: {
          payment: 1,
          stockDelta: -1,
          reservation: "consumed",
          audit: 1,
          heldIntent: 1,
          providerEvents: 0,
        },
      };
    }
    need(
      request.checkpoint?.stateHash === checkpoint.stateHash,
      "CHECKPOINT_DIVERGED"
    );
    fresh(request.checkpoint!.observedAt, now);
    need(
      Date.parse(approval!.validFrom) <= now &&
        Date.parse(approval!.validUntil) >= now,
      "APPROVAL_EXPIRED_UNDER_LOCK"
    );
    const evidenceHash = digest(evidence);
    await runtime.beforeWrite?.(c, checkpoint);
    phase = "writes";
    await writeOne(
      c,
      "INSERT INTO payments(orderId,provider,providerPaymentId,billingType,amount,status,creationStatus,externalReference,paidAmount,refundedAmount,netAmount,statusSource,manualConfirmedAt,manualConfirmedBy,manualReason,manualEvidence) VALUES(13,'asaas',?,'PIX',9900,'received','created','13',9900,0,?,'reconciliation',?,14,?,?)",
      [
        PAYMENT,
        evidence.netAmountCents,
        clock.now,
        approval!.justification,
        evidenceHash,
      ]
    );
    await writeOne(
      c,
      "UPDATE products SET stock=stock-1 WHERE id=1 AND stock=?",
      [stock.stock]
    );
    await writeOne(
      c,
      "UPDATE stockReservations SET status='consumed' WHERE id=10 AND orderId=13 AND status='active' AND expiresAt=?",
      [stock.expiresAt]
    );
    await writeOne(
      c,
      "UPDATE orders SET status='paid',paymentStatus='confirmed',paymentConfirmationSource='manual',paymentConfirmedBy=14,paymentConfirmedAt=?,paymentConfirmationReference=NULL,fulfillmentStatus='ready',fulfillmentIssue=NULL WHERE id=13 AND status='pending' AND paymentStatus='unconfirmed'",
      [clock.now]
    );
    // Legacy type is excluded from the automatic dispatcher. No mail imports/calls.
    await writeOne(
      c,
      "INSERT INTO notificationOutbox(dedupeKey,type,orderId,payload,status,attempts) VALUES(?,'payment-approved',13,?,'pending',0)",
      [
        OPERATION,
        JSON.stringify({
          orderId: 13,
          operation: OPERATION,
          approvedRecipientRequired: true,
          dispatchAuthorized: false,
        }),
      ]
    );
    const after = await snapshot(c, false);
    need(
      digest(preserved(after)) === digest(preserved(before)),
      "HISTORY_CHANGED"
    );
    const post = postFinancial(after);
    need(
      post.payment.length === 1 &&
        post.reserve[0].status === "consumed" &&
        after.products.find(v => v.id === 1)?.stock === stock.stock - 1,
      "POSTCONDITION_FAILED"
    );
    const metadata = {
      operation: OPERATION,
      approval,
      evidence,
      evidenceHash,
      preservedHash: digest(preserved(before)),
      postFinancialHash: digest(post),
      originalExpiresAt: stock.expiresAt,
      stockBefore: stock.stock,
      stockAfter: stock.stock - 1,
      localRehearsal: runtime.localRehearsal,
      adapter: runtime.auditContext,
    };
    await writeOne(
      c,
      "INSERT INTO auditLogs(actorUserId,actorType,action,entity,entityId,orderId,correlationId,beforeState,afterState,metadata) VALUES(14,'admin',?,'order','13',13,?,?,?,?)",
      [
        ACTION,
        OPERATION,
        JSON.stringify({
          stock: stock.stock,
          reserve: "active",
          paymentStatus: "unconfirmed",
        }),
        JSON.stringify({
          stock: stock.stock - 1,
          reserve: "consumed",
          paymentStatus: "confirmed",
        }),
        JSON.stringify(metadata),
      ]
    );
    validateCompletion(await snapshot(c, false));
    // Validate time again after every write, immediately before commit.
    const [commitClock] = await rows(c, "SELECT UTC_TIMESTAMP(6) now");
    fresh(evidence.observedAt, milliseconds(commitClock.now));
    need(
      Date.parse(approval!.validUntil) >= milliseconds(commitClock.now),
      "APPROVAL_EXPIRED_BEFORE_COMMIT"
    );
    await runtime.beforeCommit?.(c);
    phase = "commit";
    commitState = "unknown";
    await c.commit();
    active = false;
    commitState = "confirmed";
    phase = "independent-verification";
    const verifier = await runtime.open();
    try {
      await runtime.assertIdentity(verifier);
      await verifier.query("SET TRANSACTION READ ONLY");
      await verifier.beginTransaction();
      const verified = validateCompletion(await snapshot(verifier, false));
      need(
        verified?.evidenceHash === evidenceHash,
        "INDEPENDENT_VERIFICATION_FAILED"
      );
      await verifier.rollback();
    } finally {
      await verifier.end();
    }
    return {
      status: "completed" as const,
      operation: OPERATION,
      commitState,
      independentlyVerified: true,
    };
  } catch (error) {
    if (commitState === "unknown" || commitState === "confirmed")
      throw new Order13Incident(commitState, phase);
    if (active) {
      try {
        await c.rollback();
        active = false;
        commitState = "rolled_back";
      } catch {
        throw new Order13Incident("unknown", "rollback");
      }
    }
    // No driver SQL, connection data or payload escapes the operator.
    const code =
      error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
        ? error.message
        : "ORDER13_TRANSACTION_FAILED";
    const failure = new Error(code) as Error & { commitState?: string };
    failure.commitState = commitState;
    throw failure;
  } finally {
    await c.end().catch(() => undefined);
  }
}

export async function readOrder13Snapshot(c: Connection) {
  await assertSchema(c);
  await c.query("SET TRANSACTION READ ONLY");
  await c.beginTransaction();
  try {
    const state = await snapshot(c, false);
    return {
      state,
      stateHash: digest(scoped(state)),
      preservedHash: digest(preserved(state)),
    };
  } finally {
    await c.rollback();
  }
}

/** Read-only outcome classification; never invokes finance or a mutation branch. */
export async function inspectOrder13Outcome(
  c: Connection,
  baselineStateHash: string
) {
  need(HASH.test(baselineStateHash), "BASELINE_HASH_REQUIRED");
  await assertSchema(c);
  await c.query("SET TRANSACTION READ ONLY");
  await c.beginTransaction();
  try {
    const state = await snapshot(c, false),
      stateHash = digest(scoped(state));
    try {
      const completion = validateCompletion(state);
      if (completion)
        return {
          status: "APPLIED_VERIFIED" as const,
          mutations: 0,
          operation: OPERATION,
          stateHash,
          evidenceHash: completion.evidenceHash,
          preservedHash: completion.preservedHash,
          approvedRequestHash: completion.adapter?.approvedRequestHash ?? null,
        };
      return {
        status:
          stateHash === baselineStateHash
            ? ("NOT_APPLIED_BASELINE_INTACT" as const)
            : ("DIVERGED_OR_PARTIAL" as const),
        mutations: 0,
        operation: OPERATION,
        stateHash,
      };
    } catch {
      return {
        status: "DIVERGED_OR_PARTIAL" as const,
        mutations: 0,
        operation: OPERATION,
        stateHash,
      };
    }
  } finally {
    await c.rollback();
  }
}
