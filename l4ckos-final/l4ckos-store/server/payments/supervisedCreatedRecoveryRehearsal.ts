import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { canonical } from "../../database/schema/fingerprint";
import { asaasWebhookInbox, asaasWebhookEvents, orders } from "../../drizzle/schema";
import { getDb } from "../db";
import { inWebhookTransaction } from "../database/webhookTransaction";
import { financialEnvelope, type WebhookProcessor } from "./webhookInbox";

/** Candidate only: no route, CLI, startup hook or staging writer.
 * The local database guard must remain until a separate remote operator is
 * reviewed, bound to staging identity and expressly authorized.
 */
export async function rehearseCreatedRecovery(input: {
  eventId: string; payloadHash: string; paymentId: string; expectedAttempts: number;
  approvalReference: string; actorUserId: 14;
}, process: WebhookProcessor) {
  if (!/^[a-f0-9]{64}$/.test(input.payloadHash) || input.expectedAttempts !== 1 ||
      input.actorUserId !== 14 || !/^[A-Za-z0-9_-]{8,80}$/.test(input.approvalReference))
    throw Error("RECOVERY_APPROVAL_INVALID");
  const db = await getDb();
  if (!db) throw Error("RECOVERY_DATABASE_UNAVAILABLE");
  const [identity] = await db.execute(sql`SELECT DATABASE() AS name`);
  const name = (identity as unknown as Array<{ name: string }>)[0]?.name;
  if (!/^l4ckos_test_recovery_[a-f0-9]{12}$/.test(name ?? "")) throw Error("LOCAL_REHEARSAL_ONLY");
  return db.transaction(async tx => {
    const [record] = await tx.select().from(asaasWebhookInbox)
      .where(eq(asaasWebhookInbox.eventId, input.eventId)).for("update", { noWait: true });
    if (!record || record.payloadHash !== input.payloadHash || !record.payload)
      throw Error("RECOVERY_IDENTITY_MISMATCH");
    const preserved = JSON.parse(record.payload);
    const digestInput = { ...preserved }; delete digestInput.sourcePayloadHash;
    if (createHash("sha256").update(canonical(digestInput)).digest("hex") !== input.payloadHash)
      throw Error("RECOVERY_PAYLOAD_HASH_MISMATCH");
    const envelope = financialEnvelope(preserved);
    if (envelope.id !== input.eventId || envelope.event !== "PAYMENT_CREATED" ||
        envelope.payment?.id !== input.paymentId || envelope.payment?.externalReference !== "13" ||
        envelope.payment?.status !== "PENDING" || envelope.payment?.value !== 99 ||
        (envelope.payment.currency && envelope.payment.currency !== "BRL"))
      throw Error("RECOVERY_ENVELOPE_MISMATCH");
    const [order] = await tx.select().from(orders).where(eq(orders.id, 13)).for("update");
    if (!order || order.totalPrice !== 9900) throw Error("RECOVERY_ORDER_MISMATCH");
    const action = "webhook.created_recovery_completed";
    if (record.state === "processed") {
      const [auditRows] = await tx.execute(sql`SELECT orderId FROM auditLogs
        WHERE action=${action} AND correlationId=${input.eventId}`);
      const audit = (auditRows as unknown as Array<{ orderId: number }>)[0];
      const [ledger] = await tx.select().from(asaasWebhookEvents)
        .where(eq(asaasWebhookEvents.eventId, input.eventId));
      if (!audit || audit.orderId !== 13 || !ledger || ledger.status !== "processed" ||
          ledger.eventType !== "PAYMENT_CREATED" || ledger.paymentId !== input.paymentId || ledger.orderId !== 13)
        throw Error("RECOVERY_COMPLETION_UNPROVEN");
      return { status: "already_completed" as const };
    }
    if (record.state !== "rejected" || record.attempts !== input.expectedAttempts ||
        record.errorCode !== "WEBHOOK_VALIDATION_REJECTED") throw Error("RECOVERY_PRECONDITION_CHANGED");
    const before = { state: record.state, attempts: record.attempts, errorCode: record.errorCode,
      completedAt: record.completedAt?.toISOString() ?? null, payloadHash: record.payloadHash };
    // Reopening is never committed independently, so the startup worker cannot
    // claim an intermediate received/processing state.
    await tx.update(asaasWebhookInbox).set({ state: "processing" })
      .where(and(eq(asaasWebhookInbox.eventId, input.eventId), eq(asaasWebhookInbox.state, "rejected"),
        eq(asaasWebhookInbox.attempts, input.expectedAttempts), eq(asaasWebhookInbox.payloadHash, input.payloadHash)));
    const effects: Array<() => Promise<void>> = [];
    const outcome = await inWebhookTransaction(tx as unknown as NonNullable<typeof db>,
      () => process(preserved), effects);
    if (outcome.status !== 200 || outcome.body.handled !== true || outcome.body.event !== "PAYMENT_CREATED" ||
        outcome.body.orderId !== 13 || effects.length) throw Error("RECOVERY_HANDLER_NOT_COMPLETED");
    await tx.update(asaasWebhookInbox).set({ state: "processed", attempts: record.attempts + 1,
      errorCode: null, nextAttemptAt: null, completedAt: new Date() }).where(eq(asaasWebhookInbox.eventId, input.eventId));
    const metadata = JSON.stringify({ approvalReference: input.approvalReference, paymentId: input.paymentId,
        payloadHash: input.payloadHash, financialMutation: false, reservationMutation: false,
        notificationDispatch: false, localRehearsal: true });
    // These audit columns exist in v4 but are absent from the legacy ORM model.
    // Parameterized SQL uses the validated schema without changing that model.
    await tx.execute(sql`INSERT INTO auditLogs
      (actorUserId,actorType,action,entity,entityId,orderId,correlationId,beforeState,afterState,metadata)
      VALUES(14,'admin',${action},'order','13',13,${input.eventId},${JSON.stringify(before)},
        ${JSON.stringify({ state: "processed", attempts: record.attempts + 1 })},${metadata})`);
    // Any handler, ledger, audit or commit failure rolls everything back to the
    // original rejected record; callers must inspect rather than retry blindly.
    return { status: "completed" as const };
  });
}
