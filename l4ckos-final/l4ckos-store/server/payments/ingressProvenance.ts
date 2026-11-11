import { createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { auditLogs } from "../../drizzle/schema";
import { getDb } from "../db";
import { digest, financialEnvelope } from "./webhookInbox";
import { eventKey } from "./stagingCheckoutAdmission";

/**
 * Provenance for provider events that were AUTHENTICATED at HTTP ingress and then persisted in the durable inbox.
 *
 * The stored envelope carries no headers, so an internal replay (recovery worker, admin recovery) cannot re-read the provider
 * token. Instead, at ingress - only after validateAsaasWebhookSignature succeeded - we write an audit row holding
 * HMAC-SHA256(key = derived from ASAAS_WEBHOOK_TOKEN, "v1|eventId|payloadHash"). A replay is "authenticated" only if that MAC
 * recomputes with the CURRENT token over the CURRENT stored envelope: a row that was written without the token, an edited
 * envelope, a different event id or a rotated token all fail verification. No audit row => not authenticated => no processing.
 */
export const INGRESS_ATTESTATION_ACTION = "webhook.ingress_authenticated.v1";
const ENTITY = "asaasWebhookInbox";

function mac(eventId: string, payloadHash: string): string | null {
  const token = process.env.ASAAS_WEBHOOK_TOKEN?.trim();
  if (!token) return null;
  const key = createHmac("sha256", token).update("l4ckos-inbox-ingress-provenance-v1").digest();
  return createHmac("sha256", key).update(`v1|${eventId}|${payloadHash}`).digest("hex");
}

function describeEnvelope(payload: unknown): { eventId: string; payloadHash: string } | null {
  try {
    const envelope = financialEnvelope(payload);
    return { eventId: envelope.id, payloadHash: digest(JSON.stringify(envelope)) };
  } catch {
    return null;
  }
}

/** Call ONLY after the provider token check passed on a live HTTP delivery. Best effort: never blocks the delivery. */
export async function attestAuthenticatedIngress(payload: unknown): Promise<boolean> {
  const identity = describeEnvelope(payload);
  const value = identity ? mac(identity.eventId, identity.payloadHash) : null;
  if (!identity || !value) return false;
  try {
    const db = await getDb();
    if (!db) return false;
    const entityId = eventKey(identity.eventId);
    const existing = await db.select({ metadata: auditLogs.metadata }).from(auditLogs)
      .where(and(eq(auditLogs.action, INGRESS_ATTESTATION_ACTION), eq(auditLogs.entity, ENTITY), eq(auditLogs.entityId, entityId)))
      .orderBy(desc(auditLogs.id)).limit(5);
    if (existing.some(row => safeParse(row.metadata)?.mac === value)) return true;
    await db.insert(auditLogs).values({
      actorUserId: null, actorType: "system", action: INGRESS_ATTESTATION_ACTION, entity: ENTITY, entityId,
      metadata: JSON.stringify({ payloadHash: identity.payloadHash, mac: value }),
    });
    return true;
  } catch {
    return false;
  }
}

function safeParse(text: string | null): { mac?: string; payloadHash?: string } | null {
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

/** True only when a MAC written at authenticated ingress verifies against the stored envelope with the current token. */
export async function hasVerifiedIngressProvenance(payload: unknown): Promise<boolean> {
  const identity = describeEnvelope(payload);
  const expected = identity ? mac(identity.eventId, identity.payloadHash) : null;
  if (!identity || !expected) return false;
  const db = await getDb();
  if (!db) return false;
  const rows = await db.select({ metadata: auditLogs.metadata }).from(auditLogs)
    .where(and(eq(auditLogs.action, INGRESS_ATTESTATION_ACTION), eq(auditLogs.entity, ENTITY), eq(auditLogs.entityId, eventKey(identity.eventId))))
    .orderBy(desc(auditLogs.id)).limit(5);
  const want = Buffer.from(expected, "hex");
  return rows.some(row => {
    const found = safeParse(row.metadata)?.mac;
    if (typeof found !== "string" || !/^[0-9a-f]{64}$/.test(found)) return false;
    const have = Buffer.from(found, "hex");
    return have.length === want.length && timingSafeEqual(have, want);
  });
}
