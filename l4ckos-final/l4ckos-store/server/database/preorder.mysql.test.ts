import { ENV } from "../_core/env";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Connection } from "mysql2/promise";
import { checkout, checkoutItemSchema, type CheckoutInput } from "./checkout";
import {
  query as rawQuery,
  saveBatch,
  assignBatchProducts,
  transitionBatch,
  productionSummary,
  batchEditSchema,
} from "./productionBatches";
import {
  openBackupConnection,
  backupDatabase,
  restoreDatabase,
  assertLocalRestoreTarget,
} from "./backupRestore";
import {
  bootstrapArtifacts,
  currentBootstrapArtifacts,
  readContract,
  readCurrentContract,
} from "../../database/schema/artifacts";
import {
  readStructuralSchema,
  structuralHash,
  sha256,
} from "../../database/schema/fingerprint";
import { bootstrapCurrentDatabase } from "../../database/bootstrap/bootstrap";
import { baselineDatabase } from "../../database/schema/baseline";
import { migrateDatabase, loadLineage } from "../../database/migrations/runner";
import { ledgerRows } from "../../database/schema/governance";
import { productionBatchesRouter } from "../routers/productionBatches";
import {
  batchAcceptsSales,
  productionLabel,
  MIXED_SHIPPING_NOTICE,
} from "../../shared/preorder";
async function query(c: Connection, sql: string, values: unknown[] = []) {
  return (await rawQuery(c, sql, values)).map(r =>
    Object.hasOwn(r, "n") ? { ...r, n: Number(r.n) } : r
  );
}
const socketPath =
  process.env.L4CKOS_LOCAL_MYSQL_SOCKET ??
  "/tmp/l4ckos-reconciliation-socket/mysqld.sock";
const url = (name: string) => `mysql://root@localhost/${name}`;
const commit = "83ee0d835e9bacadc12ac3d08603ce7600135b97";
const connections: Connection[] = [],
  names: string[] = [];
