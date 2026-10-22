import {acknowledgeRejectedObservation} from './rejectedObservation';
import { createHash } from 'node:crypto';
import { canonical } from '../../database/schema/fingerprint';
import { and, eq, inArray, isNotNull, lt, lte, or, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { asaasWebhookInbox, asaasWebhookEvents } from '../../drizzle/schema';
import { getDb, isDuplicateKeyError } from '../db';
import { inWebhookTransaction } from '../database/webhookTransaction';
import { isStagingMaintenanceEnabled } from '../_core/stagingMaintenance';
import {captureRecoveryFence, assertRecoveryFence, hasRecoveryHold, retainForRecovery,
  recoveryEvidence, RECOVERY_HOLD_ACTION, assertWebhookBusinessEffectsAllowed} from './webhookRecovery';
import {selectedMethodPolicy,admitFirstReceipt,runSelectedEvent,RELEASE,BLOCK,auditRecord,insertAdmissionAudit,eventKey} from './stagingCheckoutAdmission';

export type WebhookReply = { status: number; body: Record<string, unknown> };
export type WebhookProcessor = (payload: unknown) => Promise<WebhookReply>;
const identifier = z.string().trim().min(1).max(191);
const reference = z.union([z.string().max(191), z.number().finite()]);
const money = z.union([z.number().finite().nonnegative(), z.string().max(40).regex(/^\d+(?:\.\d{1,2})?$/)]);
const envelopeSchema = z.object({
  id: identifier.optional(), eventId: identifier.optional(), event_id: identifier.optional(),
  event: z.string().trim().min(1).max(120),
  externalReference: reference.optional(), status: z.string().max(64).optional(),
  currency: z.string().max(8).optional(), value: money.optional(),
  checkout: z.object({ id: identifier }).optional(),
  payment: z.object({
    id: identifier.optional(), externalReference: reference.optional(),
    status: z.string().max(64).optional(), currency: z.string().max(8).optional(),
    value: money.optional(),
    netValue: money.optional(),
    deleted: z.boolean().optional(),
    checkout: z.object({ id: identifier }).optional(),
  }).optional(),
});
/** All object schemas strip unknown fields, including PII and secrets. */
export function financialEnvelope(payload: unknown) {
  const parsed = envelopeSchema.parse(payload);
  // Only deletion requires this flag. Keep historical canonical envelopes for
  // CREATED/other events unchanged so their redelivery hashes still match.
  if (parsed.event !== 'PAYMENT_DELETED' && parsed.payment) delete parsed.payment.deleted;
  const id = parsed.id ?? parsed.eventId ?? parsed.event_id;
  // No fallback key: separate deliveries of the same payment can be different events.
  if (!id) throw new Error('WEBHOOK_EVENT_ID_REQUIRED');
  const { eventId: _eventId, event_id: _event_id, ...body } = parsed;
  return { ...body, id, sourcePayloadHash: createHash("sha256").update(JSON.stringify(payload ?? null)).digest("hex") };
}
const reply = (status: number, code: string): WebhookReply => ({ status, body: { handled: false, code } });
const digest = (payload: string) => {
  const envelope = JSON.parse(payload);
  delete envelope.sourcePayloadHash;
  return createHash('sha256').update(canonical(envelope)).digest('hex');
};
export async function persistWebhook(payload: unknown) {
  const envelope = financialEnvelope(payload);
  const content = JSON.stringify(envelope);
  const db = await getDb();
  if (!db) throw new Error('WEBHOOK_PERSISTENCE_UNAVAILABLE');
  const [existing] = await db.select({ payloadHash: asaasWebhookInbox.payloadHash }).from(asaasWebhookInbox)
    .where(eq(asaasWebhookInbox.eventId, envelope.id));
  if (!existing) {
    try {
      await db.insert(asaasWebhookInbox).values({ eventId: envelope.id, payload: content, payloadHash: digest(content) });
    } catch (error) { if (!isDuplicateKeyError(error)) throw error; }
  }
  const [record] = await db.select().from(asaasWebhookInbox).where(eq(asaasWebhookInbox.eventId, envelope.id)).for('update');
  if (!record || record.payloadHash !== digest(content)) throw new Error('WEBHOOK_EVENT_CONFLICT');
  return envelope.id;
}
/** No leases: processing and all financial writes share a row-locked transaction.
 * A crash rolls back to received/failed; no committed orphan owner exists.
 */
export async function processStoredWebhook(eventId: string, process: WebhookProcessor): Promise<WebhookReply> {
  let fence;try{fence=captureRecoveryFence();}catch{return reply(503,'WEBHOOK_RECOVERY_CONFIG_INVALID');}
  if (isStagingMaintenanceEnabled()) return reply(503, 'STAGING_MAINTENANCE');
  const db = await getDb();
  if (!db) return reply(503, 'WEBHOOK_PERSISTENCE_UNAVAILABLE');
  const effects: Array<() => Promise<void>> = [];
  let rejected: WebhookReply | undefined;
  let entered = false;
  try {
    const result = await db.transaction(async tx => inWebhookTransaction(tx as unknown as NonNullable<typeof db>,async()=>{
      // NOWAIT prevents a concurrent delivery from waiting through provider reads.
      const [record] = await tx.select().from(asaasWebhookInbox)
        .where(eq(asaasWebhookInbox.eventId, eventId)).for('update', { noWait: true });
      if (!record) return reply(503, 'WEBHOOK_NOT_PERSISTED');
      const perform=async()=>{
      if (record.state === 'processed') return { status: 200, body: { handled: false, reason: 'duplicate_event' } };
      if (record.state === 'rejected') return acknowledgeRejectedObservation(tx,record);
      entered = true;
      if (!record.payload || digest(record.payload) !== record.payloadHash) throw new Error('WEBHOOK_PAYLOAD_UNAVAILABLE');
      await tx.update(asaasWebhookInbox).set({ state: 'processing' }).where(eq(asaasWebhookInbox.eventId, eventId));
      const outcome = await inWebhookTransaction(tx as unknown as NonNullable<typeof db>,
        () => process(JSON.parse(record.payload!)), effects);
      if (outcome.status !== 200) {rejected=outcome;throw new Error('WEBHOOK_HANDLER_NOT_COMPLETED');}
      if(fence.reviewOnly && ((outcome.body.reviewReceiptRecorded === true && selectedMethodPolicy('BOLETO')) ||
         (outcome.body.selectiveCardReview === true && selectedMethodPolicy('CARD')))) {
        const held = await retainForRecovery(tx,record,JSON.parse(record.payload!));
        if(!await auditRecord(tx,BLOCK,'asaasWebhookInbox',eventKey(eventId)))
          await insertAdmissionAudit(tx,BLOCK,'asaasWebhookInbox',eventKey(eventId),{
            eventId,payloadHash:record.payloadHash,reason:outcome.body.reviewReceiptRecorded === true ? 'BOLETO_RESERVATION_REVIEW_REQUIRED' : 'CARD_PROVIDER_REVIEW_REQUIRED',
            receiptRecorded:outcome.body.reviewReceiptRecorded === true,stockMutation:false,notificationMutation:false});
        // Durable review is not a running job; BLOCK prevents autonomous worker retries.
        await tx.update(asaasWebhookInbox).set({state:'received',attempts:record.attempts+1,
          errorCode:'SELECTIVE_REVIEW_REQUIRED',nextAttemptAt:null,completedAt:null})
          .where(eq(asaasWebhookInbox.eventId,eventId));
        return { ...held, body: { ...held.body, receiptRecorded:outcome.body.reviewReceiptRecorded === true,
          financialMutation:outcome.body.reviewReceiptRecorded === true } };
      }
      if(fence.reviewOnly&&(outcome.body.reason==='invalid_status_transition'||outcome.body.reconciliationRequired===true))throw Error('SELECTIVE_EVENT_REVIEW_REQUIRED');
      await tx.update(asaasWebhookInbox).set({ state: 'processed', attempts: record.attempts + 1,
        errorCode: null, nextAttemptAt: null, completedAt: new Date() }).where(eq(asaasWebhookInbox.eventId, eventId));
      return outcome;
      };
      if(fence.reviewOnly){
        const selected=await runSelectedEvent(tx,record,perform);
        if(selected.admitted)return selected.value;
        if(!record.payload||digest(record.payload)!==record.payloadHash)throw Error('WEBHOOK_PAYLOAD_UNAVAILABLE');
        return retainForRecovery(tx,record,JSON.parse(record.payload));
      }
      if(await hasRecoveryHold(tx,record.eventId,record.payloadHash)){
        if(!record.payload||digest(record.payload)!==record.payloadHash)throw Error('WEBHOOK_PAYLOAD_UNAVAILABLE');
        return retainForRecovery(tx,record,JSON.parse(record.payload));
      }
      return perform();
    },effects));
    assertRecoveryFence(fence);
    for (const effect of fence.reviewOnly?[]:effects) {
      assertWebhookBusinessEffectsAllowed();
      try { await effect(); } catch { console.warn('[Webhook] notification_failed_after_commit'); }
    }
    return result;
  } catch (error) {
    // Busy transactions remain owned by the other delivery; do not change its state.
    if (!entered) return reply(503, 'WEBHOOK_PROCESSING_BUSY_OR_UNAVAILABLE');
    if(fence.reviewOnly){
      try{return await db.transaction(async tx=>{
        const [record]=await tx.select().from(asaasWebhookInbox).where(eq(asaasWebhookInbox.eventId,eventId)).for('update');
        if(!record?.payload||digest(record.payload)!==record.payloadHash)throw Error('WEBHOOK_PAYLOAD_UNAVAILABLE');
        const held=await retainForRecovery(tx,record,JSON.parse(record.payload));
        if(!await auditRecord(tx,BLOCK,'asaasWebhookInbox',eventKey(eventId)))await insertAdmissionAudit(tx,BLOCK,'asaasWebhookInbox',eventKey(eventId),{eventId,payloadHash:record.payloadHash,reason:'PROCESSING_FAILED_REVIEW_REQUIRED',financialMutation:false});
        return held;
      });}catch{return reply(503,'WEBHOOK_REVIEW_PERSISTENCE_FAILED');}
    }
    const permanent = rejected && rejected.status >= 400 && rejected.status < 500;
    try {
      await db.update(asaasWebhookInbox).set({
        state: permanent ? 'rejected' : 'failed',
        attempts: sql`${asaasWebhookInbox.attempts} + 1`,
        errorCode: permanent ? 'WEBHOOK_VALIDATION_REJECTED' : 'WEBHOOK_PROCESSING_FAILED',
        nextAttemptAt: permanent ? null : new Date(Date.now() + 60_000),
        completedAt: permanent ? new Date() : null,
      }).where(and(eq(asaasWebhookInbox.eventId, eventId), inArray(asaasWebhookInbox.state, ['received', 'failed', 'processing'])));
    } catch { console.error('[Webhook] failure_state_persistence_failed'); }
    return rejected ?? reply(503, 'WEBHOOK_PROCESSING_FAILED');
  }
}
export async function receiveWebhook(payload: unknown, process: WebhookProcessor) {
  try {
    const fence=captureRecoveryFence(),envelope=financialEnvelope(payload),db=await getDb();
    if(!db)throw Error('WEBHOOK_PERSISTENCE_UNAVAILABLE');
    if(fence.reviewOnly||await hasRecoveryHold(db,envelope.id)){
      const details=recoveryEvidence(payload);
      const admission=await db.transaction(async tx=>inWebhookTransaction(tx as unknown as NonNullable<typeof db>,async()=>{
        const eventId=await persistWebhook(payload);
        const [record]=await tx.select().from(asaasWebhookInbox).where(eq(asaasWebhookInbox.eventId,eventId)).for('update');
        if(!record||record.payloadHash!==digest(JSON.stringify(envelope)))throw Error('WEBHOOK_EVENT_CONFLICT');
        if(fence.reviewOnly&&await admitFirstReceipt(tx,record)){assertRecoveryFence(fence);return {admittedEventId:eventId};}
        const held=await retainForRecovery(tx,record,envelope,details);
        assertRecoveryFence(fence);return held;
      },[]));
      if('admittedEventId' in admission)return processStoredWebhook(admission.admittedEventId,process);
      return admission;
    }
    return await processStoredWebhook(await persistWebhook(payload), process);
  }
  catch (error) {
    if (error instanceof z.ZodError || (error instanceof Error && error.message === 'WEBHOOK_EVENT_ID_REQUIRED'))
      return reply(400, 'WEBHOOK_ENVELOPE_INVALID');
    if (error instanceof Error && error.message === 'WEBHOOK_EVENT_CONFLICT') return reply(409, 'WEBHOOK_EVENT_CONFLICT');
    return reply(503, 'WEBHOOK_PERSISTENCE_FAILED');
  }
}
/** Bounded local DB work; never charges/refunds. No startup dispatch during maintenance. */
export async function recoverWebhooks(process: WebhookProcessor, limit = 25) {
  const fence=captureRecoveryFence();
  if (isStagingMaintenanceEnabled()) return { maintenance: true, examined: 0, completed: 0 };
  const db = await getDb();
  if (!db) throw new Error('WEBHOOK_PERSISTENCE_UNAVAILABLE');
  const records = await db.select({ eventId: asaasWebhookInbox.eventId }).from(asaasWebhookInbox)
    .where(and(inArray(asaasWebhookInbox.state, ['received', 'failed', 'processing']),
      or(isNull(asaasWebhookInbox.nextAttemptAt), lte(asaasWebhookInbox.nextAttemptAt, new Date())),
      sql`(NOT EXISTS (SELECT 1 FROM auditLogs h WHERE h.action=${RECOVERY_HOLD_ACTION} AND h.entity='asaasWebhookInbox' AND h.entityId=SHA2(${asaasWebhookInbox.eventId},256))
       OR EXISTS (SELECT 1 FROM auditLogs r WHERE r.action=${RELEASE} AND r.entity='asaasWebhookInbox' AND r.entityId=SHA2(${asaasWebhookInbox.eventId},256))) AND NOT EXISTS (SELECT 1 FROM auditLogs b WHERE b.action=${BLOCK} AND b.entity='asaasWebhookInbox' AND b.entityId=SHA2(${asaasWebhookInbox.eventId},256))`))
    .orderBy(asaasWebhookInbox.createdAt).limit(Math.min(100, Math.max(1, limit)));
  let completed = 0;
  for (const record of records) if ((await processStoredWebhook(record.eventId, process)).status === 200) completed++;
  assertRecoveryFence(fence);
  if(fence.reviewOnly)return {examined:records.length,completed,reviewOnly:true};
  // Preserve identities/hashes for replay; erase only processed envelopes after 30 days; preserve rejected evidence.
  await db.update(asaasWebhookInbox).set({ payload: null }).where(and(
    eq(asaasWebhookInbox.state, 'processed'), isNotNull(asaasWebhookInbox.payload),
    lt(asaasWebhookInbox.completedAt, new Date(Date.now() - 30 * 86400_000)),
    sql`NOT EXISTS (SELECT 1 FROM auditLogs h WHERE h.action=${RECOVERY_HOLD_ACTION} AND h.entity='asaasWebhookInbox' AND h.entityId=SHA2(${asaasWebhookInbox.eventId},256))`));
  const [pending] = await db.select({ n: sql<number>`count(*)` }).from(asaasWebhookInbox)
    .where(inArray(asaasWebhookInbox.state, ['received', 'failed', 'processing']));
  const [legacy] = await db.select({ n: sql<number>`count(*)` }).from(asaasWebhookEvents)
    .leftJoin(asaasWebhookInbox, eq(asaasWebhookInbox.eventId, asaasWebhookEvents.eventId))
    .where(and(inArray(asaasWebhookEvents.status, ['failed', 'processing']), isNull(asaasWebhookInbox.eventId)));
  const [rejected] = await db.select({ n: sql<number>`count(*)` }).from(asaasWebhookInbox)
    .where(eq(asaasWebhookInbox.state, 'rejected'));
  return { maintenance: false, examined: records.length, completed, pending: Number(pending.n),
    legacyNeedsPayload: Number(legacy.n), rejected: Number(rejected.n) };
}
export function startWebhookRecovery(process: WebhookProcessor) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await recoverWebhooks(process);
      if (result.pending) console.warn('[Webhook] recovery_pending', { count: result.pending });
      if (result.legacyNeedsPayload) console.error('[Webhook] legacy_requires_authenticated_redelivery', { count: result.legacyNeedsPayload });
      if (result.rejected) console.warn('[Webhook] rejection_requires_review', { count: result.rejected });
    } catch { console.error('[Webhook] recovery_unavailable'); }
    finally { running = false; }
  };
  const timer = setInterval(() => { void tick(); }, 30_000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
