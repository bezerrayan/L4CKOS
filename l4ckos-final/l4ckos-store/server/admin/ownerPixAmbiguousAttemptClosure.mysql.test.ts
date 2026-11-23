import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPool, type Pool, type PoolConnection } from "mysql2/promise";
import {
  closeOwnerPixAmbiguousAttempt,
  OWNER_PIX_CLOSE_ACTION,
} from "./ownerPixAmbiguousAttemptClosure";

const isolatedNetworkMode =
  process.env.OWNER_PIX_CLOSE_MYSQL_NETWORK_MODE ?? "";
const host = process.env.OWNER_PIX_CLOSE_MYSQL_HOST ?? "";
const port = Number(process.env.OWNER_PIX_CLOSE_MYSQL_PORT ?? 0);
const database = process.env.OWNER_PIX_CLOSE_MYSQL_DATABASE ?? "";
const attemptId = "synthetic-owner-pix-ambiguous-attempt-0001";
const ownerOpenId = "synthetic-owner-admin";
const auditReference = "owner-review-synthetic-2026-11-23";
const paymentReference =
  "L4CKOS-STOCK-ATTEMPT:v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const orderId = 710001;
let pool: Pool;

const applyInput = () => ({
  mode: "apply" as const,
  attemptId,
  ownerOpenId,
  auditReference,
  acknowledgeFinancialUncertainty: true,
  acknowledgeSingleUnitRelease: true,
});

function assertDisposableNetworkTarget() {
  const loopbackTarget =
    host === "127.0.0.1" &&
    Number.isInteger(port) &&
    port >= 32768 &&
    port <= 65535;
  const uniqueSyntheticDatabase =
    /^l4ckos_owner_pix_close_test_[a-f0-9]{12}$/.test(database);
  if (
    isolatedNetworkMode !== "local-loopback" ||
    !loopbackTarget ||
    !uniqueSyntheticDatabase
  ) {
    throw new Error(
      "Owner PIX closure integration requires a unique synthetic database on a local loopback port"
    );
  }
}

function disposableConnectionTarget() {
  return { host, port };
}

