import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { readFile, writeFile, stat, unlink } from "node:fs/promises";
import type { Connection } from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { getTableName } from "drizzle-orm";
import * as domain from "../../drizzle/schema";
import { bootstrapReleaseDatabase } from "../../database/bootstrap/bootstrap";
import { readReleaseContract } from "../../database/schema/artifacts";
import auditedDDL from "./fixtures/audited-schema.json";
import { REQUIRED_TABLES, PREORDER_TABLES, PREORDER_CAPACITY_TABLES, OPTIONAL_TABLES_V3, OPTIONAL_TABLES_V4, OPTIONAL_TABLES, TABLE_MANIFEST_VERSION, TABLE_ORDER, classifyTable } from "./tableManifest";
import { assertLocalRestoreTarget, backupDatabase, restoreDatabase, restoreLockName, openBackupConnection, checksum, rowsChecksum, validateArtifact, type BackupArtifact } from "./backupRestore";

const enabled = process.env.L4CKOS_MYSQL_TEST === "1";
const socketPath = process.env.L4CKOS_LOCAL_MYSQL_SOCKET ?? "/tmp/l4ckos-reconciliation-socket/mysqld.sock";
const url = (name: string) => `mysql://root@localhost/${name}`;
const q = (name: string) => `\`${name.replace(/`/g, "``")}\``;
const stamp = "2026-09-27 15:00:00";
let source: Connection;
let destination: Connection;
let root: Connection;
let artifact: BackupArtifact;
const databases: string[] = [];
const connections: Connection[] = [];
const runId = randomUUID().replaceAll("-", "").slice(0, 12);
const scopedName = (name: string) => `l4ckos_test_backup_${runId}_${name.replace(/^l4ckos_test_/, "")}`;
const target = (name: string) => ({ url: url(scopedName(name)), socketPath });
const physicalTarget = (name: string) => ({ url: url(name), socketPath });
const roundTripArtifactPath = `/tmp/l4ckos-backup-roundtrip-${runId}.json`;

