// Derived from the pinned local candidate by reuse.ts; do not edit independently.
import { sql } from "drizzle-orm";
import { z } from "zod";
import { canonical, sha256 } from "../schema/fingerprint";
import { assertKernelContext, type KernelContext } from "./kernelContext";

const timestamp = z.string().datetime({ offset: true });
const evidenceSchema = z.object({
  source: z.literal("official_sandbox_get"), paymentId: z.literal("pay_dog6ppexq4gyw3k6"),
  externalReference: z.literal("13"), status: z.literal("RECEIVED"), billingType: z.literal("PIX"),
  amountCents: z.literal(9900), netAmountCents: z.number().int().min(0).max(9900),
  deleted: z.literal(false), refundCount: z.literal(0), refundsHasMore: z.literal(false),
  chargebackPresent: z.literal(false), observedAt: timestamp,
  financialReceivedAt: timestamp.nullable(),
  timestampMeaning: z.enum(["official_financial_receipt", "not_proven"]),
  timestampEvidenceReference: z.string().min(8).max(120).nullable(),
}).strict();
const planSchema = z.object({
  path: z.enum(["A", "B"]), actorUserId: z.literal(14),
  approvalReference: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
  justification: z.string().trim().min(20).max(400), evidence: evidenceSchema,
}).strict();
export type FinancialRecoveryPlan = z.infer<typeof planSchema>;

// Raw mysql2/Drizzle results can contain UTC SQL strings without a suffix.
// Never parse them in the workstation's local timezone.
function utcDatabaseDate(value: unknown) {
  const date = value instanceof Date ? value :
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
      ? new Date(value.replace(" ", "T") + "Z") : new Date(NaN);
  if (!Number.isFinite(date.getTime())) throw Error("RECOVERY_DATABASE_TIME_INVALID");
  return date;
}

/** Local candidate, deliberately absent from routes/startup/CLI.
 * No provider access, fake webhook or notification dispatch. Future remote use
 * needs a reviewed adapter that binds fresh official evidence and admin consent.
 */
