import { execFile } from "node:child_process";
import { promisify } from "node:util";
import mysql from "mysql2/promise";

const execFileAsync = promisify(execFile);
const databaseUrl = String(process.env.DATABASE_URL || "");
if (!databaseUrl) throw new Error("DATABASE_URL is required");

function normalizeDefault(value) {
  if (value === null || value === undefined) return null;
  let normalized = String(value).trim();
  while (normalized.startsWith("(") && normalized.endsWith(")")) normalized = normalized.slice(1, -1).trim();
  if ((normalized.startsWith("'") && normalized.endsWith("'")) || (normalized.startsWith('"') && normalized.endsWith('"'))) normalized = normalized.slice(1, -1);
  if (/^(now\(\)|current_timestamp(?:\(\))?)$/i.test(normalized)) return "current_timestamp";
  return normalized;
}

function columnsFromList(raw) {
  return [...raw.matchAll(/`([^`]+)`/g)].map(match => match[1]);
}

function normalizeCheck(value) {
  return String(value || "").toLowerCase().replace(/`/g, "").replace(/\b[a-z0-9_]+\./g, "").replace(/[()\s]/g, "");
}

const { stdout } = await execFileAsync(
  process.execPath,
  ["node_modules/drizzle-kit/bin.cjs", "export", "--dialect", "mysql", "--schema", "./drizzle/schema.ts"],
  { maxBuffer: 10 * 1024 * 1024 },
);

const expected = { tables: new Map(), indexes: new Map(), foreignKeys: new Map(), checks: new Map() };
for (const match of stdout.matchAll(/CREATE TABLE `([^`]+)` \(([\s\S]*?)\n\);/g)) {
  const table = match[1];
  const columns = new Map();
  for (const rawLine of match[2].split(/\r?\n/)) {
    const line = rawLine.trim().replace(/,$/, "");
    const column = line.match(/^`([^`]+)`\s+(.+)$/);
    if (column) {
      const definition = column[2];
      columns.set(column[1], {
        nullable: !/\bNOT NULL\b/i.test(definition),
        type: definition.match(/^([^\s]+(?:\([^)]*\))?)/)?.[1]?.toLowerCase() || "unknown",
        default: normalizeDefault(definition.match(/\bDEFAULT\s+(.+?)(?=\s+ON UPDATE|$)/i)?.[1]),
      });
      continue;
    }
    const primary = line.match(/^CONSTRAINT `([^`]+)` PRIMARY KEY\((.+)\)$/i);
    const unique = line.match(/^CONSTRAINT `([^`]+)` UNIQUE\((.+)\)$/i);
    const check = line.match(/^CONSTRAINT `([^`]+)` CHECK\((.+)\)$/i);
    if (primary || unique) {
      const key = primary || unique;
      const name = primary ? "PRIMARY" : key[1];
      expected.indexes.set(`${table}.${name}`, { table, name, unique: true, primary: Boolean(primary), columns: columnsFromList(key[2]) });
    } else if (check) {
      expected.checks.set(`${table}.${check[1]}`, { table, name: check[1], clause: check[2] });
    }
  }
  expected.tables.set(table, columns);
}

for (const match of stdout.matchAll(/CREATE INDEX `([^`]+)` ON `([^`]+)` \(([^)]+)\);/g)) {
  expected.indexes.set(`${match[2]}.${match[1]}`, { table: match[2], name: match[1], unique: false, primary: false, columns: columnsFromList(match[3]) });
}
for (const match of stdout.matchAll(/ALTER TABLE `([^`]+)` ADD CONSTRAINT `([^`]+)` FOREIGN KEY \(([^)]+)\) REFERENCES `([^`]+)`\(([^)]+)\) ON DELETE ([a-z ]+) ON UPDATE ([a-z ]+);/gi)) {
  expected.foreignKeys.set(`${match[1]}.${match[2]}`, {
    table: match[1], name: match[2], columns: columnsFromList(match[3]), referencedTable: match[4],
    referencedColumns: columnsFromList(match[5]), deleteRule: match[6].trim().toUpperCase(), updateRule: match[7].trim().toUpperCase(),
  });
}

const connection = await mysql.createConnection(databaseUrl);
const [[databaseRow]] = await connection.query("SELECT DATABASE() AS databaseName");
const databaseName = databaseRow.databaseName;
const [columnRows] = await connection.query(
  `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, COLUMN_TYPE AS columnType,
          IS_NULLABLE AS isNullable, COLUMN_DEFAULT AS columnDefault
     FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION`, [databaseName]);
const [indexRows] = await connection.query(
  `SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique,
          COLUMN_NAME AS columnName, SEQ_IN_INDEX AS sequence
     FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`, [databaseName]);
const [foreignKeyRows] = await connection.query(
  `SELECT rc.TABLE_NAME AS tableName, rc.CONSTRAINT_NAME AS constraintName,
          rc.REFERENCED_TABLE_NAME AS referencedTable, rc.DELETE_RULE AS deleteRule, rc.UPDATE_RULE AS updateRule,
          kcu.COLUMN_NAME AS columnName, kcu.REFERENCED_COLUMN_NAME AS referencedColumnName,
          kcu.ORDINAL_POSITION AS sequence
     FROM information_schema.REFERENTIAL_CONSTRAINTS rc
     JOIN information_schema.KEY_COLUMN_USAGE kcu
       ON kcu.CONSTRAINT_SCHEMA=rc.CONSTRAINT_SCHEMA AND kcu.TABLE_NAME=rc.TABLE_NAME
      AND kcu.CONSTRAINT_NAME=rc.CONSTRAINT_NAME
    WHERE rc.CONSTRAINT_SCHEMA=? ORDER BY rc.TABLE_NAME,rc.CONSTRAINT_NAME,kcu.ORDINAL_POSITION`, [databaseName]);
