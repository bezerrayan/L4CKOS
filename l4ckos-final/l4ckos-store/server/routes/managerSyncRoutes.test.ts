import { createServer } from "node:http";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import managerSyncRoutes from "./managerSyncRoutes";

const token = "ab".repeat(32);
const env = {
  MANAGER_SYNC_TOKEN: token,
  MANAGER_SYNC_ENVIRONMENT: "staging",
  MANAGER_SYNC_PROJECT_ID: "2bb90c8e-eb65-43ee-826b-f93750f0499c",
  MANAGER_SYNC_ENVIRONMENT_ID: "15545eee-bc02-4b70-afc4-19a5db9e6f46",
  MANAGER_SYNC_SERVICE_ID: "9f1c7705-f2f9-48cf-b957-8f63a6bba4db",
};
const originalEnv = new Map(Object.keys(env).map((key) => [key, process.env[key]]));

async function withRoute(callback: (baseUrl: string) => Promise<void>) {
  const app = express();
  app.use("/api/internal/manager", managerSyncRoutes);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("FIXTURE_SERVER_UNAVAILABLE");
  try { await callback(`http://127.0.0.1:${address.port}/api/internal/manager/sync`); }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

afterEach(() => {
  for (const key of Object.keys(env)) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Manager sync V2 route guards", () => {
  it("rejects missing and invalid bearer tokens before reading the database", async () => {
    Object.assign(process.env, env);
    await withRoute(async (url) => {
      const missing = await fetch(`${url}?periodStart=2026-10-01&periodEndExclusive=2026-11-01`);
      expect(missing.status).toBe(401);
      const invalid = await fetch(`${url}?periodStart=2026-10-01&periodEndExclusive=2026-11-01`, { headers: { authorization: `Bearer ${"cd".repeat(32)}` } });
      expect(invalid.status).toBe(401);
    });
  });

  it("fails closed when source identity is not the authorized staging service", async () => {
    Object.assign(process.env, { ...env, MANAGER_SYNC_ENVIRONMENT: "production" });
    await withRoute(async (url) => {
      const response = await fetch(`${url}?periodStart=2026-10-01&periodEndExclusive=2026-11-01`, { headers: { authorization: `Bearer ${token}` } });
      expect(response.status).toBe(503);
    });
  });

  it("rejects partial months and cursor pagination before database access", async () => {
    Object.assign(process.env, env);
    await withRoute(async (url) => {
      const openMonth = await fetch(`${url}?periodStart=2026-10-01&periodEndExclusive=2026-11-01`, { headers: { authorization: `Bearer ${token}` } });
      expect(openMonth.status).toBe(400);
      expect((await openMonth.json()).code).toBe("SYNC_PERIOD_NOT_CLOSED");
      const partial = await fetch(`${url}?periodStart=2026-10-02&periodEndExclusive=2026-11-01`, { headers: { authorization: `Bearer ${token}` } });
      expect(partial.status).toBe(400);
      const closedMonth = await fetch(`${url}?periodStart=2026-09-01&periodEndExclusive=2026-10-01&after=2026-09-24T00%3A00%3A00Z`, { headers: { authorization: `Bearer ${token}` } });
      expect(closedMonth.status).toBe(400);
      const cursor = await fetch(`${url}?periodStart=2026-10-01&periodEndExclusive=2026-11-01&after=2026-10-24T00%3A00%3A00Z`, { headers: { authorization: `Bearer ${token}` } });
      expect(cursor.status).toBe(400);
    });
  });
});
