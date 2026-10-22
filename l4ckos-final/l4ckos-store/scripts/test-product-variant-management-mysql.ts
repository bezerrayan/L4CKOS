import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { bootstrapDatabase } from "../database/bootstrap/bootstrap";
import {
  migrateDatabase,
  readReleaseManifest,
} from "../database/migrations/runner";
import {
  readContract,
  readReleaseContract,
} from "../database/schema/artifacts";
import {
  assertLocalSchemaTarget,
  verifyLocalConnection,
} from "../database/schema/safety";
import {
  readStructuralSchema,
  structuralHash,
} from "../database/schema/fingerprint";
import { openBackupConnection } from "../server/database/backupRestore";
import { inWebhookTransaction } from "../server/database/webhookTransaction";
import {
  getPublicProductVariants,
  updateProductWithCatalog,
} from "../server/db";
import { createVariantOptionKey } from "../server/database/productVariantIdentity";

const ALLOWED_SOCKET = "/tmp/l4ckos-5a2b-20261021/mysqld.sock";
const V1_FINGERPRINT =
  "f2baf7519cb425c955bfd0f697da10afa670ee57763e3f641b61a09ba75b7f8d";
type Cli = { socketPath: string; schema: string };

function parseArgs(args: string[]): Cli {
  if (args.length !== 4 || args[0] !== "--socket" || args[2] !== "--schema")
    throw new Error(
      "USAGE: pnpm exec tsx scripts/test-product-variant-management-mysql.ts --socket /tmp/l4ckos-5a2b-20261021/mysqld.sock --schema l4ckos_test_variant_manage_<unique_suffix>"
    );
  const [, socketPath, , schema] = args;
  if (
    socketPath !== ALLOWED_SOCKET ||
    !/^l4ckos_test_variant_manage_[a-z0-9_]{1,36}$/.test(schema)
  )
    throw new Error("UNAPPROVED_SOCKET_OR_SCHEMA");
  return { socketPath, schema };
}

function assertEnvironment(socketPath: string, schema: string) {
  if (
    process.env.NODE_ENV !== "test" ||
    process.env.L4CKOS_LOCAL_SCHEMA !== "1"
  )
    throw new Error("TEST_AND_LOCAL_SCHEMA_GUARDS_REQUIRED");
  if (Object.hasOwn(process.env, "DATABASE_URL"))
    throw new Error("DATABASE_URL_MUST_BE_UNSET");
  if (
    Object.entries(process.env).some(
      ([key, value]) => /^(RAILWAY_|VERCEL_)/.test(key) && Boolean(value)
    )
  )
    throw new Error("HOSTED_ENVIRONMENT_FORBIDDEN");
  assertLocalSchemaTarget({
    url: `mysql://root@localhost/${schema}`,
    socketPath,
  });
}

async function rows<T extends RowDataPacket[]>(
  connection: Connection,
  query: string,
  values: unknown[] = []
) {
  const [result] = await connection.query<T>(query, values);
  return result;
}

async function assertFixtureReference(
  connection: Connection,
  description: string,
  query: string,
  values: unknown[] = []
) {
  const result = await rows(connection, query, values);
  assert.equal(
    result.length,
    1,
    `fixture integrity: missing or incorrect ${description}`
  );
}

async function confirm(
  schema: string,
  identity: { version: string; hostname: string; uuid: string }
) {
  stdout.write(
    `Destino verificado antes do DDL:\n  MySQL: ${identity.version}\n  host: ${identity.hostname}\n  server_uuid: ${identity.uuid}\n  schema NOVO: ${schema}\n  conexão: somente socket local ${ALLOWED_SOCKET}\n`
  );
  const readline = createInterface({ input: stdin, output: stdout });
  try {
    const response = await readline.question(
      `Digite exatamente CREATE ${schema} ON ${identity.uuid}: `
    );
    if (response !== `CREATE ${schema} ON ${identity.uuid}`)
      throw new Error("TARGET_CONFIRMATION_MISMATCH");
  } finally {
    readline.close();
  }
}

