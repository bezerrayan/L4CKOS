import { randomUUID } from "node:crypto";
import {
  claimNotificationOutbox,
  completeOutboxNotification,
  failOutboxNotification,
  getOrderById,
  getOrderReservationItems,
  getUserById,
} from "../db";
import {
  sendInternalNewSaleAlertEmail,
  sendInternalPaymentFailedAlertEmail,
  sendPaymentApprovedEmail,
  sendPaymentFailedEmail,
} from "../services/emailService.js";
import { formatCurrency } from "../utils/email/formatCurrency.js";
import { securityLog } from "../_core/security";

type ClaimedNotification = Awaited<ReturnType<typeof claimNotificationOutbox>>[number];

export async function dispatchOutboxNotification(row: ClaimedNotification) {
  if (!row.orderId) throw new Error("OUTBOX_ORDER_MISSING");
  const order = await getOrderById(row.orderId);
  if (!order) throw new Error("OUTBOX_ORDER_NOT_FOUND");
  const user = await getUserById(order.userId);
  if (!user?.email) throw new Error("OUTBOX_RECIPIENT_MISSING");
  const total = formatCurrency(order.totalPrice / 100);

  if (row.type === "payment-approved") {
    await sendPaymentApprovedEmail({ customerEmail: user.email, customerName: user.name || "Cliente", orderNumber: String(order.id), total });
    const items = await getOrderReservationItems(order.id);
    await sendInternalNewSaleAlertEmail({
      customerName: user.name || "Cliente",
      customerEmail: user.email,
      orderNumber: String(order.id),
      total,
      items: items.map(item => ({ id: item.productId, name: item.productName || `Produto #${item.productId}`, price: formatCurrency(Number(item.totalPrice ?? item.unitPrice * item.quantity) / 100), imageUrl: item.productImage || "" })),
      orderUrl: `${String(process.env.APP_URL || process.env.APP_BASE_URL || process.env.FRONTEND_URL || "https://l4ckos.com.br").replace(/\/$/, "")}/meus-pedidos/${order.id}`,
    });
    return;
  }

  const reason = row.type === "payment-refunded"
    ? "Um reembolso foi confirmado e o pedido requer acompanhamento."
    : row.type === "payment-chargeback"
      ? "Um chargeback foi registrado e o pedido foi sinalizado para tratamento."
      : "A operadora ou o provedor não confirmou o pagamento.";
  if (row.type === "payment-failed") {
    await sendPaymentFailedEmail({ customerEmail: user.email, customerName: user.name || "Cliente", orderNumber: String(order.id), total, paymentUrl: `${String(process.env.APP_URL || "https://l4ckos.com.br").replace(/\/$/, "")}/checkout`, failureReason: reason });
  }
  await sendInternalPaymentFailedAlertEmail({ customerName: user.name || "Cliente", customerEmail: user.email, orderNumber: String(order.id), total, failureReason: reason });
}

export async function runNotificationOutbox(options: {
  workerId?: string;
  batchSize?: number;
  maxAttempts?: number;
  send?: (row: ClaimedNotification) => Promise<void>;
} = {}) {
  const workerId = options.workerId ?? `outbox:${process.pid}:${randomUUID()}`;
  const maxAttempts = options.maxAttempts ?? 5;
  const rows = await claimNotificationOutbox(workerId, options.batchSize ?? 20, new Date(), 60_000, maxAttempts);
  const result = { claimed: rows.length, sent: 0, failed: 0 };
  for (const row of rows) {
    try {
      await (options.send ?? dispatchOutboxNotification)(row);
      if (await completeOutboxNotification(row.id, workerId)) result.sent += 1;
    } catch (error) {
      result.failed += 1;
      await failOutboxNotification(row.id, workerId, error, new Date(), maxAttempts);
      securityLog("warn", "jobs.notification_outbox_failed", { outboxId: row.id, orderId: row.orderId, paymentId: row.paymentId, workerId, errorType: error instanceof Error ? error.name : "unknown" });
    }
  }
  return result;
}
