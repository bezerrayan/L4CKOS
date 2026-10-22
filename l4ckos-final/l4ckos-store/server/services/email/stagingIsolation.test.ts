import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { canonical } from "../../../database/schema/fingerprint";

const fixture = vi.hoisted(() => ({
  send: vi.fn(async (..._args: any[]) => ({ data: { id: "synthetic-provider-id" }, error: null })),
  batch: vi.fn(async (..._args: any[]) => ({ data: [], error: null })),
  claim: vi.fn(), sent: vi.fn(), failed: vi.fn(),
  getDb: vi.fn(),
  markPaid: vi.fn(), getOrder: vi.fn(), getUser: vi.fn(),
}));
vi.mock("resend", () => ({ Resend: class {
  emails = { send: fixture.send }; batch = { send: fixture.batch };
  post() { throw new Error("Raw SDK exposed"); }
} }));
vi.mock("../../db", () => ({
  getDb: fixture.getDb,
  isDuplicateKeyError: () => false,
  markOrderPaid: fixture.markPaid,
  getOrderById: fixture.getOrder,
  getUserById: fixture.getUser,
  getOrderReservationItems: vi.fn(async () => []),
  runAsaasWebhookOnce: vi.fn(async (_input: any, handler: any) => ({ duplicate: false, result: await handler() })),
  getOrderByAsaasCheckoutId: vi.fn(), getOrderByIdAndUser: vi.fn(), getUserPhoneById: vi.fn(),
  recordPaymentException: vi.fn(), reserveExternalCheckoutCreation: vi.fn(),
  setOrderAsaasCheckoutId: vi.fn(), updateUserAsaasCustomerId: vi.fn(),
  claimOrderEmailEvent: fixture.claim,
  markOrderEmailEventSent: fixture.sent,
  markOrderEmailEventFailed: fixture.failed,
  orderEmailIdempotencyKey: (id: number, type: string) => `order-${id}-${type}`,
}));
vi.mock("../../services/asaasService", () => ({
  createAsaasCheckout: vi.fn(), createAsaasCustomer: vi.fn(), getAsaasPayment: vi.fn(), validateAsaasWebhookSignature: vi.fn(),
}));
import { getResendClient } from "./resendClient.js";
import { sendPaymentApprovedEmail, sendInternalNewSaleAlertEmail } from "./emailService.js";
import { dispatchOrderEmailEvent } from "../orderEmailDelivery";
import { processStoredWebhook, recoverWebhooks } from "../../payments/webhookInbox";
import { processWebhookEnvelope } from "../../controllers/paymentController";
import { getTableName } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";

