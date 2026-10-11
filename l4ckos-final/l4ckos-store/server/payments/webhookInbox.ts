import { createHash } from 'node:crypto';
import { canonical } from '../../database/schema/fingerprint';
import { and, eq, inArray, isNotNull, lt, lte, or, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { asaasWebhookInbox, asaasWebhookEvents } from '../../drizzle/schema';
import { getDb, isDuplicateKeyError } from '../db';
import { inWebhookTransaction } from '../database/webhookTransaction';
import { isStagingMaintenanceEnabled } from '../_core/stagingMaintenance';

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
    checkout: z.object({ id: identifier }).optional(),
  }).optional(),
});
/** All object schemas strip unknown fields, including PII and secrets. */
export function financialEnvelope(payload: unknown) {
  const parsed = envelopeSchema.parse(payload);
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
  const [record] = await db.select().from(asaasWebhookInbox).where(eq(asaasWebhookInbox.eventId, envelope.id));
  if (!record || record.payloadHash !== digest(content)) throw new Error('WEBHOOK_EVENT_CONFLICT');
  return envelope.id;
}
/** No leases: processing and all financial writes share a row-locked transaction.
 * A crash rolls back to received/failed; no committed orphan owner exists.
 */
export async function processStoredWebhook(eventId: string, process: WebhookProcessor): Promise<WebhookReply> {
  if (isStagingMaintenanceEnabled()) return reply(503, 'STAGING_MAINTENANCE');
  const db = await getDb();
  if (!db) return reply(503, 'WEBHOOK_PERSISTENCE_UNAVAILABLE');
  const effects: Array<() => Promise<void>> = [];
  let rejected: WebhookReply | undefined;
  let entered = false;
  try {
    const result = await db.transaction(async tx => {
      // NOWAIT prevents a concurrent delivery from waiting through provider reads.
      const [record] = await tx.select().from(asaasWebhookInbox)
        .where(eq(asaasWebhookInbox.eventId, eventId)).for('update', { noWait: true });
      if (!record) return reply(503, 'WEBHOOK_NOT_PERSISTED');
      if (record.state === 'processed') return { status: 200, body: { handled: false, reason: 'duplicate_event' } };
      if (record.state === 'rejected') return reply(422, record.errorCode ?? 'WEBHOOK_REJECTED');
      entered = true;
      if (!record.payload || digest(record.payload) !== record.payloadHash) throw new Error('WEBHOOK_PAYLOAD_UNAVAILABLE');
      await tx.update(asaasWebhookInbox).set({ state: 'processing' }).where(eq(asaasWebhookInbox.eventId, eventId));
      const outcome = await inWebhookTransaction(tx as unknown as NonNullable<typeof db>,
        () => process(JSON.parse(record.payload!)), effects);
      if (outcome.status !== 200) {
        rejected = outcome;
        throw new Error('WEBHOOK_HANDLER_NOT_COMPLETED');
      }
      await tx.update(asaasWebhookInbox).set({ state: 'processed', attempts: record.attempts + 1,
        errorCode: null, nextAttemptAt: null, completedAt: new Date() }).where(eq(asaasWebhookInbox.eventId, eventId));
      return outcome;
    });
    for (const effect of effects) {
      try { await effect(); } catch { console.warn('[Webhook] notification_failed_after_commit'); }
    }
    return result;
  } catch (error) {
    // Busy transactions remain owned by the other delivery; do not change its state.
    if (!entered) return reply(503, 'WEBHOOK_PROCESSING_BUSY_OR_UNAVAILABLE');
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
  try { return await processStoredWebhook(await persistWebhook(payload), process); }
  catch (error) {
    if (error instanceof z.ZodError || (error instanceof Error && error.message === 'WEBHOOK_EVENT_ID_REQUIRED'))
      return reply(400, 'WEBHOOK_ENVELOPE_INVALID');
    if (error instanceof Error && error.message === 'WEBHOOK_EVENT_CONFLICT') return reply(409, 'WEBHOOK_EVENT_CONFLICT');
    return reply(503, 'WEBHOOK_PERSISTENCE_FAILED');
  }
}
/** Bounded local DB work; never charges/refunds. No startup dispatch during maintenance. */
export async function recoverWebhooks(process: WebhookProcessor, limit = 25) {
  if (isStagingMaintenanceEnabled()) return { maintenance: true, examined: 0, completed: 0 };
  const db = await getDb();
  if (!db) throw new Error('WEBHOOK_PERSISTENCE_UNAVAILABLE');
  const records = await db.select({ eventId: asaasWebhookInbox.eventId }).from(asaasWebhookInbox)
    .where(and(inArray(asaasWebhookInbox.state, ['received', 'failed', 'processing']),
      or(isNull(asaasWebhookInbox.nextAttemptAt), lte(asaasWebhookInbox.nextAttemptAt, new Date()))))
    .orderBy(asaasWebhookInbox.createdAt).limit(Math.min(100, Math.max(1, limit)));
  let completed = 0;
  for (const record of records) if ((await processStoredWebhook(record.eventId, process)).status === 200) completed++;
  // Preserve identities/hashes for replay; erase only terminal minimal envelopes after 30 days.
  await db.update(asaasWebhookInbox).set({ payload: null }).where(and(
    inArray(asaasWebhookInbox.state, ['processed', 'rejected']), isNotNull(asaasWebhookInbox.payload),
    lt(asaasWebhookInbox.completedAt, new Date(Date.now() - 30 * 86400_000))));
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
