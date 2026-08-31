import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";

const databaseName = String(process.argv[2] || "");
const adminUrl = String(process.env.MYSQL_ADMIN_URL || "");
const maximumMigration = Number(process.env.MAX_MIGRATION || 15);

if (!/^l4ckos_homologation_[a-z0-9_]+$/.test(databaseName)) {
  throw new Error("Target database must use the l4ckos_homologation_ prefix");
}
if (!adminUrl) throw new Error("MYSQL_ADMIN_URL is required");

const connection = await mysql.createConnection(adminUrl);
const existing = await connection.query(
  "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?",
  [databaseName],
);
if (existing[0].length > 0) throw new Error("Target database already exists; refusing to overwrite it");

await connection.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
await connection.query(`USE \`${databaseName}\``);

const migrationDirectory = path.resolve("drizzle");
const migrationFiles = (await readdir(migrationDirectory))
  .filter(file => /^\d{4}_.+\.sql$/.test(file))
  .filter(file => Number(file.slice(0, 4)) <= maximumMigration)
  .sort();
const results = [];

for (const file of migrationFiles) {
  const raw = await readFile(path.join(migrationDirectory, file), "utf8");
  const statements = raw
    .replace(/-->\s*statement-breakpoint/g, "")
    .split(/;\s*(?:\r?\n|$)/)
    .map(statement => statement.trim())
    .filter(Boolean);

  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index];
    const startedAt = process.hrtime.bigint();
    await connection.query(statement);
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const [warnings] = await connection.query("SHOW WARNINGS");
    results.push({
      migration: file,
      statement: index + 1,
      operation: statement.match(/^(CREATE TABLE|ALTER TABLE|CREATE INDEX|UPDATE|INSERT|DELETE|DROP TABLE)/i)?.[1]?.toUpperCase() || "OTHER",
      elapsedMs: Number(elapsedMs.toFixed(3)),
      warningCount: warnings.length,
    });
  }
}

const [tables] = await connection.query(
  `SELECT TABLE_NAME AS tableName, ENGINE AS engine, TABLE_ROWS AS estimatedRows,
          DATA_LENGTH AS dataBytes, INDEX_LENGTH AS indexBytes
     FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`,
  [databaseName],
);
const [constraints] = await connection.query(
  `SELECT CONSTRAINT_TYPE AS constraintType, COUNT(*) AS total
     FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = ? GROUP BY CONSTRAINT_TYPE`,
  [databaseName],
);

console.log(JSON.stringify({ database: databaseName, migrations: migrationFiles, statements: results, tables, constraints }, null, 2));
await connection.end();
