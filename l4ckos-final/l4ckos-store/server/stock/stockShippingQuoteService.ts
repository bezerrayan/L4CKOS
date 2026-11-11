import type { Pool, RowDataPacket } from "mysql2/promise";
import { stockShippingQuoteRequestV1Schema } from "../../shared/stockCheckoutV1";
import { quoteShippingDetailed, type QuoteShippingResult } from "../services/shippingService";
import { stockShippingCartFingerprint, StockCheckoutError } from "./stockCheckout";
import { issueStockShippingQuoteV1, StockShippingQuoteError } from "./stockShippingQuoteV1";

type QuoteFn = (input: { cep: string; itemCount: number; subtotal: number }) => Promise<QuoteShippingResult>;

export type StockShippingQuoteOption = {
  optionId: string;
  label: string;
  description: string;
  priceCents: number;
  minDays: number | null;
  maxDays: number | null;
  quoteToken: string;
  expiresAt: string;
};

const PARCEL = { heightCm: 6, widthCm: 18, lengthCm: 26, gramsPerItem: 300 };

/**
 * Server-side freight quoting for the STOCK checkout. Everything the quote is bound to (variants, unit prices, quantities,
 * item count, subtotal, parcel, destination address) is loaded/derived HERE; the client only names variants and quantities.
 * Each carrier option is returned with a short-lived HMAC token that the checkout transaction re-verifies.
 */
export function createStockShippingQuoteService(input: { pool: Pool; secret: string; quote?: QuoteFn; now?: () => Date }) {
  const quote = input.quote ?? quoteShippingDetailed;
  return {
    async quote(request: unknown): Promise<{ options: StockShippingQuoteOption[]; source: QuoteShippingResult["source"] }> {
      const parsed = stockShippingQuoteRequestV1Schema.parse(request);
      const ids = [...new Set(parsed.items.map(item => item.variantId))];
      const [rows] = await input.pool.query<(RowDataPacket & { id: number; productId: number; price: number | null; isActive: number })[]>(
        "SELECT id, productId, price, isActive FROM productVariants WHERE id IN (?)",
        [ids],
      );
      const byId = new Map(rows.map(row => [Number(row.id), row]));
      const lines = parsed.items.map(item => {
        const variant = byId.get(item.variantId);
        if (!variant || Number(variant.productId) !== item.productId || Number(variant.isActive) !== 1 || variant.price == null || Number(variant.price) <= 0) {
          throw new StockCheckoutError("CHECKOUT_VARIANT_INACTIVE");
        }
        return { variantId: item.variantId, unitPriceCents: Number(variant.price), quantity: item.quantity };
      });
      const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);
      const merchandiseSubtotalCents = lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
      if (itemCount > 100) throw new StockShippingQuoteError("SHIPPING_CART_INVALID");
      const cartFingerprint = stockShippingCartFingerprint(lines);
      const result = await quote({ cep: parsed.address.zipCode, itemCount, subtotal: merchandiseSubtotalCents / 100 });
      const options: StockShippingQuoteOption[] = [];
      for (const option of result.options) {
        if (!option.id.startsWith("melhor-envio-") || !Number.isFinite(option.price) || option.price <= 0) continue; // local delivery has its own gate
        const priceCents = Math.round(option.price * 100);
        if (!Number.isSafeInteger(priceCents) || priceCents <= 0) continue;
        try {
          const issued = issueStockShippingQuoteV1({
            secret: input.secret,
            terms: {
              method: "carrier", optionId: option.id, carrier: option.description, serviceId: option.id.slice("melhor-envio-".length),
              serviceName: option.label, providerQuoteId: option.id, shippingPriceCents: priceCents,
              package: { heightCm: PARCEL.heightCm, widthCm: PARCEL.widthCm, lengthCm: PARCEL.lengthCm, weightGrams: PARCEL.gramsPerItem * itemCount },
            },
            address: parsed.address,
            cartFingerprint, itemCount, merchandiseSubtotalCents,
            ...(input.now ? { now: input.now() } : {}),
          });
          options.push({ optionId: option.id, label: option.label, description: option.description, priceCents, minDays: option.minDays, maxDays: option.maxDays, quoteToken: issued.quoteToken, expiresAt: issued.expiresAt });
        } catch (error) {
          if (!(error instanceof StockShippingQuoteError)) throw error; // an option that cannot be signed is simply not offered
        }
      }
      return { options, source: result.source };
    },
  };
}
