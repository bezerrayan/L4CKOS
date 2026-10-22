import { describe, expect, it, vi } from "vitest";
import {
  ASAAS_WEBHOOK_INBOUND_ENABLED_ENV,
  ASAAS_WEBHOOK_INBOUND_PATHS,
  createAsaasWebhookInboundGate,
  resolveAsaasWebhookInboundEnabled,
} from "./asaasWebhookIngress";

function invokeGate(
  enabled: boolean,
  method: string,
  path: string,
  downstream: () => void
) {
  const req = { method, path, originalUrl: path } as any;
  const res = {
    headers: {} as Record<string, string>,
    statusCode: 200,
    body: undefined as unknown,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  const next = vi.fn(downstream);

  createAsaasWebhookInboundGate(enabled)(req, res as any, next);
  return { res, next };
}

describe("Asaas inbound webhook gate", () => {
  it("defaults disabled in staging, independent of NODE_ENV", () => {
    expect(
      resolveAsaasWebhookInboundEnabled({
        APP_ENV: "staging",
        NODE_ENV: "production",
      })
    ).toBe(false);
    expect(
      resolveAsaasWebhookInboundEnabled({
        APP_ENV: "staging",
        NODE_ENV: "production",
        [ASAAS_WEBHOOK_INBOUND_ENABLED_ENV]: "false",
      })
    ).toBe(false);
  });

  it.each(ASAAS_WEBHOOK_INBOUND_PATHS)(
    "rejects %s before invoking webhook, database, queue, provider, or financial handlers",
    path => {
      const effects = {
        receiveWebhook: vi.fn(),
        persist: vi.fn(),
        claim: vi.fn(),
        queryAsaas: vi.fn(),
        mutateOrderOrStock: vi.fn(),
      };
      const downstream = vi.fn(() => {
        effects.receiveWebhook();
        effects.persist();
        effects.claim();
        effects.queryAsaas();
        effects.mutateOrderOrStock();
      });

      const { res, next } = invokeGate(false, "POST", path, downstream);

      expect(res.statusCode).toBe(503);
      expect(res.body).toEqual(
        expect.objectContaining({
          success: false,
          code: "ASAAS_WEBHOOK_INBOUND_DISABLED",
        })
      );
      expect(res.headers["Cache-Control"]).toBe("no-store");
      expect(next).not.toHaveBeenCalled();
      for (const effect of Object.values(effects))
        expect(effect).not.toHaveBeenCalled();
    }
  );

  it("also blocks Express-equivalent case and trailing-slash aliases", () => {
    for (const path of ["/API/WEBHOOKS/ASAAS/", "/Webhook/Asaas/"]) {
      const downstream = vi.fn();
      const { res, next } = invokeGate(false, "POST", path, downstream);
      expect(res.statusCode).toBe(503);
      expect(next).not.toHaveBeenCalled();
      expect(downstream).not.toHaveBeenCalled();
    }
  });

  it("fails startup configuration closed for an invalid value", () => {
    expect(() =>
      resolveAsaasWebhookInboundEnabled({
        APP_ENV: "staging",
        [ASAAS_WEBHOOK_INBOUND_ENABLED_ENV]: "yes",
      })
    ).toThrow(
      `INVALID_ASAAS_WEBHOOK_INBOUND_FLAG:${ASAAS_WEBHOOK_INBOUND_ENABLED_ENV}`
    );
  });

  it("passes through only with explicit staging enablement, leaving the existing auth and handler intact", () => {
    expect(
      resolveAsaasWebhookInboundEnabled({
        APP_ENV: "staging",
        [ASAAS_WEBHOOK_INBOUND_ENABLED_ENV]: "true",
      })
    ).toBe(true);

    for (const path of ASAAS_WEBHOOK_INBOUND_PATHS) {
      const downstream = vi.fn();
      const { res, next } = invokeGate(true, "POST", path, downstream);
      expect(res.statusCode).toBe(200);
      expect(next).toHaveBeenCalledOnce();
      expect(downstream).toHaveBeenCalledOnce();
    }
  });

  it("preserves prior non-staging defaults and does not gate health, storefront, admin, or non-POST methods", () => {
    expect(
      resolveAsaasWebhookInboundEnabled({
        APP_ENV: "production",
        NODE_ENV: "production",
      })
    ).toBe(true);
    expect(resolveAsaasWebhookInboundEnabled({ NODE_ENV: "production" })).toBe(
      true
    );

    for (const [method, path] of [
      ["GET", "/health"],
      ["GET", "/api/products"],
      ["GET", "/api/trpc/admin.dashboard"],
      ["GET", "/api/webhooks/asaas"],
    ]) {
      const downstream = vi.fn();
      const { next } = invokeGate(false, method, path, downstream);
      expect(next).toHaveBeenCalledOnce();
      expect(downstream).toHaveBeenCalledOnce();
    }
  });
});
