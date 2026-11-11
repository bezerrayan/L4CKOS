import { describe, expect, it } from "vitest";
import {
  buildTransactionalEmailEventKey,
  classifyNotificationFailure,
  isTransactionalNotificationWorkerEnabled,
  notificationFailureLogFields,
  PAYMENT_NOTIFICATION_WORKER_FLAG,
  planNotificationRetry,
} from "./transactionalNotificationPolicy";

describe("transactional notification policy", () => {
  it("builds stable idempotency keys without recipient data", () => {
    const key = buildTransactionalEmailEventKey({
      event: "order.created",
      aggregateId: 19,
    });
    expect(key).toBe("order-created-email:v1:order:19");
    expect(
      buildTransactionalEmailEventKey({
        event: "order.created",
        aggregateId: 19,
      })
    ).toBe(key);
    expect(key).not.toContain("@");
  });

  it("separates later decisions and grant revocations", () => {
    expect(
      buildTransactionalEmailEventKey({
        event: "exclusive.access_approved",
        aggregateId: 7,
        revision: 2,
      })
    ).not.toBe(
      buildTransactionalEmailEventKey({
        event: "exclusive.access_approved",
        aggregateId: 7,
        revision: 1,
      })
    );
    expect(
      buildTransactionalEmailEventKey({
        event: "exclusive.access_revoked",
        aggregateId: 7,
        grantId: 31,
      })
    ).toBe("grant:31:revoked");
  });

  it("rejects invalid identifiers", () => {
    expect(() =>
      buildTransactionalEmailEventKey({
        event: "payment.confirmed",
        aggregateId: 0,
      })
    ).toThrow("NOTIFICATION_AGGREGATE_ID_INVALID");
    expect(() =>
      buildTransactionalEmailEventKey({
        event: "exclusive.access_revoked",
        aggregateId: 7,
      })
    ).toThrow("NOTIFICATION_GRANT_ID_INVALID");
  });

  it("classifies permanent provider rejection and transient throttling", () => {
    expect(classifyNotificationFailure({ statusCode: 422 })).toEqual({
      kind: "permanent",
      errorCode: "PROVIDER_REJECTED_REQUEST",
    });
    expect(classifyNotificationFailure({ statusCode: 429 })).toEqual({
      kind: "transient",
      errorCode: "PROVIDER_RATE_LIMITED",
    });
  });

  it("retries with bounded jitter and moves uncertain delivery to review after the provider window", () => {
    const start = new Date("2026-11-11T12:00:00.000Z");
    const retry = planNotificationRetry({
      error: { code: "ETIMEDOUT", message: "private payload" },
      attempt: 1,
      firstAttemptAt: start,
      now: start,
      random: 0.5,
    });
    expect(retry).toEqual({
      action: "retry",
      errorCode: "PROVIDER_TIMEOUT_UNCONFIRMED",
      nextAttemptAt: new Date(start.getTime() + 60_000),
      attempt: 1,
    });
    expect(
      planNotificationRetry({
        error: { statusCode: 503 },
        attempt: 2,
        firstAttemptAt: start,
        now: new Date(start.getTime() + 23 * 60 * 60 * 1000),
      }).action
    ).toBe("review");
    expect(
      planNotificationRetry({
        error: { statusCode: 503 },
        attempt: 5,
        firstAttemptAt: start,
        now: start,
      }).action
    ).toBe("dead");
  });

  it("sanitizes logged failures and defaults the worker to disabled", () => {
    const fields = notificationFailureLogFields({
      eventKey: "order-created-email:v1:order:19",
      error: { statusCode: 500, message: "customer@example.test secret=abc" },
      attempt: 2,
      action: "retry",
    });
    expect(JSON.stringify(fields)).not.toMatch(/customer@example|secret=abc/);
    expect(isTransactionalNotificationWorkerEnabled({})).toBe(false);
    expect(
      isTransactionalNotificationWorkerEnabled({
        [PAYMENT_NOTIFICATION_WORKER_FLAG]: "false",
      })
    ).toBe(false);
    expect(
      isTransactionalNotificationWorkerEnabled({
        [PAYMENT_NOTIFICATION_WORKER_FLAG]: "true",
      })
    ).toBe(true);
    expect(() =>
      isTransactionalNotificationWorkerEnabled({
        [PAYMENT_NOTIFICATION_WORKER_FLAG]: "yes",
      })
    ).toThrow("INVALID_NOTIFICATION_WORKER_FLAG");
  });
});
