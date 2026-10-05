import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";
import { REQUIRED_TABLES, OPTIONAL_TABLES, TABLE_ORDER, TABLE_MANIFEST_VERSION, classifyTable } from "./tableManifest";

type Cell = string | number | null | { binaryHex: string };
type Row = Record<string, Cell>;
export type TableBackup = { schema: string; schemaChecksum: string; rowCount: number; checksum: string; rows: Row[] };
export type BackupArtifact = {
  formatVersion: 1;
  createdAt: string;
  applicationCommit: string | null;
  databaseEngine: "MySQL";
  databaseVersion: string;
  tableManifestVersion: number;
  schemaFingerprint: string;
  absentOptionalTables: string[];
  tables: Record<string, TableBackup>;
  artifactChecksum: string;
};

/** Errors deliberately never include SQL, values, connection options or provider metadata. */
export class BackupError extends Error {
  constructor(public readonly code: string) { super(code); }
}
function fail(code: string): never { throw new BackupError(code); }
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
export const checksum = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
export const rowsChecksum = (rows: Row[]) => checksum(rows.map(canonical).sort());
const identifier = (name: string) => `\`${name.replace(/`/g, "``")}\``;
const normalizeSchema = (ddl: string) => ddl.replace(/ AUTO_INCREMENT=\d+/g, "");
function encode(value: unknown): Cell {
  if (Buffer.isBuffer(value)) return { binaryHex: value.toString("hex") };
  if (value === null || typeof value === "string" || (typeof value === "number" && Number.isSafeInteger(value))) return value;
  // dateStrings/jsonStrings and decimal strings prevent precision loss and JS Date truncation.
  return fail("UNSUPPORTED_PHYSICAL_VALUE");
}
function decode(value: Cell) {
  return typeof value === "object" && value !== null ? Buffer.from(value.binaryHex, "hex") : value;
}
export async function openBackupConnection(url: string, socketPath?: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "mysql:") fail("INVALID_DATABASE_CONFIGURATION");
    return await mysql.createConnection({
      uri: url,
      socketPath, dateStrings: true, timezone: "Z", supportBigNumbers: true, bigNumberStrings: true,
      decimalNumbers: false, jsonStrings: true, multipleStatements: false,
    });
  } catch { return fail("DATABASE_CONNECTION_FAILED"); }
}
export function assertLocalRestoreTarget(url: string, socketPath?: string) {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return fail("LOCAL_RESTORE_REQUIRED"); }
  if (process.env.NODE_ENV === "production" || process.env.L4CKOS_LOCAL_RESTORE !== "1" ||
      parsed.protocol !== "mysql:" || parsed.search !== "" || parsed.hash !== "" || !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) ||
      !/^l4ckos_(local|test)_[a-z0-9_]+$/.test(parsed.pathname.slice(1)) ||
      (socketPath && !/^\/tmp\/l4ckos-[a-z0-9-]+\/mysqld\.sock$/.test(socketPath))) fail("LOCAL_RESTORE_REQUIRED");
}
async function queryRows(connection: Connection, sql: string, values: unknown[] = []) {
  const [rows] = await connection.query<RowDataPacket[]>(sql, values);
  return rows;
}
async function inventory(connection: Connection) {
  const objects = await queryRows(connection, "SELECT TABLE_NAME AS name, TABLE_TYPE AS type, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME");
  const names = objects.map(row => String(row.name));
  if (names.some(name => classifyTable(name) === "UNKNOWN")) fail("UNKNOWN_TABLE");
  if (REQUIRED_TABLES.some(name => !names.includes(name))) fail("MISSING_REQUIRED_TABLE");
  if (objects.some(row => row.type !== "BASE TABLE" || row.engine !== "InnoDB")) fail("NON_TRANSACTIONAL_OBJECT");
  const schema: Record<string, string> = {};
  for (const name of TABLE_ORDER.filter(name => names.includes(name))) {
    const row = (await queryRows(connection, `SHOW CREATE TABLE ${identifier(name)}`))[0];
    schema[name] = normalizeSchema(String(row["Create Table"]));
  }
  // Triggers could mutate restored rows. Routines/events are outside this data-only format.
  for (const [view, field] of [["TRIGGERS", "TRIGGER_SCHEMA"], ["ROUTINES", "ROUTINE_SCHEMA"], ["EVENTS", "EVENT_SCHEMA"]]) {
    const rows = await queryRows(connection, `SELECT COUNT(*) AS n FROM information_schema.${view} WHERE ${field}=DATABASE()`);
    if (Number(rows[0].n)) fail("UNSUPPORTED_SCHEMA_OBJECT");
  }
  const fks = await queryRows(connection, "SELECT TABLE_NAME AS child, REFERENCED_TABLE_NAME AS parent, REFERENCED_TABLE_SCHEMA AS parentSchema FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL");
  const database = String((await queryRows(connection, "SELECT DATABASE() AS name"))[0].name);
  for (const fk of fks) {
    if (fk.parentSchema !== database || TABLE_ORDER.indexOf(fk.parent) >= TABLE_ORDER.indexOf(fk.child)) fail("UNSUPPORTED_FK_ORDER");
  }
  return schema;
}
async function readTable(connection: Connection, name: string): Promise<Row[]> {
  const rows = await queryRows(connection, `SELECT * FROM ${identifier(name)}`);
  return rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, encode(value)])));
}
function currentCommit() {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return /^[a-f0-9]{40}$/.test(process.env.APPLICATION_COMMIT || "") ? process.env.APPLICATION_COMMIT! : null; }
}
export async function backupDatabase(connection: Connection): Promise<BackupArtifact> {
  let transaction = false;
  try {
    await connection.query("SET time_zone = '+00:00'");
    const schema = await inventory(connection);
    const version = String((await queryRows(connection, "SELECT VERSION() AS version"))[0].version);
    if (!/^8\.4\./.test(version)) fail("MYSQL_84_REQUIRED");
    await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await connection.query("START TRANSACTION WITH CONSISTENT SNAPSHOT");
    transaction = true;
    const tables: Record<string, TableBackup> = {};
    for (const name of Object.keys(schema)) {
      const rows = await readTable(connection, name);
      tables[name] = { schema: schema[name], schemaChecksum: checksum(schema[name]), rowCount: rows.length, checksum: rowsChecksum(rows), rows };
    }
    if (checksum(await inventory(connection)) !== checksum(schema)) fail("SCHEMA_CHANGED_DURING_BACKUP");
    await connection.commit();
    transaction = false;
    const artifact = {
      formatVersion: 1 as const, createdAt: new Date().toISOString(), applicationCommit: currentCommit(),
      databaseEngine: "MySQL" as const, databaseVersion: version, tableManifestVersion: TABLE_MANIFEST_VERSION,
      schemaFingerprint: checksum(schema), absentOptionalTables: OPTIONAL_TABLES.filter(name => !schema[name]), tables,
    };
    return { ...artifact, artifactChecksum: checksum(artifact) };
  } catch (error) {
    if (transaction) await connection.rollback();
    if (error instanceof BackupError) throw error;
    return fail("BACKUP_FAILED");
  }
}
export function validateArtifact(input: unknown): asserts input is BackupArtifact {
  if (!input || typeof input !== "object") fail("INVALID_BACKUP_FORMAT");
  const artifact = input as BackupArtifact;
  if (artifact.formatVersion !== 1 || artifact.tableManifestVersion !== TABLE_MANIFEST_VERSION || artifact.databaseEngine !== "MySQL" ||
      !/^8\.4\./.test(artifact.databaseVersion) || typeof artifact.createdAt !== "string" || !Number.isFinite(Date.parse(artifact.createdAt)) ||
      (artifact.applicationCommit !== null && !/^[a-f0-9]{40}$/.test(artifact.applicationCommit)) ||
      !artifact.tables || !Array.isArray(artifact.absentOptionalTables)) fail("INVALID_BACKUP_FORMAT");
  const names = Object.keys(artifact.tables);
  if (names.some(name => classifyTable(name) === "UNKNOWN")) fail("UNKNOWN_TABLE");
  if (REQUIRED_TABLES.some(name => !names.includes(name))) fail("MISSING_REQUIRED_TABLE");
  if (canonical(artifact.absentOptionalTables) !== canonical(OPTIONAL_TABLES.filter(name => !names.includes(name)))) fail("OPTIONAL_MANIFEST_MISMATCH");
  const schema: Record<string, string> = {};
  for (const [name, table] of Object.entries(artifact.tables)) {
    if (!Array.isArray(table.rows) || table.rowCount !== table.rows.length || typeof table.schema !== "string" ||
        table.schemaChecksum !== checksum(table.schema) || table.checksum !== rowsChecksum(table.rows)) fail("CHECKSUM_MISMATCH");
    for (const row of table.rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) fail("INVALID_ROW");
      for (const value of Object.values(row)) {
        if (value === null || typeof value === "string" || (typeof value === "number" && Number.isSafeInteger(value))) continue;
        if (typeof value === "object" && value && Object.keys(value).length === 1 &&
            "binaryHex" in value && typeof value.binaryHex === "string" && /^(?:[0-9a-f]{2})*$/.test(value.binaryHex)) continue;
        fail("INVALID_CELL");
      }
    }
    schema[name] = table.schema;
  }
  if (artifact.schemaFingerprint !== checksum(schema)) fail("SCHEMA_CHECKSUM_MISMATCH");
  const { artifactChecksum, ...body } = artifact;
  if (artifactChecksum !== checksum(body)) fail("ARTIFACT_CHECKSUM_MISMATCH");
}
async function validateReferences(connection: Connection) {
  const fks = await queryRows(connection, "SELECT TABLE_NAME AS child, COLUMN_NAME AS childColumn, REFERENCED_TABLE_NAME AS parent, REFERENCED_COLUMN_NAME AS parentColumn, CONSTRAINT_NAME AS fk, ORDINAL_POSITION AS position FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION");
  const groups = new Map<string, RowDataPacket[]>();
  for (const fk of fks) {
    const key = `${fk.child}.${fk.fk}`;
    groups.set(key, [...(groups.get(key) || []), fk]);
  }
  for (const parts of groups.values()) {
    const { child, parent } = parts[0];
    const join = parts.map(p => `c.${identifier(p.childColumn)} = p.${identifier(p.parentColumn)}`).join(" AND ");
    const nonnull = parts.map(p => `c.${identifier(p.childColumn)} IS NOT NULL`).join(" AND ");
    const rows = await queryRows(connection, `SELECT COUNT(*) AS n FROM ${identifier(child)} c LEFT JOIN ${identifier(parent)} p ON ${join} WHERE ${nonnull} AND p.${identifier(parts[0].parentColumn)} IS NULL`);
    if (Number(rows[0].n)) fail("ORPHAN_REFERENCE");
  }
  // The email outbox intentionally has no physical FK; preserve its logical ownership.
  for (const child of ["orderEmailEvents", "paymentEvents", "auditLogs"]) {
    const rows = await queryRows(connection, `SELECT COUNT(*) AS n FROM ${identifier(child)} c LEFT JOIN orders p ON c.orderId=p.id WHERE c.orderId IS NOT NULL AND p.id IS NULL`);
    if (Number(rows[0].n)) fail("ORPHAN_ORDER_REFERENCE");
  }
}

