#!/usr/bin/env node
import mysql from "mysql2/promise";
import { X509Certificate } from "node:crypto";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const CORE_TABLES = Object.freeze([
  "users",
  "products",
  "productVariants",
  "orders",
  "orderItems",
  "stockReservations",
  "auditLogs",
  "asaasWebhookEvents",
  "userAddresses",
]);

export const TABLES = Object.freeze([
  ...CORE_TABLES,
  "stockCheckoutAttempts",
  "stockCheckoutItems",
  "stockWebhookEvents",
]);

export const READ_ONLY_GRANT_POLICY =
  "USAGE plus table-level REFERENCES on allowlisted tables only; optional SELECT on confirmed migration history";

const QUERY = Object.freeze({
  session: `SELECT VERSION() AS serverVersion,
                   DATABASE() AS selectedSchema,
                   CURRENT_USER() AS authenticatedPrincipal,
                   CURRENT_ROLE() AS activeRoles`,
  tls: `SHOW SESSION STATUS WHERE Variable_name IN ('Ssl_version', 'Ssl_cipher')`,
  grants: `SHOW GRANTS FOR CURRENT_USER`,
  tables: `SELECT TABLE_NAME AS tableName, TABLE_TYPE AS tableType,
                  ENGINE AS engine, TABLE_COLLATION AS tableCollation
             FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (${TABLES.map(() => "?").join(", ")})
            ORDER BY TABLE_NAME`,
  columns: `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName,
                   ORDINAL_POSITION AS ordinalPosition, COLUMN_TYPE AS columnType,
                   IS_NULLABLE AS isNullable, COLUMN_DEFAULT AS columnDefault,
                   EXTRA AS extra, COLLATION_NAME AS collationName,
                   GENERATION_EXPRESSION AS generationExpression
              FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (${TABLES.map(() => "?").join(", ")})
             ORDER BY TABLE_NAME, ORDINAL_POSITION`,
  indexes: `SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName,
                   NON_UNIQUE AS nonUnique, SEQ_IN_INDEX AS sequence,
                   COLUMN_NAME AS columnName, INDEX_TYPE AS indexType
              FROM INFORMATION_SCHEMA.STATISTICS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (${TABLES.map(() => "?").join(", ")})
             ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
  constraints: `SELECT tc.TABLE_NAME AS tableName, tc.CONSTRAINT_NAME AS constraintName,
                       tc.CONSTRAINT_TYPE AS constraintType, kcu.COLUMN_NAME AS columnName,
                       kcu.ORDINAL_POSITION AS ordinalPosition,
                       kcu.REFERENCED_TABLE_NAME AS referencedTableName,
                       kcu.REFERENCED_COLUMN_NAME AS referencedColumnName,
                       rc.UPDATE_RULE AS updateRule, rc.DELETE_RULE AS deleteRule
                  FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                  LEFT JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
                    ON kcu.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
                   AND kcu.TABLE_NAME = tc.TABLE_NAME
                   AND kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
                  LEFT JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
                    ON rc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
                   AND rc.TABLE_NAME = tc.TABLE_NAME
                   AND rc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
                 WHERE tc.CONSTRAINT_SCHEMA = ? AND tc.TABLE_NAME IN (${TABLES.map(() => "?").join(", ")})
                 ORDER BY tc.TABLE_NAME, tc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`,
  checks: `SELECT tc.TABLE_NAME AS tableName, tc.CONSTRAINT_NAME AS constraintName,
                  cc.CHECK_CLAUSE AS checkClause
             FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
             JOIN INFORMATION_SCHEMA.CHECK_CONSTRAINTS cc
               ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
              AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
            WHERE tc.CONSTRAINT_SCHEMA = ? AND tc.CONSTRAINT_TYPE = 'CHECK'
              AND tc.TABLE_NAME IN (${TABLES.map(() => "?").join(", ")})
            ORDER BY tc.TABLE_NAME, tc.CONSTRAINT_NAME`,
});

const USAGE_GLOBAL_GRANT = "GRANT USAGE ON *.*";
const DRIZZLE_HISTORY_TABLE = "__drizzle_migrations";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function grantPolicy(grantRows, schema, includeDrizzleHistory) {
  const grants = grantRows.map(row => String(Object.values(row)[0] ?? ""));
  for (const grant of grants) {
    if (/\bWITH GRANT OPTION\b/i.test(grant))
      return { safe: false, triggerPrivilege: false };
    if (grant.startsWith(USAGE_GLOBAL_GRANT)) continue;
    if (
      grant.startsWith("GRANT USAGE ON ") &&
      grant.includes(`\`${schema}\`.*`)
    )
      continue;
    const target = grant.match(/\sON\s+`?([^`.]+)`?\.`?([^`.]+)`?\s+TO\s/i);
    if (!target || target[1] !== schema)
      return { safe: false, triggerPrivilege: /\bTRIGGER\b/i.test(grant) };

    if (grant.startsWith("GRANT REFERENCES ON ") && TABLES.includes(target[2]))
      continue;
    if (
      includeDrizzleHistory &&
      grant.startsWith("GRANT SELECT ON ") &&
      target[2] === DRIZZLE_HISTORY_TABLE
    )
      continue;
    return { safe: false, triggerPrivilege: /\bTRIGGER\b/i.test(grant) };
  }
  return { safe: true, triggerPrivilege: false };
}

