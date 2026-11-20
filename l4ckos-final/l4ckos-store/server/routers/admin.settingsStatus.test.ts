import { afterEach, describe, expect, it, vi } from "vitest";

const adminUser = { id: 14, openId: "synthetic-admin", email: "admin@local.dev", role: "admin" };

async function caller() {
  const { adminRouter } = await import("./admin");
  return adminRouter.createCaller({ user: adminUser, req: {} as any, res: {} as any } as any);
}

describe("admin settings status configuration contract", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("counts webhook account binding configuration without returning its values", async () => {
    vi.stubEnv("ASAAS_API_KEY", "synthetic-api-key-not-for-output");
    vi.stubEnv("ASAAS_API_URL", "https://api-sandbox.asaas.com/v3");
    vi.stubEnv("ASAAS_CHECKOUT_BASE_URL", "https://sandbox.asaas.com");
    vi.stubEnv("ASAAS_WEBHOOK_TOKEN", "synthetic-webhook-token-not-for-output");
    vi.stubEnv("ASAAS_WEBHOOK_ACCOUNT_ID", "synthetic-account-id-not-for-output");
    vi.stubEnv("ASAAS_WEBHOOK_ACCOUNT_CURRENCY", "BRL");

    const result = await (await caller()).settingsStatus();
    expect(result.integrations.asaas).toMatchObject({ status: "configured", configuredCount: 6, expectedCount: 6 });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("synthetic-api-key");
    expect(serialized).not.toContain("synthetic-webhook-token");
    expect(serialized).not.toContain("synthetic-account-id");
    expect(serialized).not.toContain('"BRL"');
  });

  it("recognizes the phase-specific Sandbox credential without exposing it", async () => {
    vi.stubEnv("G4_FINANCIAL_PHASE", "SANDBOX_WEBHOOK");
    vi.stubEnv("ASAAS_SANDBOX_API_KEY", "synthetic-sandbox-key-not-for-output");
    vi.stubEnv("ASAAS_API_URL", "https://api-sandbox.asaas.com/v3");
    vi.stubEnv("ASAAS_CHECKOUT_BASE_URL", "https://sandbox.asaas.com");
    vi.stubEnv("ASAAS_WEBHOOK_TOKEN", "synthetic-webhook-token-not-for-output");
    vi.stubEnv("ASAAS_WEBHOOK_ACCOUNT_ID", "synthetic-account-id-not-for-output");
    vi.stubEnv("ASAAS_WEBHOOK_ACCOUNT_CURRENCY", "BRL");

    const result = await (await caller()).settingsStatus();
    expect(result.integrations.asaas).toMatchObject({ status: "configured", configuredCount: 6, expectedCount: 6 });
    expect(JSON.stringify(result)).not.toContain("synthetic-sandbox-key");
  });
});