let root: Connection;
async function database(version: 1 | 2 = 2, seed = true) {
  const name =
    "l4ckos_test_preorder_" + randomUUID().replaceAll("-", "").slice(0, 10);
  assertLocalRestoreTarget(url(name), socketPath);
  await root.query(
    `CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  names.push(name);
  const c = await openBackupConnection(url(name), socketPath);
  connections.push(c);
  for (const s of (version === 2
    ? await currentBootstrapArtifacts()
    : await bootstrapArtifacts()
  ).statements)
    await c.query(s.sql);
  if (seed) {
    await c.query(
      "INSERT INTO users (id,openId,name,role) VALUES (1,'synthetic-preorder-admin','Synthetic Admin','admin'),(2,'synthetic-preorder-user','Synthetic User','user')"
    );
    await c.query(
      "INSERT INTO products (id,name,category,price,stock) VALUES (1,'Sideways Dreams','fixture',8000,0),(2,'Unknown Territory','fixture',5000,0),(3,'Stock Fixture','fixture',3000,10)"
    );
    await c.query(
      "INSERT INTO productVariants (id,productId,name,size,color,stock,sku) VALUES (1,1,'M / Preto','M','Preto',0,'FIXTURE-M'),(2,2,'G / Preto','G','Preto',0,'FIXTURE-G'),(3,1,'P / Preto','P','Preto',0,'FIXTURE-P')"
    );
  }
  return c;
}
const edit = {
  name: "DROP 01",
  salesOpenAt: null,
  salesCloseAt: null,
  estimatedShippingStart: "2026-11-05T00:00:00Z",
  estimatedShippingEnd: "2026-11-12T00:00:00Z",
  minimumQuantity: 10,
  maximumQuantity: null,
};
async function fixture(maximumQuantity: number | null = null) {
  const c = await database();
  const b = await saveBatch(
    c,
    { ...edit, minimumQuantity: 0, maximumQuantity },
    1
  );
  await assignBatchProducts(c, { id: b.id, productIds: [1, 2] }, 1);
  await transitionBatch(
    c,
    { id: b.id, status: "OPEN", acknowledgePaidOrders: false },
    1
  );
  return { c, id: b.id };
}
const payment = {
  method: "PIX" as const,
  customerId: "synthetic",
  paymentId: "synthetic",
  invoiceUrl: "http://localhost/mock-payment",
  pixQrCode: null,
  pixCopyPaste: "synthetic",
  bankSlipUrl: null,
  digitableLine: null,
  nossoNumero: null,
  billingType: "PIX",
};
const adapters = () => ({
  quote: vi.fn(async () => ({
    options: [{ id: "local", label: "Local", price: 5 }],
  })),
  charge: vi.fn(async () => payment),
});
const input = (
  items: CheckoutInput["items"] = [{ productId: 1, variantId: 1, quantity: 2 }]
): CheckoutInput => ({
  userId: 2,
  checkoutAttemptId: randomUUID(),
  items,
  method: "PIX",
  shipping: { cep: "70000000", optionId: "local" },
  shippingAddress: {
    recipient: "Synthetic",
    zipCode: "70000000",
    street: "Fixture",
    number: "1",
    neighborhood: "Fixture",
    city: "Brasilia",
    state: "DF",
  },
  customer: { name: "Synthetic", cpfCnpj: "11144477735" },
});
async function paid(c: Connection, id: number) {
  await c.query(
    "UPDATE orders SET status='paid',paymentStatus='confirmed',paymentConfirmationSource='manual',paymentConfirmedAt=UTC_TIMESTAMP(),paymentConfirmedBy=1 WHERE id=?",
    [id]
  );
}
async function other(c: Connection) {
  const d = await openBackupConnection(url(c.config.database!), socketPath);
  connections.push(d);
  return d;
}
const context = async (c: Connection) => ({
  url: url(c.config.database!),
  socketPath,
  applicationCommit: commit,
  approvedFingerprint: (await readCurrentContract()).fingerprint,
});

describe("PREORDER authoritative contracts", () => {
  it.each([
    { salesMode: "STOCK" },
    { salesMode: "PREORDER" },
    { batchId: 1 },
    { productionBatchId: 1 },
    { confirmedDemand: 5 },
    { price: 1 },
    { unitPrice: 1 },
    { totalPrice: 1 },
  ])("rejects client authority %j", extra =>
    expect(
      checkoutItemSchema.safeParse({ productId: 1, quantity: 2, ...extra })
        .success
    ).toBe(false)
  );
  it.each([0, -1, 1.5, 100, Infinity, NaN])("rejects quantity %s", quantity =>
    expect(
      checkoutItemSchema.safeParse({ productId: 1, quantity }).success
    ).toBe(false)
  );
  it("validates operational minimum/maximum and date windows", () => {
    expect(
      batchEditSchema.safeParse({
        ...edit,
        minimumQuantity: 10,
        maximumQuantity: 9,
      }).success
    ).toBe(false);
    expect(
      batchEditSchema.safeParse({
        ...edit,
        salesOpenAt: "2026-10-20T00:00:00Z",
        salesCloseAt: "2026-10-01T00:00:00Z",
      }).success
    ).toBe(false);
  });
  it("derives customer progress and mixed shipping language", () => {
    expect(productionLabel("IN_PRODUCTION")).toBe("Em produção");
    expect(productionLabel("RECEIVED")).toContain("preparando");
    expect(MIXED_SHIPPING_NOTICE).toBe("Seu pedido contém itens com prazos diferentes. O envio será feito em uma única remessa quando todos os itens estiverem disponíveis.");
    expect(
      batchAcceptsSales({
        id: 1,
        name: "fixture",
        status: "CLOSED",
        salesOpenAt: null,
        salesCloseAt: null,
        estimatedShippingStart: null,
        estimatedShippingEnd: null,
      })
    ).toBe(false);
  });
  it.each([null, { id: 2, role: "user" }])(
    "rejects nonadmin batch list %j",
    async user => {
      await expect(
        productionBatchesRouter
          .createCaller({ user, req: {}, res: {} } as any)
          .list()
      ).rejects.toMatchObject({ code: user ? "FORBIDDEN" : "UNAUTHORIZED" });
    }
  );
  it("rejects unauthenticated mutation and user transitions", async () => {
    await expect(
      productionBatchesRouter
        .createCaller({ user: null, req: {}, res: {} } as any)
        .save(edit)
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      productionBatchesRouter
        .createCaller({
          user: { id: 2, role: "user" },
          req: {},
          res: {},
        } as any)
        .transition({ id: 1, status: "OPEN", acknowledgePaidOrders: false })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("keeps 0000–0020 unchanged and 0021 additive", async () => {
    const sql = await readFile(
      new URL(
        "../../database/migrations/0021_preorder_production_batches.sql",
        import.meta.url
      ),
      "utf8"
    );
    expect(sql).not.toMatch(/\b(DROP|TRUNCATE|RENAME)\b|\bDELETE\s+FROM\b/);
    const lineage = await loadLineage();
    expect(sha256(sql)).toBe(lineage.entries[0].checksum);
    expect(lineage.entries[0].expectedPreFingerprint).toBe(
      "f2baf7519cb425c955bfd0f697da10afa670ee57763e3f641b61a09ba75b7f8d"
    );
  });
});

describe.skipIf(process.env.L4CKOS_MYSQL_TEST !== "1")(
  "PREORDER real MySQL 8.4.11",
  () => {
    beforeAll(async () => {
      process.env.L4CKOS_LOCAL_RESTORE = "1";
      process.env.L4CKOS_LOCAL_SCHEMA = "1";
      root = await openBackupConnection(
        "mysql://root@localhost/mysql",
        socketPath
      );
      expect((await query(root, "SELECT VERSION() v"))[0].v).toBe("8.4.11");
    });
    afterAll(async () => {
      for (const c of connections) await c.end();
      for (const name of names) await root.query(`DROP DATABASE \`${name}\``);
      await root.end();
    });
    it("a payment interleaved after demand SELECT cannot split groups/totals/pending", async () => {
      const {c, id} = await fixture();
      const order = await checkout(c, input(), adapters());
      const payer = await other(c);
      const original = c.query.bind(c);
      let interleaved = false;
      c.query = (async (...args: any[]) => {
        const result = await (original as any)(...args);
        if (typeof args[0] === "string" && args[0].includes("FROM orderItems i JOIN orders o") && !interleaved) {
          interleaved = true;
          await paid(payer, order.orderId);
        }
        return result;
      }) as typeof c.query;
      try {
        const snapshot = await productionSummary(c, id);
        expect(interleaved).toBe(true);
        expect(snapshot).toMatchObject({ confirmedQuantity: 0, pendingQuantity: 2, paidOrders: 0, pendingOrders: 1, groups: [] });
        const next = await productionSummary(c, id);
        expect(next).toMatchObject({ confirmedQuantity: 2, pendingQuantity: 0, paidOrders: 1, pendingOrders: 0 });
        expect(next.groups.reduce((n,g) => n + g.quantity,0)).toBe(next.confirmedQuantity);
      } finally { c.query = original; }
    });
    it("OPEN accepts zero physical stock; full amount; orderItems context and no stock reservations; external IO after commit", async () => {
      const { c, id } = await fixture();
      const a = adapters();
      a.charge.mockImplementation(async args => {
        const observer = await other(c);
        expect(
          (
            await query(
              observer,
              "SELECT quantity,unitPrice,totalPrice,salesModeAtPurchase,productionBatchId,productionBatchNameAtPurchase FROM orderItems"
            )
          )[0]
        ).toMatchObject({
          quantity: 2,
          unitPrice: 8000,
          totalPrice: 16000,
          salesModeAtPurchase: "PREORDER",
          productionBatchId: id,
          productionBatchNameAtPurchase: "DROP 01",
        });
        await observer.beginTransaction();
        await observer.query(
          "SELECT id FROM productionBatches WHERE id=? FOR UPDATE NOWAIT",
          [id]
        );
        await observer.rollback();
        expect(args.value).toBe(165);
        return payment;
      });
      const r = await checkout(c, input(), a);
      expect(r.totalPrice).toBe(16500);
      expect(
        (await query(c, "SELECT COUNT(*) n FROM stockReservations"))[0].n
      ).toBe(0);
      expect((await productionSummary(c, id)).confirmedQuantity).toBe(0);
    });
    it.each([
      "DRAFT",
      "CLOSED",
      "CANCELLED",
      "IN_PRODUCTION",
      "RECEIVED",
      "SHIPPING",
      "COMPLETED",
    ])("%s rejects before order/provider", async status => {
      const { c } = await fixture();
      await c.query("UPDATE productionBatches SET status=?", [status]);
      const a = adapters();
      await expect(checkout(c, input(), a)).rejects.toThrow(
        "CHECKOUT_BATCH_UNAVAILABLE"
      );
      expect(a.charge).not.toHaveBeenCalled();
      expect((await query(c, "SELECT COUNT(*) n FROM orders"))[0].n).toBe(0);
    });
    it.each([
      "salesOpenAt=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 DAY)",
      "salesCloseAt=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND)",
    ])("rejects date bypass %s", async condition => {
      const { c } = await fixture();
      await c.query("UPDATE productionBatches SET " + condition);
      await expect(checkout(c, input(), adapters())).rejects.toThrow(
        "CHECKOUT_BATCH_UNAVAILABLE"
      );
    });
    it("rejects missing batch/product association and foreign variant", async () => {
      const { c, id } = await fixture();
      await expect(
        checkout(
          c,
          input([{ productId: 1, variantId: 2, quantity: 1 }]),
          adapters()
        )
      ).rejects.toThrow("CHECKOUT_VARIANT_NOT_FOUND");
      await c.query("DELETE FROM productionBatchProducts WHERE productId=1");
      await expect(checkout(c, input(), adapters())).rejects.toThrow(
        "CHECKOUT_BATCH_REQUIRED"
      );
      await expect(
        c.query(
          "INSERT INTO productionBatchProducts (productId,productionBatchId) VALUES (1,999999)"
        )
      ).rejects.toMatchObject({ code: "ER_NO_REFERENCED_ROW_2" });
      expect((await query(c, "SELECT COUNT(*) n FROM orders"))[0].n).toBe(0);
    });
    it("retry is idempotent; quantity, options, price and batch snapshots survive renames", async () => {
      const { c, id } = await fixture();
      const request = input(),
        a = adapters();
      const r = await checkout(c, request, a);
      await c.query("UPDATE products SET name='Renamed',price=1 WHERE id=1");
      await saveBatch(c, { ...edit, id, name: "Renamed drop" }, 1);
      const replay = await checkout(c, request, a);
      expect(replay.replayed).toBe(true);
      expect(replay.items[0]).toMatchObject({
        productName: "Sideways Dreams",
        unitPrice: 8000,
        productionBatchNameAtPurchase: "DROP 01",
        size: "M",
        color: "Preto",
      });
      expect(a.charge).toHaveBeenCalledOnce();
      expect((await query(c, "SELECT COUNT(*) n FROM orderItems"))[0].n).toBe(
        1
      );
      expect(r.items[0].estimatedShippingStartAtPurchase).toBe(
        "2026-11-05T00:00:00.000Z"
      );
    });
    it("confirmed demand excludes unpaid, counterfeit confirmation and cancelled; groups sizes and products once", async () => {
      const { c, id } = await fixture();
      await saveBatch(c, { ...edit, id }, 1);
      const p = await checkout(
        c,
        input([
          { productId: 1, variantId: 1, quantity: 2 },
          { productId: 1, variantId: 3, quantity: 3 },
          { productId: 2, variantId: 2, quantity: 4 },
        ]),
        adapters()
      );
      await paid(c, p.orderId);
      const unpaid = await checkout(c, input(), adapters());
      const cancelled = await checkout(c, input(), adapters());
      await paid(c, cancelled.orderId);
      await c.query("UPDATE orders SET status='cancelled' WHERE id=?", [
        cancelled.orderId,
      ]);
      const forged = await checkout(c, input(), adapters());
      await c.query(
        "UPDATE orders SET paymentStatus='confirmed',status='paid' WHERE id=?",
        [forged.orderId]
      );
      const summary = await productionSummary(c, id);
      expect(summary).toMatchObject({
        paidOrders: 1,
        confirmedQuantity: 9,
        confirmedItemValueCents: 60000,
        minimumRemaining: 1,
        pendingOrders: 2,
        pendingQuantity: 4,
      });
      expect(summary.groups).toHaveLength(3);
      expect(
        summary.groups
          .filter(g => g.productId === 1)
          .reduce((n, g) => n + g.quantity, 0)
      ).toBe(5);
      expect(summary.groups.find(g => g.size === "P")?.quantity).toBe(3);
    });
    it.each([2, 3])("below/exact maximum accepts %i pieces", async quantity => {
      const { c } = await fixture(3);
      expect(
        (
          await checkout(
            c,
            input([{ productId: 1, variantId: 1, quantity }]),
            adapters()
          )
        ).orderId
      ).toBeGreaterThan(0);
    });
    it("above maximum rejects and rolls back", async () => {
      const { c } = await fixture(3),
        a = adapters();
      await expect(
        checkout(c, input([{ productId: 1, quantity: 4 }]), a)
      ).rejects.toThrow("CHECKOUT_BATCH_CAPACITY_EXCEEDED");
      expect(a.charge).not.toHaveBeenCalled();
      expect((await query(c, "SELECT COUNT(*) n FROM orderItems"))[0].n).toBe(
        0
      );
    });
    it("serializes capacity across different products and eight independent concurrent attempts", async () => {
      const { c, id } = await fixture(5),
        clients = await Promise.all(Array.from({ length: 8 }, () => other(c))),
        a = adapters();
      const results = await Promise.allSettled(
        clients.map((client, i) =>
          checkout(client, input([{ productId: (i % 2) + 1, quantity: 1 }]), a)
        )
      );
      expect(results.filter(r => r.status === "fulfilled")).toHaveLength(5);
      expect(
        results
          .filter(r => r.status === "rejected")
          .every(
            r =>
              (r as PromiseRejectedResult).reason.message ===
              "CHECKOUT_BATCH_CAPACITY_EXCEEDED"
          )
      ).toBe(true);
      expect(
        Number(
          (
            await query(
              c,
              "SELECT SUM(quantity) n FROM orderItems WHERE productionBatchId=?",
              [id]
            )
          )[0].n
        )
      ).toBe(5);
      expect(a.charge).toHaveBeenCalledTimes(5);
    });
    it("counts pending capacity; cancellation frees it; paid never double-counts it", async () => {
      const { c, id } = await fixture(2);
      const r = await checkout(c, input(), adapters());
      await expect(checkout(c, input(), adapters())).rejects.toThrow(
        "CHECKOUT_BATCH_CAPACITY_EXCEEDED"
      );
      await paid(c, r.orderId);
      await expect(
        checkout(c, input([{ productId: 2, quantity: 1 }]), adapters())
      ).rejects.toThrow("CHECKOUT_BATCH_CAPACITY_EXCEEDED");
      await c.query("UPDATE orders SET status='cancelled' WHERE id=?", [
        r.orderId,
      ]);
      await checkout(c, input(), adapters());
      expect((await productionSummary(c, id)).confirmedQuantity).toBe(0);
    });
    it("uncertain provider outcome retains one claim and blocks charge retry", async () => {
      const { c } = await fixture(2),
        a = adapters(),
        r = input();
      a.charge.mockRejectedValue(Error("synthetic"));
      await expect(checkout(c, r, a)).rejects.toThrow(
        "CHECKOUT_RECOVERY_REQUIRED"
      );
      await expect(checkout(c, r, a)).rejects.toThrow(
        "CHECKOUT_RECOVERY_REQUIRED"
      );
      await expect(checkout(c, input(), adapters())).rejects.toThrow(
        "CHECKOUT_BATCH_CAPACITY_EXCEEDED"
      );
      expect(a.charge).toHaveBeenCalledOnce();
    });
    it("unlimited preorder accepts multiple orders and large quantity without false stock", async () => {
      const { c } = await fixture();
      await checkout(c, input([{ productId: 1, quantity: 99 }]), adapters());
      await checkout(c, input([{ productId: 2, quantity: 99 }]), adapters());
      expect(
        (await query(c, "SELECT stock FROM products WHERE id=1"))[0].stock
      ).toBe(0);
    });
    it("mixed cart totals, discounts, historical context, STOCK-only reservations and idempotency", async () => {
      const { c, id } = await fixture();
      await c.query(
        "INSERT INTO coupons (code,type,value) VALUES ('SYNTHETIC','percent',10)"
      );
      const req = {
          ...input([
            { productId: 1, variantId: 1, quantity: 2 },
            { productId: 3, quantity: 3 },
          ]),
          couponCode: "SYNTHETIC",
        },
        a = adapters();
      const r = await checkout(c, req, a);
      expect(r.totalPrice).toBe(22950);
      expect(r.items).toHaveLength(2);
      expect(r.items[0].productionBatchId).toBe(id);
      expect(r.items[1].salesModeAtPurchase).toBe("STOCK");
      expect(
        (await query(c, "SELECT productId,quantity FROM stockReservations"))[0]
      ).toMatchObject({ productId: 3, quantity: 3 });
      expect((await checkout(c, req, a)).replayed).toBe(true);
      expect(a.charge).toHaveBeenCalledOnce();
    });
    it("mixed stock failure rolls back all preorder items and logical capacity", async () => {
      const { c } = await fixture(2);
      await expect(
        checkout(
          c,
          input([
            { productId: 1, quantity: 2 },
            { productId: 3, quantity: 11 },
          ]),
          adapters()
        )
      ).rejects.toThrow("CHECKOUT_STOCK_INSUFFICIENT");
      expect((await query(c, "SELECT COUNT(*) n FROM orders"))[0].n).toBe(0);
      expect((await query(c, "SELECT COUNT(*) n FROM orderItems"))[0].n).toBe(
        0
      );
      await checkout(c, input(), adapters());
    });
    it("admin lifecycle transitions and audit; paid cancellation needs acknowledgement; no refund", async () => {
      const { c, id } = await fixture();
      const r = await checkout(c, input(), adapters());
      await paid(c, r.orderId);
      await expect(
        transitionBatch(
          c,
          { id, status: "COMPLETED", acknowledgePaidOrders: false },
          1
        )
      ).rejects.toThrow("Transição");
      await expect(
        transitionBatch(
          c,
          { id, status: "CANCELLED", acknowledgePaidOrders: false },
          1
        )
      ).rejects.toThrow("Confirme");
      for (const status of [
        "CLOSED",
        "IN_PRODUCTION",
        "RECEIVED",
        "SHIPPING",
        "COMPLETED",
      ] as const)
        await transitionBatch(
          c,
          { id, status, acknowledgePaidOrders: false },
          1
        );
      const b = (await productionSummary(c, id)).batch;
      expect(b.productionStartedAt).toBeTruthy();
      expect(b.receivedAt).toBeTruthy();
      expect(b.shippingStartedAt).toBeTruthy();
      expect(b.completedAt).toBeTruthy();
      await expect(
        transitionBatch(
          c,
          { id, status: "OPEN", acknowledgePaidOrders: false },
          1
        )
      ).rejects.toThrow("Transição");
      expect(
        (
          await query(
            c,
            "SELECT COUNT(*) n FROM auditLogs WHERE actorType='admin' AND entity='productionBatch'"
          )
        )[0].n
      ).toBe(8);
    });
    it("cancelled lot retains paid evidence, warns, and rejects further sales", async () => {
      const { c, id } = await fixture();
      const r = await checkout(c, input(), adapters());
      await paid(c, r.orderId);
      await transitionBatch(
        c,
        { id, status: "CANCELLED", acknowledgePaidOrders: true },
        1
      );
      expect((await productionSummary(c, id)).confirmedQuantity).toBe(2);
      await expect(checkout(c, input(), adapters())).rejects.toThrow(
        "CHECKOUT_BATCH_UNAVAILABLE"
      );
      expect(
        (await query(c, "SELECT paymentStatus FROM orders"))[0].paymentStatus
      ).toBe("confirmed");
    });
    it("admin edit cannot shrink maximum below claimed capacity; assignments preserve snapshots", async () => {
      const { c, id } = await fixture(3);
      const r = await checkout(c, input(), adapters());
      await expect(
        saveBatch(c, { ...edit, id, minimumQuantity: 0, maximumQuantity: 1 }, 1)
      ).rejects.toThrow("capacidade");
      await assignBatchProducts(c, { id, productIds: [2] }, 1);
      expect(
        (await query(c, "SELECT salesMode FROM products WHERE id=1"))[0]
          .salesMode
      ).toBe("STOCK");
      expect(
        (
          await query(
            c,
            "SELECT productionBatchId FROM orderItems WHERE orderId=?",
            [r.orderId]
          )
        )[0].productionBatchId
      ).toBe(id);
    });
    it("full admin API list/create/edit/associate/transition/summary guarded and audited", async () => {
      const c = await database(),
        prior = process.env.DATABASE_URL;
      process.env.DATABASE_URL = url(c.config.database!);
      const caller = productionBatchesRouter.createCaller({
        user: { id: 1, role: "admin", email: ENV.adminEmails[0] },
        req: {},
        res: {},
      } as any);
      try {
        const b = await caller.save(edit);
        await caller.save({ ...edit, id: b.id, name: "API Drop" });
        await caller.associate({ id: b.id, productIds: [1, 2] });
        await caller.transition({
          id: b.id,
          status: "OPEN",
          acknowledgePaidOrders: false,
        });
        expect((await caller.list())[0].name).toBe("API Drop");
        expect((await caller.detail(b.id)).products).toHaveLength(2);
        await expect(caller.detail(999999)).rejects.toMatchObject({
          code: "BAD_REQUEST",
        });
        expect(
          (
            await query(
              c,
              "SELECT COUNT(*) n FROM auditLogs WHERE entity='productionBatch'"
            )
          )[0].n
        ).toBe(4);
      } finally {
        if (prior === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = prior;
      }
    });
    it("0021 preserves historical STOCK data, uses V2 runner, repeats once; fresh v2 matches independently", async () => {
      const c = await database(1, false),
        pre = await readContract(),
        post = await readCurrentContract();
      await c.query(
        "INSERT INTO users (id,openId) VALUES (1,'synthetic-historical')"
      );
      await c.query(
        "INSERT INTO products (id,name,category,price,stock) VALUES (1,'Historical','fixture',8000,10)"
      );
      await c.query(
        "INSERT INTO orders (id,userId,totalPrice) VALUES (1,1,8000)"
      );
      await c.query(
        "INSERT INTO orderItems (orderId,productId,quantity,unitPrice,totalPrice) VALUES (1,1,1,8000,8000)"
      );
      await baselineDatabase(c, {
        ...(await context(c)),
        approvedFingerprint: pre.fingerprint,
      });
      const migrated = await migrateDatabase(c, await context(c));
      expect(migrated.applied).toEqual(["0021_preorder_production_batches"]);
      expect(migrated.fingerprint).toBe(post.fingerprint);
      expect((await migrateDatabase(c, await context(c))).status).toBe(
        "UP_TO_DATE"
      );
      expect(
        (
          await query(
            c,
            "SELECT salesModeAtPurchase,productionBatchId,unitPrice FROM orderItems"
          )
        )[0]
      ).toMatchObject({
        salesModeAtPurchase: "STOCK",
        productionBatchId: null,
        unitPrice: 8000,
      });
      expect((await ledgerRows(c)).map(r => r.name)).toEqual([
        "baseline-v1",
        "0021_preorder_production_batches",
      ]);
      const fresh = await database(1, false);
      for (const table of (await bootstrapArtifacts()).statements.reverse())
        await fresh.query("DROP TABLE `" + table.table + "`");
      expect(
        (await bootstrapCurrentDatabase(fresh, await context(fresh)))
          .fingerprint
      ).toBe(post.fingerprint);
      const direct = await database(2, false);
      expect(structuralHash(await readStructuralSchema(direct))).toBe(
        post.fingerprint
      );
    });
    it("MySQL backup roundtrip includes batches, associations, snapshots, payment, audit and STOCK reservations", async () => {
      const { c, id } = await fixture();
      const r = await checkout(
        c,
        input([
          { productId: 1, quantity: 2 },
          { productId: 3, quantity: 1 },
        ]),
        adapters()
      );
      await paid(c, r.orderId);
      const artifact = await backupDatabase(c);
      expect(artifact.tableManifestVersion).toBe(2);
      expect(Object.keys(artifact.tables)).toHaveLength(28);
      const destination = await database(2, false);
      await restoreDatabase(destination, JSON.parse(JSON.stringify(artifact)), {
        url: url(destination.config.database!),
        socketPath,
      });
      const restored = await backupDatabase(destination);
      expect(
        Object.fromEntries(
          Object.entries(restored.tables).map(([n, t]) => [n, t.checksum])
        )
      ).toEqual(
        Object.fromEntries(
          Object.entries(artifact.tables).map(([n, t]) => [n, t.checksum])
        )
      );
      expect(await productionSummary(destination, id)).toMatchObject({
        confirmedQuantity: 2,
        paidOrders: 1,
      });
      expect(
        (
          await query(destination, "SELECT COUNT(*) n FROM stockReservations")
        )[0].n
      ).toBe(1);
    });
    it("rejects batch closure during shipping quote before local persistence", async () => {
      const { c } = await fixture(),
        a = adapters();
      a.quote.mockImplementation(async () => {
        await c.query("UPDATE productionBatches SET status='CLOSED'");
        return { options: [{ id: "local", label: "Local", price: 5 }] };
      });
      await expect(checkout(c, input(), a)).rejects.toThrow(
        "CHECKOUT_BATCH_UNAVAILABLE"
      );
      expect((await query(c, "SELECT COUNT(*) n FROM orders"))[0].n).toBe(0);
      expect(a.charge).not.toHaveBeenCalled();
    });
    it("normal payment confirmation, mixed stock consumption, ownership and shipping readiness through ORM", async () => {
      const { c, id } = await fixture(2),
        r = await checkout(
          c,
          input([
            { productId: 1, quantity: 2 },
            { productId: 3, quantity: 2 },
          ]),
          adapters()
        );
      const prior = process.env.DATABASE_URL;
      process.env.DATABASE_URL =
        url(c.config.database!) +
        "?socketPath=" +
        encodeURIComponent(socketPath);
      const db = await import("../db");
      const { ordersRouter } = await import("../routers/orders");
      try {
        expect((await productionSummary(c, id)).confirmedQuantity).toBe(0);
        expect(
          (await db.getProductByIdWithDetails(1))?.productionBatch
        ).toMatchObject({
          status: "OPEN",
          capacity: {
            maximumQuantity: 2,
            claimedQuantity: 2,
            remainingQuantity: 0,
          },
        });
        expect(
          (
            await db.markOrderPaid(r.orderId, {
              source: "manual",
              actorUserId: 1,
            })
          ).updated
        ).toBe(true);
        expect(
          (
            await db.markOrderPaid(r.orderId, {
              source: "manual",
              actorUserId: 1,
            })
          ).updated
        ).toBe(false);
        expect((await productionSummary(c, id)).confirmedQuantity).toBe(2);
        expect(
          (await query(c, "SELECT stock FROM products WHERE id=3"))[0].stock
        ).toBe(8);
        expect(
          (await query(c, "SELECT stock FROM products WHERE id=1"))[0].stock
        ).toBe(0);
        const owner = ordersRouter.createCaller({
          user: { id: 2, role: "user" },
          req: {},
          res: {},
        } as any);
        const outsider = ordersRouter.createCaller({
          user: { id: 1, role: "user" },
          req: {},
          res: {},
        } as any);
        expect((await owner.detail(r.orderId)).items).toHaveLength(2);
        expect((await owner.detail(r.orderId)).items[0]).toMatchObject({
          salesModeAtPurchase: "PREORDER",
          productionBatchNameAtPurchase: "DROP 01",
          productPrice: 8000,
        });
        await expect(outsider.detail(r.orderId)).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
        await expect(
          outsider.track({ orderId: r.orderId })
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        expect((await db.getOrdersByFilters())[0].items).toHaveLength(2);
        const storefront = (await db.getProducts()).find(p => p.id === 1)!;
        expect(storefront.salesMode).toBe("PREORDER");
        expect(batchAcceptsSales(storefront.productionBatch)).toBe(true);
        expect(storefront.productionBatch?.capacity).toEqual({
          maximumQuantity: 2,
          claimedQuantity: 2,
          remainingQuantity: 0,
        });
        expect(
          (await db.getProducts()).find(p => p.id === 2)?.productionBatch
            ?.capacity
        ).toEqual(storefront.productionBatch?.capacity);
        const blocked = adapters();
        await expect(
          checkout(c, input([{ productId: 1, quantity: 4 }]), blocked)
        ).rejects.toThrow("CHECKOUT_BATCH_CAPACITY_EXCEEDED");
        expect(blocked.charge).not.toHaveBeenCalled();
        expect((await query(c, "SELECT COUNT(*) n FROM orders"))[0].n).toBe(1);
        expect(
          (await db.getProductByIdWithDetails(1))?.productionBatch?.name
        ).toBe("DROP 01");
        await expect(
          db.updateOrderAndReserveDeliveredEmailEvents(r.orderId, {
            status: "shipped",
          })
        ).rejects.toThrow("not received");
        for (const status of ["CLOSED", "IN_PRODUCTION", "RECEIVED"] as const)
          await transitionBatch(
            c,
            { id, status, acknowledgePaidOrders: false },
            1
          );
        await db.updateOrderAndReserveDeliveredEmailEvents(r.orderId, {
          status: "shipped",
        });
        expect((await owner.detail(r.orderId)).status).toBe("shipped");
        await db.updateOrderAndReserveDeliveredEmailEvents(r.orderId, {
          status: "cancelled",
        });
        await expect(
          db.updateOrderAndReserveDeliveredEmailEvents(r.orderId, {
            status: "paid",
          })
        ).rejects.toThrow("cannot be reactivated");
        expect((await productionSummary(c, id)).confirmedQuantity).toBe(0);
      } finally {
        const orm = await db.getDb();
        await (orm as any).$client.promise().end();
        if (prior === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = prior;
      }
    });
  }
);
