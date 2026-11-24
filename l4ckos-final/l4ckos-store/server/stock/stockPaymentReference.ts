import { randomBytes } from "node:crypto";
import type { StockPaymentMethodV1 } from "../../shared/stockCheckoutV1";

/**
 * Strong, non-reusable provider reference for NEW STOCK charges.
 *
 * `externalReference = String(orderId)` is reusable after a database restore (AUTO_INCREMENT rewinds), so a numeric reference can
 * never prove which attempt created a charge. The strong reference carries a server-generated random token that is persisted with
 * the attempt BEFORE the provider is called. It only SELECTS an attempt; every other binding (paymentId, owner, amount, currency)
 * must still be verified before any financial transition.
 *
 * v1 references remain the PIX contract. v2 explicitly binds hosted-card attempts to CARD without a schema change.
 * Both use 24 random bytes (192 bits) -> 32 base64url chars and stay below the 191-character Asaas limit.
 */
export const STOCK_PAYMENT_REFERENCE_PREFIX = "L4CKOS-STOCK-ATTEMPT:v1:";
export const STOCK_CARD_PAYMENT_REFERENCE_PREFIX = "L4CKOS-STOCK-ATTEMPT:v2:CARD:";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const STRONG_PATTERN = /^L4CKOS-STOCK-ATTEMPT:v1:([A-Za-z0-9_-]{32})$/;
const CARD_STRONG_PATTERN = /^L4CKOS-STOCK-ATTEMPT:v2:CARD:([A-Za-z0-9_-]{32})$/;

export type StockPaymentMethod = StockPaymentMethodV1;

export function generateStockPaymentReference(random: (size: number) => Buffer = randomBytes, paymentMethod: StockPaymentMethod = "PIX"): string {
  const token = random(24).toString("base64url");
  if (!TOKEN_PATTERN.test(token)) throw new Error("STOCK_PAYMENT_REFERENCE_ENTROPY_UNAVAILABLE");
  return `${paymentMethod === "CARD" ? STOCK_CARD_PAYMENT_REFERENCE_PREFIX : STOCK_PAYMENT_REFERENCE_PREFIX}${token}`;
}

export type ParsedStockPaymentReference =
  | { kind: "strong"; reference: string; paymentMethod: StockPaymentMethod }
  | { kind: "legacy-numeric"; orderId: string }
  | { kind: "invalid" };

/** Exact (byte-for-byte) parsing: no trimming, no case folding, no prefix-only matching. */
export function parseStockPaymentReference(value: unknown): ParsedStockPaymentReference {
  if (typeof value !== "string") return { kind: "invalid" };
  if (STRONG_PATTERN.test(value)) return { kind: "strong", reference: value, paymentMethod: "PIX" };
  if (CARD_STRONG_PATTERN.test(value)) return { kind: "strong", reference: value, paymentMethod: "CARD" };
  if (/^[1-9]\d{0,9}$/.test(value)) return { kind: "legacy-numeric", orderId: value };
  return { kind: "invalid" };
}

export const isStrongStockPaymentReference = (value: unknown): value is string => parseStockPaymentReference(value).kind === "strong";

/** Audit record that binds a strong reference to its attempt (persisted before the provider call). */
export const STOCK_PAYMENT_REFERENCE_ACTION = "stock.payment_reference.v1";
/** Audit record that binds the provider customer to the attempt (persisted with the payment id). */
export const STOCK_PAYMENT_CUSTOMER_ACTION = "stock.payment_customer.v1";
