import { afterEach, describe, expect, it, vi } from "vitest";
import { requireAuthenticatedUser } from "../_core/httpAuth";
import { requirePublicCheckoutEnabled } from "../_core/publicStore";

const handlers = vi.hoisted(() => ({
  createCheckoutHandler: vi.fn(),
  createCustomerHandler: vi.fn(),
  asaasWebhookHandler: vi.fn(),
  createWaitlistEntry: vi.fn((_req: unknown, res: any) => res.status(201).json({ accepted: true })),
}));

vi.mock("../controllers/paymentController", () => ({
  createCheckoutHandler: handlers.createCheckoutHandler,
  createCustomerHandler: handlers.createCustomerHandler,
  asaasWebhookHandler: handlers.asaasWebhookHandler,
}));
vi.mock("../controllers/waitlist.controller", () => ({ createWaitlistEntry: handlers.createWaitlistEntry }));

import paymentRoutes from "./paymentRoutes";
import waitlistRoutes from "./waitlist.routes";
import webhookRoutes from "./webhookRoutes";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function routeHandlers(router: any, routePath: string) {
  const route = router.stack.find((layer: any) => layer.route?.path === routePath)?.route;
  if (!route) throw new Error(`Route not found: ${routePath}`);
  return route.stack.map((layer: any) => layer.handle);
}

describe("REST route boundaries for Coming Soon", () => {
  it("puts the store gate before auth and payment handlers on both commercial endpoints", async () => {
    for (const [routePath, endpoint] of [
      ["/create-customer", handlers.createCustomerHandler],
      ["/create-checkout", handlers.createCheckoutHandler],
    ] as const) {
      expect(routeHandlers(paymentRoutes, routePath)).toEqual([
        requirePublicCheckoutEnabled,
        requireAuthenticatedUser,
        endpoint,
      ]);
    }

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PUBLIC_SITE_MODE", "coming-soon");
    const response = {
      status: vi.fn().mockReturnThis(),
      type: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();
    requirePublicCheckoutEnabled({} as any, response as any, next);

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ code: "PUBLIC_STORE_CLOSED" }));
    expect(next).not.toHaveBeenCalled();
    expect(handlers.createCustomerHandler).not.toHaveBeenCalled();
    expect(handlers.createCheckoutHandler).not.toHaveBeenCalled();
  });

  it("blocks provider-side endpoints in a store-mode production staging deployment when checkout is disabled", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PUBLIC_SITE_MODE", "store");
    vi.stubEnv("PUBLIC_CHECKOUT_ENABLED", "false");
    const response = { status: vi.fn().mockReturnThis(), type: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    requirePublicCheckoutEnabled({} as any, response as any, next);

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ code: "PUBLIC_CHECKOUT_DISABLED" }));
    expect(next).not.toHaveBeenCalled();
  });

  it("keeps the Asaas webhook route outside the public checkout gate", () => {
    expect(routeHandlers(webhookRoutes, "/asaas")).toEqual([handlers.asaasWebhookHandler]);
  });

  it("leaves the public waitlist route outside the commercial gate", () => {
    const [waitlistHandler] = routeHandlers(waitlistRoutes, "/waitlist");
    expect(waitlistHandler).toBe(handlers.createWaitlistEntry);

    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    waitlistHandler({ body: { email: "preview@example.invalid" } }, response);

    expect(response.status).toHaveBeenCalledWith(201);
    expect(response.json).toHaveBeenCalledWith({ accepted: true });
    expect(handlers.createWaitlistEntry).toHaveBeenCalledOnce();
  });
});
