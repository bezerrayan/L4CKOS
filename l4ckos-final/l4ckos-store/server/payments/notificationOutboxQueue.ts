import { sql, type SQL } from "drizzle-orm";
import { buildTransactionalEmailEventKey } from "../services/email/transactionalNotificationPolicy";

export type CancellationNotificationPayload = {
  total?: string;
  items?: Array<{ name: string; quantity: number; price?: string }>;
  refundStatus?: "pending" | "refunded" | "unknown";
};

type NotificationOutboxExecutor = {
  execute(query: SQL): Promise<unknown>;
};

/**
 * Persist cancellation mail intent in the caller's transaction. This keeps
 * order state, stock release, audit record and notification intent atomic.
 */
export async function enqueueOrderCancelledInTransaction(
  tx: NotificationOutboxExecutor,
  orderId: number,
  payload: CancellationNotificationPayload = {}
) {
  if (!Number.isSafeInteger(orderId) || orderId <= 0)
    throw new Error("ORDER_CANCELLED_NOTIFICATION_ORDER_INVALID");
  const body = JSON.stringify({ ...payload, orderNumber: String(orderId) });
  if (Buffer.byteLength(body) > 16_384)
    throw new Error("PAYMENT_NOTIFICATION_PAYLOAD_LIMIT");
  const dedupeKey = buildTransactionalEmailEventKey({
    event: "order.cancelled",
    aggregateId: orderId,
  });
  await tx.execute(sql`INSERT INTO notificationOutbox(dedupeKey,type,orderId,payload)
    VALUES(${dedupeKey},'order-cancelled-email-v1',${orderId},${body})
    ON DUPLICATE KEY UPDATE dedupeKey=dedupeKey`);
}