const allowed = "synthetic@example.invalid";
const denied = "external@example.invalid";
const payload = { from: "sender@example.invalid", to: allowed, subject: "Fixture", html: "Fixture" };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  for (const [name, value] of Object.entries({ APP_ENV: "staging", EMAIL_ENV: "staging", EMAIL_MODE: "restricted",
    STAGING_EMAIL_ALLOWLIST: allowed, RESEND_API_KEY: "mock-key", EMAIL_FROM_FINANCE: "sender@example.invalid",
    ORDERS_EMAIL: "sender@example.invalid", ALERTS_NOTIFICATION_EMAIL: denied,
    RAILWAY_PROJECT_ID: "", RAILWAY_ENVIRONMENT_ID: "" })) vi.stubEnv(name, value);
  vi.spyOn(console, "info").mockImplementation(() => {});
  fixture.claim.mockResolvedValue({ eventId: 999, claimToken: "fixture", attemptCount: 1, reclaimed: false });
  fixture.sent.mockResolvedValue(true);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("staging egress isolation (provider mocked, no remote data)", () => {
  it("allows an explicitly authorized mailbox and preserves provider options", async () => {
    await getResendClient().emails.send({ ...payload, to: allowed.toUpperCase() }, { idempotencyKey: "fixture" });
    expect(fixture.send).toHaveBeenCalledOnce();
    expect(fixture.send.mock.calls[0][1]).toEqual({ idempotencyKey: "fixture" });
  });
  it.each([
    { to: denied }, { to: [allowed, denied] }, { cc: denied }, { bcc: [allowed, denied] },
    { to: `Synthetic <${allowed}>` }, { to: `${allowed},${denied}` }, { to: [] }, { bcc: "" },
  ])("blocks the whole message with unsafe recipients %j", async recipients => {
    await expect(getResendClient().emails.send({ ...payload, ...recipients })).rejects.toMatchObject({
      code: "STAGING_EMAIL_RECIPIENT_BLOCKED", retryable: false,
    });
    expect(fixture.send).not.toHaveBeenCalled();
  });
  it("permits authorized To, CC and BCC", async () => {
    await getResendClient().emails.send({ ...payload, cc: [allowed], bcc: allowed });
    expect(fixture.send).toHaveBeenCalledOnce();
  });
  it.each(["", "*", "*@example.invalid", "invalid", `${allowed},`, `["${allowed}"]`])("fails closed for allowlist %s", async value => {
    vi.stubEnv("STAGING_EMAIL_ALLOWLIST", value);
    await expect(getResendClient().emails.send(payload)).rejects.toMatchObject({ code: "STAGING_EMAIL_ALLOWLIST_INVALID" });
    expect(fixture.send).not.toHaveBeenCalled();
  });
  it.each(["", "normal", "disabled"])("fails closed for mode %s", async mode => {
    vi.stubEnv("EMAIL_MODE", mode);
    await expect(getResendClient().emails.send(payload)).rejects.toMatchObject({ code: "STAGING_EMAIL_CONFIG_INVALID" });
    expect(fixture.send).not.toHaveBeenCalled();
  });
  it("recognizes the staging project even with missing/mislabelled APP_ENV", async () => {
    vi.stubEnv("APP_ENV", "production"); vi.stubEnv("EMAIL_ENV", ""); vi.stubEnv("EMAIL_MODE", "");
    vi.stubEnv("RAILWAY_PROJECT_ID", "2bb90c8e-eb65-43ee-826b-f93750f0499c");
    await expect(getResendClient().emails.send(payload)).rejects.toThrow("STAGING_EMAIL_CONFIG_INVALID");
  });
  it("rechecks configuration immediately before dispatch, without caching allowlist", async () => {
    const client = getResendClient();
    vi.stubEnv("STAGING_EMAIL_ALLOWLIST", denied);
    await expect(client.emails.send(payload)).rejects.toThrow("STAGING_EMAIL_RECIPIENT_BLOCKED");
    expect(fixture.send).not.toHaveBeenCalled();
  });
  it("exposes no generic provider HTTP bypass and prevents facade mutation", () => {
    const client = getResendClient();
    expect((client as any).post).toBeUndefined(); expect((client as any).send).toBeUndefined();
    expect(Object.isFrozen(client)).toBe(true); expect(Object.isFrozen(client.emails)).toBe(true);
  });
  it("rejects a mixed batch atomically before any provider call", async () => {
    await expect(getResendClient().batch.send([payload, { ...payload, to: denied }])).rejects.toThrow("STAGING_EMAIL_RECIPIENT_BLOCKED");
    expect(fixture.batch).not.toHaveBeenCalled(); expect(fixture.send).not.toHaveBeenCalled();
  });
  it("guards payment notifications and administrative alerts through the real transport", async () => {
    await expect(sendPaymentApprovedEmail({ customerEmail: denied, customerName: "Fixture", orderNumber: "900", total: 500 })).rejects.toThrow("STAGING_EMAIL_RECIPIENT_BLOCKED");
    await expect(sendInternalNewSaleAlertEmail({ customerName: "Fixture", customerEmail: allowed, orderNumber: "900", total: 500, items: [], orderUrl: "https://staging.l4ckos.com.br" })).rejects.toThrow("STAGING_EMAIL_RECIPIENT_BLOCKED");
    expect(fixture.send).not.toHaveBeenCalled();
  });
  it("allows payment notification without logging mailbox or customer name", async () => {
    await sendPaymentApprovedEmail({ customerEmail: allowed, customerName: "Private Fixture", orderNumber: "900", total: 500 });
    expect(fixture.send).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(allowed);
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain("Private Fixture");
  });
  it.each(["order_delivered_email", "review_request_email"] as const)("blocks worker %s before claiming or modifying outbox", async eventType => {
    const historical = { status: "processing", attemptCount: 1, claimToken: null };
    fixture.claim.mockImplementation(async () => { historical.attemptCount++; return { ...historical }; });
    for (let retry = 0; retry < 3; retry++) {
      expect(await dispatchOrderEmailEvent({ orderId: 900, eventType, customerEmail: denied, customerName: "Fixture", appBaseUrl: "https://staging.l4ckos.com.br" }))
        .toEqual({ dispatched: false, reason: "policy_blocked" });
    }
    expect(historical).toEqual({ status: "processing", attemptCount: 1, claimToken: null });
    expect(fixture.claim).not.toHaveBeenCalled(); expect(fixture.sent).not.toHaveBeenCalled(); expect(fixture.failed).not.toHaveBeenCalled();
    expect(fixture.send).not.toHaveBeenCalled();
  });
  it("permits an authorized worker using real transport and one claim token", async () => {
    expect(await dispatchOrderEmailEvent({ orderId: 900, eventType: "order_delivered_email", customerEmail: allowed, customerName: "Fixture", appBaseUrl: "https://staging.l4ckos.com.br" })).toMatchObject({ dispatched: true });
    expect(fixture.send).toHaveBeenCalledOnce(); expect(fixture.sent).toHaveBeenCalledWith(expect.objectContaining({ claimToken: "fixture", providerMessageId: "synthetic-provider-id" }));
  });
  it.each([allowed, denied])("real payment handler preserves commit/idempotency despite blocked email for %s", async customerEmail => {
    const envelope = { id: "synthetic-new-event", event: "PAYMENT_RECEIVED", payment: { id: "synthetic-payment", externalReference: "900", value: 5, status: "RECEIVED" } };
    const record = { eventId:envelope.id, payload: JSON.stringify(envelope), payloadHash: createHash("sha256").update(canonical(envelope)).digest("hex"), state: "received", attempts: 0 };
    const updates: any[] = [];
    // Repository fixture implements the new payment/outbox statements, not a bypass of the worker.
    // Real MySQL integration separately covers locking, rollback and concurrent claims.
    let notification: any;
    const execute = async (statement: any) => {
      const { sql: query, params } = new MySqlDialect().sqlToQuery(statement);
      // The claim query reads notificationOutbox and also embeds auditLogs in a
      // recovery-fence subquery. Match the primary table before broad subquery
      // fixtures so the pending notification is not mistaken for an audit read.
      if (query.includes("FROM notificationOutbox")) return [[...(notification?.status === "pending" ? [notification] : [])]];
      if (query.includes("FROM auditLogs")) return [[]];
      if (query.includes("SELECT id FROM orders") || query.includes("SELECT providerPaymentId")) return [[]];
      if (query.includes("UPDATE payments")) return [{ affectedRows: 0 }];
      if (query.includes("INSERT INTO notificationOutbox")) {
        notification = { id: 1, dedupeKey: params[0], type: params[1], orderId: params[2], payload: params[3], status: "pending", attempts: 0 };
        return [{ affectedRows: 1 }];
      }
      if (query.includes("SELECT u.email")) { expect(committed).toBe(true); return [[{ email: customerEmail, name: "Fixture" }]]; }
      if (query.includes("UPDATE notificationOutbox SET status='processing'")) {
        Object.assign(notification, { status: "processing", lockedBy: params[0], payload: params[1], attempts: 1 });
        return [{ affectedRows: 1 }];
      }
      if (query.includes("UPDATE notificationOutbox SET status='sent'")) {
        expect(params.at(-1)).toBe(notification.lockedBy);notification.status="sent";return [{ affectedRows: 1 }];
      }
      throw new Error("UNEXPECTED_PAYMENT_OUTBOX_FIXTURE_STATEMENT");
    };
    const tx = { execute,
      select: () => ({ from: () => ({ where: () => ({ for: async () => [record] }) }) }),
      update: () => ({ set: (values: any) => ({ where: async () => { updates.push(values); Object.assign(record, values); } }) }),
    };
    let committed = false;
    fixture.getDb.mockResolvedValue({ execute, transaction: async (action: any) => { const result = await action(tx); committed = true; return result; } });
    const ledger = { confirmed: false, stockTransitions: 0 };
    fixture.getOrder.mockResolvedValue({ id: 900, userId: 900, status: "pending", totalPrice: 500 });
    fixture.getUser.mockImplementation(async () => { expect(committed).toBe(true); return { id: 900, name: "Fixture", email: customerEmail }; });
    fixture.markPaid.mockImplementation(async () => {
      expect(committed).toBe(false);
      ledger.confirmed = true; ledger.stockTransitions++;
      return { updated: true, lowStockProducts: [] };
    });
    const process = vi.fn(processWebhookEnvelope);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await processStoredWebhook(envelope.id, process)).toMatchObject({ status: 200 });
    expect(record).toMatchObject({ state: "processed", attempts: 1 });
    expect(await processStoredWebhook(envelope.id, process)).toMatchObject({ status: 200, body: { reason: "duplicate_event" } });
    expect(process).toHaveBeenCalledOnce(); expect(ledger).toEqual({ confirmed: true, stockTransitions: 1 });
    expect(updates).toHaveLength(2); expect(fixture.markPaid).toHaveBeenCalledOnce();
    expect(notification.status).toBe(customerEmail === allowed ? "sent" : "pending");
    expect(fixture.send).toHaveBeenCalledTimes(customerEmail === allowed ? 1 : 0);
    for (const [message] of fixture.send.mock.calls) expect(message.to).toEqual([allowed]);
    expect(console.warn).toHaveBeenCalled();
  });
  it("leaves nonstaging provider behavior unchanged (local mocked environment)", async () => {
    vi.stubEnv("APP_ENV", "production"); vi.stubEnv("EMAIL_ENV", "production"); vi.stubEnv("EMAIL_MODE", "normal"); vi.stubEnv("STAGING_EMAIL_ALLOWLIST", "");
    await getResendClient().emails.send({ ...payload, to: denied });
    expect(fixture.send).toHaveBeenCalledOnce();
  });
  it("financial recovery never scans or replays historical notification outboxes", async () => {
    const history = [
      { event: "payment-approved", order: "ORD-2", status: "pending", attempts: 0 },
      { event: "payment-approved", order: "ORD-3", status: "pending", attempts: 0 },
      { event: "order_delivered_email", order: "ORD-6", status: "processing", attempts: 1, token: null },
      { event: "review_request_email", order: "ORD-6", status: "processing", attempts: 1, token: null },
    ];
    const before = JSON.stringify(history);
    const tables: string[] = [];
    const builder: any = { where: () => builder, leftJoin: () => builder, orderBy: () => builder,
      limit: async () => [], then: (resolve: any) => resolve([{ n: 0 }]) };
    fixture.getDb.mockResolvedValue({
      select: () => ({ from: (table: any) => { tables.push(getTableName(table)); return builder; } }),
      update: (table: any) => { tables.push(getTableName(table)); return { set: () => ({ where: async () => {} }) }; },
    });
    const process = vi.fn();
    expect(await recoverWebhooks(process)).toMatchObject({ examined: 0, completed: 0, pending: 0 });
    expect(tables.every(table => ["asaasWebhookInbox", "asaasWebhookEvents"].includes(table))).toBe(true);
    expect(JSON.stringify(history)).toBe(before); expect(process).not.toHaveBeenCalled();
    expect(fixture.claim).not.toHaveBeenCalled(); expect(fixture.sent).not.toHaveBeenCalled(); expect(fixture.failed).not.toHaveBeenCalled();
    expect(fixture.send).not.toHaveBeenCalled();
  });
  it("keeps the raw SDK constructor restricted to the guarded boundary", () => {
    const files: string[] = [];
    const scan = (directory: string) => { for (const item of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, item.name);
      if (item.isDirectory()) scan(file); else if (/\.[jt]sx?$/.test(file) && !/\.(test|spec)\./.test(file)) files.push(file);
    } };
    scan(join(process.cwd(), "server"));
    const constructors = files.filter(file => /(?:from\s*["']resend["']|new\s+Resend\s*\(|api\.resend\.com)/.test(readFileSync(file, "utf8")));
    expect(constructors).toEqual([join(process.cwd(), "server/services/email/resendClient.js")]);
  });
});