export async function applyFinancialCore(raw: FinancialRecoveryPlan, context: KernelContext) {
  const plan = planSchema.parse(raw), evidence = plan.evidence;
  const observation = Date.parse(evidence.observedAt), now = Date.now();
  if (observation > now + 5_000 || now - observation > 120_000) throw Error("RECOVERY_EVIDENCE_STALE");
  if ((evidence.timestampMeaning === "not_proven" &&
      (evidence.financialReceivedAt !== null || evidence.timestampEvidenceReference !== null)) ||
      (evidence.timestampMeaning === "official_financial_receipt" &&
      (!evidence.financialReceivedAt || !evidence.timestampEvidenceReference)))
    throw Error("RECOVERY_TIMESTAMP_EVIDENCE_INVALID");
  if (evidence.financialReceivedAt && Date.parse(evidence.financialReceivedAt) > observation)
    throw Error("RECOVERY_RECEIPT_AFTER_OBSERVATION");
  await assertKernelContext(context);
  const db = context.db;
  const evidenceHash = sha256(canonical(evidence));
  const operationKey = `RC2_ORDER13_${plan.approvalReference}`;
  return context.transaction(async tx => {
    async function rows<T = Record<string, any>>(query: ReturnType<typeof sql>) {
      const [result] = await tx.execute(query); return result as unknown as T[];
    }
    const [timezone] = await rows(sql`SELECT @@session.time_zone zone,@@system_time_zone systemZone`);
    if (!["+00:00", "UTC"].includes(timezone.zone) &&
        !(timezone.zone === "SYSTEM" && timezone.systemZone === "UTC")) throw Error("RECOVERY_DATABASE_UTC_REQUIRED");
    const [order] = await rows(sql`SELECT * FROM orders WHERE id=13 FOR UPDATE NOWAIT`);
    const [admin] = await rows(sql`SELECT id,role FROM users WHERE id=14 FOR SHARE`);
    if (!admin || admin.role !== "admin") throw Error("RECOVERY_ADMIN_REQUIRED");
    if (!order || order.totalPrice !== 9900 || order.userId !== 594) throw Error("RECOVERY_ORDER_MISMATCH");
    const [chargeAudit] = await rows(sql`SELECT metadata FROM auditLogs WHERE id=72
      AND action='checkout.charge_created' AND entity='order' AND entityId='13' FOR SHARE`);
    const charge = chargeAudit ? JSON.parse(chargeAudit.metadata ?? "{}") : null;
    if (charge?.payment?.paymentId !== evidence.paymentId || charge.payment.method !== "PIX")
      throw Error("RECOVERY_CHECKOUT_PAYMENT_MISMATCH");
    const reservations = await rows(sql`SELECT * FROM stockReservations WHERE orderId=13 ORDER BY id FOR UPDATE`);
    const [reservation] = reservations;
    const payments = await rows(sql`SELECT * FROM payments WHERE orderId=13 OR providerPaymentId=${evidence.paymentId} FOR UPDATE`);
    const completions = await rows(sql`SELECT * FROM auditLogs WHERE entity='order' AND entityId='13'
      AND action='order.payment_recovery_completed'`);
    if (order.paymentStatus === "confirmed" || completions.length) {
      const payment = payments[0];
      if (completions.length !== 1 || reservations.length !== 1 || reservation?.id !== 10 ||
          reservation.status !== "consumed" || order.status !== "paid" || order.paymentStatus !== "confirmed" ||
          order.paymentConfirmationSource !== "manual" || order.paymentConfirmedBy !== 14 ||
          payments.length !== 1 || payment.orderId !== 13 || payment.providerPaymentId !== evidence.paymentId ||
          payment.status !== "received" || payment.amount !== 9900 || payment.paidAmount !== 9900)
        throw Error("RECOVERY_COMPLETION_CONFLICT");
      return { status: "already_completed" as const };
    }
    if (order.status !== "pending" || order.paymentStatus !== "unconfirmed" || payments.length)
      throw Error("RECOVERY_FINANCIAL_PRECONDITION_CHANGED");
    const items = await rows(sql`SELECT * FROM orderItems WHERE orderId=13 ORDER BY id FOR UPDATE`);
    if (items.length !== 1 || items[0].id !== 14 || items[0].productId !== 1 || items[0].variantId !== null ||
        items[0].quantity !== 1 || items[0].salesModeAtPurchase !== "STOCK" || items[0].totalPrice !== 9900 ||
        reservations.length !== 1 || reservation.id !== 10 || reservation.orderItemId !== 14 ||
        reservation.productId !== 1 || reservation.variantId !== null || reservation.quantity !== 1 ||
        reservation.status !== "active") throw Error("RECOVERY_RESERVATION_PRECONDITION_CHANGED");
    const expiry = utcDatabaseDate(reservation.expiresAt).getTime();
    if (expiry >= Date.now()) throw Error("RECOVERY_EXPIRED_RESERVATION_REQUIRED");
    const receipt = evidence.financialReceivedAt ? Date.parse(evidence.financialReceivedAt) : null;
    const creation = utcDatabaseDate(order.createdAt).getTime();
    if (receipt !== null && receipt < creation) throw Error("RECOVERY_RECEIPT_BEFORE_ORDER");
    if (plan.path === "A" && (evidence.timestampMeaning !== "official_financial_receipt" ||
        receipt === null || receipt >= expiry)) throw Error("RECOVERY_PATH_A_TIME_NOT_PROVEN");
    if (plan.path === "B" && receipt !== null && receipt < expiry)
      throw Error("RECOVERY_USE_PATH_A_FOR_PROVEN_EARLY_RECEIPT");
    // Same product lock as official checkout; range locks also protect active
    // commitments. A deadlock with other writers rolls back rather than retries.
    const [product] = await rows(sql`SELECT id,stock FROM products WHERE id=1 FOR UPDATE`);
    const commitments = await rows(sql`SELECT id,orderId,quantity,status,expiresAt FROM stockReservations
      WHERE productId=1 ORDER BY id FOR UPDATE`);
    if (!product) throw Error("RECOVERY_PRODUCT_MISSING");
    const [clock] = await rows(sql`SELECT UTC_TIMESTAMP(6) appliedAt`);
    const appliedAt = utcDatabaseDate(clock.appliedAt), appliedMs = appliedAt.getTime();
    if (appliedMs < observation - 5_000 || appliedMs - observation > 120_000) throw Error("RECOVERY_EVIDENCE_EXPIRED_UNDER_LOCK");
    const reservedElsewhere = commitments.filter(r => r.id !== 10 && r.status === "active" &&
      utcDatabaseDate(r.expiresAt).getTime() >= appliedMs).reduce((sum, r) => sum + Number(r.quantity), 0);
    const available = Number(product.stock) - reservedElsewhere;
    const [held] = await rows(sql`SELECT id FROM auditLogs WHERE action='order.payment_recovery_held'
      AND correlationId=${operationKey}`);
    if (held) return { status: "held" as const, reason: "NEW_ADMIN_DECISION_REQUIRED" };
    const beforeState = JSON.stringify({ orderStatus: order.status, paymentStatus: order.paymentStatus,
      reservationStatus: reservation.status, originalExpiresAt: utcDatabaseDate(reservation.expiresAt).toISOString(),
      stock: product.stock, reservedElsewhere, available });
    const metadata = JSON.stringify({ path: plan.path, approvalReference: plan.approvalReference,
      justification: plan.justification, evidence, evidenceHash, localRehearsal: false, supervisedStaging: true, approvalHash: context.approvalHash, artifactHash: context.artifactHash,
      timestampPolicy: "operator_confirmation_now; external_receipt_separate", notificationDispatch: false });
    await context.beforeWrite();
    if (available < 1) {
      await tx.execute(sql`INSERT INTO auditLogs(actorUserId,actorType,action,entity,entityId,orderId,
        correlationId,beforeState,afterState,metadata)
        VALUES(14,'admin','order.payment_recovery_held','order','13',13,${operationKey},${beforeState},
        ${JSON.stringify({ financialMutation: false, stockMutation: false, reason: "STOCK_UNAVAILABLE" })},${metadata})`);
      return { status: "held" as const, reason: "STOCK_UNAVAILABLE" };
    }
    // No expiry extension, replacement reserve or artificial provider event.
    await tx.execute(sql`UPDATE products SET stock=stock-1 WHERE id=1 AND stock>=1`);
    await tx.execute(sql`UPDATE stockReservations SET status='consumed' WHERE id=10 AND status='active'`);
    await tx.execute(sql`INSERT INTO payments(orderId,provider,providerPaymentId,billingType,amount,status,
      creationStatus,externalReference,receivedAt,paidAmount,refundedAmount,netAmount,statusSource,
      manualConfirmedAt,manualConfirmedBy,manualReason,manualEvidence)
      VALUES(13,'asaas',${evidence.paymentId},'PIX',9900,'received','created','13',
      ${receipt === null ? null : new Date(receipt)},9900,0,${evidence.netAmountCents},'reconciliation',
      ${appliedAt},14,${plan.justification},${evidenceHash})`);
    await tx.execute(sql`UPDATE orders SET status='paid',paymentStatus='confirmed',
      paymentConfirmationSource='manual',paymentConfirmedBy=14,paymentConfirmedAt=${appliedAt},
      paymentConfirmationReference=NULL,fulfillmentStatus='ready',fulfillmentIssue=NULL WHERE id=13`);
    await tx.execute(sql`INSERT INTO auditLogs(actorUserId,actorType,action,entity,entityId,orderId,
      correlationId,beforeState,afterState,metadata)
      VALUES(14,'admin','order.payment_recovery_completed','order','13',13,${operationKey},${beforeState},
      ${JSON.stringify({ orderStatus: "paid", paymentStatus: "confirmed", reservationStatus: "consumed",
        stock: Number(product.stock) - 1, operatorAppliedAt: appliedAt.toISOString() })},${metadata})`);
    // A new isolated logical notification, never a dispatch or historical replay.
    await tx.execute(sql`INSERT INTO notificationOutbox(dedupeKey,type,orderId,payload,status,attempts)
      VALUES('rc2-recovery-order13-payment-approved-v1','payment-approved',13,
      ${JSON.stringify({ orderId: 13, recoveryOperation: operationKey, approvedRecipientRequired: true })},'pending',0)`);
    return { status: "completed" as const, path: plan.path };
  });
}