async function main() {
  const { socketPath, schema } = parseArgs(process.argv.slice(2));
  assertEnvironment(socketPath, schema);
  if (!(await stat(socketPath)).isSocket())
    throw new Error("SOCKET_PATH_IS_NOT_A_UNIX_SOCKET");

  let admin: Connection | undefined;
  let connection: Connection | undefined;
  let pool: mysql.Pool | undefined;
  let createdSchema = false;
  let stage = "preflight";
  try {
    admin = await mysql.createConnection({
      socketPath,
      user: "root",
      database: "mysql",
      multipleStatements: false,
    });
    const server = (
      await rows(
        admin,
        "SELECT VERSION() version, @@hostname hostname, @@server_uuid serverUuid"
      )
    )[0];
    assert.equal(
      String(server.version).split("-")[0],
      "8.4.11",
      "Harness accepts only MySQL 8.4.11"
    );
    assert.equal(
      (
        await rows(
          admin,
          "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?",
          [schema]
        )
      ).length,
      0,
      "Refusing to reuse a schema"
    );
    await confirm(schema, {
      version: String(server.version),
      hostname: String(server.hostname),
      uuid: String(server.serverUuid),
    });
    assert.equal(
      (
        await rows(
          admin,
          "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?",
          [schema]
        )
      ).length,
      0,
      "Schema appeared during confirmation"
    );

    stage = "create-confirmed-test-schema";
    await admin.query(
      `CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    createdSchema = true;
    await admin.end();
    admin = undefined;

    const url = `mysql://root@localhost/${schema}`;
    const target = { url, socketPath };
    assertLocalSchemaTarget(target);
    connection = await openBackupConnection(url, socketPath);
    await verifyLocalConnection(connection, target);
    assert.equal(
      String(
        (
          await rows(
            connection,
            "SELECT @@server_uuid serverUuid, DATABASE() databaseName"
          )
        )[0].serverUuid
      ),
      String(server.serverUuid)
    );
    assert.equal(
      String(
        (await rows(connection, "SELECT DATABASE() databaseName"))[0]
          .databaseName
      ),
      schema
    );
    const applicationCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    stage = "bootstrap-and-migrate-synthetic-schema-to-v6";
    const v1 = await readContract();
    assert.equal(v1.fingerprint, V1_FINGERPRINT);
    await bootstrapDatabase(connection, {
      ...target,
      applicationCommit,
      approvedFingerprint: V1_FINGERPRINT,
    });
    const v6 = await readReleaseContract();
    const migrated = await migrateDatabase(
      connection,
      { ...target, applicationCommit, approvedFingerprint: v6.fingerprint },
      await readReleaseManifest()
    );
    assert.equal(migrated.fingerprint, v6.fingerprint);
    assert.equal(
      structuralHash(await readStructuralSchema(connection)),
      v6.fingerprint
    );

    stage = "seed-synthetic-legacy-and-current-variants";
    const blackMKey = createVariantOptionKey("Preto", "M");
    await connection.beginTransaction();
    try {
      await connection.query(
        "INSERT INTO products (id,name,category,price,stock) VALUES (5501,'Harness simple','Harness',9900,7),(5502,'Harness variants','Harness',12000,8)"
      );
      await connection.query(
        "INSERT INTO productVariants (id,productId,name,sku,price,stock,color,size,optionKey,isActive) VALUES (7201,5502,'Preto / M','HARNESS-7201',8900,5,'Preto','M',?,1),(7202,5502,'Legado ambíguo','HARNESS-7202',9500,3,NULL,NULL,NULL,0)",
        [blackMKey]
      );
      await connection.query(
        "INSERT INTO orders (id,userId,totalPrice) VALUES (8201,75501,9500)"
      );
      await connection.query(
        "INSERT INTO orderItems (id,orderId,productId,variantId,productName,variantName,sku,size,color,quantity,unitPrice,totalPrice) VALUES (9301,8201,5502,7202,'Harness variants','Legado ambíguo','HARNESS-7202',NULL,NULL,1,9500,9500)"
      );
      await connection.query(
        "INSERT INTO stockReservations (id,orderId,userId,productId,variantId,orderItemId,quantity,status,expiresAt) VALUES (9401,8201,75501,5502,7201,NULL,2,'active',DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 1 HOUR))"
      );

      await assertFixtureReference(
        connection,
        "order 8201 for orderItems.orderId and stockReservations.orderId",
        "SELECT id FROM orders WHERE id=8201 AND userId=75501 AND totalPrice=9500"
      );
      assert.equal(
        (
          await rows(
            connection,
            "SELECT id FROM products WHERE id IN (5501,5502)"
          )
        ).length,
        2,
        "fixture integrity: expected products 5501 and 5502"
      );
      await assertFixtureReference(
        connection,
        "variants 7201 and 7202 for product 5502",
        "SELECT productId FROM productVariants WHERE id IN (7201,7202) AND productId=5502 GROUP BY productId HAVING COUNT(*)=2"
      );
      await assertFixtureReference(
        connection,
        "order item 9301 for order 8201, product 5502, and historical variant 7202",
        "SELECT id FROM orderItems WHERE id=9301 AND orderId=8201 AND productId=5502 AND variantId=7202"
      );
      await assertFixtureReference(
        connection,
        "active reservation 9401 for order 8201 and product 5502",
        "SELECT id FROM stockReservations WHERE id=9401 AND orderId=8201 AND productId=5502 AND variantId=7201 AND status='active'"
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }

    stage = "exercise-real-catalog-helpers-with-local-socket-pool";
    const orderBeforeManagement = (
      await rows(
        connection,
        "SELECT id,userId,status,paymentStatus,totalPrice,fulfillmentStatus FROM orders WHERE id=8201"
      )
    )[0];
    pool = mysql.createPool({
      socketPath,
      user: "root",
      database: schema,
      connectionLimit: 3,
      multipleStatements: false,
    });
    const appDb = drizzle(pool);
    const withLocalDb = <T>(action: () => Promise<T>) =>
      inWebhookTransaction(appDb as any, action, []);

    await withLocalDb(() =>
      updateProductWithCatalog({
        id: 5502,
        product: {},
        variants: [{ id: 7201, sku: "HARNESS-7201-PATCH" }],
      })
    );
    const partial = (
      await rows(
        connection,
        "SELECT id,sku,price,stock FROM productVariants WHERE id=7201"
      )
    )[0];
    assert.deepEqual(
      {
        id: Number(partial.id),
        sku: partial.sku,
        price: Number(partial.price),
        stock: Number(partial.stock),
      },
      { id: 7201, sku: "HARNESS-7201-PATCH", price: 8900, stock: 5 }
    );

    const beforeDuplicate = (
      await rows(connection, "SELECT name,stock FROM products WHERE id=5502")
    )[0];
    await assert.rejects(
      withLocalDb(() =>
        updateProductWithCatalog({
          id: 5502,
          product: { name: "Must rollback" },
          variants: [
            {
              id: 7202,
              color: "Preto",
              size: "M",
              sku: "HARNESS-7202",
              isActive: false,
            },
          ],
        })
      ),
      /combinação de cor e tamanho/
    );
    const afterDuplicate = (
      await rows(connection, "SELECT name,stock FROM products WHERE id=5502")
    )[0];
    assert.deepEqual(
      afterDuplicate,
      beforeDuplicate,
      "duplicate combination must roll back the whole catalog transaction"
    );

    await withLocalDb(() =>
      updateProductWithCatalog({
        id: 5502,
        product: {},
        variants: [
          {
            id: 7202,
            color: "Branco",
            size: "G",
            sku: "HARNESS-7202",
            isActive: false,
          },
        ],
      })
    );
    const classified = (
      await rows(
        connection,
        "SELECT id,color,size,optionKey,isActive,sku,price,stock FROM productVariants WHERE id=7202"
      )
    )[0];
    assert.equal(Number(classified.id), 7202, "legacy ID changed");
    assert.deepEqual(
      {
        color: classified.color,
        size: classified.size,
        isActive: Number(classified.isActive),
        sku: classified.sku,
        price: Number(classified.price),
        stock: Number(classified.stock),
      },
      {
        color: "Branco",
        size: "G",
        isActive: 0,
        sku: "HARNESS-7202",
        price: 9500,
        stock: 3,
      }
    );
    assert.equal(
      String(classified.optionKey),
      createVariantOptionKey("Branco", "G")
    );

    const beforeReservedReduction = (
      await rows(connection, "SELECT name,stock FROM products WHERE id=5502")
    )[0];
    await assert.rejects(
      withLocalDb(() =>
        updateProductWithCatalog({
          id: 5502,
          product: { name: "Must rollback reserved" },
          variants: [{ id: 7201, stock: 1 }],
        })
      ),
      /2 unidades reservadas ativas/
    );
    assert.deepEqual(
      (
        await rows(connection, "SELECT name,stock FROM products WHERE id=5502")
      )[0],
      beforeReservedReduction
    );
    assert.equal(
      Number(
        (
          await rows(
            connection,
            "SELECT stock FROM productVariants WHERE id=7201"
          )
        )[0].stock
      ),
      5
    );

    const publicResult = await withLocalDb(() =>
      getPublicProductVariants(5502)
    );
    assert.equal(publicResult.hasVariants, true);
    assert.deepEqual(publicResult.variants, [
      {
        variantId: 7201,
        color: "Preto",
        size: "M",
        price: 8900,
        availableUnits: 3,
      },
    ]);
    assert.equal(
      Number(
        (
          await rows(
            connection,
            "SELECT variantId FROM orderItems WHERE id=9301"
          )
        )[0].variantId
      ),
      7202,
      "historical variant reference changed"
    );
    assert.equal(
      Number(
        (
          await rows(
            connection,
            "SELECT variantId FROM stockReservations WHERE id=9401"
          )
        )[0].variantId
      ),
      7201,
      "reservation variant reference changed"
    );
    await withLocalDb(() =>
      updateProductWithCatalog({
        id: 5501,
        product: { name: "Harness simple updated" },
        variants: [],
      })
    );
    assert.equal(
      Number(
        (await rows(connection, "SELECT stock FROM products WHERE id=5501"))[0]
          .stock
      ),
      7,
      "simple product stock changed"
    );
    assert.deepEqual(
      (
        await rows(
          connection,
          "SELECT id,userId,status,paymentStatus,totalPrice,fulfillmentStatus FROM orders WHERE id=8201"
        )
      )[0],
      orderBeforeManagement,
      "catalog management mutated the seeded financial order record"
    );

    console.log(
      JSON.stringify(
        {
          status: "PASS",
          server: String(server.version),
          schema,
          migrations: migrated.applied,
          fingerprint: migrated.fingerprint,
          checks: [
            "variant ID preserved",
            "partial patch preserves price and stock",
            "duplicate option rejected with transaction rollback",
            "legacy classification remains inactive",
            "active reservation prevents stock reduction",
            "public projection excludes inactive legacy row",
            "public availability subtracts active reservations",
            "historical order and reservation references preserved",
            "simple product stock preserved",
          ],
          cleanup:
            "not performed; inspect and retain this newly created schema for review",
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        status: "FAIL",
        stage,
        schema,
        createdSchema,
        code:
          error && typeof error === "object" && "code" in error
            ? String((error as { code: unknown }).code)
            : undefined,
        message: error instanceof Error ? error.message : "UNKNOWN_FAILURE",
        cleanup: "not performed; inspect this schema before any cleanup",
      })
    );
    process.exitCode = 1;
  } finally {
    await pool?.end().catch(() => undefined);
    await connection?.end().catch(() => undefined);
    await admin?.end().catch(() => undefined);
  }
}

main().catch(error => {
  console.error(
    JSON.stringify({
      status: "FAIL",
      stage: "startup",
      message: error instanceof Error ? error.message : "UNKNOWN_FAILURE",
      cleanup: "not performed",
    })
  );
  process.exitCode = 1;
});
