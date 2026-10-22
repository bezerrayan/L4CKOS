import { z } from "zod";
import { structuralHash } from "../../database/schema/fingerprint";
export const PAYMENT13 = "pay_dog6ppexq4gyw3k6";
export const HOOK = "7f9041aa-8df5-4e35-af6c-84b4ef5e18bb";
const events = [
  "PAYMENT_CREATED",
  "PAYMENT_UPDATED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_RECEIVED",
  "PAYMENT_OVERDUE",
  "PAYMENT_DELETED",
  "PAYMENT_RESTORED",
  "PAYMENT_REFUNDED",
  "PAYMENT_PARTIALLY_REFUNDED",
  "PAYMENT_REFUND_IN_PROGRESS",
  "PAYMENT_REFUND_DENIED",
].sort();
const payment = z.object({
  id: z.literal(PAYMENT13),
  externalReference: z.literal("13"),
  billingType: z.literal("PIX"),
  status: z.literal("RECEIVED"),
  value: z.literal(99),
  netValue: z.literal(98.01),
  deleted: z.literal(false),
  refunds: z.array(z.unknown()).length(0).nullable().optional(),
  chargeback: z.null().optional(),
  chargebackStatus: z.null().optional(),
});
const refunds = z.object({
  offset: z.literal(0),
  limit: z.literal(100),
  totalCount: z.literal(0),
  hasMore: z.literal(false),
  data: z.array(z.unknown()).length(0).nullable(),
});
const webhook = z.object({
  id: z.literal(HOOK),
  url: z.literal("https://api-staging.l4ckos.com.br/api/webhooks/asaas"),
  enabled: z.literal(true),
  interrupted: z.literal(false),
  apiVersion: z.literal(3),
  sendType: z.literal("SEQUENTIALLY"),
  events: z.array(z.string()),
});
export type NoopEvidence = Awaited<ReturnType<typeof readSandboxNoopEvidence>>;
/** GET only, fixed Sandbox resources. Raw provider/customer data never leaves this function. */
export async function readSandboxNoopEvidence() {
  if (
    process.env.ASAAS_API_URL?.replace(/\/+$/, "") !==
      "https://api-sandbox.asaas.com/v3" ||
    !process.env.ASAAS_API_KEY
  )
    throw Error("NOOP_SANDBOX_REQUIRED");
  const get = async (path: string) => {
    const r = await fetch("https://api-sandbox.asaas.com/v3" + path, {
      method: "GET",
      redirect: "error",
      headers: { access_token: process.env.ASAAS_API_KEY! },
      signal: AbortSignal.timeout(10000),
    });
    if (r.status !== 200) throw Error("NOOP_PROVIDER_READ_FAILED");
    return r.json();
  };
  const p = payment.parse(await get("/payments/" + PAYMENT13));
  const f = refunds.parse(
    await get("/payments/" + PAYMENT13 + "/refunds?offset=0&limit=100")
  );
  const w = webhook.parse(await get("/webhooks/" + HOOK));
  if (JSON.stringify([...w.events].sort()) !== JSON.stringify(events))
    throw Error("NOOP_WEBHOOK_EVENTS_CHANGED");
  const facts = {
    paymentId: p.id,
    orderId: 13,
    billingType: p.billingType,
    status: p.status,
    grossCents: 9900,
    netCents: 9801,
    deleted: false,
    refundCount: f.totalCount,
    chargeback: false,
    webhook: HOOK,
    enabled: true,
    interrupted: false,
    apiVersion: 3,
    sendType: w.sendType,
    events,
  };
  return {
    observedAt: new Date().toISOString(),
    facts,
    hash: structuralHash(facts),
  };
}