function statementValues(schema) {
  return [schema, ...TABLES];
}

function validateRequest(expectedSchema, runId, timeoutMs) {
  if (!/^[A-Za-z0-9_$-]{1,64}$/.test(expectedSchema ?? ""))
    throw fail("INVALID_EXPECTED_SCHEMA");
  if (typeof runId !== "string" || !/^[A-Za-z0-9._-]{1,80}$/.test(runId))
    throw fail("INVALID_RUN_ID");
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1000 ||
    timeoutMs > 120_000
  )
    throw fail("INVALID_TIMEOUT");
}

async function query(connection, sql, values = [], timeoutMs) {
  return connection.query({ sql, timeout: timeoutMs }, values);
}

export async function runSchemaAttestation({
  connection,
  expectedSchema,
  runId,
  timeoutMs = 20_000,
  includeDrizzleHistory = false,
  onTimeout = () => connection.destroy?.(),
}) {
  if (!connection) throw fail("CONNECTION_REQUIRED");
  validateRequest(expectedSchema, runId, timeoutMs);

  let timer;
  const operation = (async () => {
    const [sessionRows] = await query(connection, QUERY.session, [], timeoutMs);
    const session = sessionRows[0];
    if (
      !session ||
      (session.selectedSchema !== null &&
        session.selectedSchema !== expectedSchema)
    )
      throw fail("SESSION_IDENTITY_MISMATCH");

    const [tlsRows] = await query(connection, QUERY.tls, [], timeoutMs);
    const tls = Object.fromEntries(
      tlsRows.map(row => [row.Variable_name, row.Value])
    );
    if (tls.Ssl_version !== "TLSv1.3" || !tls.Ssl_cipher)
      throw fail("TLS_POLICY_MISMATCH");

    const [grantRows] = await query(connection, QUERY.grants, [], timeoutMs);
    const grantStatus = grantPolicy(
      grantRows,
      expectedSchema,
      includeDrizzleHistory
    );
    if (!grantStatus.safe)
      throw fail(
        grantStatus.triggerPrivilege
          ? "TRIGGER_PRIVILEGE_NOT_READ_ONLY"
          : "UNREVIEWED_PRIVILEGE"
      );

    const values = statementValues(expectedSchema);
    const [tables] = await query(connection, QUERY.tables, values, timeoutMs);
    const visible = new Set(tables.map(row => row.tableName));
    const missingCoreTables = CORE_TABLES.filter(name => !visible.has(name));
    if (missingCoreTables.length) throw fail("METADATA_VISIBILITY_INCOMPLETE");
    const uncoveredAllowlistTables = TABLES.filter(name => !visible.has(name));

    const [columns] = await query(connection, QUERY.columns, values, timeoutMs);
    const [indexes] = await query(connection, QUERY.indexes, values, timeoutMs);
    const [constraints] = await query(
      connection,
      QUERY.constraints,
      values,
      timeoutMs
    );
    const [checks] = await query(connection, QUERY.checks, values, timeoutMs);

    let migrationHistory = { status: "not_requested" };
    if (includeDrizzleHistory) {
      const [historyColumns] = await query(
        connection,
        `SELECT COLUMN_NAME AS columnName FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = '__drizzle_migrations'
            AND COLUMN_NAME IN ('id', 'hash', 'created_at')
          ORDER BY ORDINAL_POSITION`,
        [expectedSchema],
        timeoutMs
      );
      const available = new Set(historyColumns.map(row => row.columnName));
      if (!["id", "hash", "created_at"].every(name => available.has(name))) {
        throw fail("MIGRATION_HISTORY_LAYOUT_MISMATCH");
      }
      const [history] = await query(
        connection,
        `SELECT id, hash, created_at AS createdAt
           FROM \`${expectedSchema}\`.\`${DRIZZLE_HISTORY_TABLE}\` ORDER BY id`,
        [],
        timeoutMs
      );
      migrationHistory = { status: "attested", rows: history };
    }

    return {
      schemaVersion: 1,
      runId,
      status: "partial",
      attestedSchema: expectedSchema,
      session: {
        serverVersion: session.serverVersion,
        selectedSchema: session.selectedSchema,
        authenticatedPrincipal: session.authenticatedPrincipal,
        activeRoles: session.activeRoles,
        tlsVersion: tls.Ssl_version,
        tlsCipher: tls.Ssl_cipher,
      },
      privilegeModel: {
        grants: READ_ONLY_GRANT_POLICY,
        runnerReadsApplicationRows: false,
        rowReadCapability: includeDrizzleHistory
          ? "SELECT is granted only on the explicitly confirmed migration-history table"
          : "none",
        warning:
          "REFERENCES alone does not permit row reads or DDL; no CREATE or ALTER privilege is granted.",
      },
      schema: { tables, columns, indexes, constraints, checks },
      uncoveredAllowlistTables,
      triggers: {
        status: "not_attested",
        reason:
          "TRIGGER privilege permits trigger DDL; no read-only metadata privilege is available",
      },
      migrationHistory,
      warnings: [
        "REFERENCES grants are limited to allowlisted objects and do not permit reading their rows.",
        "Tables absent from results may be absent or not granted; confirm coverage before interpreting them.",
        "Trigger metadata requires separate DBA evidence; empty INFORMATION_SCHEMA.TRIGGERS results are not treated as proof of no triggers.",
      ],
    };
  })();

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(fail("ATTESTATION_TIMEOUT"));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function productionConnectionConfig(
  env = process.env,
  { includeDrizzleHistory = false } = {}
) {
  if (env.MYSQL_ATTESTATION_APPROVED !== "YES")
    throw fail("EXPLICIT_APPROVAL_FLAG_REQUIRED");
  if (env.MYSQL_ATTESTATION_PRIVILEGE_ACK !== "REFERENCES_METADATA_ONLY")
    throw fail("REFERENCES_PRIVILEGE_ACK_REQUIRED");
  if (
    includeDrizzleHistory &&
    env.MYSQL_ATTESTATION_HISTORY_ROW_READ_ACK !== "MIGRATION_TABLE_ONLY"
  )
    throw fail("MIGRATION_HISTORY_ROW_READ_ACK_REQUIRED");
  const host = env.MYSQL_ATTESTATION_HOST;
  const schema = env.MYSQL_ATTESTATION_DATABASE;
  if (
    !/^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*$/.test(
      host ?? ""
    ) ||
    isIP(host) !== 0
  )
    throw fail("MYSQL_ATTESTATION_HOST_INVALID");
  if (!/^[A-Za-z0-9_$-]{1,64}$/.test(schema ?? ""))
    throw fail("INVALID_EXPECTED_SCHEMA");
  const user = env.MYSQL_ATTESTATION_USER;
  const password = env.MYSQL_ATTESTATION_PASSWORD;
  if (!user || !password) throw fail("MYSQL_ATTESTATION_CREDENTIALS_REQUIRED");
  const ca = env.MYSQL_ATTESTATION_TLS_CA_PEM;
  if (!ca || typeof ca !== "string") throw fail("MYSQL_TLS_CA_MISSING");
  let certificate;
  try {
    certificate = new X509Certificate(ca);
  } catch {
    throw fail("MYSQL_TLS_CA_INVALID");
  }
  const now = Date.now();
  if (
    !certificate.ca ||
    now < Date.parse(certificate.validFrom) ||
    now > Date.parse(certificate.validTo)
  )
    throw fail("MYSQL_TLS_CA_INVALID");
  return {
    connectionOptions: createTlsConnectionConfig({
      host,
      expectedHost: host,
      user,
      password,
      database: schema,
      ca,
    }),
    expectedSchema: schema,
  };
}

export function createTlsConnectionConfig({
  host,
  expectedHost,
  user,
  password,
  database,
  ca,
}) {
  if (host !== expectedHost || !host) throw fail("MYSQL_TLS_HOST_MISMATCH");
  if (
    !/^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*$/.test(
      host
    ) ||
    isIP(host) !== 0
  )
    throw fail("MYSQL_ATTESTATION_HOST_INVALID");
  if (!user || !password) throw fail("MYSQL_ATTESTATION_CREDENTIALS_REQUIRED");
  if (!/^[A-Za-z0-9_$-]{1,64}$/.test(database ?? ""))
    throw fail("INVALID_EXPECTED_SCHEMA");
  if (typeof ca !== "string" || !ca.includes("BEGIN CERTIFICATE"))
    throw fail("MYSQL_TLS_CA_MISSING");
  return {
    host,
    port: 3306,
    user,
    password,
    connectTimeout: 5_000,
    enableKeepAlive: false,
    ssl: {
      ca,
      rejectUnauthorized: true,
      verifyIdentity: true,
      minVersion: "TLSv1.3",
    },
  };
}

export function safeFailure(error, runId) {
  const code =
    error?.code && /^[A-Z0-9_]+$/.test(error.code)
      ? error.code
      : "ATTESTATION_FAILED";
  return {
    schemaVersion: 1,
    runId: runId ?? null,
    status: "failed",
    error: code,
  };
}

async function main() {
  const runId = process.env.MYSQL_ATTESTATION_RUN_ID;
  const includeDrizzleHistory =
    process.env.MYSQL_ATTESTATION_HISTORY_MODE === "drizzle-confirmed";
  if (
    includeDrizzleHistory &&
    process.env.MYSQL_ATTESTATION_HISTORY_TABLE_CONFIRMED !==
      DRIZZLE_HISTORY_TABLE
  ) {
    process.stderr.write(
      `${JSON.stringify(safeFailure(fail("MIGRATION_HISTORY_TABLE_NOT_CONFIRMED"), runId))}\n`
    );
    process.exitCode = 1;
    return;
  }
  const timeoutMs = Number(process.env.MYSQL_ATTESTATION_TIMEOUT_MS ?? 20_000);
  try {
    const config = productionConnectionConfig(process.env, {
      includeDrizzleHistory,
    });
    const result = await runOneShot({
      createConnection: mysql.createConnection,
      connectionOptions: config.connectionOptions,
      expectedSchema: config.expectedSchema,
      runId,
      timeoutMs,
      includeDrizzleHistory,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = 0;
  } catch (error) {
    process.stderr.write(`${JSON.stringify(safeFailure(error, runId))}\n`);
    process.exitCode = 1;
  }
}

export async function runOneShot({
  createConnection,
  connectionOptions,
  expectedSchema,
  runId,
  timeoutMs,
  includeDrizzleHistory = false,
}) {
  validateRequest(expectedSchema, runId, timeoutMs);
  let connection;
  try {
    connection = await createConnection(connectionOptions);
    return await runSchemaAttestation({
      connection,
      expectedSchema,
      runId,
      timeoutMs,
      includeDrizzleHistory,
    });
  } finally {
    if (connection) {
      try {
        await connection.end();
      } catch {
        connection.destroy?.();
      }
    }
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    process.stderr.write(
      '{"schemaVersion":1,"status":"failed","error":"ATTESTATION_FAILED"}\n'
    );
    process.exitCode = 1;
  });
}
