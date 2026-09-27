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

const PROVIDER_TIMEOUT_MS = Math.max(
  1_000,
  Number.parseInt(process.env.ORDER_EMAIL_PROVIDER_TIMEOUT_MS || "15000", 10) || 15_000,
);

async function withProviderTimeout<T>(operation: Promise<T>) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Email provider timed out after ${PROVIDER_TIMEOUT_MS}ms`)), PROVIDER_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
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

  try {
    console.info("[OrderEmailEvent] event claimed", {
      orderId: input.orderId,
      eventId: claimed.eventId,
      eventType: input.eventType,
      attemptCount: claimed.attemptCount,
    });
    if (claimed.reclaimed) {
      console.warn("[OrderEmailEvent] stale event reclaimed", {
        orderId: input.orderId,
        eventId: claimed.eventId,
        eventType: input.eventType,
        attemptCount: claimed.attemptCount,
      });
    }

    const idempotencyKey = orderEmailIdempotencyKey(input.orderId, input.eventType);
    const orderNumber = String(input.orderId);
    const orderUrl = `${input.appBaseUrl}/meus-pedidos/${input.orderId}`;
    const scheduledAt = input.eventType === "review_request_email"
      ? getReviewRequestScheduledAt()
      : undefined;
    console.info("[OrderEmailEvent] provider dispatch started", {
      orderId: input.orderId,
      eventId: claimed.eventId,
      eventType: input.eventType,
      attemptCount: claimed.attemptCount,
    });

    const response = input.eventType === "order_delivered_email"
      ? await withProviderTimeout(sendOrderDeliveredEmail({
          customerEmail: input.customerEmail,
          customerName: input.customerName,
          orderNumber,
          orderUrl,
          idempotencyKey,
        }))
      : await withProviderTimeout(sendReviewRequestEmail({
          customerEmail: input.customerEmail,
          customerName: input.customerName,
          orderNumber,
          reviewUrl: orderUrl,
          scheduledAt: scheduledAt!,
          idempotencyKey,
        }));

    const providerMessageId = response && typeof response === "object" && "id" in response
      ? String(response.id ?? "") || null
      : null;
    const finalized = await markOrderEmailEventSent({
      orderId: input.orderId,
      eventType: input.eventType,
      claimToken: claimed.claimToken,
      providerMessageId,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
    });
    if (!finalized) {
      console.warn("[OrderEmailEvent] provider accepted after lease loss", {
        orderId: input.orderId,
        eventId: claimed.eventId,
        eventType: input.eventType,
        attemptCount: claimed.attemptCount,
      });
      return { dispatched: false, reason: "lease_lost" as const };
    }
    console.info("[OrderEmailEvent] provider accepted", {
      orderId: input.orderId,
      eventId: claimed.eventId,
      eventType: input.eventType,
      attemptCount: claimed.attemptCount,
    });
    return { dispatched: true, scheduledAt: scheduledAt ?? null };
  } catch (error) {
    const message = errorMessage(error);
    let persisted = false;
    try {
      persisted = await markOrderEmailEventFailed({
        orderId: input.orderId,
        eventType: input.eventType,
        claimToken: claimed.claimToken,
        error: message,
      });
    } catch (persistenceError) {
      console.error("[OrderEmailEvent] failure persistence failed", {
        orderId: input.orderId,
        eventId: claimed.eventId,
        eventType: input.eventType,
        attemptCount: claimed.attemptCount,
        name: persistenceError instanceof Error ? persistenceError.name : "UnknownError",
      });
    }
    console.error("[OrderEmailEvent] dispatch failed", {
      orderId: input.orderId,
      eventId: claimed.eventId,
      eventType: input.eventType,
      attemptCount: claimed.attemptCount,
      name: error instanceof Error ? error.name : "UnknownError",
      persisted,
    });
    return { dispatched: false, reason: "provider_failed" as const };
  }
}
