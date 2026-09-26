import {
  claimOrderEmailEvent,
  markOrderEmailEventFailed,
  markOrderEmailEventSent,
  orderEmailIdempotencyKey,
  type OrderEmailEventType,
} from "../db";
import { sendOrderDeliveredEmail, sendReviewRequestEmail } from "./emailService.js";
import { getReviewRequestScheduledAt } from "../utils/email/reviewRequestSchedule";

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown email provider error";
  return String(message)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .slice(0, 500);
}

export async function dispatchOrderEmailEvent(input: {
  orderId: number;
  eventType: OrderEmailEventType;
  customerEmail: string;
  customerName: string;
  appBaseUrl: string;
}) {
  const claimed = await claimOrderEmailEvent(input.orderId, input.eventType);
  if (!claimed) return { dispatched: false, reason: "already_reserved_or_sent" as const };

  const idempotencyKey = orderEmailIdempotencyKey(input.orderId, input.eventType);
  const orderNumber = String(input.orderId);
  const orderUrl = `${input.appBaseUrl}/meus-pedidos/${input.orderId}`;
  const scheduledAt = input.eventType === "review_request_email"
    ? getReviewRequestScheduledAt()
    : undefined;

  try {
    const response = input.eventType === "order_delivered_email"
      ? await sendOrderDeliveredEmail({
          customerEmail: input.customerEmail,
          customerName: input.customerName,
          orderNumber,
          orderUrl,
          idempotencyKey,
        })
      : await sendReviewRequestEmail({
          customerEmail: input.customerEmail,
          customerName: input.customerName,
          orderNumber,
          reviewUrl: orderUrl,
          scheduledAt: scheduledAt!,
          idempotencyKey,
        });

    const providerMessageId = response && typeof response === "object" && "id" in response
      ? String(response.id ?? "") || null
      : null;
    await markOrderEmailEventSent({
      orderId: input.orderId,
      eventType: input.eventType,
      providerMessageId,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
    });
    return { dispatched: true, scheduledAt: scheduledAt ?? null };
  } catch (error) {
    const message = errorMessage(error);
    await markOrderEmailEventFailed({ orderId: input.orderId, eventType: input.eventType, error: message });
    console.error("[OrderEmailEvent] dispatch failed", {
      orderId: input.orderId,
      eventType: input.eventType,
      name: error instanceof Error ? error.name : "UnknownError",
      message,
    });
    return { dispatched: false, reason: "provider_failed" as const };
  }
}
