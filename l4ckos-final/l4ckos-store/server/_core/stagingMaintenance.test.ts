import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { describe, expect, it } from "vitest";
import {
  createStagingMaintenanceMiddleware,
  isStagingMaintenanceEnabled,
} from "./stagingMaintenance";

const stagingEnv = {
  NODE_ENV: "production",
  STAGING_MAINTENANCE_MODE: "true",
  RAILWAY_PROJECT_ID: "2bb90c8e-eb65-43ee-826b-f93750f0499c",
  RAILWAY_ENVIRONMENT_ID: "15545eee-bc02-4b70-afc4-19a5db9e6f46",
  RAILWAY_SERVICE_ID: "9f1c7705-f2f9-48cf-b957-8f63a6bba4db",
};

async function withServer(
  env: Record<string, string | undefined>,
  check: (base: string, requestsHandled: () => number) => Promise<void>,
) {
  const app = express();
  let handled = 0;

  // Same ordering as the real backend.
  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true, service: "backend" });
  });

  app.use(createStagingMaintenanceMiddleware(env));

  app.use((_req, res) => {
    handled++;
    res.status(200).json({ handled: true });
  });

  const server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;

  try {
    await check(
      `http://127.0.0.1:${address.port}`,
      () => handled,
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}

describe("staging maintenance", () => {
  it("permite ativação somente na identidade exata do staging", () => {
    expect(isStagingMaintenanceEnabled(stagingEnv)).toBe(true);

    for (const [key, value] of [
      ["STAGING_MAINTENANCE_MODE", "false"],
      ["NODE_ENV", "development"],
      ["RAILWAY_PROJECT_ID", "outro-projeto"],
      ["RAILWAY_ENVIRONMENT_ID", "outro-ambiente"],
      ["RAILWAY_SERVICE_ID", "outro-servico"],
    ]) {
      expect(isStagingMaintenanceEnabled({
        ...stagingEnv,
        [key]: value,
      })).toBe(false);
    }
  });

  it("preserva health e bloqueia rotas de escrita e leitura", async () => {
    await withServer(stagingEnv, async (base, handled) => {
      const health = await fetch(`${base}/health`);
      expect(health.status).toBe(200);
      expect((await health.json()).service).toBe("backend");

      const routes = [
        ["GET", "/"],
        ["POST", "/api/payments/create-checkout"],
        ["POST", "/api/webhooks/asaas"],
        ["POST", "/webhook/asaas"],
        ["POST", "/api/trpc/orders.create"],
        ["PUT", "/api/trpc/admin.update"],
        ["POST", "/api/upload"],
        ["OPTIONS", "/api/payments/create-checkout"],
      ];

      for (const [method, route] of routes) {
        const response = await fetch(base + route, { method });
        expect(response.status, `${method} ${route}`).toBe(503);
        expect(response.headers.get("retry-after")).toBe("120");
        expect((await response.json()).code)
          .toBe("STAGING_MAINTENANCE");
      }

      expect(handled()).toBe(0);
    });
  });

  it("não afeta o funcionamento normal quando desativado", async () => {
    await withServer({
      ...stagingEnv,
      STAGING_MAINTENANCE_MODE: "false",
    }, async (base, handled) => {
      const response = await fetch(`${base}/api/payments/create-checkout`, {
        method: "POST",
      });

      expect(response.status).toBe(200);
      expect(handled()).toBe(1);
    });
  });

  it("não permite ativação fora do projeto staging", async () => {
    await withServer({
      ...stagingEnv,
      RAILWAY_PROJECT_ID: "projeto-diferente",
    }, async (base, handled) => {
      const response = await fetch(`${base}/api/trpc/admin.update`, {
        method: "POST",
        headers: {
          "x-railway-project-id": stagingEnv.RAILWAY_PROJECT_ID,
        },
      });

      expect(response.status).toBe(200);
      expect(handled()).toBe(1);
    });
  });
});
