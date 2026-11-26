import type { Pool } from "mysql2/promise";
import { assertPublicOrSyntheticSandboxCheckoutEnabled, isPublicCheckoutEnabled } from "../_core/publicStore";
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
import { resolveOwnerPixTestAuthorization, type OwnerPixTestActor } from "./ownerPixTestGate";
import { StockCheckoutError } from "./stockCheckout";

/**
 * Same admission the router applies: public checkout, or (isolated homologation only) the allowlisted synthetic buyer
 * during an approved sandbox checkout phase. Anything else stays closed.
 */
function isCheckoutAdmitted(authenticatedUserId: number | undefined): boolean {
  if (isPublicCheckoutEnabled()) return true;
  try {
    assertPublicOrSyntheticSandboxCheckoutEnabled(authenticatedUserId);
    return true;
  } catch {
    return false;
  }
}

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
      return createStockCheckout({ enabled: isCheckoutAdmitted(authenticatedUserId) && input.checkoutEnabled !== false, ownerUserId: authenticatedUserId as number, store, provider: input.provider, request, ...(input.shipping ? { shipping: { secret: input.shipping.secret } } : {}) });
    },
    checkoutOwnerPixTest(request: unknown, actor: OwnerPixTestActor) {
      // Revalidate the complete server-side admission at the runtime boundary as well as in the router.
      const authorization = resolveOwnerPixTestAuthorization(actor);
      if (!authorization) throw new StockCheckoutError("PUBLIC_CHECKOUT_DISABLED");
      const serverRequest = request && typeof request === "object"
        ? { ...(request as Record<string, unknown>), attemptId: authorization.attemptId }
        : request;
      return createStockCheckout({
        enabled: true,
        ownerUserId: actor.id,
        store,
        provider: input.provider,
        request: serverRequest,
        maximumAmountCents: authorization.maxAmountCents,
        ...(input.shipping ? { shipping: { secret: input.shipping.secret } } : {}),
      });
    },
    /** Null when freight signing is not configured: carrier delivery is then simply unavailable. */
    quoteShipping(request: unknown) {
      return shippingQuotes ? shippingQuotes.quote(request) : null;
    },
    resume(authenticatedUserId: number, attemptId: unknown, expectedItems?: unknown) {
      // Authenticated read-only lookup is available while payment creation remains gated.
      return resumeStockCheckout({ store, authenticatedUserId, attemptId, expectedItems, provider: input.provider });
    },
    resumeLatest(authenticatedUserId: number, expectedItems?: unknown) {
      return resumeLatestStockCheckout({ store, authenticatedUserId, expectedItems, provider: input.provider });
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
