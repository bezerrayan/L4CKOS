import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPool, type Pool } from "mysql2/promise";
import express from "express";
import { createServer, type Server } from "node:http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import { drizzle as drizzleMysql } from "drizzle-orm/mysql2";
import superjson from "superjson";
import { appRouter } from "../routers";
import { setStockLocalHarnessDb } from "../db";
import { ENV } from "../_core/env";
import {
  configureStockCheckoutRuntimeForLocalHarness,
  createContext,
} from "../_core/context";
import { sdk } from "../_core/sdk";
import { COOKIE_NAME } from "../../shared/const";
import { createStockCheckoutRuntime } from "../stock/stockCheckoutRuntime";
import {
  createStockCheckout as createStockCheckoutDomain,
  StockProviderError,
  type StockCheckoutStore,
} from "../stock/stockCheckout";
import { createMysqlStockCheckoutStore } from "../stock/mysqlStockCheckoutStore";
import {
  createExclusiveStore,
  type ExclusiveDropNotifier,
  type NotificationEvent,
} from "./store";
import { configureExclusiveStoreForLocalHarness } from "./runtime";
import { canPurchaseExclusive } from "../../shared/exclusiveDropsV1";
import { canonicalizeSeedVariants } from "../stock/testing/canonicalizeSeedVariants";

/**
 * Exclusive drops against the REAL STOCK V1 checkout, on the disposable loopback MySQL harness only.
 * Skipped unless the STOCK_MYSQL_* variables of scripts/run-stock-mysql-tests.sh are present.
 */
const database = process.env.STOCK_MYSQL_DATABASE ?? "";
const host = process.env.STOCK_MYSQL_HOST ?? "";
const port = Number(process.env.STOCK_MYSQL_PORT ?? 0);
const user = process.env.STOCK_MYSQL_USER ?? "";
const password = process.env.STOCK_MYSQL_PASSWORD ?? "";
const delivery = {
  optionId: "local-plano-piloto" as const,
  address: {
    recipient: "Cliente Sintético",
    zipCode: "70000000",
    street: "Rua de Teste",
    number: "123",
    neighborhood: "Centro",
    city: "Brasília",
    state: "DF",
  },
};

function assertSyntheticTarget() {
  if (!/^(127\.0\.0\.1|localhost|::1)$/.test(host))
    throw new Error("STOCK_MYSQL_HOST must be loopback");
  if (
    database !== "l4ckos_stock_test" ||
    user !== "stock_test" ||
    process.env.STOCK_LOCAL_HARNESS !== "true"
  )
    throw new Error("STOCK MySQL test identity is not disposable");
}

let pool: Pool;
let httpServer: Server;
let baseUrl = "";
let providerCalls: Array<{ orderId: string }>;
let providerMode: "ok" | "definitive" | "unknown" = "ok";
let sessionTokens: Record<string, string>;
let now: Date;
let stockRuntime: ReturnType<typeof createStockCheckoutRuntime>;
const clock = () => now;
const at = (iso: string) => {
  now = new Date(iso);
};

const client = (session: string) =>
  createTRPCProxyClient<typeof appRouter>({
    links: [
      httpBatchLink({
        url: `${baseUrl}/api/trpc`,
        transformer: superjson,
        headers: {
          cookie: `${COOKIE_NAME}=${sessionTokens[session] ?? session}`,
        },
      }),
    ],
  });
const owner = () => client("owner-81");
const other = () => client("other-82");
const third = () => client("third-84");
const admin = () => client("admin-83");

const store = () => createExclusiveStore(pool, { now: clock });
const appCode = (error: unknown) => {
  const value = error as {
    data?: { appError?: { code?: string } };
    shape?: { data?: { appError?: { code?: string } } };
  };
  return value?.data?.appError?.code ?? value?.shape?.data?.appError?.code;
};
const trpcCode = (error: unknown) =>
  (error as { data?: { code?: string } })?.data?.code;
const caught = async (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    e => e
  );

const TABLES = [
  "exclusiveNotificationOutbox",
  "exclusiveEvents",
  "exclusiveRedeemAttempts",
  "exclusiveGrantUsage",
  "exclusiveGrants",
  "exclusiveAccessRequests",
  "exclusiveDropProducts",
  "exclusiveDrops",
  "stockWebhookEvents",
  "stockReservations",
  "orderItems",
  "stockCheckoutItems",
  "stockCheckoutAttempts",
  "orders",
  "productVariants",
  "products",
  "userAddresses",
  "users",
];

async function resetDatabase() {
  await pool.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const table of TABLES)
    await pool.query(`TRUNCATE TABLE ${table}`).catch(() => undefined);
  await pool.query("SET FOREIGN_KEY_CHECKS = 1");
  const adminEmail = ENV.adminEmails[0] ?? "admin@local.dev";
  await pool.execute(
    `INSERT INTO users (id, openId, name, email, role) VALUES (81, 'synthetic-owner-81', 'Integrante Um', 'um@example.invalid', 'user'), (82, 'synthetic-other-82', 'Outro Cliente', 'outro@example.invalid', 'user'),
       (83, 'synthetic-admin-83', 'Admin', ?, 'admin'), (84, 'synthetic-third-84', 'Terceiro', 'terceiro@example.invalid', 'user')`,
    [adminEmail]
  );
  await pool.execute(
    `INSERT INTO products (id, name, category, price, stock) VALUES (4, 'Camiseta Clã XIV Bis', 'camisetas', 12900, 0), (5, 'City Noise', 'camisetas', 9900, 0)`
  );
  await pool.execute(
    `INSERT INTO productVariants (id, productId, name, sku, size, color, price, stock, reservedStock, isActive) VALUES
       (8, 4, 'XIV-M', 'XIV-M', 'M', 'Preto', 12900, 20, 0, 1), (9, 4, 'XIV-G', 'XIV-G', 'G', 'Preto', 12900, 20, 0, 1), (10, 4, 'XIV-GG', 'XIV-GG', 'GG', 'Preto', 12900, 20, 0, 1),
       (11, 5, 'CN-M', 'CN-M', 'M', 'Preto', 9900, 20, 0, 1)`
  );
  await canonicalizeSeedVariants(pool);
}

const DROP_INPUT = {
  slug: "xiv-bis-cla",
  name: "Clã XIV Bis × L4CKOS",
  description: "Edição exclusiva",
  timezone: "America/Sao_Paulo",
  requestStartsAt: "2026-11-01T00:00:00-03:00",
  requestEndsAt: "2026-11-25T23:59:00-03:00",
  purchaseStartsAt: "2026-11-20T09:00:00-03:00",
  purchaseEndsAt: "2026-11-30T12:00:00-03:00",
  isPublic: true,
  requiresAuthorization: true,
  defaultUnitLimit: 3,
  status: "published" as const,
  productIds: [4],
};

async function createDrop(overrides: Record<string, unknown> = {}) {
  return admin().exclusiveDrops.admin.saveDrop.mutate({
    ...DROP_INPUT,
    ...overrides,
  } as never);
}

