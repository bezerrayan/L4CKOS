import {acknowledgeRejectedObservation} from './rejectedObservation';
import { alertExecutorForDrizzle, recordReconciliationAlert, truncateIdentifier } from './reconciliationAlerts';
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
import {selectedMethodPolicy,selectiveEventReleased,admitFirstReceipt,runSelectedEvent,RELEASE,BLOCK,auditRecord,insertAdmissionAudit,eventKey} from './stagingCheckoutAdmission';

export type WebhookReply = { status: number; body: Record<string, unknown> };
export type WebhookProcessor = (payload: unknown, preflightResult?: unknown) => Promise<WebhookReply>;
export type WebhookPreflight = (payload: unknown) => Promise<unknown>;
const identifier = z.string().trim().min(1).max(191);
const reference = z.union([z.string().max(191), z.number().finite()]);
const money = z.union([z.number().finite().nonnegative(), z.string().max(40).regex(/^\d+(?:\.\d{1,2})?$/)]);
const envelopeSchema = z.object({
  id: identifier.optional(), eventId: identifier.optional(), event_id: identifier.optional(),
  event: z.string().trim().min(1).max(120),
  // Asaas's documented payment payload carries account.id; retain only that
  // identity field so missing-currency receipts can be checked against the
  // configured provider account before any payment/stock transition.
  account: z.object({ id: identifier }).optional(),
  externalReference: reference.optional(), status: z.string().max(64).optional(),
  currency: z.string().max(8).optional(), value: money.optional(),
  checkout: z.object({ id: identifier }).optional(),
  payment: z.object({
    id: identifier.optional(), externalReference: reference.optional(),
    status: z.string().max(64).optional(), currency: z.string().max(8).optional(),
    value: money.optional(),
    netValue: money.optional(),
    billingType: z.string().trim().max(64).optional(),
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
const PAYMENT_DELETED_PREFLIGHT_AUDIT = 'payment.deleted_preflight_reconciliation_required.v1';
const PAYMENT_DELETED_PREFLIGHT_RETRY_LIMIT = 3;
const PAYMENT_CURRENCY_PROVIDER_READ_CODE = 'PAYMENT_CURRENCY_PROVIDER_READ_FAILED';
const PAYMENT_RECEIVED_PROVIDER_STATUS_PENDING_CODE = 'PAYMENT_RECEIVED_PROVIDER_STATUS_PENDING';
const PAYMENT_PROVIDER_PREFLIGHT_RETRY_LIMIT = 3;
const PAYMENT_PROVIDER_PREFLIGHT_BACKOFF_MS = [30_000, 120_000] as const;
function providerHttpStatus(error: unknown) {
  if (!error || typeof error !== 'object') return null;
  const value = Number((error as { providerStatus?: unknown; statusCode?: unknown }).providerStatus ??
    (error as { statusCode?: unknown }).statusCode);
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}
function isTransientProviderReadFailure(status: number | null) {
  return status === null || status === 408 || status === 425 || status === 429 || status >= 500;
}
async function acknowledgeDeletedLookupFailure(tx: any, record: any): Promise<WebhookReply> {
  if (record.errorCode !== 'PAYMENT_CURRENT_STATE_UNAVAILABLE' || !record.payload || !record.payloadHash)
    return reply(503, 'WEBHOOK_RECONCILIATION_AUDIT_UNAVAILABLE');
  let envelope: any;
  try { envelope = JSON.parse(record.payload); } catch { return reply(503, 'WEBHOOK_PAYLOAD_UNAVAILABLE'); }
  if (envelope.id !== record.eventId || envelope.event !== 'PAYMENT_DELETED' || envelope.payment?.deleted !== true ||
      typeof envelope.payment?.id !== 'string' || !envelope.payment.id.trim() || digest(record.payload) !== record.payloadHash)
    return reply(503, 'WEBHOOK_PAYLOAD_UNAVAILABLE');
  const eventKey = createHash('sha256').update(record.eventId).digest('hex');
  const [audits] = await tx.execute(sql`SELECT metadata FROM auditLogs WHERE action=${PAYMENT_DELETED_PREFLIGHT_AUDIT}
    AND entity='asaasWebhookInbox' AND entityId=${eventKey} LIMIT 1`);
  const audit = (audits as Array<{ metadata: string | null }>)[0];
  if (!audit?.metadata) return reply(503, 'WEBHOOK_RECONCILIATION_AUDIT_UNAVAILABLE');
  try {
    const metadata = JSON.parse(audit.metadata);
    if (metadata.eventId !== record.eventId || metadata.payloadHash !== record.payloadHash ||
        metadata.paymentId !== envelope.payment.id || metadata.reconciliationRequired !== true)
      return reply(503, 'WEBHOOK_RECONCILIATION_AUDIT_UNAVAILABLE');
  } catch { return reply(503, 'WEBHOOK_RECONCILIATION_AUDIT_UNAVAILABLE'); }
  return { status: 200, body: { handled: false, reason: 'payment_reconciliation_required', reconciliationRequired: true } };
}
async function persistPreflightFailure(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, eventId: string,
  code: string, error: unknown): Promise<WebhookReply> {
  const result = await db.transaction(async tx => {
    const [record] = await tx.select().from(asaasWebhookInbox).where(eq(asaasWebhookInbox.eventId, eventId)).for('update');
    if (!record) return reply(503, 'WEBHOOK_NOT_PERSISTED');
    if (record.state === 'processed') return { status: 200, body: { handled: false, reason: 'duplicate_event' } };
    if (record.state === 'rejected') return record.errorCode === 'PAYMENT_CURRENT_STATE_UNAVAILABLE'
      ? acknowledgeDeletedLookupFailure(tx, record) : acknowledgeRejectedObservation(tx, record);
    const nextAttempts = Number(record.attempts) + 1;
    let envelope: any = null;
    try { envelope = record.payload ? JSON.parse(record.payload) : null; } catch { /* keep the failure retryable */ }
    const deletedLookup = code === 'PAYMENT_CURRENT_STATE_UNAVAILABLE' && envelope?.event === 'PAYMENT_DELETED' &&
      envelope?.payment?.deleted === true && typeof envelope?.payment?.id === 'string' && Boolean(envelope.payment.id.trim());
    const status = providerHttpStatus(error);
    const persistedPayloadMatches = typeof record.payload === 'string' && typeof record.payloadHash === 'string' &&
      digest(record.payload) === record.payloadHash;
    const paymentCurrencyRead = code === PAYMENT_CURRENCY_PROVIDER_READ_CODE && envelope?.event === 'PAYMENT_RECEIVED' &&
      envelope?.id === eventId && typeof envelope?.payment?.id === 'string' && Boolean(envelope.payment.id.trim()) &&
      persistedPayloadMatches;
    const paymentStatusPending = code === PAYMENT_RECEIVED_PROVIDER_STATUS_PENDING_CODE && envelope?.event === 'PAYMENT_RECEIVED' &&
      envelope?.id === eventId && typeof envelope?.payment?.id === 'string' && Boolean(envelope.payment.id.trim()) &&
      persistedPayloadMatches;
    if (paymentCurrencyRead || paymentStatusPending) {
      const payment = envelope.payment;
      const eventKey = createHash('sha256').update(eventId).digest('hex');
      const correlationId = `PAYMENT_PROVIDER_PREFLIGHT:${eventKey}:${nextAttempts}`;
      const providerObservedStatus = String((error as { providerObservedStatus?: unknown } | null)?.providerObservedStatus ?? "").trim().toUpperCase() || null;
      const transient = paymentStatusPending || isTransientProviderReadFailure(status);
      const retryable = transient && nextAttempts < PAYMENT_PROVIDER_PREFLIGHT_RETRY_LIMIT;
      const backoffMs = retryable
        ? PAYMENT_PROVIDER_PREFLIGHT_BACKOFF_MS[Math.min(nextAttempts - 1, PAYMENT_PROVIDER_PREFLIGHT_BACKOFF_MS.length - 1)]
        : 0;
      const nextAttemptAt = retryable ? new Date(Date.now() + backoffMs) : null;
      const rawReference = payment.externalReference ?? envelope.externalReference ?? null;
      const reference = rawReference === null || rawReference === undefined ? null : String(rawReference).trim();
      const referenceHash = reference ? createHash('sha256').update(reference).digest('hex') : null;
      const referenceHint = reference ? truncateIdentifier(reference) : null;
      const observedAmountCents = typeof payment.value === 'number' && Number.isFinite(payment.value)
        ? Math.round(payment.value * 100)
        : typeof payment.value === 'string' && Number.isFinite(Number(payment.value)) ? Math.round(Number(payment.value) * 100) : null;
      const failureReason = paymentStatusPending
        ? 'PROVIDER_STATUS_NOT_RECEIVED_RETRY_LIMIT'
        : transient ? 'PROVIDER_UNAVAILABLE_RETRY_LIMIT' : `PROVIDER_HTTP_${status}`;
      const metadata = JSON.stringify({ eventId, payloadHash: record.payloadHash, event: envelope.event, paymentId: payment.id,
        referenceHint, referenceHash, observedStatus: typeof payment.status === 'string' ? payment.status.trim().toUpperCase() : null,
        providerObservedStatus,
        observedAmountCents, providerStatus: status, attempts: nextAttempts, retryable, backoffMs, reason: failureReason,
        reconciliationRequired: !retryable, financialMutation: false, stockMutation: false, notificationMutation: false });
      const beforeState = JSON.stringify({ state: record.state, attempts: Number(record.attempts) });
      const afterState = JSON.stringify(retryable
        ? { state: 'failed', attempts: nextAttempts, retryable: true, nextAttemptAt: nextAttemptAt?.toISOString() }
        : { state: 'processed', attempts: nextAttempts, reconciliationRequired: true });
      const [existingRows] = await tx.execute(sql`SELECT id FROM auditLogs WHERE action='payment.provider_preflight_failure.v1'
        AND entity='asaasWebhookInbox' AND entityId=${eventKey} AND correlationId=${correlationId} LIMIT 1 FOR UPDATE`);
      if (!(existingRows as unknown as Array<{ id: number }>).length) {
        await tx.execute(sql`INSERT INTO auditLogs(actorUserId,actorType,action,entity,entityId,event,correlationId,metadata,beforeState,afterState)
          VALUES(NULL,'system','payment.provider_preflight_failure.v1','asaasWebhookInbox',${eventKey},'PAYMENT_RECEIVED',
          ${correlationId},${metadata},${beforeState},${afterState})`);
      }
      if (retryable) {
        await tx.update(asaasWebhookInbox).set({ state: 'failed', attempts: nextAttempts, errorCode: code,
          nextAttemptAt, completedAt: null }).where(eq(asaasWebhookInbox.eventId, eventId));
        return { status: 503, body: { handled: false,
          code: paymentStatusPending ? 'PAYMENT_NOT_RECEIVED_YET' : 'PAYMENT_PROVIDER_TEMPORARILY_UNAVAILABLE',
          retryable: true, retryAfterSeconds: Math.ceil(backoffMs / 1000) } };
      }
      await recordReconciliationAlert(alertExecutorForDrizzle(tx), {
        kind: 'ASAAS_WEBHOOK_FINANCIAL_EXCEPTION', subject: { paymentId: payment.id, eventKey },
        providerEventId: eventId, reference,
        observed: { status: providerObservedStatus ?? (typeof payment.status === 'string' ? payment.status.trim().toUpperCase() : null), amountCents: observedAmountCents },
        reason: failureReason,
      });
      await tx.update(asaasWebhookInbox).set({ state: 'processed', attempts: nextAttempts, errorCode: null,
        nextAttemptAt: null, completedAt: new Date() }).where(eq(asaasWebhookInbox.eventId, eventId));
      return { status: 200, body: { handled: false, reason: 'payment_reconciliation_required', reconciliationRequired: true,
        financialMutation: false, stockMutation: false } };
    }
    const escalate = deletedLookup && (status === 404 || nextAttempts >= PAYMENT_DELETED_PREFLIGHT_RETRY_LIMIT);
    if (escalate) {
      const eventKey = createHash('sha256').update(eventId).digest('hex');
      const correlationId = `PAYMENT_DELETED_PROVIDER_UNAVAILABLE:${eventKey}`;
      const metadata = JSON.stringify({ eventId, payloadHash: record.payloadHash, paymentId: envelope.payment.id,
        externalReference: envelope.payment.externalReference ?? null, observedValue: envelope.payment.value ?? null,
        providerStatus: status, attempts: nextAttempts, errorCode: 'PAYMENT_CURRENT_STATE_UNAVAILABLE',
        reconciliationRequired: true, financialMutation: false, stockMutation: false, notificationMutation: false });
      const beforeState = JSON.stringify({ state: record.state, attempts: Number(record.attempts) });
      const afterState = JSON.stringify({ state: 'rejected', attempts: nextAttempts, reconciliationRequired: true });
      const [existingRows] = await tx.execute(sql`SELECT id FROM auditLogs WHERE action=${PAYMENT_DELETED_PREFLIGHT_AUDIT}
        AND entity='asaasWebhookInbox' AND entityId=${eventKey} LIMIT 1 FOR UPDATE`);
      if (!(existingRows as unknown as Array<{ id: number }>).length) {
        await tx.execute(sql`INSERT INTO auditLogs(actorUserId,actorType,action,entity,entityId,event,correlationId,metadata,beforeState,afterState)
          VALUES(NULL,'system',${PAYMENT_DELETED_PREFLIGHT_AUDIT},'asaasWebhookInbox',${eventKey},'PAYMENT_DELETED',
          ${correlationId},${metadata},${beforeState},${afterState})`);
      }
      // Durable operator alert in the SAME transaction: the event may only be acknowledged (200) once this is committed.
      await recordReconciliationAlert(alertExecutorForDrizzle(tx), {
        kind: 'PAYMENT_DELETED_PREFLIGHT_ESCALATED', subject: { paymentId: envelope.payment.id, eventKey }, providerEventId: eventId,
        reason: status === 404 ? 'PROVIDER_404' : 'PROVIDER_UNAVAILABLE_RETRY_LIMIT',
        observed: { amountCents: typeof envelope.payment.value === 'number' ? Math.round(envelope.payment.value * 100) : null },
      });
      await tx.update(asaasWebhookInbox).set({ state: 'rejected', attempts: nextAttempts,
        errorCode: 'PAYMENT_CURRENT_STATE_UNAVAILABLE', nextAttemptAt: null, completedAt: new Date() })
        .where(eq(asaasWebhookInbox.eventId, eventId));
      return acknowledgeDeletedLookupFailure(tx, { ...record, state: 'rejected', attempts: nextAttempts,
        errorCode: 'PAYMENT_CURRENT_STATE_UNAVAILABLE' });
    }
    await tx.update(asaasWebhookInbox).set({ state: 'failed', attempts: nextAttempts, errorCode: code,
      nextAttemptAt: new Date(Date.now() + 60_000), completedAt: null }).where(eq(asaasWebhookInbox.eventId, eventId));
    return reply(503, code);
  });
  if (code === 'PAYMENT_CURRENT_STATE_UNAVAILABLE' && result.status === 200 && 'reason' in result.body && result.body.reason === 'payment_reconciliation_required')
    console.warn('[Webhook] payment_deleted_lookup_escalated', { eventId, providerStatus: providerHttpStatus(error) });
  return result;
}
export const digest = (payload: string) => {
  const envelope = JSON.parse(payload);
  delete envelope.sourcePayloadHash;
  return createHash('sha256').update(canonical(envelope)).digest('hex');
};
function matchesHistoricalBillingTypeHash(record: { payload: string | null; payloadHash: string }, incoming: ReturnType<typeof financialEnvelope>) {
  if (!record.payload || !incoming.payment || typeof incoming.payment.billingType !== "string") return false;
  try {
    const stored = JSON.parse(record.payload);
    if (stored.id !== incoming.id || stored.event !== incoming.event ||
        stored.sourcePayloadHash !== incoming.sourcePayloadHash || stored.payment?.billingType !== undefined ||
        digest(record.payload) !== record.payloadHash) return false;
    const priorShape = JSON.parse(JSON.stringify(incoming));
    delete priorShape.payment.billingType;
    return digest(JSON.stringify(priorShape)) === record.payloadHash;
  } catch { return false; }
}
export async function persistWebhook(payload: unknown) {
  const envelope = financialEnvelope(payload);
  const content = JSON.stringify(envelope);
  const db = await getDb();
  if (!db) throw new Error('WEBHOOK_PERSISTENCE_UNAVAILABLE');
  const [existing] = await db.select({ payloadHash: asaasWebhookInbox.payloadHash, payload: asaasWebhookInbox.payload }).from(asaasWebhookInbox)
    .where(eq(asaasWebhookInbox.eventId, envelope.id));
  if (!existing) {
    try {
      await db.insert(asaasWebhookInbox).values({ eventId: envelope.id, payload: content, payloadHash: digest(content) });
      return envelope.id;
    } catch (error) { if (!isDuplicateKeyError(error)) throw error; }
    // A simultaneous first delivery may have won the unique-key insert. Use a
    // non-waiting current read to compare its committed payload; the processing
    // transaction below owns the row lock and will return BUSY if it is active.
    const [record] = await db.select({ payloadHash: asaasWebhookInbox.payloadHash, payload: asaasWebhookInbox.payload }).from(asaasWebhookInbox)
      .where(eq(asaasWebhookInbox.eventId, envelope.id)).for('update', { noWait: true });
    if (!record || (record.payloadHash !== digest(content) && !matchesHistoricalBillingTypeHash(record, envelope)))
      throw new Error('WEBHOOK_EVENT_CONFLICT');
    return envelope.id;
  }
  if (existing.payloadHash !== digest(content) && !matchesHistoricalBillingTypeHash(existing, envelope))
    throw new Error('WEBHOOK_EVENT_CONFLICT');
  return envelope.id;
}
/** No leases: processing and all financial writes share a row-locked transaction.
 * A crash rolls back to received/failed; no committed orphan owner exists.
 */
export async function processStoredWebhook(eventId: string, process: WebhookProcessor, preflight?: WebhookPreflight,
  preparedPreflight?: { result: unknown }): Promise<WebhookReply> {
  let fence;try{fence=captureRecoveryFence();}catch{return reply(503,'WEBHOOK_RECOVERY_CONFIG_INVALID');}
  if (isStagingMaintenanceEnabled()) return reply(503, 'STAGING_MAINTENANCE');
  const db = await getDb();
  if (!db) return reply(503, 'WEBHOOK_PERSISTENCE_UNAVAILABLE');
  const effects: Array<() => Promise<void>> = [];
  let rejected: WebhookReply | undefined;
  let entered = false;
  let preflightResult: unknown;
  if (preparedPreflight) {
    preflightResult = preparedPreflight.result;
  } else if (preflight) {
    try {
      const [record] = await db.select({ payload: asaasWebhookInbox.payload, payloadHash: asaasWebhookInbox.payloadHash,
        state: asaasWebhookInbox.state }).from(asaasWebhookInbox).where(eq(asaasWebhookInbox.eventId, eventId));
      if (!record) return reply(503, 'WEBHOOK_NOT_PERSISTED');
      if (record.state === 'processed') return { status: 200, body: { handled: false, reason: 'duplicate_event' } };
      if (record.state !== 'rejected') {
        if (!record.payload || digest(record.payload) !== record.payloadHash) return reply(503, 'WEBHOOK_PAYLOAD_UNAVAILABLE');
        preflightResult = await preflight(JSON.parse(record.payload));
      }
    } catch (error) {
      const code = error instanceof Error && /^[A-Z_]{3,80}$/.test(error.message)
        ? error.message : 'WEBHOOK_PREFLIGHT_FAILED';
      try {
        return await persistPreflightFailure(db, eventId, code, error);
      } catch { console.error('[Webhook] preflight_failure_persistence_failed'); return reply(503, code); }
    }
  }
  try {
    const result = await db.transaction(async tx => inWebhookTransaction(tx as unknown as NonNullable<typeof db>,async()=>{
      // NOWAIT prevents a concurrent delivery from waiting through provider reads.
      const [record] = await tx.select().from(asaasWebhookInbox)
        .where(eq(asaasWebhookInbox.eventId, eventId)).for('update', { noWait: true });
      if (!record) return reply(503, 'WEBHOOK_NOT_PERSISTED');
      const perform=async()=>{
      if (record.state === 'processed') return { status: 200, body: { handled: false, reason: 'duplicate_event' } };
      if (record.state === 'rejected') return record.errorCode === 'PAYMENT_CURRENT_STATE_UNAVAILABLE'
        ? acknowledgeDeletedLookupFailure(tx, record) : acknowledgeRejectedObservation(tx,record);
      entered = true;
      if (!record.payload || digest(record.payload) !== record.payloadHash) throw new Error('WEBHOOK_PAYLOAD_UNAVAILABLE');
      await tx.update(asaasWebhookInbox).set({ state: 'processing' }).where(eq(asaasWebhookInbox.eventId, eventId));
      const outcome = await inWebhookTransaction(tx as unknown as NonNullable<typeof db>,
        () => process(JSON.parse(record.payload!), preflightResult), effects);
      if (outcome.status !== 200) {rejected=outcome;throw new Error('WEBHOOK_HANDLER_NOT_COMPLETED');}
      if(fence.reviewOnly && ((outcome.body.reviewReceiptRecorded === true && selectedMethodPolicy('BOLETO')) ||
         (outcome.body.selectiveCardReview === true && selectedMethodPolicy('CARD') && !selectiveEventReleased(eventId)))) {
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
      if(fence.reviewOnly&&(outcome.body.reason==='invalid_status_transition'||(outcome.body.reconciliationRequired===true&&!selectiveEventReleased(eventId))))throw Error('SELECTIVE_EVENT_REVIEW_REQUIRED');
      await tx.update(asaasWebhookInbox).set({ state: 'processed', attempts: record.attempts + 1,
        errorCode: null, nextAttemptAt: null, completedAt: new Date() }).where(eq(asaasWebhookInbox.eventId, eventId));
      return outcome;
      };
      if(fence.reviewOnly){
        const providerPayment = preflightResult && typeof preflightResult === 'object'
          ? (preflightResult as { currentPayment?: Record<string, unknown> }).currentPayment
          : undefined;
        const selected=await runSelectedEvent(tx,record,perform,providerPayment);
        if(selected.admitted)return selected.value;
        if(!record.payload||digest(record.payload)!==record.payloadHash)throw Error('WEBHOOK_PAYLOAD_UNAVAILABLE');
        return retainForRecovery(tx,record,JSON.parse(record.payload));
      }
      if(await hasRecoveryHold(tx,record.eventId,record.payloadHash)){
        if(!record.payload||digest(record.payload)!==record.payloadHash)throw Error('WEBHOOK_PAYLOAD_UNAVAILABLE');
        return retainForRecovery(tx,record,JSON.parse(record.payload));
      }
      return perform();
    },effects), { isolationLevel: 'read committed' });
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
export async function receiveWebhook(payload: unknown, process: WebhookProcessor, preflight?: WebhookPreflight) {
  try {
    const fence=captureRecoveryFence(),envelope=financialEnvelope(payload),db=await getDb();
    if(!db)throw Error('WEBHOOK_PERSISTENCE_UNAVAILABLE');
    const eventId=await persistWebhook(payload);
    const [persisted]=await db.select({state:asaasWebhookInbox.state,errorCode:asaasWebhookInbox.errorCode,
      nextAttemptAt:asaasWebhookInbox.nextAttemptAt}).from(asaasWebhookInbox).where(eq(asaasWebhookInbox.eventId,eventId));
    if(persisted?.state==='processed')return {status:200,body:{handled:false,reason:'duplicate_event'}};
    if (persisted?.state === 'failed' &&
        (persisted.errorCode === PAYMENT_CURRENCY_PROVIDER_READ_CODE || persisted.errorCode === PAYMENT_RECEIVED_PROVIDER_STATUS_PENDING_CODE) &&
        persisted.nextAttemptAt &&
        new Date(persisted.nextAttemptAt as any).getTime() > Date.now())
      return { status: 503, body: { handled: false, code: 'PAYMENT_PROVIDER_RETRY_BACKOFF', retryable: true,
        retryAt: new Date(persisted.nextAttemptAt as any).toISOString() } };
    let preparedPreflight:{result:unknown}|undefined;
    if(preflight&&persisted?.state!=='rejected'){
      try{preparedPreflight={result:await preflight(envelope)};}
      catch(error){
        const code=error instanceof Error&&/^[A-Z_]{3,80}$/.test(error.message)?error.message:'WEBHOOK_PREFLIGHT_FAILED';
        try{return await persistPreflightFailure(db,eventId,code,error);}
        catch{console.error('[Webhook] preflight_failure_persistence_failed');return reply(503,code);}
      }
    }
    if(fence.reviewOnly||await hasRecoveryHold(db,envelope.id)){
      const details=recoveryEvidence(payload);
      const admission=await db.transaction(async tx=>inWebhookTransaction(tx as unknown as NonNullable<typeof db>,async()=>{
        const [record]=await tx.select().from(asaasWebhookInbox).where(eq(asaasWebhookInbox.eventId,eventId)).for('update');
        if(!record||record.payloadHash!==digest(JSON.stringify(envelope)))throw Error('WEBHOOK_EVENT_CONFLICT');
        const providerPayment=preparedPreflight?.result&&typeof preparedPreflight.result==='object'
          ? (preparedPreflight.result as {currentPayment?:Record<string,unknown>}).currentPayment : undefined;
        if(fence.reviewOnly&&await admitFirstReceipt(tx,record,providerPayment)){assertRecoveryFence(fence);return {admittedEventId:eventId};}
        const held=await retainForRecovery(tx,record,envelope,details);
        assertRecoveryFence(fence);return held;
      },[]));
      if('admittedEventId' in admission)return processStoredWebhook(admission.admittedEventId,process,preflight,preparedPreflight);
      return admission;
    }
    return await processStoredWebhook(eventId, process, preflight, preparedPreflight);
  }
  catch (error) {
    if (error instanceof z.ZodError || (error instanceof Error && error.message === 'WEBHOOK_EVENT_ID_REQUIRED'))
      return reply(400, 'WEBHOOK_ENVELOPE_INVALID');
    if (error instanceof Error && error.message === 'WEBHOOK_EVENT_CONFLICT') return reply(409, 'WEBHOOK_EVENT_CONFLICT');
    return reply(503, 'WEBHOOK_PERSISTENCE_FAILED');
  }
}
/** Bounded local DB work; never charges/refunds. No startup dispatch during maintenance. */
export async function recoverWebhooks(process: WebhookProcessor, limit = 25, preflight?: WebhookPreflight) {
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
  for (const record of records) if ((await processStoredWebhook(record.eventId, process, preflight)).status === 200) completed++;
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
export function startWebhookRecovery(process: WebhookProcessor, preflight?: WebhookPreflight) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await recoverWebhooks(process, 25, preflight);
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
