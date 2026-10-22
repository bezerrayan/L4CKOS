import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createConnection, type Connection, type RowDataPacket } from "mysql2/promise";
import { getTableConfig } from "drizzle-orm/mysql-core";
import { productVariants } from "../drizzle/schema";
import { bootstrapDatabase } from "../database/bootstrap/bootstrap";
import { migrateDatabase, readReleaseManifest, type LineageManifest } from "../database/migrations/runner";
import { readArtifact, readContract, readReleaseContract } from "../database/schema/artifacts";
import { readStructuralSchema, structuralHash } from "../database/schema/fingerprint";
import { assertLocalSchemaTarget, verifyLocalConnection } from "../database/schema/safety";
import { analyzeVariantPreflight, createVariantOptionKey, validateVariantCombinationSet, type VariantPreflightRow } from "../server/database/productVariantIdentity";
import { openBackupConnection } from "../server/database/backupRestore";

const REQUIRED_SOCKET = "/tmp/l4ckos-5a2b-20261021/mysqld.sock";
const V1_FINGERPRINT = "f2baf7519cb425c955bfd0f697da10afa670ee57763e3f641b61a09ba75b7f8d";
const V5_FINGERPRINT = "7fe98896cff3da47b18a522c668fc429355e0397d74afa26c864585f102d649e";
const V6_FINGERPRINT = "38b664bdad6d26873fcb3b539c17234ee4214cf6654aecf0bc13286622cc0d04";
const IDS = { simpleProduct: 5501, variantProduct: 5502, order: 8201, variants: [7201, 7202, 7203, 7204], items: [9301, 9302, 9303, 9304], reservations: [9401, 9402] } as const;
type Cli = { socketPath: string; schema: string };

function parseArgs(args: string[]): Cli {
  if (args.length !== 4 || args[0] !== "--socket" || args[2] !== "--schema") {
    throw new Error("USAGE: pnpm exec tsx scripts/test-product-variant-identity-upgrade.ts --socket /tmp/l4ckos-5a2b-20261021/mysqld.sock --schema l4ckos_test_<unique_suffix>");
  }
  const [, socketPath, , schema] = args;
  if (socketPath !== REQUIRED_SOCKET || !/^l4ckos_test_[a-z0-9_]{1,48}$/.test(schema)) throw new Error("UNAPPROVED_SOCKET_OR_SCHEMA");
  return { socketPath, schema };
}

function assertExecutionEnvironment(socketPath: string, schema: string) {
  if (process.env.NODE_ENV !== "test" || process.env.L4CKOS_LOCAL_SCHEMA !== "1") throw new Error("TEST_AND_LOCAL_SCHEMA_GUARDS_REQUIRED");
  if (Object.hasOwn(process.env, "DATABASE_URL")) throw new Error("DATABASE_URL_MUST_BE_UNSET");
  if (Object.entries(process.env).some(([key, value]) => key.startsWith("RAILWAY_") && Boolean(value))) throw new Error("RAILWAY_ENVIRONMENT_FORBIDDEN");
  assertLocalSchemaTarget({ url: `mysql://root@localhost/${schema}`, socketPath });
}

async function queryRows<T extends RowDataPacket[]>(connection: Connection, sql: string, values: unknown[] = []) {
  const [rows] = await connection.query<T>(sql, values);
  return rows;
}

async function confirmTarget(schema: string, server: { version: string; hostname: string; port: number; uuid: string }) {
  stdout.write(`Destino confirmado antes de DDL:\n  MySQL: ${server.version}\n  host: ${server.hostname}\n  port: ${server.port} (somente metadado; conexão por socket)\n  server_uuid: ${server.uuid}\n  schema novo: ${schema}\n`);
  const readline = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await readline.question(`Digite exatamente CREATE ${schema} ON ${server.uuid}: `);
    if (answer !== `CREATE ${schema} ON ${server.uuid}`) throw new Error("TARGET_CONFIRMATION_MISMATCH");
  } finally {
    readline.close();
  }
}

