import { describeStockAttempt, type StockAttemptView } from "./stockAttemptView";
import type { StockAttemptResumeV1 } from "../../../shared/stockCheckoutV1";

/**
 * Presentation + polling policy for the page the customer lands on after the hosted card page.
 *
 * Landing here proves nothing about the payment. The only financial source is the attempt state the backend reports
 * (set exclusively by the provider's authenticated confirmation), so every state is rendered from that and never from
 * the fact that the browser came back.
 */
export const RETURN_POLL_INTERVAL_MS = 5_000;
export const RETURN_POLL_WINDOW_MS = 3 * 60_000;

const KEEP_POLLING = new Set<StockAttemptResumeV1["status"]>(["reserved", "creating", "pending"]);

export function shouldKeepPollingReturn(status: StockAttemptResumeV1["status"] | undefined, elapsedMs: number): boolean {
  if (elapsedMs >= RETURN_POLL_WINDOW_MS) return false;
  // Unknown yet (first load) keeps polling; terminal and ambiguous states stop: ambiguous needs analysis, not polling.
  return status === undefined || KEEP_POLLING.has(status);
}

export type ReturnView = StockAttemptView & {
  /** True when the poll window ended while the payment is still unconfirmed. */
  stillWaiting: boolean;
  /** Safe link to the order tracking page (only when the server gave an order id). */
  orderPath: string | null;
};

export function describeReturnAttempt(attempt: StockAttemptResumeV1, elapsedMs: number): ReturnView {
  const view = describeStockAttempt(attempt);
  const waiting = KEEP_POLLING.has(attempt.status);
  const orderId = attempt.orderId && /^[0-9]{1,12}$/.test(attempt.orderId) ? attempt.orderId : null;
  return {
    ...view,
    stillWaiting: waiting && elapsedMs >= RETURN_POLL_WINDOW_MS,
    orderPath: orderId ? `/meus-pedidos/${orderId}` : null,
  };
}
