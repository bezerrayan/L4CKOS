import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { assertStagingIdentity } from "./guard.mjs";
import { handleMaintenanceRequest } from "./http.mjs";

const staging = {
  NODE_ENV: "production",
  RAILWAY_PROJECT_ID: "2bb90c8e-eb65-43ee-826b-f93750f0499c",
  RAILWAY_ENVIRONMENT_ID: "15545eee-bc02-4b70-afc4-19a5db9e6f46",
  RAILWAY_SERVICE_ID: "9f1c7705-f2f9-48cf-b957-8f63a6bba4db",
};

test("identidade exata do staging", () => {
  assert.doesNotThrow(() => assertStagingIdentity(staging));

  for (const key of Object.keys(staging)) {
    assert.throws(
      () => assertStagingIdentity({
        ...staging,
        [key]: "outro-valor",
      }),
      /STAGING_IDENTITY_MISMATCH/,
    );
  }

  assert.throws(
    () => assertStagingIdentity({}),
    /STAGING_IDENTITY_MISMATCH/,
  );
});

test("health acessível e demais rotas bloqueadas", async () => {
  const server = createServer(handleMaintenanceRequest);

  await new Promise(resolve => {
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    const base = `http://127.0.0.1:${address.port}`;

    for (const method of ["GET", "HEAD"]) {
      const res = await fetch(`${base}/health`, { method });
      assert.equal(res.status, 200);
    }

    const blocked = [
      ["GET", "/"],
      ["GET", "/api/trpc/products.list"],
      ["POST", "/api/trpc/admin.update"],
      ["POST", "/api/payments/create-checkout"],
      ["POST", "/api/webhooks/asaas"],
      ["POST", "/webhook/asaas"],
      ["POST", "/api/upload"],
      ["OPTIONS", "/api/trpc"],
      ["POST", "/health"],
    ];

    for (const [method, route] of blocked) {
      const res = await fetch(base + route, {
        method,
        headers: {
          "x-railway-project-id": staging.RAILWAY_PROJECT_ID,
        },
      });

      assert.equal(res.status, 503, `${method} ${route}`);
      assert.equal(res.headers.get("retry-after"), "120");

      const body = await res.json();
      assert.equal(body.code, "STAGING_MAINTENANCE");
    }
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
