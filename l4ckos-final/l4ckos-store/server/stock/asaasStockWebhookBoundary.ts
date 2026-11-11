import { validateAsaasWebhookSignature } from "../services/asaasService";
import type { StockNormalizedWebhook, StockWebhookBoundary } from "./stockCheckout";

const PAID_EVENTS = new Set(["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED", "PAYMENT_OVERDUE_RECEIVED"]);
const FAILED_EVENTS = new Set(["PAYMENT_REFUSED", "PAYMENT_DELETED", "PAYMENT_REPROVED", "PAYMENT_FAILED"]);
const PENDING_EVENTS = new Set(["PAYMENT_CREATED", "PAYMENT_AWAITING_RISK_ANALYSIS", "PAYMENT_PENDING"]);
const PAID_STATUSES = new Set(["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"]);
const FAILED_STATUSES = new Set(["REFUSED", "DELETED", "REPROVED", "FAILED"]);
const PENDING_STATUSES = new Set(["PENDING", "AWAITING_RISK_ANALYSIS", "AWAITING_PAYMENT"]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredText(value: unknown, code: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
}

/** Adapts the existing production token verifier, while making STOCK fail closed in every environment. */
export function createAsaasStockWebhookBoundary(): StockWebhookBoundary {
  return {
    async verifySignature({ headers }) {
      if (!process.env.ASAAS_WEBHOOK_TOKEN?.trim()) return false;
      const normalized: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(headers)) normalized[key.toLowerCase()] = value;
      return validateAsaasWebhookSignature(normalized);
    },
    decodeSignedEvent(rawBody): StockNormalizedWebhook {
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        throw new Error("WEBHOOK_PAYLOAD_INVALID");
      }
      const payload = record(parsed);
      const payment = record(payload?.payment);
      if (!payload || !payment) throw new Error("WEBHOOK_PAYLOAD_INVALID");

      const eventName = requiredText(payload.event, "WEBHOOK_EVENT_INVALID").toUpperCase();
      const paymentStatus = typeof payment.status === "string" ? payment.status.trim().toUpperCase() : "";
      let status: StockNormalizedWebhook["status"];
      if (PAID_EVENTS.has(eventName) && (!paymentStatus || PAID_STATUSES.has(paymentStatus))) status = "paid";
      else if (FAILED_EVENTS.has(eventName) && FAILED_STATUSES.has(paymentStatus)) status = "failed";
      else if (PENDING_EVENTS.has(eventName) && (!paymentStatus || PENDING_STATUSES.has(paymentStatus))) status = "pending";
      else throw new Error("WEBHOOK_EVENT_UNSUPPORTED_OR_CONFLICTING");

      const eventId = requiredText(payload.id ?? payload.eventId ?? payload.event_id, "WEBHOOK_EVENT_ID_REQUIRED");
      const orderId = requiredText(payment.externalReference, "WEBHOOK_ORDER_REFERENCE_REQUIRED");
      const paymentId = requiredText(payment.id, "WEBHOOK_PAYMENT_ID_REQUIRED");
      const amount = payment.value;
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) throw new Error("WEBHOOK_AMOUNT_INVALID");
      const amountCents = Math.round(amount * 100);
      if (!Number.isSafeInteger(amountCents) || Math.abs(amount * 100 - amountCents) > 1e-7) throw new Error("WEBHOOK_AMOUNT_INVALID");
      const currency = typeof payment.currency === "string" ? payment.currency.trim().toUpperCase() : "BRL";
      if (currency !== "BRL") throw new Error("WEBHOOK_CURRENCY_MISMATCH");

      return { eventId, orderId, paymentId, status, amountCents, payload: parsed };
    },
  };
}