/** Request → approve → redeem: returns the grant after the customer unlocked it. */
async function unlockedGrant(
  session: () => ReturnType<typeof client>,
  unitLimit = 3,
  expiresAt = "2026-11-30T12:00:00-03:00",
  dropId = 1
) {
  const request = await session().exclusiveDrops.requestAccess.mutate({
    dropId,
  });
  const approved = await admin().exclusiveDrops.admin.approve.mutate({
    requestId: request.requestId,
    unitLimit,
    expiresAt,
  });
  await session().exclusiveDrops.redeemCode.mutate({ code: approved.code });
  return { ...approved, requestId: request.requestId };
}

const create = (
  session: () => ReturnType<typeof client>,
  attemptId: string,
  variantId: number,
  quantity = 1,
  productId = 4
) =>
  session().stockCheckout.create.mutate({
    attemptId,
    items: [{ productId, variantId, quantity }],
    delivery,
  } as never);

describe.skipIf(!process.env.STOCK_MYSQL_HOST)(
  "Exclusive drops over STOCK V1 (MySQL 9.7.2 disposable only)",
  () => {
    beforeAll(async () => {
      assertSyntheticTarget();
      pool = createPool({
        host,
        port,
        user,
        password,
        database,
        connectionLimit: 12,
      });
      setStockLocalHarnessDb(drizzleMysql(pool));
      const [identity] = await pool.query<
        (Record<string, unknown> & { version: string; dbName: string })[]
      >("SELECT VERSION() AS version, DATABASE() AS dbName");
      if (
        !String(identity[0]?.version).startsWith("9.7.2") ||
        identity[0]?.dbName !== database
      )
        throw new Error(
          "MySQL identity/version did not match the disposable test target"
        );
      const [existing] = await pool.execute<
        (Record<string, unknown> & { n: number })[]
      >(
        "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'products'"
      );
      if (Number(existing[0]?.n) === 0) {
        const base = await readFile(
          resolve("server/stock/fixtures/mysql8-stock-schema.sql"),
          "utf8"
        );
        for (const statement of base
          .split(";")
          .map(part => part.trim())
          .filter(Boolean))
          await pool.query(statement);
      }
      const migration = await readFile(
        resolve(
          "database/migrations/exclusive-drops-v1/0028_exclusive_drops_candidate.sql"
        ),
        "utf8"
      );
      for (const statement of migration
        .split(";")
        .map(part => part.trim())
        .filter(part => /CREATE TABLE/.test(part)))
        await pool.query(statement);
      sessionTokens = {
        "owner-81": await sdk.createSessionToken("synthetic-owner-81", {
          name: "Integrante Um",
          sessionVersion: 1,
        }),
        "other-82": await sdk.createSessionToken("synthetic-other-82", {
          name: "Outro Cliente",
          sessionVersion: 1,
        }),
        "admin-83": await sdk.createSessionToken("synthetic-admin-83", {
          name: "Admin",
          sessionVersion: 1,
        }),
        "third-84": await sdk.createSessionToken("synthetic-third-84", {
          name: "Terceiro",
          sessionVersion: 1,
        }),
      };
      stockRuntime = createStockCheckoutRuntime({
        pool,
        exclusiveStore: store(),
        provider: {
          supportsIdempotencyKey: true,
          async createPayment(input) {
            providerCalls.push(input);
            if (providerMode === "definitive")
              throw new StockProviderError("rejected by provider", true);
            if (providerMode === "unknown") throw new Error("socket hang up");
            return {
              paymentId: `pay-${providerCalls.length}`,
              checkoutUrl: "https://sandbox.invalid/checkout",
            };
          },
        },
      });
      configureStockCheckoutRuntimeForLocalHarness(stockRuntime);
      configureExclusiveStoreForLocalHarness(
        createExclusiveStore(pool, { now: clock })
      );
      const app = express();
      app.use(
        "/api/trpc",
        createExpressMiddleware({ router: appRouter, createContext })
      );
      httpServer = createServer(app);
      await new Promise<void>(done => httpServer.listen(0, "127.0.0.1", done));
      const address = httpServer.address();
      if (!address || typeof address === "string")
        throw new Error("harness did not bind loopback");
      baseUrl = `http://127.0.0.1:${address.port}`;
    }, 30_000);

    beforeEach(async () => {
      await resetDatabase();
      providerCalls = [];
      providerMode = "ok";
      at("2026-11-20T15:00:00.000Z"); // inside the purchase window (starts 12:00Z)
      vi.stubEnv("PUBLIC_SITE_MODE", "store");
      vi.stubEnv("PUBLIC_CHECKOUT_ENABLED", "true");
    });

    afterAll(async () => {
      vi.unstubAllEnvs();
      configureExclusiveStoreForLocalHarness(undefined);
      // The disposable database is shared with the STOCK suites: leave it exactly as the base fixture (no drops, no extra tables).
      if (pool) {
        await pool.query("SET FOREIGN_KEY_CHECKS = 0");
        for (const table of [
          "exclusiveNotificationOutbox",
          "exclusiveEvents",
          "exclusiveRedeemAttempts",
          "exclusiveGrantUsage",
          "exclusiveGrants",
          "exclusiveAccessRequests",
          "exclusiveDropProducts",
          "exclusiveDrops",
        ]) {
          await pool.query(`DROP TABLE IF EXISTS ${table}`);
        }
        await pool.query("SET FOREIGN_KEY_CHECKS = 1");
      }
      configureStockCheckoutRuntimeForLocalHarness(undefined);
      if (httpServer)
        await new Promise<void>(done => httpServer.close(() => done()));
      if (pool) setStockLocalHarnessDb(null);
      if (pool) await pool.end();
    });

    // ---------------------------------------------------------------- visibility
    it("1. the exclusive product is public: drop info and window are visible, purchase is not available", async () => {
      await createDrop();
      const anonymous = client("no-session");
      const view = await anonymous.exclusiveDrops.forProduct.query({
        productId: 4,
      });
      expect(view).toMatchObject({
        exclusive: true,
        drop: {
          name: "Clã XIV Bis × L4CKOS",
          state: "active",
          timezone: "America/Sao_Paulo",
          requiresAuthorization: true,
        },
        viewer: { status: "login_required" },
      });
      expect(view.exclusive && view.drop.purchaseWindow.endsAt).toBe(
        "2026-11-30T15:00:00.000Z"
      );
      expect(canPurchaseExclusive(view)).toBe(false);
      expect(
        await anonymous.exclusiveDrops.forProduct.query({ productId: 5 })
      ).toEqual({ exclusive: false });
    });

    it("a draft drop advertises nothing (no name) yet the product stays blocked on the server", async () => {
      await createDrop({ status: "draft" });
      const view = await owner().exclusiveDrops.forProduct.query({
        productId: 4,
      });
      expect(view).toMatchObject({
        exclusive: true,
        drop: { name: "Drop exclusivo" },
      });
      expect(
        appCode(await caught(create(owner, "xiv-attempt-draft-0001", 8)))
      ).toBe("EXCLUSIVE_DROP_CLOSED");
    });

    // ---------------------------------------------------------------- server-side enforcement
    it("2/3. without access the API rejects direct checkout; nothing reaches STOCK (no attempt, no provider call)", async () => {
      await createDrop();
      const error = await caught(create(owner, "xiv-attempt-noaccess-01", 8));
      expect(trpcCode(error)).toBe("FORBIDDEN");
      expect(appCode(error)).toBe("EXCLUSIVE_ACCESS_REQUIRED");
      const [attempts] = await pool.query<any[]>(
        "SELECT COUNT(*) AS n FROM stockCheckoutAttempts"
      );
      expect(Number(attempts[0].n)).toBe(0);
      expect(providerCalls).toHaveLength(0);
    });

    it("a pending, rejected or revoked request cannot buy; changing the cart/API call does not bypass it", async () => {
      await createDrop();
      const request = await owner().exclusiveDrops.requestAccess.mutate({
        dropId: 1,
      });
      expect(
        appCode(await caught(create(owner, "xiv-attempt-pending-001", 8)))
      ).toBe("EXCLUSIVE_ACCESS_REQUIRED");
      await admin().exclusiveDrops.admin.reject.mutate({
        requestId: request.requestId,
      });
      expect(
        appCode(await caught(create(owner, "xiv-attempt-rejected-01", 8)))
      ).toBe("EXCLUSIVE_ACCESS_REQUIRED");
      expect(
        appCode(
          await caught(owner().cart.add.mutate({ productId: 4, quantity: 1 }))
        )
      ).toBe("EXCLUSIVE_ACCESS_REQUIRED");
      // mixing a public product into the request does not unlock the exclusive line
      const mixed = await caught(
        owner().stockCheckout.create.mutate({
          attemptId: "xiv-attempt-mixed-0001",
          items: [
            { productId: 5, variantId: 11, quantity: 1 },
            { productId: 4, variantId: 8, quantity: 1 },
          ],
          delivery,
        } as never)
      );
      expect(appCode(mixed)).toBe("EXCLUSIVE_ACCESS_REQUIRED");
      expect(providerCalls).toHaveLength(0);
    });

    it("15. a public product still checks out without any code", async () => {
      await createDrop();
      const result = await create(owner, "city-noise-attempt-001", 11, 2, 5);
      expect(result).toMatchObject({ status: "pending", replayed: false });
      expect(providerCalls).toHaveLength(1);
      await stockRuntime.receiveWebhook({
        rawBody: "synthetic-city-noise-paid",
        headers: { "asaas-access-token": "synthetic-local-signature" },
        boundary: {
          verifySignature: async () => true,
          decodeSignedEvent: () => ({
            eventId: "city-noise-paid-001",
            orderId: result.orderId,
            paymentId: result.paymentId,
            status: "paid",
            amountCents: result.amountCents,
            payload: { source: "synthetic-test" },
          }),
        },
      });
      const [paid] = await pool.query<any[]>(
        "SELECT status FROM stockCheckoutAttempts WHERE attemptId = 'city-noise-attempt-001'"
      );
      expect(paid[0].status).toBe("paid");
    });

    // ---------------------------------------------------------------- request
    it("4. duplicate request creates one record; status is queryable", async () => {
      await createDrop();
      const first = await owner().exclusiveDrops.requestAccess.mutate({
        dropId: 1,
      });
      const second = await owner().exclusiveDrops.requestAccess.mutate({
        dropId: 1,
      });
      expect(first).toMatchObject({ status: "pending", created: true });
      expect(second).toMatchObject({
        status: "pending",
        created: false,
        requestId: first.requestId,
      });
      const [rows] = await pool.query<any[]>(
        "SELECT COUNT(*) AS n FROM exclusiveAccessRequests"
      );
      expect(Number(rows[0].n)).toBe(1);
      const mine = await owner().exclusiveDrops.myRequests.query();
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({
        requestStatus: "pending",
        viewer: { status: "pending" },
      });
      expect(
        await caught(
          client("no-session").exclusiveDrops.requestAccess.mutate({
            dropId: 1,
          })
        )
      ).toMatchObject({ data: { code: "UNAUTHORIZED" } });
    });

    it("requests outside the request window or for a closed drop are refused", async () => {
      await createDrop({ requestEndsAt: "2026-11-10T00:00:00-03:00" });
      expect(
        appCode(
          await caught(
            owner().exclusiveDrops.requestAccess.mutate({ dropId: 1 })
          )
        )
      ).toBe("EXCLUSIVE_REQUEST_WINDOW_CLOSED");
    });

    // ---------------------------------------------------------------- admin
    it("5. an ordinary user cannot approve, reject, revoke or list", async () => {
      await createDrop();
      const request = await owner().exclusiveDrops.requestAccess.mutate({
        dropId: 1,
      });
      for (const attempt of [
        () =>
          other().exclusiveDrops.admin.approve.mutate({
            requestId: request.requestId,
            unitLimit: 3,
            expiresAt: "2026-11-30T12:00:00-03:00",
          }),
        () =>
          other().exclusiveDrops.admin.reject.mutate({
            requestId: request.requestId,
          }),
        () =>
          other().exclusiveDrops.admin.revoke.mutate({
            requestId: request.requestId,
          }),
        () =>
          other().exclusiveDrops.admin.reissueCode.mutate({
            requestId: request.requestId,
          }),
        () => other().exclusiveDrops.admin.history.query({}),
        () => other().exclusiveDrops.admin.listRequests.query({}),
        () =>
          owner().exclusiveDrops.admin.saveDrop.mutate({
            ...DROP_INPUT,
            slug: "hack-drop",
          } as never),
      ])
        expect(trpcCode(await caught(attempt()))).toBe("FORBIDDEN");
      expect(
        trpcCode(
          await caught(
            client("no-session").exclusiveDrops.admin.listDrops.query()
          )
        )
      ).toBe("UNAUTHORIZED");
    });

    it("6. an authorized admin filters, approves and revokes; the history keeps authorization and usage", async () => {
      await createDrop();
      await owner().exclusiveDrops.requestAccess.mutate({ dropId: 1 });
      await other().exclusiveDrops.requestAccess.mutate({ dropId: 1 });
      expect(
        await admin().exclusiveDrops.admin.listRequests.query({
          dropId: 1,
          status: "pending",
        })
      ).toHaveLength(2);
      const granted = await unlockedGrantFor(owner);
      expect(
        await admin().exclusiveDrops.admin.listRequests.query({
          status: "approved",
        })
      ).toHaveLength(1);
      await create(owner, "xiv-attempt-history-001", 8, 2);
      await admin().exclusiveDrops.admin.revoke.mutate({
        requestId: granted.requestId,
      });
      const history = await admin().exclusiveDrops.admin.history.query({
        requestId: granted.requestId,
      });
      expect(history.map(e => e.event)).toEqual(
        expect.arrayContaining([
          "requested",
          "approved",
          "code_redeemed",
          "units_claimed",
          "revoked",
        ])
      );
      expect(JSON.stringify(history)).not.toContain(granted.code);
      expect(
        appCode(await caught(create(owner, "xiv-attempt-history-002", 9)))
      ).toBe("EXCLUSIVE_ACCESS_REQUIRED");
    });

    // ---------------------------------------------------------------- codes
    it("7/8/9. another account's, an expired and a revoked code are rejected; the plaintext is never stored", async () => {
      await createDrop();
      const request = await owner().exclusiveDrops.requestAccess.mutate({
        dropId: 1,
      });
      const approved = await admin().exclusiveDrops.admin.approve.mutate({
        requestId: request.requestId,
        unitLimit: 3,
        expiresAt: "2026-11-21T00:00:00-03:00",
      });
      expect(approved.code).toMatch(
        /^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/
      );
      // stored as a hash only
      const [grants] = await pool.query<any[]>(
        "SELECT codeHash FROM exclusiveGrants"
      );
      expect(grants[0].codeHash).toHaveLength(64);
      expect(grants[0].codeHash).not.toContain(approved.code.replace(/-/g, ""));
      // 7. someone else cannot use it (and learns nothing)
      const foreign = await caught(
        other().exclusiveDrops.redeemCode.mutate({ code: approved.code })
      );
      expect(appCode(foreign)).toBe("EXCLUSIVE_CODE_INVALID");
      // still locked for the owner until redeemed
      expect(
        appCode(await caught(create(owner, "xiv-attempt-locked-0001", 8)))
      ).toBe("EXCLUSIVE_ACCESS_REQUIRED");
      // 8. expired
      at("2026-11-21T04:00:00.000Z"); // after 00:00-03:00 on the 21st
      expect(
        appCode(
          await caught(
            owner().exclusiveDrops.redeemCode.mutate({ code: approved.code })
          )
        )
      ).toBe("EXCLUSIVE_CODE_INVALID");
      // 9. revoked
      at("2026-11-20T15:00:00.000Z");
      await admin().exclusiveDrops.admin.revoke.mutate({
        requestId: request.requestId,
      });
      expect(
        appCode(
          await caught(
            owner().exclusiveDrops.redeemCode.mutate({ code: approved.code })
          )
        )
      ).toBe("EXCLUSIVE_CODE_INVALID");
    });

    it("an unlocked grant that expires stops buying; a reissued code invalidates the old one", async () => {
      await createDrop();
      const granted = await unlockedGrantFor(
        owner,
        3,
        "2026-11-22T00:00:00-03:00"
      );
      expect(await create(owner, "xiv-attempt-expiry-0001", 8)).toMatchObject({
        status: "pending",
      });
      at("2026-11-22T04:00:00.000Z");
      expect(
        appCode(await caught(create(owner, "xiv-attempt-expiry-0002", 9)))
      ).toBe("EXCLUSIVE_ACCESS_REQUIRED");
      at("2026-11-20T15:00:00.000Z");
      const fresh = await admin().exclusiveDrops.admin.reissueCode.mutate({
        requestId: granted.requestId,
      });
      expect(
        appCode(await caught(create(owner, "xiv-attempt-expiry-0003", 9)))
      ).toBe("EXCLUSIVE_ACCESS_REQUIRED"); // must unlock again
      expect(
        appCode(
          await caught(
            owner().exclusiveDrops.redeemCode.mutate({ code: granted.code })
          )
        )
      ).toBe("EXCLUSIVE_CODE_INVALID");
      await owner().exclusiveDrops.redeemCode.mutate({ code: fresh.code });
      expect(await create(owner, "xiv-attempt-expiry-0004", 9)).toMatchObject({
        status: "pending",
      });
    });

    it("brute force is throttled per account, even for the right code, until the window passes", async () => {
      await createDrop();
      const request = await owner().exclusiveDrops.requestAccess.mutate({
        dropId: 1,
      });
      const approved = await admin().exclusiveDrops.admin.approve.mutate({
        requestId: request.requestId,
        unitLimit: 1,
        expiresAt: "2026-11-30T12:00:00-03:00",
      });
      for (let i = 0; i < 5; i += 1)
        expect(
          appCode(
            await caught(
              owner().exclusiveDrops.redeemCode.mutate({
                code: "AAAAA-BBBBB-CCCCC-DDDDD",
              })
            )
          )
        ).toBe("EXCLUSIVE_CODE_INVALID");
      expect(
        appCode(
          await caught(
            owner().exclusiveDrops.redeemCode.mutate({ code: approved.code })
          )
        )
      ).toBe("EXCLUSIVE_CODE_RATE_LIMITED");
      at("2026-11-20T15:20:00.000Z");
      expect(
        await owner().exclusiveDrops.redeemCode.mutate({ code: approved.code })
      ).toEqual({ unlocked: true });
    });

    // ---------------------------------------------------------------- quota
    it("10. one authorization buys several sizes up to the unit limit across attempts (M + G + GG), then stops", async () => {
      await createDrop();
      await unlockedGrantFor(owner, 3);
      expect(await create(owner, "xiv-attempt-sizes-0001", 8)).toMatchObject({
        status: "pending",
      }); // M
      expect(await create(owner, "xiv-attempt-sizes-0002", 9)).toMatchObject({
        status: "pending",
      }); // G
      expect(await create(owner, "xiv-attempt-sizes-0003", 10)).toMatchObject({
        status: "pending",
      }); // GG
      const over = await caught(create(owner, "xiv-attempt-sizes-0004", 8, 2));
      expect(appCode(over)).toBe("EXCLUSIVE_QUOTA_EXCEEDED");
      const view = await owner().exclusiveDrops.forProduct.query({
        productId: 4,
      });
      expect(view.exclusive && view.viewer).toMatchObject({
        status: "unlocked",
        unitLimit: 3,
        unitsUsed: 3,
        unitsRemaining: 0,
      });
      // two of one size + one of another in a single attempt also works within the limit
    });

    it("units are counted, not sizes: 2 M + 1 G in one attempt consumes 3", async () => {
      await createDrop();
      await unlockedGrantFor(owner, 3);
      const attempt = await owner().stockCheckout.create.mutate({
        attemptId: "xiv-attempt-units-0001",
        items: [
          { productId: 4, variantId: 8, quantity: 2 },
          { productId: 4, variantId: 9, quantity: 1 },
        ],
        delivery,
      } as never);
      expect(attempt.status).toBe("pending");
      const payment = providerCalls[0];
      await stockRuntime.receiveWebhook({
        rawBody: "synthetic-xiv-bis-paid",
        headers: { "asaas-access-token": "synthetic-local-signature" },
        boundary: {
          verifySignature: async () => true,
          decodeSignedEvent: () => ({
            eventId: "xiv-bis-paid-001",
            orderId: attempt.orderId,
            paymentId: `pay-${providerCalls.indexOf(payment) + 1}`,
            status: "paid",
            amountCents: attempt.amountCents,
            payload: { source: "synthetic-test" },
          }),
        },
      });
      const [paid] = await pool.query<any[]>(
        "SELECT status FROM stockCheckoutAttempts WHERE attemptId = 'xiv-attempt-units-0001'"
      );
      expect(paid[0].status).toBe("paid");
      const [used] = await pool.query<any[]>(
        "SELECT units FROM exclusiveGrantUsage WHERE attemptId = 'xiv-attempt-units-0001'"
      );
      expect(Number(used[0].units)).toBe(3);
      expect(
        appCode(await caught(create(owner, "xiv-attempt-units-0002", 10)))
      ).toBe("EXCLUSIVE_QUOTA_EXCEEDED");
    });

    it("quota and STOCK reservation roll back together on injected failures on either side of inventory reservation", async () => {
      await createDrop();
      await unlockedGrantFor(owner, 3);
      const exclusive = store();
      const paymentProvider = {
        supportsIdempotencyKey: true,
        async createPayment() {
          throw new Error("provider must not be called for rollback tests");
        },
      };
      const request = (attemptId: string) => ({
        attemptId,
        items: [{ productId: 4, variantId: 8, quantity: 1 }],
        delivery,
      });
      const beforeStock = createMysqlStockCheckoutStore(pool, {
        reserveExclusiveQuota: async (connection, claim) => {
          await exclusive.reserveForCheckoutInTransaction(connection, claim);
          throw new Error("injected-after-quota");
        },
      });
      await expect(
        createStockCheckoutDomain({
          enabled: true,
          ownerUserId: 81,
          store: beforeStock,
          provider: paymentProvider,
          request: request("xiv-attempt-rollback-0001"),
        })
      ).rejects.toThrow("injected-after-quota");

      const base = createMysqlStockCheckoutStore(pool, {
        reserveExclusiveQuota: (connection, claim) =>
          exclusive.reserveForCheckoutInTransaction(connection, claim),
      });
      const afterStock: StockCheckoutStore = {
        ...base,
        transaction: work =>
          base.transaction(tx =>
            work(
              new Proxy(tx, {
                get(target, property, receiver) {
                  if (property === "reserveVariant")
                    return async (
                      ...args: Parameters<typeof target.reserveVariant>
                    ) => {
                      await target.reserveVariant(...args);
                      throw new Error("injected-after-stock");
                    };
                  return Reflect.get(target, property, receiver);
                },
              })
            )
          ),
      };
      await expect(
        createStockCheckoutDomain({
          enabled: true,
          ownerUserId: 81,
          store: afterStock,
          provider: paymentProvider,
          request: request("xiv-attempt-rollback-0002"),
        })
      ).rejects.toThrow("injected-after-stock");
      const [claims] = await pool.query<any[]>(
        "SELECT COUNT(*) AS n FROM exclusiveGrantUsage"
      );
      const [attempts] = await pool.query<any[]>(
        "SELECT COUNT(*) AS n FROM stockCheckoutAttempts"
      );
      const [variant] = await pool.query<any[]>(
        "SELECT stock, reservedStock FROM productVariants WHERE id = 8"
      );
      expect(Number(claims[0].n)).toBe(0);
      expect(Number(attempts[0].n)).toBe(0);
      expect(variant[0]).toMatchObject({ stock: 20, reservedStock: 0 });
    });

    it("11. two tabs racing for the last unit: exactly one wins; a same-id replay never double-counts", async () => {
      await createDrop();
      await unlockedGrantFor(owner, 1);
      const results = await Promise.allSettled([
        create(owner, "xiv-attempt-race-00001", 8),
        create(owner, "xiv-attempt-race-00002", 9),
        create(owner, "xiv-attempt-race-00003", 10),
      ]);
      expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
      for (const failed of results.filter(
        (r): r is PromiseRejectedResult => r.status === "rejected"
      ))
        expect(appCode(failed.reason)).toBe("EXCLUSIVE_QUOTA_EXCEEDED");
      const [claims] = await pool.query<any[]>(
        "SELECT COALESCE(SUM(units),0) AS n FROM exclusiveGrantUsage"
      );
      expect(Number(claims[0].n)).toBe(1);
      const winner = results.findIndex(r => r.status === "fulfilled");
      const winnerId = `xiv-attempt-race-0000${winner + 1}`;
      const replay = await create(owner, winnerId, [8, 9, 10][winner]);
      expect(replay.replayed).toBe(true);
      const [after] = await pool.query<any[]>(
        "SELECT COALESCE(SUM(units),0) AS n FROM exclusiveGrantUsage"
      );
      expect(Number(after[0].n)).toBe(1);
    });

    it("a failed STOCK create (insufficient stock) does not hold units", async () => {
      await createDrop();
      await unlockedGrantFor(owner, 1);
      await pool.execute("UPDATE productVariants SET stock = 0 WHERE id = 8");
      expect(
        appCode(await caught(create(owner, "xiv-attempt-nostock-001", 8)))
      ).toBe("STOCK_UNAVAILABLE");
      const [claims] = await pool.query<any[]>(
        "SELECT COUNT(*) AS n FROM exclusiveGrantUsage"
      );
      expect(Number(claims[0].n)).toBe(0);
      expect(await create(owner, "xiv-attempt-nostock-002", 9)).toMatchObject({
        status: "pending",
      });
    });

    it("12/13. quota follows STOCK safely: cancel/expiry frees it; pending, ambiguous, reconciliation and paid keep it", async () => {
      await createDrop();
      await unlockedGrantFor(owner, 1);
      await create(owner, "xiv-attempt-quota-00001", 8);
      const setAttempt = (sql: string) =>
        pool.query(
          `UPDATE stockCheckoutAttempts SET ${sql} WHERE attemptId = 'xiv-attempt-quota-00001'`
        );
      const blocked = async (id: string) =>
        appCode(await caught(create(owner, id, 9))) ===
        "EXCLUSIVE_QUOTA_EXCEEDED";

      expect(await blocked("xiv-attempt-quota-probe1")).toBe(true); // reserved + pending payment: held
      await setAttempt("providerState = 'ambiguous'");
      expect(await blocked("xiv-attempt-quota-probe2")).toBe(true); // 13. ambiguous: NOT released
      await setAttempt("status = 'released', releasedAt = NOW(3)");
      expect(await blocked("xiv-attempt-quota-probe3")).toBe(true); // 13. released but provider outcome still ambiguous: NOT released
      await setAttempt(
        "providerState = 'created', reconciliationRequiredAt = NOW(3)"
      );
      expect(await blocked("xiv-attempt-quota-probe4")).toBe(true); // awaiting reconciliation: held
      await setAttempt(
        "status = 'paid', paidAt = NOW(3), reconciliationRequiredAt = NULL"
      );
      expect(await blocked("xiv-attempt-quota-probe5")).toBe(true); // paid: consumed, never released
      await setAttempt(
        "status = 'released', providerState = 'not_started', reconciliationRequiredAt = NULL, paidAt = NULL, releasedAt = NOW(3)"
      );
      // 12. safely released (cancel / expiry of an unstarted attempt): units are free again
      expect(await create(owner, "xiv-attempt-quota-probe6", 9)).toMatchObject({
        status: "pending",
      });
      // idempotent: reading again does not change anything
      expect(
        appCode(await caught(create(owner, "xiv-attempt-quota-probe7", 10)))
      ).toBe("EXCLUSIVE_QUOTA_EXCEEDED");
    });

    it("a definitive provider failure frees the units; an orphan claim frees itself after the grace window", async () => {
      await createDrop();
      await unlockedGrantFor(owner, 1);
      await pool.query(
        `INSERT INTO exclusiveGrantUsage (grantId, attemptId, units, createdAt) VALUES (1, 'orphan-attempt-id-0001', 1, '2026-11-20 14:59:30.000')`
      );
      expect(
        appCode(await caught(create(owner, "xiv-attempt-orphan-0001", 9)))
      ).toBe("EXCLUSIVE_QUOTA_EXCEEDED"); // in flight (30s old)
      at("2026-11-20T15:03:00.000Z"); // 3.5 min later: the create that never persisted is gone
      expect(await create(owner, "xiv-attempt-orphan-0002", 9)).toMatchObject({
        status: "pending",
      });
    });

    it("a DEFINITIVE provider failure releases the units; an UNKNOWN provider outcome keeps them until reconciliation", async () => {
      await createDrop();
      await unlockedGrantFor(owner, 1);
      providerMode = "definitive";
      await caught(create(owner, "xiv-attempt-provfail-001", 8));
      const [released] = await pool.query<any[]>(
        "SELECT status, providerState FROM stockCheckoutAttempts WHERE attemptId = 'xiv-attempt-provfail-001'"
      );
      expect(released[0]).toMatchObject({
        status: "released",
        providerState: "definitive_failure",
      });
      providerMode = "unknown";
      // the failed attempt freed the unit, so a fresh attempt may claim it...
      expect(
        appCode(await caught(create(owner, "xiv-attempt-provfail-002", 9)))
      ).toBe("PAYMENT_UNDER_ANALYSIS");
      // ...but the unknown outcome keeps it held: no other attempt can use that unit, and no second charge path opens
      providerMode = "ok";
      expect(
        appCode(await caught(create(owner, "xiv-attempt-provfail-003", 10)))
      ).toBe("EXCLUSIVE_QUOTA_EXCEEDED");
      expect(providerCalls).toHaveLength(2);
    });

    // ---------------------------------------------------------------- Sprint 7: UX contract, isolation and concurrency
    it("quota is split for the UI: reserved (open attempts, ambiguous) vs consumed (paid), always server-derived", async () => {
      await createDrop();
      await unlockedGrantFor(owner, 3);
      const viewer = async () => {
        const v = await owner().exclusiveDrops.forProduct.query({
          productId: 4,
        });
        return v.exclusive ? v.viewer : null;
      };
      expect(await viewer()).toMatchObject({
        unitLimit: 3,
        unitsReserved: 0,
        unitsConsumed: 0,
        unitsRemaining: 3,
      });
      await create(owner, "xiv-attempt-split-0001", 8, 2);
      expect(await viewer()).toMatchObject({
        unitsReserved: 2,
        unitsConsumed: 0,
        unitsUsed: 2,
        unitsRemaining: 1,
      });
      await pool.query(
        "UPDATE stockCheckoutAttempts SET status = 'paid', paidAt = NOW(3) WHERE attemptId = 'xiv-attempt-split-0001'"
      );
      await create(owner, "xiv-attempt-split-0002", 9, 1);
      await pool.query(
        "UPDATE stockCheckoutAttempts SET providerState = 'ambiguous' WHERE attemptId = 'xiv-attempt-split-0002'"
      );
      expect(await viewer()).toMatchObject({
        unitsReserved: 1,
        unitsConsumed: 2,
        unitsUsed: 3,
        unitsRemaining: 0,
      });
      const listed = await admin().exclusiveDrops.admin.listRequests.query({});
      expect(listed[0].grant).toMatchObject({
        unitsReserved: 1,
        unitsConsumed: 2,
      });
    });

    it("revocation with an OPEN attempt: new attempts are blocked at once, the open attempt keeps its own STOCK lifecycle and its units stay held", async () => {
      await createDrop();
      const granted = await unlockedGrantFor(owner, 2);
      const open = await create(owner, "xiv-attempt-revoke-0001", 8);
      await admin().exclusiveDrops.admin.revoke.mutate({
        requestId: granted.requestId,
      });
      expect(
        appCode(await caught(create(owner, "xiv-attempt-revoke-0002", 9)))
      ).toBe("EXCLUSIVE_ACCESS_REQUIRED");
      // the open attempt is still resumable and payable (STOCK owns it)...
      expect(
        await owner().stockCheckout.resume.query({
          attemptId: "xiv-attempt-revoke-0001",
        })
      ).toMatchObject({ status: "pending", orderId: open.orderId });
      // ...and a same-id replay (atomic-quota design) returns that SAME open attempt: no second charge, no extra units, nothing new reserved.
      const providerCallsBefore = providerCalls.length;
      expect(await create(owner, "xiv-attempt-revoke-0001", 8)).toMatchObject({
        status: "pending",
        orderId: open.orderId,
        replayed: true,
      });
      expect(providerCalls).toHaveLength(providerCallsBefore);
      const [attemptCount] = await pool.query<any[]>(
        "SELECT COUNT(*) AS n FROM stockCheckoutAttempts"
      );
      expect(Number(attemptCount[0].n)).toBe(1);
      // any NEW attempt (even a different cart) is still refused: access is revoked
      expect(
        appCode(await caught(create(owner, "xiv-attempt-revoke-0003", 10)))
      ).toBe("EXCLUSIVE_ACCESS_REQUIRED");
      const view = await owner().exclusiveDrops.forProduct.query({
        productId: 4,
      });
      expect(view.exclusive && view.viewer.status).toBe("revoked");
    });

    it("re-issuing a code during an active attempt: the attempt is untouched, the old code dies, the customer must unlock again, units stay counted", async () => {
      await createDrop();
      const granted = await unlockedGrantFor(owner, 2);
      await create(owner, "xiv-attempt-reissue-001", 8);
      const fresh = await admin().exclusiveDrops.admin.reissueCode.mutate({
        requestId: granted.requestId,
      });
      expect(
        await owner().stockCheckout.resume.query({
          attemptId: "xiv-attempt-reissue-001",
        })
      ).toMatchObject({ status: "pending" });
      expect(
        appCode(
          await caught(
            owner().exclusiveDrops.redeemCode.mutate({ code: granted.code })
          )
        )
      ).toBe("EXCLUSIVE_CODE_INVALID");
      expect(
        appCode(await caught(create(owner, "xiv-attempt-reissue-002", 9)))
      ).toBe("EXCLUSIVE_ACCESS_REQUIRED");
      let view = await owner().exclusiveDrops.forProduct.query({
        productId: 4,
      });
      expect(view.exclusive && view.viewer).toMatchObject({
        status: "approved",
        unitsReserved: 1,
        unitsRemaining: 1,
      });
      await owner().exclusiveDrops.redeemCode.mutate({ code: fresh.code });
      expect(await create(owner, "xiv-attempt-reissue-002", 9)).toMatchObject({
        status: "pending",
      });
      view = await owner().exclusiveDrops.forProduct.query({ productId: 4 });
      expect(view.exclusive && view.viewer).toMatchObject({
        status: "unlocked",
        unitsRemaining: 0,
      });
    });

    it("two tabs unlocking with the same code at once: both succeed, one 'redeemed' event; unlocking again is a harmless no-op", async () => {
      await createDrop();
      const request = await owner().exclusiveDrops.requestAccess.mutate({
        dropId: 1,
      });
      const approved = await admin().exclusiveDrops.admin.approve.mutate({
        requestId: request.requestId,
        unitLimit: 1,
        expiresAt: "2026-11-30T12:00:00-03:00",
      });
      const both = await Promise.all([
        owner().exclusiveDrops.redeemCode.mutate({ code: approved.code }),
        owner().exclusiveDrops.redeemCode.mutate({ code: approved.code }),
      ]);
      expect(both).toEqual([{ unlocked: true }, { unlocked: true }]);
      expect(
        await owner().exclusiveDrops.redeemCode.mutate({
          code: approved.code.toLowerCase(),
        })
      ).toEqual({ unlocked: true });
      const history = await admin().exclusiveDrops.admin.history.query({
        requestId: request.requestId,
      });
      expect(history.filter(e => e.event === "code_redeemed")).toHaveLength(1);
    });

    it("isolation: another customer sees none of A's requests, quota or status, and an anonymous caller cannot redeem", async () => {
      await createDrop();
      await unlockedGrantFor(owner, 2);
      expect(await other().exclusiveDrops.myRequests.query()).toEqual([]);
      const view = await other().exclusiveDrops.forProduct.query({
        productId: 4,
      });
      expect(view.exclusive && view.viewer).toEqual({ status: "none" });
      expect(
        trpcCode(
          await caught(
            client("no-session").exclusiveDrops.redeemCode.mutate({
              code: "AAAAA-BBBBB-CCCCC-DDDDD",
            })
          )
        )
      ).toBe("UNAUTHORIZED");
      const mine = await owner().exclusiveDrops.myRequests.query();
      expect(JSON.stringify(mine)).not.toContain("outro@example.invalid");
    });

    it("with the STOCK expiry sweeper: an expired UNSTARTED attempt frees the units; an expired provider-created attempt keeps them (reconciliation)", async () => {
      await createDrop();
      await unlockedGrantFor(owner, 2);
      await create(owner, "xiv-attempt-sweep-0001", 8); // provider-created (pending payment)
      await create(owner, "xiv-attempt-sweep-0002", 9);
      await pool.query(
        "UPDATE stockCheckoutAttempts SET providerState = 'not_started', paymentId = NULL, checkoutUrl = NULL WHERE attemptId = 'xiv-attempt-sweep-0002'"
      );
      await pool.query(
        "UPDATE stockCheckoutAttempts SET reservationExpiresAt = '2026-01-01 00:00:00.000' WHERE attemptId IN ('xiv-attempt-sweep-0001', 'xiv-attempt-sweep-0002')"
      );
      const viewer = async () => {
        const v = await owner().exclusiveDrops.forProduct.query({
          productId: 4,
        });
        return v.exclusive ? v.viewer : null;
      };
      expect(await viewer()).toMatchObject({
        unitsReserved: 2,
        unitsRemaining: 0,
      }); // expired in time but not yet swept: still held
      const swept = await stockRuntime.expireReservations(50);
      expect(swept.releasedAttemptIds).toContain("xiv-attempt-sweep-0002");
      expect(swept.releasedAttemptIds).not.toContain("xiv-attempt-sweep-0001");
      expect(swept.reconciliationAttemptIds).toContain(
        "xiv-attempt-sweep-0001"
      );
      // the unstarted one is free again; the provider-created one stays held until STOCK reconciles it
      expect(await viewer()).toMatchObject({
        unitsReserved: 1,
        unitsRemaining: 1,
      });
      expect(await create(owner, "xiv-attempt-sweep-0003", 10)).toMatchObject({
        status: "pending",
      });
      // a cart equivalent to an open attempt is refused as NOT_REUSABLE first (atomic-quota design); a different cart hits the quota
      expect(
        appCode(await caught(create(owner, "xiv-attempt-sweep-0004", 8)))
      ).toBe("CHECKOUT_ATTEMPT_NOT_REUSABLE");
      expect(
        appCode(await caught(create(owner, "xiv-attempt-sweep-0005", 8, 2)))
      ).toBe("EXCLUSIVE_QUOTA_EXCEEDED");
    });

    it("the e-mail context carries recipient, drop and grant data but never a code or a hash", async () => {
      await createDrop();
      const granted = await unlockedGrantFor(owner, 2);
      const context = await store().notificationContext(granted.requestId);
      expect(context).toMatchObject({
        userEmail: "um@example.invalid",
        dropName: "Clã XIV Bis × L4CKOS",
        timezone: "America/Sao_Paulo",
        unitLimit: 2,
        productId: 4,
      });
      const [grants] = await pool.query<any[]>(
        "SELECT codeHash FROM exclusiveGrants"
      );
      const dump = JSON.stringify(context);
      expect(dump).not.toContain(granted.code);
      expect(dump).not.toContain(grants[0].codeHash);
      expect(await store().notificationContext(99999)).toBeNull();
    });

    // ---------------------------------------------------------------- drop lifecycle
    it("14. a closed or not-yet-open drop blocks new purchases but stays visible", async () => {
      await createDrop();
      await unlockedGrantFor(owner, 3);
      at("2026-11-30T16:00:00.000Z"); // after 12:00-03:00 = 15:00Z
      expect(
        appCode(await caught(create(owner, "xiv-attempt-closed-0001", 8)))
      ).toBe("EXCLUSIVE_DROP_CLOSED");
      const view = await client("no-session").exclusiveDrops.forProduct.query({
        productId: 4,
      });
      expect(view).toMatchObject({
        exclusive: true,
        drop: { state: "closed" },
      });
      at("2026-11-20T11:00:00.000Z"); // before 09:00-03:00 = 12:00Z
      expect(
        appCode(await caught(create(owner, "xiv-attempt-closed-0002", 8)))
      ).toBe("EXCLUSIVE_DROP_CLOSED");
      expect(
        await client("no-session").exclusiveDrops.forProduct.query({
          productId: 4,
        })
      ).toMatchObject({ drop: { state: "scheduled" } });
    });

    it("an admin early-close ends the drop immediately", async () => {
      await createDrop();
      await unlockedGrantFor(owner, 3);
      await createDrop({ id: 1, status: "closed" });
      expect(
        appCode(await caught(create(owner, "xiv-attempt-early-0001", 8)))
      ).toBe("EXCLUSIVE_DROP_CLOSED");
    });

    it("drop configuration validates: ambiguous local times and inverted windows are refused; a product belongs to one drop", async () => {
      expect(
        trpcCode(
          await caught(createDrop({ purchaseStartsAt: "2026-11-20T09:00:00" }))
        )
      ).toBe("BAD_REQUEST");
      expect(
        trpcCode(
          await caught(
            createDrop({ purchaseEndsAt: "2026-11-01T00:00:00-03:00" })
          )
        )
      ).toBe("BAD_REQUEST");
      await createDrop();
      expect(await caught(createDrop({ slug: "other-drop" }))).toBeTruthy(); // product 4 already in xiv-bis-cla
    });

    it("legacy checkout cannot carry an exclusive product", async () => {
      await createDrop();
      expect(
        appCode(await caught(store().assertNoExclusiveProducts([4])))
      ).toBeUndefined(); // domain error, not a tRPC one
      await expect(
        store().assertNoExclusiveProducts([4])
      ).rejects.toMatchObject({ code: "EXCLUSIVE_ACCESS_REQUIRED" });
      await expect(
        store().assertNoExclusiveProducts([5])
      ).resolves.toBeUndefined();
    });

    it("fails closed when access cannot be proven (the exclusive tables are unreadable)", async () => {
      await createDrop();
      await pool.query(
        "RENAME TABLE exclusiveDropProducts TO exclusiveDropProducts_gone"
      );
      try {
        // Missing mapping means the server cannot establish whether any product is exclusive.
        const error = await caught(
          create(owner, "city-noise-attempt-002", 11, 1, 5)
        );
        expect(appCode(error)).toBe("EXCLUSIVE_ACCESS_UNVERIFIABLE");
        expect(providerCalls).toHaveLength(0);
      } finally {
        await pool.query(
          "RENAME TABLE exclusiveDropProducts_gone TO exclusiveDropProducts"
        );
      }
      await pool.query(
        "ALTER TABLE exclusiveGrants RENAME COLUMN unlockedAt TO unlockedAt_gone"
      );
      try {
        // ...but a broken grant lookup for an exclusive product is NOT treated as access.
        const error = await caught(create(owner, "xiv-attempt-closed-9999", 8));
        expect([
          "EXCLUSIVE_ACCESS_UNVERIFIABLE",
          "EXCLUSIVE_ACCESS_REQUIRED",
        ]).toContain(appCode(error));
      } finally {
        await pool.query(
          "ALTER TABLE exclusiveGrants RENAME COLUMN unlockedAt_gone TO unlockedAt"
        );
      }
    });

    // ---------------------------------------------------------------- e-mail events
    it("e-mail outbox: one event per decision, no duplicates on retries, no code inside, lease reclaim, failure isolation", async () => {
      await createDrop();
      const request = await owner().exclusiveDrops.requestAccess.mutate({
        dropId: 1,
      });
      await owner().exclusiveDrops.requestAccess.mutate({ dropId: 1 }); // duplicate click
      const approved = await admin().exclusiveDrops.admin.approve.mutate({
        requestId: request.requestId,
        unitLimit: 2,
        expiresAt: "2026-11-30T12:00:00-03:00",
      });
      expect(
        await caught(
          admin().exclusiveDrops.admin.approve.mutate({
            requestId: request.requestId,
            unitLimit: 2,
            expiresAt: "2026-11-30T12:00:00-03:00",
          })
        )
      ).toBeTruthy(); // retried approval
      await admin().exclusiveDrops.admin.revoke.mutate({
        requestId: request.requestId,
      });
      const other82 = await other().exclusiveDrops.requestAccess.mutate({
        dropId: 1,
      });
      await admin().exclusiveDrops.admin.reject.mutate({
        requestId: other82.requestId,
      });

      const [outbox] = await pool.query<any[]>(
        "SELECT eventType, eventKey, status FROM exclusiveNotificationOutbox ORDER BY id"
      );
      expect(outbox.map(row => row.eventType)).toEqual([
        "request_received",
        "access_approved",
        "access_revoked",
        "request_received",
        "access_rejected",
      ]);
      expect(new Set(outbox.map(row => row.eventKey)).size).toBe(outbox.length);
      expect(JSON.stringify(outbox)).not.toContain(approved.code);

      const delivered: NotificationEvent[] = [];
      const notifier: ExclusiveDropNotifier = {
        async send(event) {
          if (event.eventType === "access_rejected")
            throw new Error(
              `provider down for ${approved.code} customer@example.invalid`
            );
          delivered.push(event);
        },
      };
      const first = await store().dispatchNotifications(notifier);
      expect(first).toMatchObject({ claimed: 5, sent: 4, failed: 1 });
      const again = await store().dispatchNotifications(notifier); // re-entry after success: nothing is resent
      expect(again).toMatchObject({ claimed: 0 });
      expect(delivered.map(event => event.eventKey)).toHaveLength(4);
      const [failed] = await pool.query<any[]>(
        "SELECT lastError FROM exclusiveNotificationOutbox WHERE status = 'failed'"
      );
      expect(failed[0].lastError).not.toContain(approved.code); // sanitized
      expect(failed[0].lastError).not.toContain("customer@example.invalid");
      expect(failed[0].lastError).toBe("DELIVERY_OUTCOME_UNCONFIRMED");

      // orphaned lease: reclaimable only after it expires
      await pool.query(
        "UPDATE exclusiveNotificationOutbox SET status='processing', leaseExpiresAt='2026-11-20 14:00:00.000' WHERE status='failed'"
      );
      const reclaimed = await store().dispatchNotifications({
        async send(event) {
          delivered.push(event);
        },
      });
      expect(reclaimed).toMatchObject({ claimed: 1, sent: 1 });
    });

    it("e-mail outbox: two workers cannot claim and send the same leased event", async () => {
      await createDrop();
      await owner().exclusiveDrops.requestAccess.mutate({ dropId: 1 });

      let beginSend!: () => void;
      const sendStarted = new Promise<void>(resolve => {
        beginSend = resolve;
      });
      let releaseSend!: () => void;
      const holdProvider = new Promise<void>(resolve => {
        releaseSend = resolve;
      });
      let calls = 0;
      const notifier: ExclusiveDropNotifier = {
        async send() {
          calls += 1;
          beginSend();
          await holdProvider;
        },
      };

      const firstWorker = store().dispatchNotifications(notifier);
      await sendStarted;
      const secondWorker = await store().dispatchNotifications(notifier);
      releaseSend();

      expect(secondWorker).toMatchObject({ claimed: 0, sent: 0 });
      expect(await firstWorker).toMatchObject({
        claimed: 1,
        sent: 1,
        failed: 0,
      });
      expect(calls).toBe(1);
    });

    // ---------------------------------------------------------------- STOCK non-regression
    it("16. STOCK dedupe still applies to exclusive carts: the same cart under another attemptId is rejected by STOCK, quota intact", async () => {
      await createDrop();
      await unlockedGrantFor(owner, 3);
      await create(owner, "xiv-attempt-dedupe-0001", 8);
      const duplicate = await caught(
        create(owner, "xiv-attempt-dedupe-0002", 8)
      );
      expect(appCode(duplicate)).toBe("CHECKOUT_ATTEMPT_NOT_REUSABLE");
      expect(providerCalls).toHaveLength(1);
      const [claims] = await pool.query<any[]>(
        "SELECT COALESCE(SUM(units),0) AS n FROM exclusiveGrantUsage u LEFT JOIN stockCheckoutAttempts a ON a.attemptId = u.attemptId WHERE a.attemptId IS NOT NULL"
      );
      expect(Number(claims[0].n)).toBe(1); // the rejected duplicate left no persisted claim
    });
  }
);

/** Same as unlockedGrant but bound to the test-scoped helpers above. */
async function unlockedGrantFor(
  session: () => ReturnType<typeof client>,
  unitLimit = 3,
  expiresAt = "2026-11-30T12:00:00-03:00"
) {
  return unlockedGrant(session, unitLimit, expiresAt, 1);
}
