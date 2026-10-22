import { assertSelectiveFinancialBuyer } from "../payments/stagingFinancialBuyer";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { sdk } from "../_core/sdk";
import { ENV } from "../_core/env";
import { isConfiguredAdmin } from "../_core/authz";
import { assertRestrictedEmailRecipientsAllowed } from "../services/email/recipientPolicy.js";
import {
  admissionRows as rows,
  admissionHash as hash,
  auditRecord,
  json,
  requireAdmission,
  assertSelectiveStage,
  insertAdmissionAudit,
  loadSelectedGrant,
  recipientHash,
  validateSelectedEvent,
  eventKey,
  CANDIDATE,
  GRANT,
  RELEASE,
  BLOCK,
  POSITIVE_EVENTS,
  ELIGIBLE_EVENTS,
  type Executor,
} from "../payments/stagingCheckoutAdmission";
import {
  RECOVERY_HOLD_ACTION,
  captureRecoveryFence,
  assertRecoveryFence,
} from "../payments/webhookRecovery";

const base = {
  orderId: z.number().int().min(14),
  paymentId: z
    .string()
    .regex(/^pay_[A-Za-z0-9]+$/)
    .max(191),
};
export const admissionRequest = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("authorize"),
      ...base,
      method: z.enum(["PIX", "BOLETO", "CARD"]),
      events: z
        .array(z.enum(ELIGIBLE_EVENTS))
        .min(1)
        .max(ELIGIBLE_EVENTS.length)
        .refine(x => new Set(x).size === x.length),
      recipientHash: z.string().regex(/^[a-f0-9]{64}$/),
      notifications: z.boolean(),
      expiresAt: z.string().datetime(),
      reason: z.string().min(20).max(500),
    })
    .strict(),
  z
    .object({
      action: z.literal("release"),
      ...base,
      eventIds: z
        .array(z.string().min(1).max(191))
        .min(1)
        .max(25)
        .refine(x => new Set(x).size === x.length),
      reason: z.string().min(20).max(500),
    })
    .strict(),
]);
class Preview extends Error {
  constructor(public result: any) {
    super("ADMISSION_PREVIEW_ROLLBACK");
  }
}
type Db = Executor & {
  transaction: <T>(fn: (tx: any) => Promise<T>) => Promise<T>;
};
/** SDK verification only: does not call authenticateRequest/upsertUser/lastSignedIn. */
async function actor(tx: Executor, token: string) {
  const session = await sdk.verifySession(token);
  requireAdmission(session && session.appId === ENV.appId);
  const [user] = await rows(
    tx,
    sql`SELECT * FROM users WHERE openId=${session.openId} FOR UPDATE`
  );
  requireAdmission(
    user &&
      user.isBlocked === 0 &&
      user.sessionVersion === session.sessionVersion &&
      isConfiguredAdmin(user as any)
  );
  return user;
}
export async function administerCheckoutAdmission(
  db: Db,
  raw: unknown,
  token: string,
  options: { dryRun: boolean; expectedDigest?: string }
) {
  assertSelectiveStage();
  const fence = captureRecoveryFence();
  const request = admissionRequest.parse(raw);
  try {
    return await db.transaction(async tx => {
      let decision: any,
        existing: any,
        action: string,
        identity: string,
        entity: string;
      if (request.action === "authorize") {
        const [order] = await rows(
          tx,
          sql`SELECT * FROM orders WHERE id=${request.orderId} FOR UPDATE`
        );
        requireAdmission(order);
        existing = await auditRecord(
          tx,
          GRANT,
          "order",
          String(request.orderId)
        );
        const admin = await actor(tx, token);
        if (existing) {
          const m = json(existing.metadata);
          requireAdmission(
            m.actorUserId === admin.id &&
              m.decisionDigest === hash(m.decision) &&
              hash(m.decision.request) ===
                hash({ ...request, events: [...request.events].sort() })
          );
          decision = m.decision;
        } else {
          // Orders 13/14 and their existing grants are immutable historical baselines.
          requireAdmission(order.id > 14);
          requireAdmission(request.events.every(e => POSITIVE_EVENTS.includes(e as any) || request.method === "CARD"));
          requireAdmission(
            order.status === "pending" &&
              order.paymentStatus === "unconfirmed" &&
              order.paymentConfirmationSource === null
          );
          const candidate = await auditRecord(
            tx,
            CANDIDATE,
            "order",
            String(order.id)
          );
          requireAdmission(candidate);
          const c = json(candidate.metadata);
          requireAdmission(
            c.version === 1 &&
              c.orderId === order.id &&
              c.userId === order.userId &&
              c.method === request.method &&
              c.attempt === order.checkoutAttemptId &&
              c.fingerprint === order.checkoutFingerprint &&
              c.stageProject === "2bb90c8e-eb65-43ee-826b-f93750f0499c"
          );
          const items = await rows(
            tx,
            sql`SELECT salesModeAtPurchase FROM orderItems WHERE orderId=${order.id} FOR UPDATE`
          );
          requireAdmission(
            items.length > 0 &&
              items.every(i => i.salesModeAtPurchase === "STOCK")
          );
          const payments = await rows(
            tx,
            sql`SELECT * FROM payments WHERE orderId=${order.id} FOR UPDATE`
          );
          requireAdmission(payments.length === 1);
          const p = payments[0];
          requireAdmission(
            p.provider === "asaas" &&
              p.providerPaymentId === request.paymentId &&
              p.externalReference === String(order.id) &&
              p.creationStatus === "created" &&
              p.status === "pending" &&
              p.statusSource === "provider" &&
              p.financialIssue === null &&
              Number(p.paidAmount) === 0 &&
              Number(p.refundedAmount) === 0 &&
              Number(p.amount) === Number(order.totalPrice) &&
              p.billingType ===
                (request.method === "CARD" ? "CREDIT_CARD" : request.method)
          );
          const charge = await auditRecord(
            tx,
            "checkout.charge_created",
            "order",
            String(order.id)
          );
          requireAdmission(charge);
          const saved = json(charge.metadata);
          requireAdmission(
            saved.payment?.method === request.method &&
              saved.payment?.paymentId === request.paymentId &&
              saved.payment?.customerId === p.providerCustomerId
          );
          const expiry = Date.parse(request.expiresAt);
          requireAdmission(
            expiry > Date.now() && expiry <= Date.now() + 4 * 3600_000
          );
          const [user] = await rows(
            tx,
            sql`SELECT email FROM users WHERE id=${order.userId} FOR UPDATE`
          );
          requireAdmission(
            user?.email && recipientHash(user.email) === request.recipientHash
          );
          assertSelectiveFinancialBuyer(user.email, request.notifications, request.method);
          const messages = await rows(
            tx,
            sql`SELECT type,payload FROM notificationOutbox WHERE orderId=${order.id} FOR UPDATE`
          );
          requireAdmission(
            messages.every(
              m =>
                ["order-created-email-v1", "payment-pending-email-v1"].includes(
                  m.type
                ) &&
                recipientHash(json(m.payload).customerEmail || "") ===
                  request.recipientHash
            )
          );
          decision = {
            policyVersion: 2,
            request: { ...request, events: [...request.events].sort() },
            candidateHash: hash(c),
            paymentRowId: p.id,
            amount: Number(p.amount),
            actorUserId: admin.id,
          };
          const { verifySelectedProvider } = await import(
            "../payments/stagingCheckoutAdmission"
          );
          await verifySelectedProvider(decision);
        }
        action = GRANT;
        entity = "order";
        identity = String(order.id);
      } else {
        // Lock exact event rows before order/grant, matching the inbox processor lock order.
        const records = [];
        for (const id of [...request.eventIds].sort()) {
          const [record] = await rows(
            tx,
            sql`SELECT * FROM asaasWebhookInbox WHERE eventId=${id} FOR UPDATE`
          );
          requireAdmission(
            record && ["received", "failed"].includes(record.state)
          );
          records.push(record);
        }
        const reviewed = [];
        let grantId = 0;
        for (const record of records) {
          requireAdmission(
            !(await auditRecord(
              tx,
              BLOCK,
              "asaasWebhookInbox",
              eventKey(record.eventId)
            ))
          );
          const selected = await validateSelectedEvent(tx, record as any);
          requireAdmission(
            selected.order.id === request.orderId &&
              selected.payment.providerPaymentId === request.paymentId
          );
          const held = await auditRecord(
            tx,
            RECOVERY_HOLD_ACTION,
            "asaasWebhookInbox",
            eventKey(record.eventId)
          );
          requireAdmission(held);
          const h = json(held.metadata);
          requireAdmission(
            h.payloadHash === record.payloadHash &&
              h.orderId === request.orderId
          );
          reviewed.push({
            eventId: record.eventId,
            payloadHash: record.payloadHash,
            holdId: held.id,
            holdHash: hash(h),
          });
          grantId = selected.grant.id;
        }
        const admin = await actor(tx, token);
        decision = { request, reviewed, grantId, actorUserId: admin.id };
        action = RELEASE;
        entity = "asaasWebhookInbox";
        identity = "";
      }
      assertSelectiveStage();
      assertRecoveryFence(fence);
      if (request.action === "authorize")
        requireAdmission(Date.parse(request.expiresAt) > Date.now());
      else await loadSelectedGrant(tx, request.orderId);
      const digest = hash(decision),
        admin = await actor(tx, token);
      if (!options.dryRun) requireAdmission(options.expectedDigest === digest);
      if (request.action === "authorize") {
        if (!options.dryRun && !existing)
          await insertAdmissionAudit(
            tx,
            action,
            entity,
            identity,
            {
              version: 1,
              orderId: request.orderId,
              actorUserId: admin.id,
              decisionDigest: digest,
              decision,
            },
            admin.id
          );
      } else {
        for (const reviewed of decision.reviewed) {
          const prior = await auditRecord(
            tx,
            RELEASE,
            entity,
            eventKey(reviewed.eventId)
          );
          const metadata = {
            version: 1,
            ...reviewed,
            orderId: request.orderId,
            paymentId: request.paymentId,
            grantId: decision.grantId,
            actorUserId: admin.id,
            decisionDigest: digest,
            decision,
          };
          if (prior)
            requireAdmission(hash(json(prior.metadata)) === hash(metadata));
          else if (!options.dryRun)
            await insertAdmissionAudit(
              tx,
              action,
              entity,
              eventKey(reviewed.eventId),
              metadata,
              admin.id
            );
        }
      }
      const result = {
        status: options.dryRun ? "DRY_RUN" : "AUTHORIZED",
        action: request.action,
        decisionDigest: digest,
        decision,
        financialMutation: false,
        backlogRelease: false,
      };
      if (options.dryRun) throw new Preview(result);
      return result;
    });
  } catch (e) {
    if (e instanceof Preview) return e.result;
    throw e;
  }
}