const [checkRows] = await connection.query(
  `SELECT tc.TABLE_NAME AS tableName, tc.CONSTRAINT_NAME AS constraintName, cc.CHECK_CLAUSE AS checkClause
     FROM information_schema.TABLE_CONSTRAINTS tc
     JOIN information_schema.CHECK_CONSTRAINTS cc
       ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME
    WHERE tc.TABLE_SCHEMA=? AND tc.CONSTRAINT_TYPE='CHECK' ORDER BY tc.TABLE_NAME,tc.CONSTRAINT_NAME`, [databaseName]);
await connection.end();

const actual = { tables: new Map(), indexes: new Map(), foreignKeys: new Map(), checks: new Map() };
for (const row of columnRows) {
  if (!actual.tables.has(row.tableName)) actual.tables.set(row.tableName, new Map());
  actual.tables.get(row.tableName).set(row.columnName, { nullable: row.isNullable === "YES", type: String(row.columnType).toLowerCase(), default: normalizeDefault(row.columnDefault) });
}
for (const row of indexRows) {
  const key = `${row.tableName}.${row.indexName}`;
  if (!actual.indexes.has(key)) actual.indexes.set(key, { table: row.tableName, name: row.indexName, unique: Number(row.nonUnique) === 0, primary: row.indexName === "PRIMARY", columns: [] });
  actual.indexes.get(key).columns.push(row.columnName);
}
for (const row of foreignKeyRows) {
  const key = `${row.tableName}.${row.constraintName}`;
  if (!actual.foreignKeys.has(key)) actual.foreignKeys.set(key, { table: row.tableName, name: row.constraintName, columns: [], referencedTable: row.referencedTable, referencedColumns: [], deleteRule: row.deleteRule, updateRule: row.updateRule });
  actual.foreignKeys.get(key).columns.push(row.columnName);
  actual.foreignKeys.get(key).referencedColumns.push(row.referencedColumnName);
}
for (const row of checkRows) actual.checks.set(`${row.tableName}.${row.constraintName}`, { table: row.tableName, name: row.constraintName, clause: row.checkClause });

const missingTables = [...expected.tables.keys()].filter(table => !actual.tables.has(table));
const extraTables = [...actual.tables.keys()].filter(table => !expected.tables.has(table));
const missingColumns = [];
const extraColumns = [];
const incompatibleColumns = [];
for (const [table, columns] of expected.tables) {
  const actualColumns = actual.tables.get(table);
  if (!actualColumns) continue;
  for (const [column, definition] of columns) {
    const found = actualColumns.get(column);
    if (!found) missingColumns.push({ table, column });
    else if (found.type !== definition.type || found.nullable !== definition.nullable || found.default !== definition.default) incompatibleColumns.push({ table, column, expected: definition, actual: found });
  }
  for (const column of actualColumns.keys()) if (!columns.has(column)) extraColumns.push({ table, column });
}

function compareNamed(expectedMap, actualMap, comparator) {
  const missing = [];
  const incompatible = [];
  for (const [key, definition] of expectedMap) {
    const found = actualMap.get(key);
    if (!found) missing.push(definition);
    else if (!comparator(definition, found)) incompatible.push({ expected: definition, actual: found });
  }
  const extra = [...actualMap].filter(([key]) => !expectedMap.has(key)).map(([, value]) => value);
  return { missing, incompatible, extra };
}

function compareIndexes(expectedMap, actualMap) {
  const missing = [];
  const incompatible = [];
  const aliases = [];
  const consumed = new Set();
  const sameShape = (a, b) => a.table === b.table && a.unique === b.unique && a.primary === b.primary && JSON.stringify(a.columns) === JSON.stringify(b.columns);
  for (const [key, definition] of expectedMap) {
    const exact = actualMap.get(key);
    if (exact) {
      consumed.add(key);
      if (!sameShape(definition, exact)) incompatible.push({ expected: definition, actual: exact });
      continue;
    }
    const alias = [...actualMap].find(([actualKey, value]) => !consumed.has(actualKey) && sameShape(definition, value));
    if (alias) {
      consumed.add(alias[0]);
      aliases.push({ table: definition.table, expectedName: definition.name, actualName: alias[1].name, columns: definition.columns });
    } else missing.push(definition);
  }
  const extra = [...actualMap].filter(([key]) => !consumed.has(key)).map(([, value]) => value);
  return { missing, incompatible, aliases, extra };
}

const indexes = compareIndexes(expected.indexes, actual.indexes);
const foreignKeys = compareNamed(expected.foreignKeys, actual.foreignKeys, (a, b) => a.referencedTable === b.referencedTable && a.deleteRule === b.deleteRule && a.updateRule === b.updateRule && JSON.stringify(a.columns) === JSON.stringify(b.columns) && JSON.stringify(a.referencedColumns) === JSON.stringify(b.referencedColumns));
const checks = compareNamed(expected.checks, actual.checks, (a, b) => normalizeCheck(a.clause) === normalizeCheck(b.clause));

const blockers = missingTables.length + missingColumns.length + incompatibleColumns.length + indexes.missing.length + indexes.incompatible.length + foreignKeys.missing.length + foreignKeys.incompatible.length + checks.missing.length + checks.incompatible.length;
const result = {
  ok: blockers === 0, database: databaseName,
  summary: { blockers, expectedTables: expected.tables.size, actualTables: actual.tables.size, expectedIndexes: expected.indexes.size, expectedForeignKeys: expected.foreignKeys.size, expectedChecks: expected.checks.size },
  tables: { missing: missingTables, extra: extraTables },
  columns: { missing: missingColumns, incompatible: incompatibleColumns, extra: extraColumns },
  indexes, foreignKeys, checks,
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
