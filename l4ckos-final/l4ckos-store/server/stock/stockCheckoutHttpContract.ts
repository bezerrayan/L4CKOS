import { stockAttemptResumeV1Schema, stockCheckoutRequestV1Schema, type StockAttemptResumeV1, type StockCheckoutRequestV1, type StockCheckoutResponseV1 } from "../../shared/stockCheckoutV1";
import { resumeStockCheckout, StockCheckoutError, type StockCheckoutStore } from "./stockCheckout";

export type StockCheckoutDomainResult = {
  orderId: string;
  paymentId: string;
  checkoutUrl: string;
  amountCents: number;
  replayed: boolean;
};

/** Parse the strict V1 wire shape before handing it to the checkout domain. */
export function parseStockCheckoutRequestV1(input: unknown): StockCheckoutRequestV1 {
  return stockCheckoutRequestV1Schema.parse(input);
}

/** Converts the currently implemented domain result to the proposed HTTP V1 response; does not mount a route. */
export function toStockCheckoutResponseV1(
  attemptId: string,
  result: StockCheckoutDomainResult,
): StockCheckoutResponseV1 {
  return {
    attemptId,
    orderId: result.orderId,
    status: "pending",
    paymentId: result.paymentId,
    checkoutUrl: result.checkoutUrl,
    amountCents: result.amountCents,
    replayed: result.replayed,
  };
}

export type StockResumeHttpInput = {
  session?: { user?: { id?: unknown } } | null;
  params: { attemptId?: unknown };
  /** Kept in the adapter signature to show that an untrusted body is deliberately ignored. */
  body?: unknown;
};

export type StockResumeHttpReply =
  | { status: 200; body: StockAttemptResumeV1 }
  | { status: 400; body: { code: "ATTEMPT_ID_INVALID" } }
  | { status: 401; body: { code: "AUTHENTICATION_REQUIRED" } }
  | { status: 404; body: { code: "ATTEMPT_NOT_FOUND" } }
  | { status: 500; body: { code: "RESUME_UNAVAILABLE" } };

/** Local auth/session boundary for a future route; no route is mounted and no body userId is read. */
export async function resumeStockAttemptHttp(input: {
  store: StockCheckoutStore;
  request: StockResumeHttpInput;
}): Promise<StockResumeHttpReply> {
  const authenticatedUserId = input.request.session?.user?.id;
  if (!Number.isSafeInteger(authenticatedUserId) || Number(authenticatedUserId) <= 0) {
    return { status: 401, body: { code: "AUTHENTICATION_REQUIRED" } };
  }
  try {
    const result = await resumeStockCheckout({
      store: input.store,
      authenticatedUserId: Number(authenticatedUserId),
      attemptId: input.request.params.attemptId,
    });
    return { status: 200, body: stockAttemptResumeV1Schema.parse(result) };
  } catch (error) {
    if (error instanceof StockCheckoutError && error.code === "STOCK_ATTEMPT_ID_INVALID") {
      return { status: 400, body: { code: "ATTEMPT_ID_INVALID" } };
    }
    if (error instanceof StockCheckoutError && error.code === "CHECKOUT_ATTEMPT_NOT_FOUND") {
      return { status: 404, body: { code: "ATTEMPT_NOT_FOUND" } };
    }
    return { status: 500, body: { code: "RESUME_UNAVAILABLE" } };
  }
}
