import { afterEach, describe, expect, it, vi } from "vitest";

const handlers = vi.hoisted(() => ({
  createCheckoutHandler: vi.fn((_req: unknown, res: any) => res.status(201).end("checkout-handler-called")),
  createCustomerHandler: vi.fn((_req: unknown, res: any) => res.status(201).end("customer-handler-called")),
  requireAuthenticatedUser: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("../controllers/paymentController", () => ({
  createCheckoutHandler: handlers.createCheckoutHandler,
  createCustomerHandler: handlers.createCustomerHandler,
}));

vi.mock("../_core/httpAuth", () => ({
  requireAuthenticatedUser: handlers.requireAuthenticatedUser,
}));

import paymentRoutes from "./paymentRoutes";

describe("payment routes checkout gate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it.each(["/create-checkout", "/create-customer"])(
    "blocks an authenticated POST to %s before auth handlers or provider handlers when flags are absent",
    async path => {
      vi.stubEnv("PUBLIC_SITE_MODE", "");
      vi.stubEnv("PUBLIC_CHECKOUT_ENABLED", "");

      const routeLayer = (paymentRoutes as any).stack.find((layer: any) =>
        layer.route?.path === path && layer.route?.methods?.post,
      );
      expect(routeLayer).toBeDefined();
      const routeHandlers = routeLayer.route.stack as Array<{ handle: Function }>;
      expect(routeHandlers[1].handle).toBe(handlers.requireAuthenticatedUser);

      const req = {
        method: "POST",
        path: `/api/payments${path}`,
        authUser: {
          id: 41,
          role: "user",
          email: "buyer@example.test",
        },
      } as any;
      const responseBody = vi.fn();
      const res = { status: vi.fn().mockReturnThis(), json: responseBody } as any;
      const next = vi.fn();

      routeHandlers[0].handle(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(responseBody).toHaveBeenCalledWith(expect.objectContaining({ code: "PUBLIC_CHECKOUT_DISABLED", status: 403 }));
      expect(next).not.toHaveBeenCalled();
      expect(handlers.requireAuthenticatedUser).not.toHaveBeenCalled();
      expect(handlers.createCheckoutHandler).not.toHaveBeenCalled();
      expect(handlers.createCustomerHandler).not.toHaveBeenCalled();
    },
  );
});
