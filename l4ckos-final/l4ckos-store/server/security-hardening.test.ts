import { describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { getAllowedMethodsForApiPath, API_NOT_FOUND_RESPONSE } from "./_core/httpApi";
import { hasForbiddenClientPaymentField } from "./controllers/paymentController";
import { createApiCorsOptions, getAllowedOrigins, isAllowedOrigin } from "./_core/corsPolicy";
import { getSessionCookieOptions } from "./_core/cookies";
import { isKnownClientRoute } from "./_core/vite";

process.env.JWT_SECRET = "test-secret-with-at-least-thirty-two-characters";
process.env.JWT_ISSUER = "l4ckos-test";
process.env.JWT_AUDIENCE = "l4ckos-test-web";
process.env.ADMIN_EMAILS = "admin@example.com";

vi.mock("./db", () => ({
  getOrderByAsaasCheckoutId: vi.fn(),
  getOrderById: vi.fn(),
  getOrderReservationItems: vi.fn(),
  getOrderByIdAndUser: vi.fn(),
  markOrderPaid: vi.fn(),
  getUserByOpenId: vi.fn(),
  upsertUser: vi.fn(),
  getUserById: vi.fn(),
  getUserPhoneById: vi.fn(),
  setOrderAsaasCheckoutId: vi.fn(),
  updateUserAsaasCustomerId: vi.fn(),
  runAsaasWebhookOnce: vi.fn(async (_input, handler) => ({ duplicate: false, result: await handler() })),
}));

vi.mock("./services/asaasService", async () => {
  const actual = await vi.importActual<typeof import("./services/asaasService")>("./services/asaasService");
  return {
    ...actual,
    createAsaasCheckout: vi.fn(),
    createAsaasCustomer: vi.fn(),
    getAsaasPayment: vi.fn(),
  };
});

vi.mock("./services/emailService.js", () => ({
  sendInternalLowStockAlertEmail: vi.fn(),
  sendInternalNewSaleAlertEmail: vi.fn(),
  sendInternalPaymentFailedAlertEmail: vi.fn(),
  sendPaymentApprovedEmail: vi.fn(),
  sendPaymentFailedEmail: vi.fn(),
  sendWelcomeAccountEmail: vi.fn(),
}));

describe("security hardening contracts", () => {
  it("uses a JSON API 404 contract", () => {
    expect(API_NOT_FOUND_RESPONSE).toEqual({
      error: "ROUTE_NOT_FOUND",
      message: "Route not found",
    });
  });

  it("declares 405 methods for known API routes", () => {
    expect(getAllowedMethodsForApiPath("/api/payments/create-checkout")).toEqual(["POST"]);
    expect(getAllowedMethodsForApiPath("/api/cep/70000000")).toEqual(["GET"]);
    expect(getAllowedMethodsForApiPath("/api/trpc/admin.dashboard")).toEqual(["GET", "POST"]);
    expect(getAllowedMethodsForApiPath("/api/unknown")).toBeNull();
  });

  it("rejects client-controlled payment fields", () => {
    expect(hasForbiddenClientPaymentField({ orderId: 1, redirectUrl: "https://l4ckos.com.br/checkout" })).toBe(false);
    expect(hasForbiddenClientPaymentField({ orderId: 1, totalPrice: 1 })).toBe(true);
    expect(hasForbiddenClientPaymentField({ orderId: 1, paymentStatus: "paid" })).toBe(true);
    expect(hasForbiddenClientPaymentField({ orderId: 1, customer: { status: "paid" } })).toBe(true);
    expect(hasForbiddenClientPaymentField({ items: [{ productId: 1, price: 1 }] })).toBe(true);
  });

  it("maps missing auth, forbidden admin, admin success and ownership checks", async () => {
    const { requireAuth, requireRole, requireOwnershipOrRole } = await import("./_core/authz");

    expect(() => requireAuth(null)).toThrow(TRPCError);
    try {
      requireAuth(null);
    } catch (error) {
      expect(error).toBeInstanceOf(TRPCError);
      expect((error as TRPCError).code).toBe("UNAUTHORIZED");
    }

    try {
      requireRole({ id: 1, openId: "user-1", email: "user@example.com", role: "user" } as any, "admin");
    } catch (error) {
      expect(error).toBeInstanceOf(TRPCError);
      expect((error as TRPCError).code).toBe("FORBIDDEN");
    }

    const admin = { id: 2, openId: "admin-openid", email: "admin@example.com", role: "admin" } as any;
    expect(requireRole(admin, "admin")).toBe(admin);
    expect(requireOwnershipOrRole({ id: 3, openId: "user-3", email: "u@example.com", role: "user" } as any, { userId: 3 }, "admin")).toEqual({ userId: 3 });

    try {
      requireOwnershipOrRole({ id: 3, openId: "user-3", email: "u@example.com", role: "user" } as any, { userId: 4 }, "admin");
    } catch (error) {
      expect(error).toBeInstanceOf(TRPCError);
      expect((error as TRPCError).code).toBe("FORBIDDEN");
    }
  });

  it("does not grant Google admin role to unverified email", async () => {
    const { getGoogleRoleForUserInfo } = await import("./_core/oauth");

    expect(getGoogleRoleForUserInfo({ openId: "google-user", email: "admin@example.com", emailVerified: false })).toBe("user");
    expect(getGoogleRoleForUserInfo({ openId: "google-user", email: "admin@example.com", emailVerified: true })).toBe("admin");
  });

  it("validates JWT expiry, algorithm, issuer and audience explicitly", async () => {
    const { sdk } = await import("./_core/sdk");
    const { SignJWT } = await import("jose");
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);

    const valid = await sdk.createSessionToken("user-openid", {
      name: "User",
      expiresInMs: 60_000,
      sessionVersion: 7,
    });
    await expect(sdk.verifySession(valid)).resolves.toMatchObject({
      openId: "user-openid",
      appId: "loja-escoteira",
      name: "User",
      sessionVersion: 7,
    });

    await expect(sdk.verifySession("not-a-jwt")).resolves.toBeNull();

    const expired = await new SignJWT({ openId: "user-openid", appId: "loja-escoteira", name: "User", sessionVersion: 1 })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer("l4ckos-test")
      .setAudience("l4ckos-test-web")
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(secret);
    await expect(sdk.verifySession(expired)).resolves.toBeNull();

    const wrongAlgorithm = await new SignJWT({ openId: "user-openid", appId: "loja-escoteira", name: "User", sessionVersion: 1 })
      .setProtectedHeader({ alg: "HS384", typ: "JWT" })
      .setIssuer("l4ckos-test")
      .setAudience("l4ckos-test-web")
      .setExpirationTime(Math.floor(Date.now() / 1000) + 60)
      .sign(secret);
    await expect(sdk.verifySession(wrongAlgorithm)).resolves.toBeNull();

    const wrongIssuer = await new SignJWT({ openId: "user-openid", appId: "loja-escoteira", name: "User", sessionVersion: 1 })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer("wrong-issuer")
      .setAudience("l4ckos-test-web")
      .setExpirationTime(Math.floor(Date.now() / 1000) + 60)
      .sign(secret);
    await expect(sdk.verifySession(wrongIssuer)).resolves.toBeNull();

    const wrongAudience = await new SignJWT({ openId: "user-openid", appId: "loja-escoteira", name: "User", sessionVersion: 1 })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer("l4ckos-test")
      .setAudience("wrong-audience")
      .setExpirationTime(Math.floor(Date.now() / 1000) + 60)
      .sign(secret);
    await expect(sdk.verifySession(wrongAudience)).resolves.toBeNull();
  });

  it("rejects removed, blocked and session-version mismatched users during authenticated access", async () => {
    const db = await import("./db");
    const { sdk } = await import("./_core/sdk");
    const token = await sdk.createSessionToken("user-openid", {
      name: "User",
      expiresInMs: 60_000,
      sessionVersion: 3,
    });
    const req = { headers: { cookie: `app_session_id=${token}` } } as any;

    vi.mocked(db.getUserByOpenId).mockResolvedValueOnce(undefined as any);
    await expect(sdk.authenticateRequest(req)).rejects.toThrow();

    vi.mocked(db.getUserByOpenId).mockResolvedValueOnce({ id: 1, openId: "user-openid", isBlocked: 1, sessionVersion: 3 } as any);
    await expect(sdk.authenticateRequest(req)).rejects.toThrow();

    vi.mocked(db.getUserByOpenId).mockResolvedValueOnce({ id: 1, openId: "user-openid", isBlocked: 0, sessionVersion: 4 } as any);
    await expect(sdk.authenticateRequest(req)).rejects.toThrow();
  });

  it("validates CSRF absent, invalid, valid and webhook-exempt requests", async () => {
    const { createCsrfToken, shouldRequireCsrf, validateCsrfRequest } = await import("./_core/csrf");
    const token = createCsrfToken();

    expect(shouldRequireCsrf({
      method: "POST",
      path: "/api/trpc/cart.add",
      headers: { cookie: "app_session_id=session" },
    } as any)).toBe(true);
    expect(validateCsrfRequest({
      headers: { cookie: "app_session_id=session" },
    } as any)).toBe(false);
    expect(validateCsrfRequest({
      headers: {
        cookie: `app_session_id=session; l4ckos_csrf=${token}`,
        "x-csrf-token": "invalid",
      },
    } as any)).toBe(false);
    expect(validateCsrfRequest({
      headers: {
        cookie: `app_session_id=session; l4ckos_csrf=${token}`,
        "x-csrf-token": token,
      },
    } as any)).toBe(true);
    expect(shouldRequireCsrf({
      method: "POST",
      path: "/api/webhooks/asaas",
      headers: {},
    } as any)).toBe(false);
  });

  it("sets secure cookie flags when the request is HTTPS behind a proxy", () => {
    const options = getSessionCookieOptions({
      protocol: "http",
      headers: { "x-forwarded-proto": "https" },
    } as any);

    expect(options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
  });

  it("allows configured CORS origins and rejects invalid ones", () => {
    const prodOrigins = getAllowedOrigins({ isProduction: true });
    expect(prodOrigins).toEqual(["https://l4ckos.com.br", "https://www.l4ckos.com.br"]);
    expect(isAllowedOrigin(undefined, { isProduction: true, allowedOrigins: prodOrigins })).toBe(true);
    expect(isAllowedOrigin("https://l4ckos.com.br", { isProduction: true, allowedOrigins: prodOrigins })).toBe(true);
    expect(isAllowedOrigin("http://l4ckos.com.br", { isProduction: true, allowedOrigins: prodOrigins })).toBe(false);
    expect(isAllowedOrigin("https://evil.example", { isProduction: true, allowedOrigins: prodOrigins })).toBe(false);
    expect(isAllowedOrigin("http://localhost:5173", { isProduction: false, allowedOrigins: getAllowedOrigins({ isProduction: false }) })).toBe(true);
  });

  it("sends CORS credentials and exact origin for GET /api/csrf from allowed origins", async () => {
    await withCorsTestServer(async baseUrl => {
      for (const origin of ["https://l4ckos.com.br", "https://www.l4ckos.com.br"]) {
        const response = await fetch(`${baseUrl}/api/csrf`, {
          headers: { Origin: origin, "x-forwarded-proto": "https" },
        });

        expect(response.status).toBe(200);
        expect(response.headers.get("access-control-allow-origin")).toBe(origin);
        expect(response.headers.get("access-control-allow-credentials")).toBe("true");
        expect(response.headers.get("access-control-allow-origin")).not.toBe("*");
        expect(response.headers.get("cache-control")).toBe("no-store, private");
        expect(response.headers.get("set-cookie")).toContain("l4ckos_csrf=");
        expect(response.headers.get("set-cookie")).toContain("Secure");
      }
    });
  });

  it("blocks GET /api/csrf from disallowed origins without wildcard credentials", async () => {
    await withCorsTestServer(async baseUrl => {
      const response = await fetch(`${baseUrl}/api/csrf`, {
        headers: { Origin: "https://evil.example" },
      });

      expect(response.status).toBe(403);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    });
  });

  it("accepts OPTIONS preflight with content-type and x-csrf-token for mutating requests", async () => {
    await withCorsTestServer(async baseUrl => {
      const response = await fetch(`${baseUrl}/api/trpc/cart.add`, {
        method: "OPTIONS",
        headers: {
          Origin: "https://l4ckos.com.br",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type,x-csrf-token",
        },
      });

      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe("https://l4ckos.com.br");
      expect(response.headers.get("access-control-allow-credentials")).toBe("true");
      expect(response.headers.get("access-control-allow-origin")).not.toBe("*");
      expect(response.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("x-csrf-token");
      expect(response.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("content-type");
    });
  });

  it("keeps valid React Router direct routes and marks unknown routes as 404 candidates", () => {
    expect(isKnownClientRoute("/entrar")).toBe(true);
    expect(isKnownClientRoute("/gestao")).toBe(true);
    expect(isKnownClientRoute("/produto/123")).toBe(true);
    expect(isKnownClientRoute("/meus-pedidos/123")).toBe(true);
    expect(isKnownClientRoute("/definitivamente-nao-existe")).toBe(false);
  });

  it("validates Asaas webhook token without accepting missing or wrong tokens in production", async () => {
    const { validateAsaasWebhookSignature } = await import("./services/asaasService");
    const previousToken = process.env.ASAAS_WEBHOOK_TOKEN;
    const previousEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    process.env.ASAAS_WEBHOOK_TOKEN = "webhook-token-123";

    expect(validateAsaasWebhookSignature({ "asaas-access-token": "webhook-token-123" })).toBe(true);
    expect(validateAsaasWebhookSignature({ "asaas-access-token": "wrong-token" })).toBe(false);
    expect(validateAsaasWebhookSignature({})).toBe(false);

    process.env.ASAAS_WEBHOOK_TOKEN = previousToken;
    process.env.NODE_ENV = previousEnv;
  });

  it("does not repeat Asaas webhook side effects for duplicate events", async () => {
    const db = await import("./db");
    const { asaasWebhookHandler } = await import("./controllers/paymentController");
    const previousToken = process.env.ASAAS_WEBHOOK_TOKEN;
    const previousEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    process.env.ASAAS_WEBHOOK_TOKEN = "webhook-token-123";

    vi.mocked(db.getOrderById).mockResolvedValue({ id: 10, userId: 1, status: "pending", totalPrice: 1000 } as any);
    vi.mocked(db.runAsaasWebhookOnce).mockResolvedValueOnce({ duplicate: true });

    const res = createMockResponse();
    await asaasWebhookHandler({
      ip: "127.0.0.1",
      headers: { "asaas-access-token": "webhook-token-123" },
      body: {
        id: "evt-duplicate",
        event: "PAYMENT_RECEIVED",
        payment: { id: "pay_1", externalReference: "10", value: 10, status: "RECEIVED" },
      },
    } as any, res as any);

    expect(db.markOrderPaid).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ handled: false, reason: "duplicate_event" });

    process.env.ASAAS_WEBHOOK_TOKEN = previousToken;
    process.env.NODE_ENV = previousEnv;
  });

  it("serializes concurrent Asaas webhook attempts through the idempotency adapter", async () => {
    const db = await import("./db");
    const { asaasWebhookHandler } = await import("./controllers/paymentController");
    const previousToken = process.env.ASAAS_WEBHOOK_TOKEN;
    const previousEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    process.env.ASAAS_WEBHOOK_TOKEN = "webhook-token-123";

    const inFlight = new Set<string>();
    vi.mocked(db.getOrderById).mockResolvedValue({ id: 11, userId: 1, status: "pending", totalPrice: 1000 } as any);
    vi.mocked(db.markOrderPaid).mockResolvedValue({ updated: true, lowStockProducts: [] } as any);
    vi.mocked(db.getUserById).mockResolvedValue({ id: 1, email: "user@example.com", name: "User" } as any);
    vi.mocked(db.getOrderReservationItems).mockResolvedValue([]);
    vi.mocked(db.runAsaasWebhookOnce).mockImplementation(async (input: any, handler: any) => {
      if (inFlight.has(input.eventId)) return { duplicate: true };
      inFlight.add(input.eventId);
      const result = await handler();
      return { duplicate: false, result };
    });

    const request = {
      ip: "127.0.0.1",
      headers: { "asaas-access-token": "webhook-token-123" },
      body: {
        id: "evt-concurrent",
        event: "PAYMENT_RECEIVED",
        payment: { id: "pay_2", externalReference: "11", value: 10, status: "RECEIVED" },
      },
    } as any;
    const first = createMockResponse();
    const second = createMockResponse();
    await Promise.all([asaasWebhookHandler(request, first as any), asaasWebhookHandler(request, second as any)]);

    expect(db.markOrderPaid).toHaveBeenCalledTimes(1);
    expect(db.markOrderPaid).toHaveBeenCalledWith(11, {
      source: "asaas_webhook",
      reference: "evt-concurrent",
    });
    expect([first.body?.reason, second.body?.reason]).toContain("duplicate_event");

    process.env.ASAAS_WEBHOOK_TOKEN = previousToken;
    process.env.NODE_ENV = previousEnv;
  });
});

function createMockResponse() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
    type() {
      return this;
    },
  };
}

async function withCorsTestServer(run: (baseUrl: string) => Promise<void>) {
  const app = express();
  const allowedOrigins = getAllowedOrigins({ isProduction: true });

  app.use(
    "/api",
    cors(createApiCorsOptions({ isProduction: true, allowedOrigins })),
  );
  app.use("/api", (err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof Error && err.message === "Origin not allowed by CORS") {
      res.status(403).json({ code: "CORS_ORIGIN_DENIED" });
      return;
    }
    next(err);
  });
  app.get("/api/csrf", (_req, res) => {
    res.cookie("l4ckos_csrf", "test-token", {
      httpOnly: false,
      path: "/",
      sameSite: "lax",
      secure: true,
    });
    res.setHeader("Cache-Control", "no-store, private");
    res.status(200).json({ csrfToken: "test-token" });
  });

  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Failed to start test server");
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
