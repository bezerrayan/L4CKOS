import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  connection: {
    query: vi.fn(),
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    end: vi.fn(),
  },
  createConnection: vi.fn(),
  queries: [] as string[],
}));

vi.mock("mysql2/promise", async importOriginal => ({
  ...await importOriginal<typeof import("mysql2/promise")>(),
  createConnection: state.createConnection,
}));

import { ordersRouter } from "./orders";

const request = {
  checkoutAttemptId: "a20485ea-35f8-4ea3-85dd-4084f593e695",
  method: "PIX" as const,
  items: [{ productId: 4, quantity: 1 }],
  shipping: { cep: "70000000", optionId: "local" },
  shippingAddress: {
    recipient: "Comprador sintético",
    zipCode: "70000000",
    street: "Rua de teste",
    number: "1",
    neighborhood: "Centro",
    city: "Brasília",
    state: "DF",
  },
  customer: { name: "Comprador sintético", cpfCnpj: "11144477735", email: "buyer@example.invalid" },
};

afterEach(() => {
  vi.unstubAllEnvs();
  state.queries.length = 0;
  vi.clearAllMocks();
});

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("PUBLIC_SITE_MODE", "coming-soon");
  vi.stubEnv("PUBLIC_CHECKOUT_ENABLED", "false");
  vi.stubEnv("DATABASE_URL", "mysql://local-test.invalid/l4ckos");
  vi.stubEnv("RAILWAY_PROJECT_ID", "");
  vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "");
  vi.stubEnv("RAILWAY_SERVICE_ID", "");
  vi.stubEnv("ASAAS_WEBHOOK_RECOVERY_MODE", "");
  vi.stubEnv("EMAIL_MODE", "");
  state.connection.query.mockImplementation(async (sql: string) => {
    state.queries.push(sql);
    if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }], []];
    if (sql.startsWith("SET ")) return [{ affectedRows: 0 }, []];
    if (sql.includes("FROM orders WHERE checkoutAttemptId")) return [[], []];
    if (sql.includes("RELEASE_LOCK")) return [[{ released: 1 }], []];
    throw new Error(`Unexpected SQL from closed checkout: ${sql}`);
  });
  state.createConnection.mockResolvedValue(state.connection);
});

describe("orders.createAsaasCharge while Coming Soon is active", () => {
  it("rejects an unauthenticated visitor before opening a database connection", async () => {
    const caller = ordersRouter.createCaller({ user: null, req: {} as any, res: {} as any } as any);

    await expect(caller.createAsaasCharge(request)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(state.createConnection).not.toHaveBeenCalled();
  });

  it("returns a structured closed-store error to an authenticated caller without commercial writes", async () => {
    const caller = ordersRouter.createCaller({
      user: { id: 27, role: "user", email: "buyer@example.invalid" },
      req: {} as any,
      res: {} as any,
    } as any);

    await expect(caller.createAsaasCharge(request)).rejects.toMatchObject({
      code: "FORBIDDEN",
      appCode: "PUBLIC_STORE_CLOSED",
      message: "A loja está temporariamente fechada para novos pedidos.",
    });

    expect(state.createConnection).not.toHaveBeenCalled();
    expect(state.connection.end).not.toHaveBeenCalled();
    expect(state.connection.beginTransaction).not.toHaveBeenCalled();
    expect(state.connection.commit).not.toHaveBeenCalled();
    expect(state.queries.some(sql => /\b(INSERT|UPDATE|DELETE)\b/i.test(sql))).toBe(false);
  });
});

describe("orders.createAsaasCharge in navigable staging mode", () => {
  it("keeps the store open while refusing checkout before database or provider access", async () => {
    vi.stubEnv("PUBLIC_SITE_MODE", "store");
    vi.stubEnv("PUBLIC_CHECKOUT_ENABLED", "false");
    const caller = ordersRouter.createCaller({
      user: { id: 27, role: "user", email: "buyer@example.invalid" },
      req: {} as any,
      res: {} as any,
    } as any);

    await expect(caller.createAsaasCharge(request)).rejects.toMatchObject({
      code: "FORBIDDEN",
      appCode: "PUBLIC_CHECKOUT_DISABLED",
    });
    expect(state.createConnection).not.toHaveBeenCalled();
  });
});
