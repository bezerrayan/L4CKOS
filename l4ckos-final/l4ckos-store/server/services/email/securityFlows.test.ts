import React from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import emailRoutes from "../../routes/email.routes";
import { buildUnsubscribeToken, buildUnsubscribeUrl, verifyUnsubscribeToken, unsubscribeByToken } from "./emailSubscriptions.js";
import { resolveAnnouncementUrl, resolvePublicApiOrigin } from "./publicUrls";
import { sendLaunchAnnouncementEmail, sendInternalNewSaleAlertEmail, sendInternalLowStockAlertEmail, sendInternalPaymentFailedAlertEmail } from "./emailService.js";
const fixture = vi.hoisted(() => ({ subscriptions: new Map<string, any>(), write: vi.fn(), send: vi.fn(async () => ({ data: { id: "synthetic-provider-id" } })), client: vi.fn() }));
vi.mock("../../db", () => ({
  isEmailUnsubscribed: vi.fn(async email => fixture.subscriptions.has(email)),
  unsubscribeEmail: fixture.write.mockImplementation(async ({ email, reason, source }) => fixture.subscriptions.set(email, { reason, source })),
}));
vi.mock("./resendClient.js", () => ({ getResendClient: () => { fixture.client(); return { emails: { send: fixture.send } }; } }));
beforeEach(() => {
  fixture.subscriptions.clear(); vi.clearAllMocks();
  fixture.write.mockImplementation(async ({ email, reason, source }) => fixture.subscriptions.set(email, { reason, source }));
  vi.stubGlobal("React", React);
  for (const name of ["APP_URL", "APP_BASE_URL", "FRONTEND_URL", "ALERTS_NOTIFICATION_EMAIL", "ORDERS_ALERT_EMAIL", "EMAIL_TO_SALES", "EMAIL_TO_FINANCE", "EMAIL_TO_CONTACT"]) vi.stubEnv(name, "");
  vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", "synthetic-unsubscribe-secret-at-least-32");
  vi.stubEnv("PUBLIC_API_URL", "https://api.fixture.invalid");
  vi.stubEnv("EMAIL_FROM_MARKETING", "sender@example.invalid");
  vi.stubEnv("ORDERS_EMAIL", "sender@example.invalid");
  vi.stubEnv("EMAIL_FROM_FINANCE", "sender@example.invalid");
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function response() { return { status: vi.fn().mockReturnThis(), type: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() }; }
async function handler(token: string) {
  const r = response(); const route = (emailRoutes as any).stack.find((entry: any) => entry.route?.path === "/email/unsubscribe");
  await route.route.stack[0].handle({ query: { token } }, r); return r;
}
describe("unsubscribe origin, templates and handler (synthetic / provider mocked)", () => {
  it("uses the configured backend, preserving the token", () => {
    vi.stubEnv("APP_URL", "https://frontend.fixture.invalid"); const url = new URL(buildUnsubscribeUrl("synthetic@example.invalid"));
    expect(url.origin).toBe("https://api.fixture.invalid"); expect(url.pathname).toBe("/api/email/unsubscribe");
    expect(verifyUnsubscribeToken(url.searchParams.get("token")!)).toBe("synthetic@example.invalid");
  });
  it("renders the backend link in the actual marketing HTML", async () => {
    vi.stubEnv("APP_URL", "https://frontend.fixture.invalid");
    await sendLaunchAnnouncementEmail({ email: "synthetic@example.invalid", name: "Synthetic", couponCode: "TEST", discountPercent: 15 });
    const html = fixture.send.mock.calls[0][0].html;
    expect(html).toContain(buildUnsubscribeUrl("synthetic@example.invalid")); expect(html).not.toContain("https://frontend.fixture.invalid/api/email/unsubscribe");
  });
  it.each(["", "http://api.fixture.invalid", "https://user:password@api.fixture.invalid", "https://api.fixture.invalid/subpath", "https://api.fixture.invalid/?host=evil", "https://api.fixture.invalid/#x", "file:///tmp/x"])("rejects unsafe/missing backend %s before provider", async origin => {
    vi.stubEnv("PUBLIC_API_URL", origin); expect(() => resolvePublicApiOrigin()).toThrow();
    vi.stubEnv("APP_URL", "https://frontend.fixture.invalid");
    await expect(sendLaunchAnnouncementEmail({ email: "synthetic@example.invalid" })).rejects.toThrow(); expect(fixture.send).not.toHaveBeenCalled();
  });
  it("permits HTTP only on explicit loopback in nonproduction", () => {
    vi.stubEnv("PUBLIC_API_URL", "http://localhost:3010"); vi.stubEnv("NODE_ENV", "test"); expect(resolvePublicApiOrigin()).toBe("http://localhost:3010");
    vi.stubEnv("NODE_ENV", "production"); expect(() => resolvePublicApiOrigin()).toThrow();
  });
  it("handles a valid token twice without affecting another subscription", async () => {
    fixture.subscriptions.set("other@example.invalid", { reason: "preserved", source: "fixture" });
    const token = buildUnsubscribeToken("synthetic@example.invalid");
    expect((await handler(token)).status).toHaveBeenCalledWith(200); const snapshot = [...fixture.subscriptions];
    expect((await handler(token)).status).toHaveBeenCalledWith(200); expect([...fixture.subscriptions]).toEqual(snapshot);
    expect(fixture.subscriptions.size).toBe(2);
  });
  it("rejects invalid, tampered, extra-segment and other-context tokens without mutations", async () => {
    const token = buildUnsubscribeToken("synthetic@example.invalid"); const payload = Buffer.from("other@example.invalid").toString("base64url");
    const contextSignature = crypto.createHmac("sha256", process.env.EMAIL_UNSUBSCRIBE_SECRET!).update(`password-reset:${payload}`).digest("base64url");
    for (const value of ["", "invalid", `${token}.extra`, `${payload}.${token.split(".")[1]}`, `${payload}.${contextSignature}`, "synthetic.jwt.signature"]) {
      expect((await handler(value)).status).toHaveBeenCalledWith(400);
    }
    expect(fixture.write).not.toHaveBeenCalled(); expect(fixture.subscriptions.size).toBe(0);
  });
  it("fails closed without a signing secret", async () => {
    const token = buildUnsubscribeToken("synthetic@example.invalid"); vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", ""); vi.stubEnv("JWT_SECRET", "");
    expect(() => buildUnsubscribeToken("synthetic@example.invalid")).toThrow(); await expect(unsubscribeByToken(token)).rejects.toThrow(); expect(fixture.write).not.toHaveBeenCalled();
  });
});
describe("announcement environment defaults", () => {
  it.each(["https://staging.fixture.invalid", "https://production.fixture.invalid"])("uses APP_URL %s in the emitted template", async url => {
    vi.stubEnv("APP_URL", url); expect(resolveAnnouncementUrl()).toBe(`${url}/`);
    await sendLaunchAnnouncementEmail({ email: "synthetic@example.invalid", name: "Synthetic" }); expect(fixture.send.mock.calls[0][0].html).toContain(`${url}/`);
  });
  it("requires configuration or explicit URL without a production fallback", () => {
    expect(() => resolveAnnouncementUrl()).toThrow(); expect(resolveAnnouncementUrl("https://explicit.fixture.invalid/path")).toBe("https://explicit.fixture.invalid/path");
    vi.stubEnv("FRONTEND_URL", "https://staging.fixture.invalid"); expect(resolveAnnouncementUrl()).toBe("https://staging.fixture.invalid/");
  });
});
describe("internal alert recipient", () => {
  const flows = [() => sendInternalNewSaleAlertEmail({ orderNumber: "1", items: [] }), () => sendInternalLowStockAlertEmail({ products: [] }), () => sendInternalPaymentFailedAlertEmail({ orderNumber: "1" })];
  it("fails explicitly before provider when every recipient config is absent", async () => {
    for (const flow of flows) await expect(flow()).rejects.toThrow("Missing env var: ALERTS_NOTIFICATION_EMAIL"); expect(fixture.client).not.toHaveBeenCalled();
  });
  it("uses the configured recipient and preserves existing fallback priority", async () => {
    vi.stubEnv("ALERTS_NOTIFICATION_EMAIL", "synthetic-alert@example.invalid"); vi.stubEnv("ORDERS_ALERT_EMAIL", "synthetic-fallback@example.invalid");
    for (const flow of flows) await flow();
    for (const [payload] of fixture.send.mock.calls) expect(payload.to).toEqual(["synthetic-alert@example.invalid"]);
    fixture.send.mockClear(); vi.stubEnv("ALERTS_NOTIFICATION_EMAIL", ""); await flows[0](); expect(fixture.send.mock.calls[0][0].to).toEqual(["synthetic-fallback@example.invalid"]);
  });
});
