import { z } from "zod";
import { createHash } from "node:crypto";
export type WebhookReply = { status: number; body: Record<string, unknown> };
export type WebhookProcessor = (payload: unknown) => Promise<WebhookReply>;
// Parser extracted verbatim; equivalence is checked during packaging.
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
