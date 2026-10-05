import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { readFile, writeFile, stat } from "node:fs/promises";
import type { Connection } from "mysql2/promise";
import { getTableName } from "drizzle-orm";
import * as domain from "../../drizzle/schema";
import auditedDDL from "./fixtures/audited-schema.json";
import { REQUIRED_TABLES, TABLE_ORDER, classifyTable } from "./tableManifest";
import { assertLocalRestoreTarget, backupDatabase, restoreDatabase, openBackupConnection, checksum, rowsChecksum, type BackupArtifact } from "./backupRestore";

const enabled = process.env.L4CKOS_MYSQL_TEST === "1";
const socketPath = "/tmp/l4ckos-reconciliation-socket/mysqld.sock";
const url = (name: string) => `mysql://root@localhost/${name}`;
const target = (name: string) => ({ url: url(name), socketPath });
const q = (name: string) => `\`${name.replace(/`/g, "``")}\``;
const stamp = "2026-09-27 15:00:00";
let source: Connection;
let destination: Connection;
let root: Connection;
let artifact: BackupArtifact;
const databases: string[] = [];
const connections: Connection[] = [];

async function database(name: string, optional = false) {
  await root.query(`CREATE DATABASE ${q(name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  databases.push(name);
  const connection = await openBackupConnection(url(name), socketPath);
  connections.push(connection);
  for (const table of TABLE_ORDER.filter(t => t in auditedDDL)) await connection.query(auditedDDL[table as keyof typeof auditedDDL]);
  if (optional) await connection.query(await readFile(new URL("../../drizzle/0013_asaas_webhook_events.sql", import.meta.url), "utf8"));
  return connection;
}
async function seed(connection: Connection) {
  for (const name of TABLE_ORDER.filter(t => t in auditedDDL)) {
    const [columns] = await connection.query<any[]>(`SHOW FULL COLUMNS FROM ${q(name)}`);
    const row: Record<string, unknown> = {};
    for (const column of columns) {
      const { Field: field, Type: type } = column;
      if (type.startsWith("int")) row[field] = field === "id" || field.endsWith("Id") ? 1 : 3;
      else if (type.startsWith("timestamp")) row[field] = stamp;
      else if (type.startsWith("enum")) row[field] = type.match(/^enum\('([^']+)'/)[1];
      else if (type.startsWith("text")) row[field] = '{"synthetic":true}';
      else row[field] = `${field}-synthetic`.slice(0, Number(type.match(/varchar\((\d+)\)/)?.[1] || 255));
    }
    const overrides: Record<string, Record<string, unknown>> = {
      products: { price: 9000 },
      productVariants: { price: 9000 },
      orders: { totalPrice: 17970, checkoutAttemptId: "fixture-attempt", checkoutFingerprint: "fixture-fingerprint" },
      orderItems: { unitPrice: 5990, quantity: 3, totalPrice: 17970 },
      stockReservations: { status: "restocked", quantity: 3 },
      auditLogs: { actorUserId: null, actorType: "system", beforeState: '{"old":1}', afterState: '{"new":2}' },
      orderEmailEvents: { eventType: "order_delivered_email", status: "sent", attemptCount: 4, idempotencyKey: "fixture-delivery", providerMessageId: "synthetic-provider-1", processingToken: "synthetic-lease", lastError: "synthetic-history" },
      notificationOutbox: { status: "sent", attempts: 5, amount: undefined },
      payments: { amount: 17970, paidAmount: 17970, netAmount: 17970, refundedAmount: 0, status: "received" },
      paymentEvents: { processingStatus: "processed" },
    };
    for (const [field, value] of Object.entries(overrides[name] || {})) if (field in row && value !== undefined) row[field] = value;
    await connection.query(`INSERT INTO ${q(name)} (${Object.keys(row).map(q)}) VALUES (${Object.keys(row).map(() => "?")})`, Object.values(row));
  }
  await connection.query("INSERT INTO orderEmailEvents (id,orderId,eventType,status,idempotencyKey,attemptCount,scheduledAt,providerMessageId,sentAt,failedAt,processingAt,processingToken,lastError,createdAt,updatedAt) VALUES (2,1,'review_request_email','sent','fixture-review',2,?,'synthetic-provider-2',?,?,?,'synthetic-review-lease','synthetic-old-failure',?,?)", ["2026-09-27 15:05:00", stamp, stamp, stamp, stamp, stamp]);
}
function reseal(copy: BackupArtifact) {
  for (const table of Object.values(copy.tables)) { table.rowCount = table.rows.length; table.checksum = rowsChecksum(table.rows); }
  const { artifactChecksum: _, ...body } = copy;
  copy.artifactChecksum = checksum(body);
  return copy;
}
async function empty(connection: Connection) {
  for (const name of REQUIRED_TABLES) {
    const [rows] = await connection.query<any[]>(`SELECT COUNT(*) n FROM ${q(name)}`);
    expect(Number(rows[0].n)).toBe(0);
  }
}

describe("backup safety and explicit manifest", () => {
  it("covers every ORM table with reviewed classifications", () => {
    const names = Object.values(domain).filter(v => typeof v === "object" && v !== null).flatMap(v => {
      try { return [getTableName(v as any)]; } catch { return []; }
    }).filter(Boolean);
    expect(names.length).toBe(23);
    for (const name of names) expect(classifyTable(name)).not.toBe("UNKNOWN");
    expect(REQUIRED_TABLES.length).toBe(25);
    expect(classifyTable("payments")).toBe("KNOWN");
    expect(classifyTable("asaasWebhookEvents")).toBe("OPTIONAL_PENDING_RECONCILIATION");
  });
  it("rejects remote, production, ambiguous and unacknowledged restore before connecting", () => {
    const previous = process.env.L4CKOS_LOCAL_RESTORE;
    process.env.L4CKOS_LOCAL_RESTORE = "1";
    for (const value of ["mysql://root@remote.invalid/l4ckos_test_bad", "mysql://root@localhost/l4ckos", "mysql://root@localhost/l4ckos_test_bad?host=remote.invalid", "invalid"]) expect(() => assertLocalRestoreTarget(value)).toThrow("LOCAL_RESTORE_REQUIRED");
    const nodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    expect(() => assertLocalRestoreTarget(url("l4ckos_test_source"))).toThrow("LOCAL_RESTORE_REQUIRED");
    process.env.NODE_ENV = nodeEnv;
    delete process.env.L4CKOS_LOCAL_RESTORE;
    expect(() => assertLocalRestoreTarget(url("l4ckos_test_source"))).toThrow("LOCAL_RESTORE_REQUIRED");
    if (previous === undefined) delete process.env.L4CKOS_LOCAL_RESTORE; else process.env.L4CKOS_LOCAL_RESTORE = previous;
  });
});

describe.skipIf(!enabled)("MySQL 8.4 real isolated backup/restore", () => {
  beforeAll(async () => {
    process.env.L4CKOS_LOCAL_RESTORE = "1";
    root = await openBackupConnection("mysql://root@localhost/mysql", socketPath);
    source = await database("l4ckos_test_source");
    destination = await database("l4ckos_test_destination");
    await seed(source);
    artifact = await backupDatabase(source);
  }, 30000);
  afterAll(async () => {
    for (const connection of connections) await connection.end();
    for (const name of databases) await root.query(`DROP DATABASE ${q(name)}`);
    await root?.end();
  });
  it("round-trips all 25 physical tables and exact cents/outbox/financial/audit fields through a file", async () => {
    const path = "/tmp/l4ckos-reconciliation-roundtrip.json";
    await writeFile(path, JSON.stringify(artifact), { mode: 0o600 });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const parsed = JSON.parse(await readFile(path, "utf8"));
    expect(await restoreDatabase(destination, parsed, target("l4ckos_test_destination"))).toEqual({ tables: 25, rows: 26 });
    const restored = await backupDatabase(destination);
    for (const name of REQUIRED_TABLES) {
      expect(restored.tables[name].rowCount).toBe(artifact.tables[name].rowCount);
      expect(restored.tables[name].checksum).toBe(artifact.tables[name].checksum);
    }
    expect(restored.tables.orderItems.rows[0]).toMatchObject({ unitPrice: 5990, quantity: 3, totalPrice: 17970 });
    expect(restored.tables.products.rows[0].price).toBe(9000);
    expect(restored.tables.stockReservations.rows[0].status).toBe("restocked");
    expect(restored.tables.auditLogs.rows[0].actorUserId).toBeNull();
    for (const row of restored.tables.orderEmailEvents.rows) expect(row.status).toBe("sent");
    expect(restored.tables.orderEmailEvents.checksum).toBe(artifact.tables.orderEmailEvents.checksum);
    expect(restored.schemaFingerprint).toBe(artifact.schemaFingerprint);
    console.log("MySQL round-trip: 25 tables, 26 rows, all row/schema checksums equal; cents, outbox, FKs preserved");
  });
  it("rejects non-empty target without deleting or altering its rows", async () => {
    await expect(restoreDatabase(destination, artifact, target("l4ckos_test_destination"))).rejects.toThrow("TARGET_NOT_EMPTY");
    expect((await backupDatabase(destination)).tables.orderEmailEvents.checksum).toBe(artifact.tables.orderEmailEvents.checksum);
  });
  it("preserves unique order/event and rejects duplicates in MySQL", async () => {
    await expect(destination.query("INSERT INTO orderEmailEvents (orderId,eventType,idempotencyKey) VALUES (1,'review_request_email','another-synthetic')")).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
  });
  it("fails for an unknown table and a missing expected table", async () => {
    const c = await database("l4ckos_test_inventory");
    await c.query("CREATE TABLE unexpected (id INT PRIMARY KEY) ENGINE=InnoDB");
    await expect(backupDatabase(c)).rejects.toThrow("UNKNOWN_TABLE");
    await c.query("DROP TABLE unexpected");
    await c.query("DROP TABLE cartItems");
    await expect(backupDatabase(c)).rejects.toThrow("MISSING_REQUIRED_TABLE");
    await expect(restoreDatabase(c, artifact, target("l4ckos_test_inventory"))).rejects.toThrow("MISSING_REQUIRED_TABLE");
  });
  it("handles optional webhook absence and future presence explicitly", async () => {
    expect(artifact.absentOptionalTables).toEqual(["asaasWebhookEvents"]);
    const c = await database("l4ckos_test_optional_source", true);
    const d = await database("l4ckos_test_optional_destination", true);
    await c.query("INSERT INTO asaasWebhookEvents (eventId,eventType,payloadHash,status) VALUES ('synthetic-event','SYNTHETIC',REPEAT('a',64),'processed')");
    const b = await backupDatabase(c);
    expect(b.absentOptionalTables).toEqual([]);
    await restoreDatabase(d, b, target("l4ckos_test_optional_destination"));
    expect((await backupDatabase(d)).tables.asaasWebhookEvents.checksum).toBe(b.tables.asaasWebhookEvents.checksum);
    const e = await database("l4ckos_test_optional_mismatch");
    await expect(restoreDatabase(e, b, target("l4ckos_test_optional_mismatch"))).rejects.toThrow("INCOMPATIBLE_SCHEMA");
  });
  it("rejects checksum corruption before writing", async () => {
    const c = await database("l4ckos_test_corruption");
    const copy = structuredClone(artifact);
    copy.tables.orderItems.rows[0].unitPrice = 1;
    await expect(restoreDatabase(c, copy, target("l4ckos_test_corruption"))).rejects.toThrow("CHECKSUM_MISMATCH");
    await empty(c);
  });
  it("rolls back every table on an invalid physical FK", async () => {
    const c = await database("l4ckos_test_fk");
    const copy = structuredClone(artifact);
    copy.tables.payments.rows[0].orderId = 999;
    await expect(restoreDatabase(c, reseal(copy), target("l4ckos_test_fk"))).rejects.toThrow("RESTORE_FAILED_ROLLED_BACK");
    await empty(c);
  });
  it("rolls back a late partial restore with duplicate outbox", async () => {
    const c = await database("l4ckos_test_partial");
    const copy = structuredClone(artifact);
    copy.tables.orderEmailEvents.rows.push({ ...copy.tables.orderEmailEvents.rows[0], id: 99 });
    await expect(restoreDatabase(c, reseal(copy), target("l4ckos_test_partial"))).rejects.toThrow("RESTORE_FAILED_ROLLED_BACK");
    await empty(c);
  });
  it("rejects a logical orphan outbox without masking missing physical FKs", async () => {
    const c = await database("l4ckos_test_logical_fk");
    const copy = structuredClone(artifact);
    copy.tables.orderEmailEvents.rows[0].orderId = 999;
    await expect(restoreDatabase(c, reseal(copy), target("l4ckos_test_logical_fk"))).rejects.toThrow("ORPHAN_ORDER_REFERENCE");
    await empty(c);
  });
  it("enforces actual quantity/price constraints and keeps nullable historical totals", async () => {
    for (const [unitPrice, quantity] of [[-1,1],[0,0],[5990,-1]]) {
      await expect(source.query("INSERT INTO orderItems (orderId,productId,quantity,unitPrice) VALUES (1,1,?,?)", [quantity, unitPrice])).rejects.toMatchObject({ code: "ER_CHECK_CONSTRAINT_VIOLATED" });
    }
    await source.query("INSERT INTO orderItems (id,orderId,productId,quantity,unitPrice,totalPrice) VALUES (10,1,1,2,0,NULL)");
    const rows = (await backupDatabase(source)).tables.orderItems.rows;
    expect(rows.find(row => row.id === 10)).toMatchObject({ unitPrice: 0, quantity: 2, totalPrice: null });
    await source.query("INSERT INTO orderItems (id,orderId,productId,quantity,unitPrice,totalPrice) VALUES (11,1,1,2,5990,10000)");
    const historical = await backupDatabase(source);
    const c = await database("l4ckos_test_historical_money");
    await restoreDatabase(c, historical, target("l4ckos_test_historical_money"));
    const restored = (await backupDatabase(c)).tables.orderItems.rows;
    expect(restored.find(row => row.id === 10)).toMatchObject({ unitPrice: 0, quantity: 2, totalPrice: null });
    expect(restored.find(row => row.id === 11)).toMatchObject({ unitPrice: 5990, quantity: 2, totalPrice: 10000 });
    await source.query("DELETE FROM orderItems WHERE id IN (10,11)");
  });
  it("uses one repeatable-read snapshot under concurrent writes", async () => {
    const writer = await openBackupConnection(url("l4ckos_test_source"), socketPath);
    const original = source.query.bind(source);
    let changed = false;
    source.query = (async (...args: any[]) => {
      const result = await (original as any)(...args);
      if (!changed && args[0] === "SELECT * FROM `users`") {
        changed = true;
        await writer.beginTransaction();
        await writer.query("UPDATE products SET price=12345 WHERE id=1");
        await writer.query("UPDATE orders SET totalPrice=12345 WHERE id=1");
        await writer.commit();
      }
      return result;
    }) as typeof source.query;
    try {
      const snapshot = await backupDatabase(source);
      expect(changed).toBe(true);
      expect(snapshot.tables.products.rows[0].price).toBe(9000);
      expect(snapshot.tables.orders.rows[0].totalPrice).toBe(17970);
      expect((await backupDatabase(writer)).tables.products.rows[0].price).toBe(12345);
    } finally {
      source.query = original;
      await writer.query("UPDATE products SET price=9000 WHERE id=1");
      await writer.query("UPDATE orders SET totalPrice=17970 WHERE id=1");
      await writer.end();
    }
  });
});
