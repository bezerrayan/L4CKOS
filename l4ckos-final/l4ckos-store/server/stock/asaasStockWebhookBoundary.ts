import { validateAsaasWebhookSignature } from "../services/asaasService";
import type { StockNormalizedWebhook, StockWebhookBoundary } from "./stockCheckout";
import { parseStockPaymentReference } from "./stockPaymentReference";

const PAID_EVENTS = new Set(["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED", "PAYMENT_OVERDUE_RECEIVED"]);
const FAILED_EVENTS = new Set([
  "PAYMENT_REFUSED", "PAYMENT_DELETED", "PAYMENT_REPROVED", "PAYMENT_FAILED",
  "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED", "PAYMENT_REPROVED_BY_RISK_ANALYSIS",
]);
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
export function createAsaasStockWebhookBoundary(input: {
  verifiedProviderCurrency?: string | null;
  configuredAccountId?: string | null;
  configuredAccountCurrency?: string | null;
} = {}): StockWebhookBoundary {
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
      const eventAccount = record(payload.account);
      const eventAccountId = typeof eventAccount?.id === "string" ? eventAccount.id.trim() : "";
      const configuredAccountId = typeof input.configuredAccountId === "string" ? input.configuredAccountId.trim() : "";
      const configuredAccountCurrency = typeof input.configuredAccountCurrency === "string"
        ? input.configuredAccountCurrency.trim().toUpperCase() : "";
      // Asaas's documented PAYMENT_CREATED envelope has account.id but no payment.currency.
      // Only this non-settling event may use the explicitly pinned BRL account currency,
      // and only when the envelope's account identity matches the configured account.
      const pinnedCreatedCurrency = eventName === "PAYMENT_CREATED" && paymentStatus === "PENDING" &&
        configuredAccountId && eventAccountId === configuredAccountId && configuredAccountCurrency === "BRL"
        ? "BRL" : "";
      const eventCurrency = typeof payment.currency === "string" && payment.currency.trim()
        ? payment.currency.trim().toUpperCase() : "";
      const verifiedProviderCurrency = typeof input.verifiedProviderCurrency === "string"
        ? input.verifiedProviderCurrency.trim().toUpperCase() : "";
      const currency = eventCurrency || verifiedProviderCurrency || pinnedCreatedCurrency;
      let status: StockNormalizedWebhook["status"];
      const reference = parseStockPaymentReference(payment.externalReference);
      const isHostedCard = reference.kind === "strong" && reference.paymentMethod === "CARD";
      // PIX settles only on RECEIVED. A hosted credit-card payment can settle
      // inventory on CONFIRMED after the controller's authoritative provider GET.
      if (eventName === "PAYMENT_RECEIVED" && (!paymentStatus || PAID_STATUSES.has(paymentStatus))) status = "paid";
      else if (eventName === "PAYMENT_CONFIRMED" && isHostedCard && ["CONFIRMED", "RECEIVED"].includes(paymentStatus)) status = "paid";
      else if (PAID_EVENTS.has(eventName) && (!paymentStatus || PAID_STATUSES.has(paymentStatus))) status = "pending";
      else if (eventName === "PAYMENT_DELETED" && payment.deleted === true) status = "failed";
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
      // These two authenticated PIX events are observations only. They never
      // settle an order, so an omitted currency must not turn a valid delivery
      // into a permanent retry. Explicit incompatible currency still fails.
      const currencylessNonSettlement = !currency &&
        (eventName === "PAYMENT_CONFIRMED" || eventName === "PAYMENT_OVERDUE_RECEIVED") &&
        status === "pending";
      if (currency !== "BRL" && !currencylessNonSettlement) throw new Error("WEBHOOK_CURRENCY_MISMATCH");

      const parsedReference = parseStockPaymentReference(orderId);
      if (parsedReference.kind === "strong") return { eventId, orderId, paymentId, status, amountCents, payload: parsed, strongReference: parsedReference.reference, referenceKind: "strong" };
      return { eventId, orderId, paymentId, status, amountCents, payload: parsed, referenceKind: "legacy" };
    },
  };
}