async function database(name: string, optional = false) {
  const physicalName = scopedName(name);
  await root.query(`CREATE DATABASE ${q(physicalName)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  databases.push(physicalName);
  const connection = await openBackupConnection(url(physicalName), socketPath);
  connections.push(connection);
  for (const table of TABLE_ORDER.filter(t => t in auditedDDL)) await connection.query(auditedDDL[table as keyof typeof auditedDDL]);
  if (optional) await connection.query(await readFile(new URL("../../drizzle/0013_asaas_webhook_events.sql", import.meta.url), "utf8"));
  return connection;
}
async function releaseV6Database(suffix: string) {
  const name = scopedName(`v6_${suffix}`);
  await root.query(`CREATE DATABASE ${q(name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  databases.push(name);
  const connection = await openBackupConnection(url(name), socketPath);
  connections.push(connection);
  const contract = await readReleaseContract();
  await bootstrapReleaseDatabase(connection, {
    url: url(name), socketPath, applicationCommit: "a".repeat(40),
    approvedFingerprint: contract.fingerprint, lockTimeoutSeconds: 0,
  });
  return { connection, name };
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
  it("covers ORM tables, reviewed classifications and bounded restore lock identities", () => {
    const names = Object.values(domain).filter(v => typeof v === "object" && v !== null).flatMap(v => {
      try { return [getTableName(v as any)]; } catch { return []; }
    }).filter(Boolean);
    // These have reviewed SQL DDL but intentionally no Drizzle model.
    const sqlOnlyRequiredTables = new Set(["payments", "paymentEvents", "notificationOutbox"]);
    const expectedModels = [
      ...REQUIRED_TABLES.filter(name => !sqlOnlyRequiredTables.has(name)),
      ...OPTIONAL_TABLES,
    ].sort();
    expect([...new Set(names)].sort()).toEqual(expectedModels);
    for (const name of names) expect(classifyTable(name)).not.toBe("UNKNOWN");
    for (const name of REQUIRED_TABLES.filter(name => !sqlOnlyRequiredTables.has(name))) expect(classifyTable(name)).toBe("KNOWN");
    for (const name of [...PREORDER_TABLES, ...PREORDER_CAPACITY_TABLES]) expect(classifyTable(name)).toBe("KNOWN_VERSIONED");
    expect(REQUIRED_TABLES.length).toBe(25);
    expect(classifyTable("payments")).toBe("KNOWN");
    expect(classifyTable("asaasWebhookEvents")).toBe("OPTIONAL_PENDING_RECONCILIATION");
    expect(classifyTable("homeHighlightSettings")).toBe("OPTIONAL_PENDING_RECONCILIATION");
    expect(classifyTable("preorderBatchCapacityPolicies")).toBe("KNOWN_VERSIONED");
    expect(classifyTable("preorderCapacityReservations")).toBe("KNOWN_VERSIONED");
    expect(TABLE_MANIFEST_VERSION).toBe(5);
    const shortSchema = "l4ckos_test_short";
    const longSchema = `l4ckos_test_${"x".repeat(52)}`;
    expect(shortSchema.length).toBeLessThanOrEqual(64);
    expect(longSchema.length).toBe(64);
    expect(restoreLockName(shortSchema)).toBe(`l4ckos_restore_${shortSchema}`);
    expect(restoreLockName(longSchema)).toHaveLength(64);
    expect(restoreLockName(longSchema)).toBe(restoreLockName(longSchema));
    expect(restoreLockName(longSchema)).not.toBe(restoreLockName(`${longSchema.slice(0, -1)}y`));
    expect(restoreLockName(shortSchema)).not.toBe(restoreLockName(longSchema));
  });
  it.each([
    [1, ["asaasWebhookEvents"]],
    [2, ["productionBatches", "productionBatchProducts", "asaasWebhookEvents"]],
    [3, [...OPTIONAL_TABLES_V3]],
  ] as const)("preserves historical backup manifest v%i", (version, absentOptionalTables) => {
    const tables = Object.fromEntries(REQUIRED_TABLES.map(name => [name, {
      schema: "CREATE TABLE fixture ()",
      schemaChecksum: checksum("CREATE TABLE fixture ()"),
      rowCount: 0,
      checksum: rowsChecksum([]),
      rows: [],
    }]));
    const body = {
      formatVersion: 1 as const,
      createdAt: "2026-10-21T00:00:00.000Z",
      applicationCommit: null,
      databaseEngine: "MySQL" as const,
      databaseVersion: "8.4.11",
      tableManifestVersion: version,
      schemaFingerprint: checksum(Object.fromEntries(Object.entries(tables).map(([name, table]) => [name, table.schema]))),
      absentOptionalTables: [...absentOptionalTables],
      tables,
    };
    validateArtifact({ ...body, artifactChecksum: checksum(body) });
  });
  it("preserves v4 backups and accepts v5 only with the new optional table inventory", () => {
    const tables = Object.fromEntries(REQUIRED_TABLES.map(name => [name, {
      schema: "CREATE TABLE fixture ()",
      schemaChecksum: checksum("CREATE TABLE fixture ()"),
      rowCount: 0,
      checksum: rowsChecksum([]),
      rows: [],
    }]));
    for (const [version, optional] of [[4, OPTIONAL_TABLES_V4], [5, OPTIONAL_TABLES]] as const) {
      const body = {
        formatVersion: 1 as const,
        createdAt: "2026-10-21T00:00:00.000Z",
        applicationCommit: null,
        databaseEngine: "MySQL" as const,
        databaseVersion: "8.4.11",
        tableManifestVersion: version,
        schemaFingerprint: checksum(Object.fromEntries(Object.entries(tables).map(([name, table]) => [name, table.schema]))),
        absentOptionalTables: [...optional],
        tables,
      };
      validateArtifact({ ...body, artifactChecksum: checksum(body) });
    }
  });
  it("rejects remote, production, ambiguous and unacknowledged restore before connecting", () => {
    const previous = process.env.L4CKOS_LOCAL_RESTORE;
    process.env.L4CKOS_LOCAL_RESTORE = "1";
    for (const value of ["mysql://root@remote.invalid/l4ckos_test_bad", "mysql://root@localhost/l4ckos", "mysql://root@localhost/l4ckos_test_bad?host=remote.invalid", "invalid"]) expect(() => assertLocalRestoreTarget(value)).toThrow("LOCAL_RESTORE_REQUIRED");
    const nodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    expect(() => assertLocalRestoreTarget(target("l4ckos_test_source").url)).toThrow("LOCAL_RESTORE_REQUIRED");
    process.env.NODE_ENV = nodeEnv;
    delete process.env.L4CKOS_LOCAL_RESTORE;
    expect(() => assertLocalRestoreTarget(target("l4ckos_test_source").url)).toThrow("LOCAL_RESTORE_REQUIRED");
    if (previous === undefined) delete process.env.L4CKOS_LOCAL_RESTORE; else process.env.L4CKOS_LOCAL_RESTORE = previous;
  });
});

describe.skipIf(!enabled)("MySQL 8.4 real isolated backup/restore", () => {
  beforeAll(async () => {
    process.env.L4CKOS_LOCAL_RESTORE = "1";
    process.env.L4CKOS_LOCAL_SCHEMA = "1";
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
    await unlink(roundTripArtifactPath).catch(() => {});
  });
  it("round-trips all 25 physical tables and exact cents/outbox/financial/audit fields through a file", async () => {
    await writeFile(roundTripArtifactPath, JSON.stringify(artifact), { mode: 0o600 });
    expect((await stat(roundTripArtifactPath)).mode & 0o777).toBe(0o600);
    const parsed = JSON.parse(await readFile(roundTripArtifactPath, "utf8"));
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
  it("round-trips the exact v6 release schema including 0024's singleton and 0025 variant identity", async () => {
    const sourceV6 = await releaseV6Database("source");
    const destinationV6 = await releaseV6Database("destination");
    await sourceV6.connection.query("UPDATE homeHighlightSettings SET displayMode='rotate', rotationIntervalSeconds=10 WHERE id=1");
    await sourceV6.connection.query("INSERT INTO users (openId,name,email) VALUES ('synthetic-v6-user','Synthetic V6','v6@example.invalid')");
    await sourceV6.connection.query("INSERT INTO products (name,category,price,stock,optionColors,optionSizes) VALUES ('Synthetic V6 shirt','Camisetas',8000,5,'Blue','M')");
    await sourceV6.connection.query("INSERT INTO productVariants (productId,name,sku,price,stock,size,color,optionKey,isActive) VALUES (1,'Blue / M','SYNTHETIC-V6-BLUE-M',8000,5,'M','Blue','blue:m',1)");

    const artifactV6 = await backupDatabase(sourceV6.connection);
    expect(Object.keys(artifactV6.tables)).toHaveLength(30);
    expect(artifactV6.tables).toHaveProperty("homeHighlightSettings");
    expect(artifactV6.absentOptionalTables).toEqual(["preorderBatchCapacityPolicies", "preorderCapacityReservations"]);
    expect(artifactV6.tables.productVariants.rows[0]).toMatchObject({ sku: "SYNTHETIC-V6-BLUE-M", isActive: 1, color: "Blue", size: "M" });
    expect(artifactV6.tables.homeHighlightSettings.rows[0]).toMatchObject({ id: 1, displayMode: "rotate", rotationIntervalSeconds: 10 });

    // 0024 seeds this singleton on every v6 bootstrap; the restore contract
    // requires every business table to be empty, so remove only this fixture row.
    await destinationV6.connection.query("DELETE FROM homeHighlightSettings WHERE id=1");
    const restoredCount = await restoreDatabase(destinationV6.connection, artifactV6, physicalTarget(destinationV6.name));
    const restoredV6 = await backupDatabase(destinationV6.connection);
    expect(restoredCount.tables).toBe(Object.keys(artifactV6.tables).length);
    expect(restoredV6.schemaFingerprint).toBe(artifactV6.schemaFingerprint);
    expect(restoredV6.absentOptionalTables).toEqual(artifactV6.absentOptionalTables);
    expect(Object.keys(restoredV6.tables).sort()).toEqual(Object.keys(artifactV6.tables).sort());
    for (const name of Object.keys(artifactV6.tables)) {
      expect(restoredV6.tables[name].rowCount).toBe(artifactV6.tables[name].rowCount);
      expect(restoredV6.tables[name].checksum).toBe(artifactV6.tables[name].checksum);
    }
    const [migrations] = await destinationV6.connection.query<any[]>("SELECT COUNT(*) n FROM _l4ckos_schema_migrations WHERE name='0025_product_variant_identity'");
    expect(Number(migrations[0].n)).toBe(1);
    const [futureMigrations] = await destinationV6.connection.query<any[]>("SELECT COUNT(*) n FROM _l4ckos_schema_migrations WHERE name LIKE '0026%'");
    expect(Number(futureMigrations[0].n)).toBe(0);
  });
  it("rejects non-empty target without deleting or altering its rows", async () => {
    await expect(restoreDatabase(destination, artifact, target("l4ckos_test_destination"))).rejects.toThrow("TARGET_NOT_EMPTY");
    expect((await backupDatabase(destination)).tables.orderEmailEvents.checksum).toBe(artifact.tables.orderEmailEvents.checksum);
    const longTargetLogicalName = `l4ckos_test_${"x".repeat(29)}`;
    const longTargetSchemaName = scopedName(longTargetLogicalName);
    const longTarget = await database(longTargetLogicalName);
    expect(longTargetSchemaName.length).toBeLessThanOrEqual(64);
    expect(`l4ckos_restore_${longTargetSchemaName}`.length).toBeGreaterThan(64);
    expect(restoreLockName(longTargetSchemaName).length).toBeLessThanOrEqual(64);
    await longTarget.query("INSERT INTO users (openId,name,email) VALUES ('synthetic-long-target','Synthetic','long-target@example.invalid')");
    await expect(restoreDatabase(longTarget, artifact, physicalTarget(longTargetSchemaName))).rejects.toThrow("TARGET_NOT_EMPTY");

    const competitor = await openBackupConnection(url(String(destination.config.database)), socketPath);
    connections.push(competitor);
    const lockName = restoreLockName(String(destination.config.database));
    const [acquired] = await destination.query<any[]>("SELECT GET_LOCK(?, 0) AS acquired", [lockName]);
    expect(Number(acquired[0].acquired)).toBe(1);
    try {
      await expect(restoreDatabase(competitor, artifact, physicalTarget(String(destination.config.database)))).rejects.toThrow("RESTORE_ALREADY_RUNNING");
    } finally {
      await destination.query("SELECT RELEASE_LOCK(?)", [lockName]);
    }
    expect(restoreLockName(String(destination.config.database))).not.toBe(restoreLockName(longTargetSchemaName));
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
    expect(artifact.absentOptionalTables).toEqual(OPTIONAL_TABLES);
    const c = await database("l4ckos_test_optional_source", true);
    const d = await database("l4ckos_test_optional_destination", true);
    await c.query("INSERT INTO asaasWebhookEvents (eventId,eventType,payloadHash,status) VALUES ('synthetic-event','SYNTHETIC',REPEAT('a',64),'processed')");
    const b = await backupDatabase(c);
    expect(b.absentOptionalTables).toEqual(OPTIONAL_TABLES.filter(name => name !== "asaasWebhookEvents"));
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
    const writer = await openBackupConnection(url(scopedName("l4ckos_test_source")), socketPath);
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
