import type { Pool } from "mysql2/promise";
import { isPublicCheckoutEnabled } from "../_core/publicStore";
import {
  createStockCheckout,
  expireStockReservations,
  processSignedStockWebhook,
  resumeStockCheckout,
  resumeLatestStockCheckout,
  type StockPaymentProvider,
  type StockWebhookBoundary,
} from "./stockCheckout";
import { createMysqlStockCheckoutStore } from "./mysqlStockCheckoutStore";
import { createExclusiveStore, type ExclusiveStore } from "../exclusive/store";
import { createStockShippingQuoteService } from "./stockShippingQuoteService";
import type { quoteShippingDetailed } from "../services/shippingService";

/** Composition boundary for a future STOCK-only route; this factory does not mount or enable any route. */
export function createStockCheckoutRuntime(input: { pool: Pool; provider: StockPaymentProvider; checkoutEnabled?: boolean; exclusiveStore?: ExclusiveStore; shipping?: { secret: string; quote?: typeof quoteShippingDetailed } }) {
  const shippingQuotes = input.shipping ? createStockShippingQuoteService({ pool: input.pool, secret: input.shipping.secret, quote: input.shipping.quote }) : undefined;
  const exclusiveStore = input.exclusiveStore ?? createExclusiveStore(input.pool);
  const store = createMysqlStockCheckoutStore(input.pool, {
    reserveExclusiveQuota: (connection, claim) => exclusiveStore.reserveForCheckoutInTransaction(connection, claim),
  });
  return {
    isForDisposableLocalHarness() {
      const connection = (input.pool as unknown as { pool?: { config?: { connectionConfig?: { host?: unknown; user?: unknown; database?: unknown } } } }).pool?.config?.connectionConfig;
      return /^(127\.0\.0\.1|localhost|::1)$/.test(String(connection?.host ?? "")) &&
        connection?.database === "l4ckos_stock_test" &&
        connection?.user === "stock_test";
    },
    checkout(request: unknown, authenticatedUserId?: number) {
      // Gate check occurs before the domain can acquire a connection or invoke the provider.
      return createStockCheckout({ enabled: isPublicCheckoutEnabled() && input.checkoutEnabled !== false, ownerUserId: authenticatedUserId as number, store, provider: input.provider, request, ...(input.shipping ? { shipping: { secret: input.shipping.secret } } : {}) });
    },
    /** Null when freight signing is not configured: carrier delivery is then simply unavailable. */
    quoteShipping(request: unknown) {
      return shippingQuotes ? shippingQuotes.quote(request) : null;
    },
    resume(authenticatedUserId: number, attemptId: unknown) {
      // Authenticated read-only lookup is available while payment creation remains gated.
      return resumeStockCheckout({ store, authenticatedUserId, attemptId });
    },
    resumeLatest(authenticatedUserId: number) {
      return resumeLatestStockCheckout({ store, authenticatedUserId });
    },
    receiveWebhook(input: {
      rawBody: string;
      headers: Readonly<Record<string, string | string[] | undefined>>;
      boundary: StockWebhookBoundary;
    }) {
      return processSignedStockWebhook({ ...input, store });
    },
    expireReservations(batchSize = 50) {
      return expireStockReservations(store, batchSize);
    },
  };
}

export type StockCheckoutRuntime = ReturnType<typeof createStockCheckoutRuntime>;
