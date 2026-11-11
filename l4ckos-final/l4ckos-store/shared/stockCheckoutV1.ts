import { z } from "zod";

export const stockCheckoutItemV1Schema = z.object({
  productId: z.number().int().positive(),
  variantId: z.number().int().positive(),
  quantity: z.number().int().min(1).max(99),
}).strict();

const stockDeliveryAddressV1Schema = z.object({
  recipient: z.string().trim().min(3).max(255),
  zipCode: z.string().trim().regex(/^\d{8}$/),
  street: z.string().trim().min(2).max(255),
  number: z.string().trim().min(1).max(30),
  complement: z.string().trim().max(255).optional(),
  neighborhood: z.string().trim().min(2).max(255),
  city: z.string().trim().min(2).max(255),
  state: z.string().trim().min(2).max(100),
}).strict();

export const stockLocalDeliveryV1Schema = z.object({
  optionId: z.literal("local-plano-piloto"),
  address: stockDeliveryAddressV1Schema,
}).strict();

/** Carrier delivery: price/carrier/service are NEVER client-supplied; only the server-signed quote token authorizes them. */
export const stockCarrierDeliveryV1Schema = z.object({
  optionId: z.string().regex(/^melhor-envio-[A-Za-z0-9_-]{1,60}$/),
  quoteToken: z.string().min(20).max(4096),
  address: stockDeliveryAddressV1Schema,
}).strict();

export const stockDeliveryV1Schema = z.union([stockLocalDeliveryV1Schema, stockCarrierDeliveryV1Schema]);

export const stockCheckoutRequestV1Schema = z.object({
  attemptId: z.string().regex(/^[A-Za-z0-9_-]{16,120}$/),
  items: z.array(stockCheckoutItemV1Schema).min(1).max(30),
  delivery: stockDeliveryV1Schema.optional(),
}).strict();

export const stockCheckoutHttpRequestV1Schema = stockCheckoutRequestV1Schema.extend({
  delivery: stockDeliveryV1Schema,
}).strict();

export const stockCheckoutResponseV1Schema = z.object({
  attemptId: z.string(),
  orderId: z.string(),
  status: z.enum(["pending", "paid", "reconciliation_required"]),
  paymentId: z.string().optional(),
  checkoutUrl: z.string().url().optional(),
  amountCents: z.number().int().nonnegative(),
  replayed: z.boolean(),
}).strict();

export const stockAttemptResumeV1Schema = z.object({
  attemptId: z.string(),
  status: z.enum(["reserved", "creating", "pending", "ambiguous", "paid", "failed", "expired", "cancelled"]),
  orderId: z.string().nullable(),
  paymentId: z.string().optional(),
  checkoutUrl: z.string().url().optional(),
  amountCents: z.number().int().nonnegative(),
  reservationExpiresAt: z.string().datetime(),
  canStartNewAttempt: z.boolean(),
}).strict();

export type StockCheckoutItemV1 = z.infer<typeof stockCheckoutItemV1Schema>;
export type StockDeliveryV1 = z.infer<typeof stockDeliveryV1Schema>;
export type StockCarrierDeliveryV1 = z.infer<typeof stockCarrierDeliveryV1Schema>;
export type StockCheckoutRequestV1 = z.infer<typeof stockCheckoutRequestV1Schema>;
export type StockCheckoutResponseV1 = z.infer<typeof stockCheckoutResponseV1Schema>;
export type StockAttemptResumeV1 = z.infer<typeof stockAttemptResumeV1Schema>;

export const stockShippingQuoteRequestV1Schema = z.object({
  items: z.array(stockCheckoutItemV1Schema).min(1).max(30),
  address: stockDeliveryAddressV1Schema,
}).strict();
export type StockShippingQuoteRequestV1 = z.infer<typeof stockShippingQuoteRequestV1Schema>;