/** Data only: callers must supply an offline, empty, compatible local schema.
 * This function never executes artifact.schema or disables foreign key checks.
 */
export async function restoreDatabase(connection: Connection, input: unknown, target: { url: string; socketPath?: string }) {
  assertLocalRestoreTarget(target.url, target.socketPath);
  validateArtifact(input);
  let transaction = false;
  let locked = false;
  try {
    // Prevent forged target descriptors when calling the library directly.
    const options = connection.config;
    const expected = new URL(target.url);
    if (options.database !== expected.pathname.slice(1) || options.host !== expected.hostname ||
        (options.socketPath || undefined) !== target.socketPath || Number(options.port) !== Number(expected.port || 3306)) fail("TARGET_CONNECTION_MISMATCH");
    await connection.query("SET time_zone = '+00:00'");
    const version = String((await queryRows(connection, "SELECT VERSION() AS version"))[0].version);
    if (!/^8\.4\./.test(version)) fail("MYSQL_84_REQUIRED");
    const lock = await queryRows(connection, "SELECT GET_LOCK(CONCAT('l4ckos_restore_', DATABASE()), 0) AS acquired");
    if (Number(lock[0].acquired) !== 1) fail("RESTORE_ALREADY_RUNNING");
    locked = true;
    const schema = await inventory(connection);
    if (checksum(schema) !== input.schemaFingerprint) fail("INCOMPATIBLE_SCHEMA");
    const foreignKeys = await queryRows(connection, "SELECT @@SESSION.foreign_key_checks AS enabled");
    if (Number(foreignKeys[0].enabled) !== 1) fail("FK_CHECKS_REQUIRED");
    await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await connection.beginTransaction();
    transaction = true;
    // Lock empty ranges as well as checking counts: target must be offline.
    for (const name of Object.keys(schema)) {
      if ((await queryRows(connection, `SELECT * FROM ${identifier(name)} FOR UPDATE`)).length) fail("TARGET_NOT_EMPTY");
    }
    for (const name of TABLE_ORDER.filter(name => schema[name])) {
      const columns = (await queryRows(connection, `SHOW FULL COLUMNS FROM ${identifier(name)}`));
      const columnNames = columns.map(c => String(c.Field));
      for (const row of input.tables[name].rows) {
        if (canonical(Object.keys(row).sort()) !== canonical([...columnNames].sort())) fail("ROW_COLUMNS_MISMATCH");
        const writable = columns.filter(c => !/GENERATED/.test(String(c.Extra)) || /DEFAULT_GENERATED/.test(String(c.Extra))).map(c => String(c.Field));
        await connection.query(`INSERT INTO ${identifier(name)} (${writable.map(identifier).join(",")}) VALUES (${writable.map(() => "?").join(",")})`, writable.map(c => decode(row[c])));
      }
    }
    await validateReferences(connection);
    for (const name of Object.keys(schema)) {
      const rows = await readTable(connection, name);
      if (rows.length !== input.tables[name].rowCount || rowsChecksum(rows) !== input.tables[name].checksum) fail("RESTORE_VERIFICATION_FAILED");
    }
    await connection.commit();
    transaction = false;
    return { tables: Object.keys(schema).length, rows: Object.values(input.tables).reduce((sum, table) => sum + table.rowCount, 0) };
  } catch (error) {
    if (transaction) await connection.rollback();
    if (error instanceof BackupError) throw error;
    return fail("RESTORE_FAILED_ROLLED_BACK");
  } finally {
    if (locked) await connection.query("SELECT RELEASE_LOCK(CONCAT('l4ckos_restore_', DATABASE()))");
  }
}