function recordingPool(source: Pool, statements: string[], transactions: string[]) {
  return {
    async getConnection() {
      const connection = await source.getConnection();
      return new Proxy(connection, {
        get(target, property) {
          const value = Reflect.get(target, property, target);
          if (property === "query" || property === "execute") {
            return (...args: unknown[]) => {
              if (typeof args[0] === "string") statements.push(args[0]);
              return (value as (...values: unknown[]) => unknown).apply(
                target,
                args
              );
            };
          }
          if (
            property === "beginTransaction" ||
            property === "rollback" ||
            property === "commit"
          ) {
            return (...args: unknown[]) => {
              transactions.push(String(property));
              return (value as (...values: unknown[]) => unknown).apply(
                target,
                args
              );
            };
          }
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  } as Pool;
}

async function hasTable(name: string): Promise<boolean> {
  const [rows] = await pool.execute<Array<{ n: number }>>(
    "SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
    [name]
  );
  return Number(rows[0]?.n) === 1;
}

async function prepareSchema() {
  if (!(await hasTable("products"))) {
    const schema = await readFile(
      resolve("server/stock/fixtures/mysql8-stock-schema.sql"),
      "utf8"
    );
    for (const statement of schema
      .split(";")
      .map(part => part.trim())
      .filter(Boolean))
      await pool.query(statement);
  }
  if (!(await hasTable("auditLogs")))
    await pool.query(`CREATE TABLE auditLogs (
    id INT NOT NULL AUTO_INCREMENT, actorUserId INT NULL, actorType ENUM('admin','user','system') NOT NULL DEFAULT 'system',
    action VARCHAR(120) NOT NULL, entity VARCHAR(120) NOT NULL, entityId VARCHAR(120) NULL, orderId INT NULL, event VARCHAR(120) NULL,
    correlationId VARCHAR(191) NULL, metadata TEXT NULL, beforeState TEXT NULL, afterState TEXT NULL, createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(id), KEY audit_order_idx(orderId), KEY audit_correlation_idx(correlationId)
  ) ENGINE=InnoDB`);
  if (!(await hasTable("payments")))
    await pool.query(`CREATE TABLE payments (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, orderId INT NOT NULL, providerPaymentId VARCHAR(64) NULL, externalReference VARCHAR(191) NULL,
    KEY payments_order_idx(orderId)
  ) ENGINE=InnoDB`);
  if (!(await hasTable("asaasWebhookEvents")))
    await pool.query(`CREATE TABLE asaasWebhookEvents (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, eventId VARCHAR(191) NOT NULL, paymentId VARCHAR(120) NULL, checkoutId VARCHAR(120) NULL, orderId INT NULL,
    UNIQUE KEY asaas_event_unique(eventId), KEY asaas_order_idx(orderId)
  ) ENGINE=InnoDB`);
  if (!(await hasTable("asaasWebhookInbox")))
    await pool.query(`CREATE TABLE asaasWebhookInbox (
    eventId VARCHAR(191) PRIMARY KEY, payload TEXT NULL, payloadHash VARCHAR(64) NOT NULL, state VARCHAR(24) NOT NULL DEFAULT 'received'
  ) ENGINE=InnoDB`);
  const [fulfillmentColumn] = await pool.execute<Array<{ n: number }>>(
    "SELECT COUNT(*) n FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='orders' AND column_name='fulfillmentStatus'"
  );
  if (!Number(fulfillmentColumn[0]?.n))
    await pool.query(
      "ALTER TABLE orders ADD COLUMN fulfillmentStatus ENUM('awaiting_payment','ready','processing','shipped','delivered','cancelled','on_hold','inventory_exception') NOT NULL DEFAULT 'awaiting_payment'"
    );
}

async function resetAndSeed() {
  await pool.query("SET FOREIGN_KEY_CHECKS=0");
  for (const table of [
    "asaasWebhookInbox",
    "asaasWebhookEvents",
    "stockWebhookEvents",
    "payments",
    "auditLogs",
    "stockReservations",
    "orderItems",
    "stockCheckoutItems",
    "stockCheckoutAttempts",
    "orders",
    "productVariants",
    "products",
    "users",
  ]) {
    if (await hasTable(table)) await pool.query(`TRUNCATE TABLE \`${table}\``);
  }
  await pool.query("SET FOREIGN_KEY_CHECKS=1");
  await pool.execute(
    "INSERT INTO users (id,openId,role,isBlocked) VALUES (710001,?,?,0)",
    [ownerOpenId, "admin"]
  );
  await pool.execute(
    "INSERT INTO products (id,name,category,price,stock) VALUES (46,'Synthetic product','synthetic',11900,0)"
  );
  await pool.execute(
    "INSERT INTO productVariants (id,productId,name,sku,size,color,price,stock,reservedStock,isActive) VALUES (113,46,'Synthetic white M','SYN-113','M','Branco',11900,1,1,1)"
  );
  await pool.execute(
    "INSERT INTO orders (id,userId,status,paymentStatus,totalPrice,stockAttemptId,stockPaymentId,asaasCheckoutId,fulfillmentStatus) VALUES (?,710001,'pending','unconfirmed',1000,?,NULL,NULL,'awaiting_payment')",
    [orderId, attemptId]
  );
  await pool.execute(
    `INSERT INTO stockCheckoutAttempts (attemptId,ownerUserId,fingerprint,orderId,status,providerState,amountCents,paymentId,createdAt,reservationExpiresAt,expiryReviewedAt,reconciliationRequiredAt)
    VALUES (?,710001,REPEAT('a',64),?,'reserved','ambiguous',1000,NULL,DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY),DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 HOUR),DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 30 MINUTE),DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 30 MINUTE))`,
    [attemptId, orderId]
  );
  await pool.execute(
    "INSERT INTO orderItems (id,orderId,productId,quantity,unitPrice,totalPrice,variantId) VALUES (710001,?,46,1,1000,1000,113)",
    [orderId]
  );
  await pool.execute(
    "INSERT INTO stockCheckoutItems (attemptId,lineNumber,variantId,productId,sku,size,color,unitPriceCents,quantity,totalCents) VALUES (?,0,113,46,'SYN-113','M','Branco',1000,1,1000)",
    [attemptId]
  );
  await pool.execute(
    "INSERT INTO stockReservations (id,orderId,userId,productId,attemptId,variantId,orderItemId,quantity,status,expiresAt) VALUES (710001,?,710001,46,?,113,710001,1,'active',DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 30 MINUTE))",
    [orderId, attemptId]
  );
  await pool.execute(
    `INSERT INTO auditLogs (actorType,action,entity,entityId,orderId,event,correlationId,metadata)
    VALUES ('system','stock.payment_reference.v1','stockCheckoutAttempt',?,?,'STOCK_PAYMENT_REFERENCE',?,JSON_OBJECT('attemptId',?,'orderId',?,'referenceVersion',1))`,
    [attemptId, orderId, paymentReference, attemptId, String(orderId)]
  );
}

async function count(sql: string, values: unknown[] = []) {
  const [rows] = await pool.execute<Array<{ n: number }>>(sql, values);
  return Number(rows[0]?.n ?? 0);
}

describe.skipIf(isolatedNetworkMode !== "local-loopback")(
  "owner PIX ambiguous attempt closure (disposable MySQL only)",
  () => {
    beforeAll(async () => {
      assertDisposableNetworkTarget();
      pool = createPool({
        ...disposableConnectionTarget(),
        user: "root",
        database,
        connectionLimit: 6,
        waitForConnections: true,
        queueLimit: 0,
        multipleStatements: false,
      });
      const [identity] = await pool.query<
        Array<{ databaseName: string; version: string; currentUser: string }>
      >(
        "SELECT DATABASE() databaseName, VERSION() version, CURRENT_USER() currentUser"
      );
      if (
        identity[0]?.databaseName !== database ||
        !String(identity[0]?.version).startsWith("9.7.4") ||
        !String(identity[0]?.currentUser).startsWith("root@")
      ) {
        throw new Error("Owner PIX closure test target identity mismatch");
      }
      await prepareSchema();
    }, 30_000);
    beforeEach(resetAndSeed);
    afterAll(async () => {
      if (pool) await pool.end();
    });

    it("preflight validates the complete target without writing", async () => {
      const result = await closeOwnerPixAmbiguousAttempt(pool, {
        mode: "preflight",
        attemptId,
        ownerOpenId,
      });
      expect(result).toMatchObject({
        result: "ready",
        financialOutcome: "unknown",
      });
      expect(
        await count("SELECT COUNT(*) n FROM auditLogs WHERE action = ?", [
          OWNER_PIX_CLOSE_ACTION,
        ])
      ).toBe(0);
      expect(
        await count(
          "SELECT COUNT(*) n FROM stockReservations WHERE attemptId = ? AND status='active'",
          [attemptId]
        )
      ).toBe(1);
    });

    it("uses only granted read privileges for inspection and applies under restricted row locks", async () => {
      const restrictedUser = "owner_pix_close_limited";
      const restrictedHost = "%";
      const restrictedPassword = "owner-pix-close-synthetic-only-20261123";
      let restrictedPool: Pool | null = null;
      try {
        await pool.query(
          `DROP USER IF EXISTS '${restrictedUser}'@'${restrictedHost}'`
        );
        await pool.query(
          `CREATE USER '${restrictedUser}'@'${restrictedHost}' IDENTIFIED BY '${restrictedPassword}'`
        );
        const selectTables = [
          "users",
          "orders",
          "orderItems",
          "productVariants",
          "stockCheckoutAttempts",
          "stockCheckoutItems",
          "stockReservations",
          "auditLogs",
          "asaasWebhookInbox",
          "asaasWebhookEvents",
          "stockWebhookEvents",
        ];
        for (const table of selectTables) {
          await pool.query(
            `GRANT SELECT ON \`${database}\`.\`${table}\` TO '${restrictedUser}'@'${restrictedHost}'`
          );
        }
        await pool.query(
          `GRANT SELECT (orderId, externalReference) ON \`${database}\`.payments TO '${restrictedUser}'@'${restrictedHost}'`
        );
        await pool.query(
          `GRANT UPDATE (status, releasedAt) ON \`${database}\`.stockCheckoutAttempts TO '${restrictedUser}'@'${restrictedHost}'`
        );
        await pool.query(
          `GRANT UPDATE (status) ON \`${database}\`.stockReservations TO '${restrictedUser}'@'${restrictedHost}'`
        );
        await pool.query(
          `GRANT UPDATE (reservedStock) ON \`${database}\`.productVariants TO '${restrictedUser}'@'${restrictedHost}'`
        );
        await pool.query(
          `GRANT UPDATE (status, fulfillmentStatus) ON \`${database}\`.orders TO '${restrictedUser}'@'${restrictedHost}'`
        );
        await pool.query(
          `GRANT INSERT ON \`${database}\`.auditLogs TO '${restrictedUser}'@'${restrictedHost}'`
        );

        restrictedPool = createPool({
          ...disposableConnectionTarget(),
          user: restrictedUser,
          password: restrictedPassword,
          database,
          connectionLimit: 2,
          waitForConnections: true,
          queueLimit: 0,
          multipleStatements: false,
        });

        const preflightStatements: string[] = [];
        const preflightTransactions: string[] = [];
        await expect(
          closeOwnerPixAmbiguousAttempt(
            recordingPool(
              restrictedPool,
              preflightStatements,
              preflightTransactions
            ),
            { mode: "preflight", attemptId, ownerOpenId }
          )
        ).resolves.toMatchObject({ result: "ready" });
        expect(preflightStatements.join("\n")).not.toMatch(
          /\b(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|CREATE|DROP|TRUNCATE)\b/i
        );
        expect(preflightStatements.join("\n")).not.toMatch(
          /\bFOR\s+(?:UPDATE|SHARE)\b/i
        );
        expect(preflightTransactions).toEqual(["beginTransaction", "rollback"]);

        const statusStatements: string[] = [];
        const statusTransactions: string[] = [];
        await expect(
          closeOwnerPixAmbiguousAttempt(
            recordingPool(
              restrictedPool,
              statusStatements,
              statusTransactions
            ),
            { mode: "status", attemptId, ownerOpenId, auditReference }
          )
        ).resolves.toMatchObject({ result: "commit_not_observed" });
        expect(statusStatements.join("\n")).not.toMatch(
          /\b(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|CREATE|DROP|TRUNCATE)\b/i
        );
        expect(statusStatements.join("\n")).not.toMatch(
          /\bFOR\s+(?:UPDATE|SHARE)\b/i
        );
        expect(statusTransactions).toEqual(["beginTransaction", "rollback"]);

        const applyStatements: string[] = [];
        const applyTransactions: string[] = [];
        await expect(
          closeOwnerPixAmbiguousAttempt(
            recordingPool(
              restrictedPool,
              applyStatements,
              applyTransactions
            ),
            applyInput()
          )
        ).resolves.toMatchObject({ result: "closed", financialOutcome: "unknown" });
        const hasLockOn = (table: string, mode: "UPDATE" | "SHARE") =>
          applyStatements.some(
            statement =>
              statement.includes(`FROM ${table}`) &&
              new RegExp(`\\bFOR\\s+${mode}\\b`, "i").test(statement)
          );
        for (const table of [
          "stockCheckoutAttempts",
          "orders",
          "stockReservations",
          "productVariants",
        ]) {
          expect(hasLockOn(table, "UPDATE")).toBe(true);
        }
        expect(hasLockOn("stockCheckoutItems", "SHARE")).toBe(true);
        expect(hasLockOn("payments", "SHARE")).toBe(true);
        expect(applyStatements.join("\n")).not.toMatch(
          /SELECT\s+id\s+FROM\s+payments/i
        );
        expect(applyTransactions).toContain("commit");

        expect(
          await count(
            "SELECT COUNT(*) n FROM auditLogs WHERE action=? AND entityId=?",
            [OWNER_PIX_CLOSE_ACTION, attemptId]
          )
        ).toBe(1);
      } finally {
        if (restrictedPool) await restrictedPool.end();
        await pool.query(
          `DROP USER IF EXISTS '${restrictedUser}'@'${restrictedHost}'`
        );
      }
    });

    it("closes only the linked order and one reservation, records uncertainty, and is idempotent", async () => {
      const input = applyInput();
      await expect(
        closeOwnerPixAmbiguousAttempt(pool, input)
      ).resolves.toMatchObject({
        result: "closed",
        financialOutcome: "unknown",
        providerStatePreserved: "ambiguous",
      });
      await expect(
        closeOwnerPixAmbiguousAttempt(pool, input)
      ).resolves.toMatchObject({
        result: "already_closed",
        financialOutcome: "unknown",
        providerStatePreserved: "ambiguous",
      });
      const [attempt] = await pool.execute<
        Array<{
          status: string;
          providerState: string;
          paymentId: string | null;
          reconciliationRequiredAt: string | null;
        }>
      >(
        "SELECT status,providerState,paymentId,reconciliationRequiredAt FROM stockCheckoutAttempts WHERE attemptId=?",
        [attemptId]
      );
      const [order] = await pool.execute<
        Array<{
          status: string;
          paymentStatus: string;
          fulfillmentStatus: string;
        }>
      >(
        "SELECT status,paymentStatus,fulfillmentStatus FROM orders WHERE id=?",
        [orderId]
      );
      const [variant] = await pool.execute<
        Array<{ stock: number; reservedStock: number }>
      >("SELECT stock,reservedStock FROM productVariants WHERE id=113");
      expect(attempt[0]).toMatchObject({
        status: "released",
        providerState: "ambiguous",
        paymentId: null,
      });
      expect(attempt[0]?.reconciliationRequiredAt).not.toBeNull();
      expect(order[0]).toEqual({
        status: "cancelled",
        paymentStatus: "unconfirmed",
        fulfillmentStatus: "cancelled",
      });
      expect(variant[0]).toMatchObject({ stock: 1, reservedStock: 0 });
      expect(
        await count(
          "SELECT COUNT(*) n FROM stockReservations WHERE attemptId=? AND status='released' AND quantity=1",
          [attemptId]
        )
      ).toBe(1);
      expect(
        await count(
          "SELECT COUNT(*) n FROM auditLogs WHERE action=? AND entityId=?",
          [OWNER_PIX_CLOSE_ACTION, attemptId]
        )
      ).toBe(1);
      const [audit] = await pool.execute<
        Array<{
          actorUserId: number;
          actorType: string;
          metadata: string;
          beforeState: string;
          afterState: string;
        }>
      >(
        "SELECT actorUserId,actorType,metadata,beforeState,afterState FROM auditLogs WHERE action=? AND entityId=?",
        [OWNER_PIX_CLOSE_ACTION, attemptId]
      );
      expect(audit[0]).toMatchObject({
        actorUserId: 710001,
        actorType: "admin",
      });
      expect(JSON.parse(audit[0].metadata)).toMatchObject({
        providerAbsenceConfirmed: false,
        financialOutcome: "unknown",
        residualUncertainty: true,
      });
      expect(JSON.parse(audit[0].beforeState)).toMatchObject({
        providerState: "ambiguous",
        reservedStock: 1,
      });
      expect(JSON.parse(audit[0].afterState)).toMatchObject({
        providerState: "ambiguous",
        reservedStock: 0,
        physicalStock: 1,
      });
    });

    it("aborts without writes when a payment row is present", async () => {
      await pool.execute(
        "INSERT INTO payments (orderId,providerPaymentId,externalReference) VALUES (?, 'synthetic-payment', ?)",
        [orderId, paymentReference]
      );
      await expect(
        closeOwnerPixAmbiguousAttempt(pool, applyInput())
      ).rejects.toMatchObject({ code: "OWNER_PIX_CLOSE_PAYMENT_ROW_FOUND" });
      expect(
        await count(
          "SELECT COUNT(*) n FROM stockCheckoutAttempts WHERE attemptId=? AND status='reserved'",
          [attemptId]
        )
      ).toBe(1);
      expect(
        await count(
          "SELECT COUNT(*) n FROM stockReservations WHERE attemptId=? AND status='active'",
          [attemptId]
        )
      ).toBe(1);
      expect(
        await count("SELECT COUNT(*) n FROM auditLogs WHERE action=?", [
          OWNER_PIX_CLOSE_ACTION,
        ])
      ).toBe(0);
    });

    it("aborts when the strong payment reference appears on a different order", async () => {
      await pool.execute(
        "INSERT INTO payments (orderId,providerPaymentId,externalReference) VALUES (710099, 'synthetic-payment-other-order', ?)",
        [paymentReference]
      );
      await expect(
        closeOwnerPixAmbiguousAttempt(pool, applyInput())
      ).rejects.toMatchObject({
        code: "OWNER_PIX_CLOSE_PAYMENT_REFERENCE_ROW_FOUND",
      });
      expect(
        await count(
          "SELECT COUNT(*) n FROM stockCheckoutAttempts WHERE attemptId=? AND status='reserved'",
          [attemptId]
        )
      ).toBe(1);
      expect(
        await count("SELECT COUNT(*) n FROM auditLogs WHERE action=?", [
          OWNER_PIX_CLOSE_ACTION,
        ])
      ).toBe(0);
    });

    it("status detects a changed stock postcondition after a committed close", async () => {
      await closeOwnerPixAmbiguousAttempt(pool, applyInput());
      await pool.execute(
        "UPDATE productVariants SET reservedStock=1 WHERE id=113"
      );
      await expect(
        closeOwnerPixAmbiguousAttempt(pool, {
          mode: "status",
          attemptId,
          ownerOpenId,
          auditReference,
        })
      ).rejects.toMatchObject({
        code: "OWNER_PIX_CLOSE_OPERATION_STATE_DIVERGED",
      });
      expect(
        await count(
          "SELECT COUNT(*) n FROM stockCheckoutAttempts WHERE attemptId=? AND status='released' AND providerState='ambiguous'",
          [attemptId]
        )
      ).toBe(1);
    });

    it("aborts when a correlated provider webhook is already in the inbox", async () => {
      await pool.execute(
        "INSERT INTO asaasWebhookInbox (eventId,payload,payloadHash) VALUES ('synthetic-event',?,REPEAT('b',64))",
        [
          JSON.stringify({
            event: "PAYMENT_CREATED",
            payment: { externalReference: paymentReference },
          }),
        ]
      );
      await expect(
        closeOwnerPixAmbiguousAttempt(pool, applyInput())
      ).rejects.toMatchObject({
        code: "OWNER_PIX_CLOSE_CORRELATED_WEBHOOK_FOUND",
      });
      expect(
        await count(
          "SELECT COUNT(*) n FROM stockCheckoutAttempts WHERE attemptId=? AND status='reserved'",
          [attemptId]
        )
      ).toBe(1);
    });

    it("aborts on a reservation mismatch before changing any rows", async () => {
      await pool.execute(
        "UPDATE stockReservations SET quantity=2 WHERE attemptId=?",
        [attemptId]
      );
      await expect(
        closeOwnerPixAmbiguousAttempt(pool, applyInput())
      ).rejects.toMatchObject({ code: "OWNER_PIX_CLOSE_RESERVATION_MISMATCH" });
      expect(
        await count(
          "SELECT COUNT(*) n FROM stockCheckoutAttempts WHERE attemptId=? AND status='reserved'",
          [attemptId]
        )
      ).toBe(1);
      expect(
        await count("SELECT COUNT(*) n FROM auditLogs WHERE action=?", [
          OWNER_PIX_CLOSE_ACTION,
        ])
      ).toBe(0);
    });

    it("rolls back all state if the durable audit insert fails", async () => {
      await pool.query(`CREATE TRIGGER owner_pix_close_audit_fail BEFORE INSERT ON auditLogs FOR EACH ROW
      BEGIN IF NEW.action = '${OWNER_PIX_CLOSE_ACTION}' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic audit failure'; END IF; END`);
      try {
        await expect(
          closeOwnerPixAmbiguousAttempt(pool, applyInput())
        ).rejects.toMatchObject({
          code: "OWNER_PIX_CLOSE_MYSQL_ER_SIGNAL_EXCEPTION",
        });
        expect(
          await count(
            "SELECT COUNT(*) n FROM stockCheckoutAttempts WHERE attemptId=? AND status='reserved'",
            [attemptId]
          )
        ).toBe(1);
        expect(
          await count(
            "SELECT COUNT(*) n FROM stockReservations WHERE attemptId=? AND status='active'",
            [attemptId]
          )
        ).toBe(1);
        expect(
          await count(
            "SELECT COUNT(*) n FROM productVariants WHERE id=113 AND stock=1 AND reservedStock=1"
          )
        ).toBe(1);
        expect(
          await count(
            "SELECT COUNT(*) n FROM orders WHERE id=? AND status='pending'",
            [orderId]
          )
        ).toBe(1);
      } finally {
        await pool.query("DROP TRIGGER IF EXISTS owner_pix_close_audit_fail");
      }
    });

    it("serializes concurrent requests and commits a single release", async () => {
      const input = applyInput();
      const results = await Promise.all([
        closeOwnerPixAmbiguousAttempt(pool, input),
        closeOwnerPixAmbiguousAttempt(pool, input),
      ]);
      expect(results.map(result => result.result).sort()).toEqual([
        "already_closed",
        "closed",
      ]);
      expect(
        await count(
          "SELECT COUNT(*) n FROM auditLogs WHERE action=? AND entityId=?",
          [OWNER_PIX_CLOSE_ACTION, attemptId]
        )
      ).toBe(1);
      expect(
        await count(
          "SELECT COUNT(*) n FROM productVariants WHERE id=113 AND stock=1 AND reservedStock=0"
        )
      ).toBe(1);
    });

    it("reports an uncertain COMMIT and verifies the committed record read-only", async () => {
      const uncertainPool = {
        async getConnection() {
          const connection = await pool.getConnection();
          const commit = connection.commit.bind(connection);
          connection.commit = async () => {
            await commit();
            throw new Error("synthetic lost commit acknowledgement");
          };
          return connection;
        },
      } as Pool;
      await expect(
        closeOwnerPixAmbiguousAttempt(uncertainPool, applyInput())
      ).rejects.toMatchObject({
        code: "OWNER_PIX_CLOSE_COMMIT_RESULT_UNKNOWN",
      });
      await expect(
        closeOwnerPixAmbiguousAttempt(pool, {
          mode: "status",
          attemptId,
          ownerOpenId,
          auditReference,
        })
      ).resolves.toMatchObject({
        result: "already_closed",
        financialOutcome: "unknown",
      });
    });
  }
);
