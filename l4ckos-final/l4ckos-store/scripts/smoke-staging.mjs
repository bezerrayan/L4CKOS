import "dotenv/config";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";

const read = name => String(process.env[name] ?? "").trim();
const baseUrl = (read("STAGING_BACKEND_URL") || read("API_PUBLIC_URL")).replace(/\/+$/, "");
if (read("APP_ENV") !== "staging") throw new Error("SMOKE_REFUSED: APP_ENV must be staging");
if (!baseUrl || new URL(baseUrl).origin === read("PRODUCTION_API_ORIGIN")) throw new Error("SMOKE_REFUSED: isolated staging backend URL is required");

const results = [];
function record(name, status, detail) { results.push({ name, status, detail }); }
function assert(condition, message) { if (!condition) throw new Error(message); }

async function checkedFetch(name, pathname, options, expectedStatus) {
  const response = await fetch(`${baseUrl}${pathname}`, { ...options, signal: AbortSignal.timeout(15_000) });
  assert(response.status === expectedStatus, `${name}: expected ${expectedStatus}, got ${response.status}`);
  record(name, "PASS", `HTTP ${response.status}`);
  return response;
}

function authenticatedClient() {
  let cookie = "";
  const client = createTRPCProxyClient({
    links: [httpBatchLink({
      url: `${baseUrl}/api/trpc`,
      transformer: superjson,
      async fetch(url, options) {
        const headers = new Headers(options?.headers);
        if (cookie) headers.set("cookie", cookie);
        const response = await fetch(url, { ...options, headers, signal: AbortSignal.timeout(20_000) });
        const setCookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
        if (setCookies.length) cookie = setCookies.map(value => value.split(";", 1)[0]).join("; ");
        return response;
      },
    })],
  });
  return client;
}

try {
  const health = await checkedFetch("health", "/health", {}, 200).then(response => response.json());
  assert(health.environment === "staging" && health.commit && health.version, "health does not identify staging build");
  const version = await checkedFetch("version", "/version", {}, 200).then(response => response.json());
  assert(version.commit === health.commit, "health/version commit mismatch");
  const readiness = await checkedFetch("readiness", "/ready", {}, 200).then(response => response.json());
  assert(readiness.components?.database?.status === "up" && readiness.components?.schema?.status === "up" && readiness.components?.environment?.status === "up", "readiness components are not healthy");

  const anonymous = authenticatedClient();
  const runtime = await anonymous.system.runtime.query();
  assert(runtime.environment === "staging", "runtime environment mismatch");
  const products = await anonymous.products.list.query({ limit: 100 });
  assert(products.length >= 4, "controlled product fixtures are missing");
  record("catalog", "PASS", `${products.length} products`);
  let variantProduct = null;
  for (const product of products) {
    const detail = await anonymous.products.getById.query(product.id);
    if (detail.variants?.length) { variantProduct = detail; break; }
  }
  assert(variantProduct?.variants?.length, "variant fixture is missing");
  record("variants", "PASS", `${variantProduct.variants.length} variants`);

  const client = authenticatedClient();
  await client.auth.localLogin.mutate({ email: read("STAGING_CLIENT_EMAIL"), password: read("STAGING_CLIENT_PASSWORD") });
  const clientUser = await client.auth.me.query();
  assert(clientUser?.role === "user", "staging client login failed");
  record("client-login", "PASS", "isolated client account");

  const admin = authenticatedClient();
  await admin.auth.localLogin.mutate({ email: read("STAGING_ADMIN_EMAIL"), password: read("STAGING_ADMIN_PASSWORD") });
  await admin.admin.dashboard.query();
  record("admin-access", "PASS", "isolated admin account");

  await checkedFetch("cron-without-token", "/api/internal/jobs/reservations", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }, 401);
  await checkedFetch("cron-invalid-token", "/api/internal/jobs/reservations", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer invalid" }, body: "{}" }, 401);
  await checkedFetch("cron-valid-token", "/api/internal/jobs/reservations", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${read("CRON_SECRET")}` }, body: "{}" }, 200);
  await checkedFetch("webhook-without-token", "/api/webhooks/asaas", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }, 401);

  const stagingOrigin = read("EXPECTED_FRONTEND_ORIGIN");
  await checkedFetch("cors-staging-origin", "/api/trpc", { method: "OPTIONS", headers: { origin: stagingOrigin, "access-control-request-method": "POST" } }, 204);
  const productionCors = await fetch(`${baseUrl}/api/trpc`, { method: "OPTIONS", headers: { origin: read("PRODUCTION_FRONTEND_ORIGIN"), "access-control-request-method": "POST" } });
  assert(productionCors.status !== 204 || productionCors.headers.get("access-control-allow-origin") !== read("PRODUCTION_FRONTEND_ORIGIN"), "production origin was accepted by staging CORS");
  record("cors-production-to-staging", "PASS", `blocked with HTTP ${productionCors.status}`);

  const candidate = products.find(product => Number(product.stock) > 0);
  assert(candidate, "no in-stock product fixture");
  if (!runtime.checkout.available) {
    let blocked = false;
    try {
      await client.orders.createAsaasCharge.mutate({ checkoutAttemptId: crypto.randomUUID(), method: "PIX", items: [{ productId: candidate.id, quantity: 1 }], shipping: { cep: "70000000", optionId: "controlled" }, shippingAddress: { recipient: "Cliente Staging", zipCode: "70000000", street: "Rua de Teste", number: "100", neighborhood: "Centro de Testes", city: "Brasilia", state: "DF" }, customer: { name: "Cliente Staging", cpfCnpj: "11144477735", email: read("STAGING_CLIENT_EMAIL") } });
    } catch (error) {
      blocked = String(error?.message || error).includes("indispon") || String(error?.message || error).includes("manutenção");
    }
    assert(blocked, "checkout flag did not block backend mutation");
    record("controlled-checkout", "PASS", "backend feature flag blocked charge creation");
  } else if (read("SMOKE_ASAAS_CHARGE_ENABLED") !== "true") {
    record("controlled-checkout", "SKIP", "checkout enabled, but explicit sandbox charge authorization is absent");
  } else {
    const quote = await fetch(`${baseUrl}/api/shipping/quote`, { method: "POST", headers: { "content-type": "application/json", origin: stagingOrigin }, body: JSON.stringify({ cep: "70000000", itemCount: 1, subtotal: Number(candidate.price) / 100 }) }).then(response => response.json());
    const option = quote.options?.[0];
    assert(option?.id, "shipping quote unavailable for controlled checkout");
    await client.orders.createAsaasCharge.mutate({ checkoutAttemptId: crypto.randomUUID(), method: "PIX", items: [{ productId: candidate.id, quantity: 1 }], shipping: { cep: "70000000", optionId: option.id }, shippingAddress: { recipient: "Cliente Staging", zipCode: "70000000", street: "Rua de Teste", number: "100", neighborhood: "Centro de Testes", city: "Brasilia", state: "DF" }, customer: { name: "Cliente Staging", cpfCnpj: read("SMOKE_CUSTOMER_CPF"), email: read("SMOKE_CUSTOMER_EMAIL") } });
    record("controlled-checkout", "PASS", "sandbox charge created with explicit authorization");
  }

  console.log(JSON.stringify({ decision: results.some(item => item.status === "SKIP") ? "GO-WITH-PENDING-EXTERNAL" : "GO", target: baseUrl, results }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ decision: "NO-GO", target: baseUrl, errorType: error instanceof Error ? error.name : "unknown", message: error instanceof Error ? error.message : "unknown", results }, null, 2));
  process.exit(1);
}