async function assertDrizzleContract() {
  const table = getTableConfig(productVariants);
  assert.equal(table.name, "productVariants");
  assert.ok(table.columns.some(column => column.name === "size"));
  assert.ok(table.columns.some(column => column.name === "color"));
  assert.ok(table.columns.some(column => column.name === "optionKey"));
  assert.equal(productVariants.isActive.name, "isActive");
  assert.equal(productVariants.isActive.default, 0);
  assert.equal(productVariants.isActive.notNull, true);
  assert.ok(table.checks.some(check => check.name === "product_variants_active_boolean_chk"));
  assert.ok(table.indexes.some(index => index.config.name === "productVariants_product_option_unique"));
}

async function seedLegacyRows(connection: Connection) {
  const keyPretoM = createVariantOptionKey("Preto", "M");
  const keyAzulG = createVariantOptionKey("Azul", "G");
  await connection.beginTransaction();
  try {
    await connection.query(
      "INSERT INTO products (id,name,category,price,stock) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)",
      [IDS.simpleProduct, "Gate synthetic simple", "Gate", 9900, 13, IDS.variantProduct, "Gate synthetic variants", "Gate", 15000, 19],
    );
    await connection.query(
      `INSERT INTO productVariants (id,productId,name,sku,price,stock,size,color,optionKey) VALUES
       (7201,5502,'Preto / M histórico','GATE-SKU-7201',12850,4,'M','Preto',?),
       (7202,5502,'Legado sem classificação','GATE-SKU-7202',NULL,7,NULL,NULL,NULL),
       (7203,5502,'Azul / G histórico','GATE-SKU-7203',14100,6,'G','Azul',?),
       (7204,5502,'preto / m ambíguo','GATE-SKU-7204',12950,2,'m',' preto ',NULL)`,
      [keyPretoM, keyAzulG],
    );
    await connection.query("INSERT INTO orders (id,userId,totalPrice) VALUES (?, ?, ?)", [IDS.order, 75501, 65950]);
    await connection.query(
      `INSERT INTO orderItems (id,orderId,productId,quantity,unitPrice,variantId,productName,variantName,sku,size,color,totalPrice) VALUES
       (9301,8201,5502,1,12850,7201,'Gate synthetic variants','Preto / M histórico','GATE-SKU-7201','M','Preto',12850),
       (9302,8201,5502,1,15000,7202,'Gate synthetic variants','Legado sem classificação','GATE-SKU-7202',NULL,NULL,15000),
       (9303,8201,5502,2,14100,7203,'Gate synthetic variants','Azul / G histórico','GATE-SKU-7203','G','Azul',28200),
       (9304,8201,5501,1,9900,NULL,'Gate synthetic simple',NULL,NULL,NULL,NULL,9900)`,
    );
    await connection.query(
      `INSERT INTO stockReservations (id,orderId,userId,productId,quantity,status,expiresAt,variantId,orderItemId) VALUES
       (9401,8201,75501,5502,1,'active',DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 1 HOUR),7202,9302),
       (9402,8201,75501,5502,2,'active',DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 1 HOUR),7203,9303)`,
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

async function captureLegacySnapshot(connection: Connection) {
  const products = await queryRows(connection, "SELECT id,name,category,price,stock FROM products WHERE id IN (?,?) ORDER BY id", [IDS.simpleProduct, IDS.variantProduct]);
  const variants = await queryRows(connection, "SELECT id,productId,name,color,size,optionKey,sku,price,stock FROM productVariants ORDER BY id");
  const items = await queryRows(connection, "SELECT id,orderId,productId,quantity,unitPrice,variantId,productName,variantName,sku,size,color,totalPrice FROM orderItems WHERE orderId=? ORDER BY id", [IDS.order]);
  const reservations = await queryRows(connection, "SELECT id,orderId,userId,productId,quantity,status,variantId,orderItemId FROM stockReservations WHERE orderId=? ORDER BY id", [IDS.order]);
  return { products, variants, items, reservations };
}

async function verifyMigration25(connection: Connection, before: Awaited<ReturnType<typeof captureLegacySnapshot>>) {
  const column = (await queryRows(connection,
    "SELECT COLUMN_TYPE type, IS_NULLABLE nullable, COLUMN_DEFAULT defaultValue FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='productVariants' AND COLUMN_NAME='isActive'"))[0];
  assert.ok(column, "isActive column is missing");
  assert.equal(String(column.type).toLowerCase(), "tinyint");
  assert.equal(column.nullable, "NO");
  assert.equal(String(column.defaultValue), "0");

  const check = (await queryRows(connection,
    `SELECT t.ENFORCED enforced, c.CHECK_CLAUSE clause
     FROM information_schema.TABLE_CONSTRAINTS t
     JOIN information_schema.CHECK_CONSTRAINTS c ON c.CONSTRAINT_SCHEMA=t.CONSTRAINT_SCHEMA AND c.CONSTRAINT_NAME=t.CONSTRAINT_NAME
     WHERE t.CONSTRAINT_SCHEMA=DATABASE() AND t.TABLE_NAME='productVariants' AND t.CONSTRAINT_NAME='product_variants_active_boolean_chk'`))[0];
  assert.ok(check, "boolean CHECK constraint is missing");
  assert.equal(check.enforced, "YES");
  assert.match(String(check.clause).toLowerCase().replaceAll("`", ""), /isactive\s+in\s*\(0,\s*1\)/);

  const after = await captureLegacySnapshot(connection);
  assert.deepEqual(after, before, "legacy products, variants, IDs, prices, SKUs, stocks or historical references changed");
  const availability = await queryRows(connection, "SELECT id,isActive FROM productVariants ORDER BY id");
  assert.deepEqual(availability, IDS.variants.map(id => ({ id, isActive: 0 })));
  assert.equal(after.variants.find(row => Number(row.id) === 7202)?.name, "Legado sem classificação");
  assert.equal(after.variants.find(row => Number(row.id) === 7202)?.color, null);
  assert.equal(after.variants.find(row => Number(row.id) === 7202)?.size, null);
  assert.equal(after.variants.find(row => Number(row.id) === 7202)?.optionKey, null);

  const products = after.products.map(row => ({ id: Number(row.id), stock: Number(row.stock), hasVariantOptions: Number(row.id) === IDS.variantProduct, salesMode: "STOCK" as const }));
  const variants = after.variants.map(row => ({
    ...row,
    id: Number(row.id), productId: Number(row.productId),
    price: row.price === null ? null : Number(row.price), stock: Number(row.stock), isActive: 0,
  }));
  const itemVariantIds = after.items.flatMap(row => row.variantId === null ? [] : [Number(row.variantId)]);
  const reservationVariantIds = after.reservations.flatMap(row => row.variantId === null ? [] : [Number(row.variantId)]);
  const findings = analyzeVariantPreflight({ products, variants: variants as VariantPreflightRow[], orderItemVariantIds: itemVariantIds, reservationVariantIds });
  assert.ok(findings.some(f => f.kind === "simple-product" && f.productId === IDS.simpleProduct));
  assert.ok(findings.some(f => f.kind === "pending-classification" && f.variantId === 7202));
  assert.ok(findings.some(f => f.kind === "duplicate-combination" && f.productId === IDS.variantProduct && f.variantIds.includes(7201) && f.variantIds.includes(7204)));
  assert.ok(findings.some(f => f.kind === "referenced-variant" && f.variantId === 7202 && f.orderItemCount === 1 && f.reservationCount === 1));
  assert.ok(findings.some(f => f.kind === "referenced-variant" && f.variantId === 7203 && f.orderItemCount === 1 && f.reservationCount === 1));
  assert.throws(() => validateVariantCombinationSet(IDS.variantProduct, [
    { color: "Preto", size: "M", sku: "GATE-NEW-1", price: null, stock: 1, isActive: true },
    { color: " preto ", size: "m", sku: "GATE-NEW-2", price: null, stock: 1, isActive: true },
  ]), /VARIANT_COMBINATION_DUPLICATE/);

  await connection.beginTransaction();
  try {
    await connection.query("INSERT INTO productVariants (id,productId,name,sku,price,stock) VALUES (7299,5502,'Default check','GATE-DEFAULT-7299',100,1)");
    const defaultRow = (await queryRows(connection, "SELECT isActive FROM productVariants WHERE id=7299"))[0];
    assert.equal(Number(defaultRow.isActive), 0, "default insert did not produce isActive=0");
    await connection.rollback();
  } catch (error) {
    await connection.rollback();
    throw error;
  }
  assert.equal((await queryRows(connection, "SELECT id FROM productVariants WHERE id=7299")).length, 0, "transaction rollback left the synthetic row behind");

  let invalidBooleanRejected = false;
  await connection.beginTransaction();
  try {
    await connection.query("INSERT INTO productVariants (id,productId,name,sku,price,stock,isActive) VALUES (7298,5502,'CHECK probe','GATE-CHECK-7298',100,1,2)");
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
    assert.equal(code, "ER_CHECK_CONSTRAINT_VIOLATED", "invalid isActive failed for a reason other than the expected MySQL CHECK rejection");
    invalidBooleanRejected = true;
  } finally {
    await connection.rollback();
  }
  assert.ok(invalidBooleanRejected, "CHECK accepted isActive=2");
  assert.equal((await queryRows(connection, "SELECT id FROM productVariants WHERE id=7298")).length, 0, "failed CHECK probe left a row behind");

  return { before, after, findings };
}

async function main() {
  const { socketPath, schema } = parseArgs(process.argv.slice(2));
  assertExecutionEnvironment(socketPath, schema);
  if (!(await stat(socketPath)).isSocket()) throw new Error("SOCKET_PATH_IS_NOT_A_UNIX_SOCKET");

  let admin: Connection | undefined;
  let connection: Connection | undefined;
  let stage = "server-preflight";
  let createdSchema = false;
  try {
    admin = await createConnection({ socketPath, user: "root", database: "mysql", multipleStatements: false });
    const serverRow = (await queryRows(admin, "SELECT VERSION() version, @@hostname hostname, @@port port, @@server_uuid serverUuid"))[0];
    const version = String(serverRow.version).split("-")[0];
    assert.equal(version, "8.4.11", "this harness accepts only MySQL 8.4.11");
    const existing = await queryRows(admin, "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?", [schema]);
    assert.equal(existing.length, 0, "refusing to reuse or alter a preexisting schema");
    await confirmTarget(schema, { version, hostname: String(serverRow.hostname), port: Number(serverRow.port), uuid: String(serverRow.serverUuid) });
    const repeatedCheck = await queryRows(admin, "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?", [schema]);
    assert.equal(repeatedCheck.length, 0, "schema appeared during confirmation; refusing DDL");

    stage = "create-synthetic-schema";
    await admin.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    createdSchema = true;
    await admin.end();
    admin = undefined;

    const url = `mysql://root@localhost/${schema}`;
    const target = { url, socketPath };
    assertLocalSchemaTarget(target);
    connection = await openBackupConnection(url, socketPath);
    await verifyLocalConnection(connection, target);
    const reconnectedIdentity = (await queryRows(connection, "SELECT VERSION() version, @@server_uuid serverUuid, DATABASE() databaseName"))[0];
    assert.equal(String(reconnectedIdentity.version).split("-")[0], "8.4.11");
    assert.equal(String(reconnectedIdentity.serverUuid), String(serverRow.serverUuid), "MySQL server identity changed after schema creation");
    assert.equal(String(reconnectedIdentity.databaseName), schema);
    const applicationCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

    stage = "bootstrap-historical-v1";
    const baseContract = await readContract();
    assert.equal(baseContract.fingerprint, V1_FINGERPRINT);
    const baseContext = { ...target, applicationCommit, approvedFingerprint: V1_FINGERPRINT };
    const bootstrap = await bootstrapDatabase(connection, baseContext);
    assert.equal(bootstrap.status, "BOOTSTRAPPED");

    stage = "upgrade-v1-to-v5-through-historical-artifacts";
    const v5Manifest = JSON.parse((await readArtifact("database/migrations/manifest-v5.json", "database/migrations")).toString("utf8")) as LineageManifest;
    const v5Contract = JSON.parse((await readArtifact("database/schema/contract-v5.json", "database/schema")).toString("utf8")) as { version: number; fingerprint: string };
    assert.equal(v5Contract.version, 5);
    assert.equal(v5Contract.fingerprint, V5_FINGERPRINT);
    assert.deepEqual(v5Manifest.migrations.map(entry => entry.name), [
      "0021_preorder_production_batches", "0022_preorder_manufacturing_schedule", "0023_asaas_webhook_inbox", "0024_home_highlight_settings",
    ]);
    assert.equal(v5Manifest.migrations.at(-1)?.expectedPostFingerprint, v5Contract.fingerprint);
    const toV5 = await migrateDatabase(connection, { ...target, applicationCommit, approvedFingerprint: v5Contract.fingerprint }, v5Manifest);
    assert.deepEqual(toV5.applied, v5Manifest.migrations.map(entry => entry.name));
    assert.equal(toV5.fingerprint, V5_FINGERPRINT);
    assert.equal(structuralHash(await readStructuralSchema(connection)), V5_FINGERPRINT);
    const homeSettings = (await queryRows(connection, "SELECT id,displayMode,rotationIntervalSeconds FROM homeHighlightSettings"))[0];
    assert.deepEqual(homeSettings, { id: 1, displayMode: "single", rotationIntervalSeconds: 8 });

    stage = "seed-legacy-fixtures";
    await seedLegacyRows(connection);
    const before = await captureLegacySnapshot(connection);
    assert.deepEqual(before.variants.map(row => Number(row.id)), [...IDS.variants]);
    assert.deepEqual(before.items.map(row => Number(row.id)), [...IDS.items]);
    assert.deepEqual(before.reservations.map(row => Number(row.id)), [...IDS.reservations]);

    stage = "apply-only-0025-from-v5-to-v6";
    const v6Manifest = await readReleaseManifest();
    const v6Contract = await readReleaseContract();
    assert.equal(v6Contract.version, 6);
    assert.equal(v6Contract.fingerprint, V6_FINGERPRINT);
    assert.deepEqual(v6Manifest.migrations.map(entry => entry.name), [
      "0021_preorder_production_batches", "0022_preorder_manufacturing_schedule", "0023_asaas_webhook_inbox", "0024_home_highlight_settings", "0025_product_variant_identity",
    ]);
    const toV6 = await migrateDatabase(connection, { ...target, applicationCommit, approvedFingerprint: V6_FINGERPRINT }, v6Manifest);
    assert.deepEqual(toV6.applied, ["0025_product_variant_identity"]);
    assert.equal(toV6.fingerprint, V6_FINGERPRINT);
    assert.equal(structuralHash(await readStructuralSchema(connection)), v6Contract.fingerprint);
    await assertDrizzleContract();

    stage = "verify-0025-data-contract-checks-preflight-and-rollback";
    const preservation = await verifyMigration25(connection, before);
    console.log(JSON.stringify({
      status: "PASS",
      server: { version, uuid: String(serverRow.serverUuid) },
      schema,
      migrationsToV5: toV5.applied,
      migrationsV5ToV6: toV6.applied,
      fingerprints: { v5: toV5.fingerprint, v6: toV6.fingerprint },
      legacyPreservation: {
        equal: true,
        beforeSha256: structuralHash(preservation.before),
        afterSha256: structuralHash(preservation.after),
        before: preservation.before,
        after: preservation.after,
      },
      preflight: preservation.findings,
      defaultAndCheck: { defaultIsActive: 0, enforcedBooleanCheck: true, invalidValueRejected: true },
      rollback: { insertRemoved: true, failedCheckProbeRemoved: true },
      cleanup: "not performed; retain this schema for review",
    }, null, 2));
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : undefined;
    console.error(JSON.stringify({ status: "FAIL", stage, code, message: error instanceof Error ? error.message : "UNKNOWN_FAILURE", createdSchema, cleanup: "not performed; inspect this schema before any cleanup" }));
    process.exitCode = 1;
  } finally {
    await connection?.end().catch(() => undefined);
    await admin?.end().catch(() => undefined);
  }
}

main().catch(error => {
  console.error(JSON.stringify({ status: "FAIL", stage: "startup", message: error instanceof Error ? error.message : "UNKNOWN_FAILURE", cleanup: "not performed" }));
  process.exitCode = 1;
});
