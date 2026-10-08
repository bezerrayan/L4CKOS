import { describe, expect, it } from "vitest";
import { assert0021SqlScope } from "../../database/staging0021/sqlScope";
import { MIGRATION, PRE, POST, type Plan } from "../../database/staging0021/policy";

const plan = {
  applicationCommit: "a".repeat(40),
  migration: MIGRATION,
} as Plan;

const ddl = new Set(["CREATE TABLE reviewed_fixture (id INT)"]);
const check = (sql: unknown, params?: unknown) =>
  assert0021SqlScope(sql, params, plan, ddl);

describe("0021 SQL write scope", () => {
  it("accepts only the exact reviewed DDL", () => {
    expect(() => check("CREATE TABLE reviewed_fixture (id INT)")).not.toThrow();
    expect(() => check("CREATE TABLE unreviewed (id INT)")).toThrow();
    expect(() => check("DROP TABLE orders")).toThrow();
  });

  it("accepts read-only schema and backup queries", () => {
    expect(() => check("SELECT * FROM information_schema.tables")).not.toThrow();
    expect(() => check("SELECT COUNT(*) FROM orders")).not.toThrow();
    expect(() => check("SHOW TABLES")).not.toThrow();
  });

  it("rejects write and control bypass attempts", () => {
    for (const sql of [
      "UPDATE users SET role='admin'",
      "DELETE FROM orders",
      "REPLACE INTO products VALUES (1)",
      "INSERT INTO _l4ckos_schema_migrations VALUES (1)",
      "UPDATE _l4ckos_schema_executions SET state='COMPLETED'",
      "WITH x AS (SELECT 1) DELETE FROM orders",
      "SELECT 1; DELETE FROM orders",
      "SELECT 1 INTO OUTFILE '/tmp/example'",
      "SELECT GET_LOCK('unauthorized', 0)",
      "SELECT LOAD_FILE('/etc/passwd')",
      "SET foreign_key_checks=0",
      "/* comment */ SELECT 1",
      "SELECT 1 -- comment",
    ]) {
      expect(() => check(sql)).toThrow("STAGING_WRITE_SCOPE_VIOLATION");
    }
  });

  it("validates ledger fields and rejects BASELINE insertion", () => {
    const sql = "INSERT INTO _l4ckos_schema_migrations (name,kind,checksum,applicationCommit,description,preFingerprint,postFingerprint,manifestVersion,runnerVersion,executionDurationMs) VALUES (?,?,?,?,?,?,?,?,?,?)";
    const values = [
      MIGRATION.name, "MIGRATION", MIGRATION.checksum,
      plan.applicationCommit, "0021", PRE, POST, 2, "2.0.0", 1,
    ];
    expect(() => check(sql, values)).not.toThrow();
    expect(() => check(sql, values.map((v, i) => i === 1 ? "BASELINE" : v))).toThrow();
    expect(() => check(sql, values.map((v, i) => i === 3 ? "b".repeat(40) : v))).toThrow();
  });

  it("validates execution checkpoint updates", () => {
    const sql = "UPDATE _l4ckos_schema_executions SET completedStatements=? WHERE id=? AND state='STARTED'";
    expect(() => check(sql, [1, 10])).not.toThrow();
    expect(() => check(sql, [5, 10])).toThrow();
    expect(() => check(sql, [1, -1])).toThrow();
  });

  it("accepts only the shared schema lock shape", () => {
    const lock = "l4ckos_schema_v2_" + "a".repeat(32);
    expect(() => check("SELECT GET_LOCK(?, ?) acquired", [lock, 1])).not.toThrow();
    expect(() => check("SELECT RELEASE_LOCK(?) released", [lock])).not.toThrow();
    expect(() => check("SELECT GET_LOCK(?, ?) acquired", ["other", 1])).toThrow();
  });
});

describe("0021 backup SQL phase guard", () => {
  const backupSql = [
    "SET time_zone = '+00:00'",
    "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ",
    "START TRANSACTION WITH CONSISTENT SNAPSHOT",
  ];

  it("permits exact backup statements only during backup", () => {
    for (const sql of backupSql) {
      expect(() => check(sql)).toThrow(
        "STAGING_WRITE_SCOPE_VIOLATION"
      );
      expect(() =>
        assert0021SqlScope(sql, undefined, plan, ddl, true)
      ).not.toThrow();
      expect(() =>
        assert0021SqlScope(sql, ["unexpected"], plan, ddl, true)
      ).toThrow("STAGING_WRITE_SCOPE_VIOLATION");
    }
  });

  it("rejects other session and transaction commands", () => {
    for (const sql of [
      "SET GLOBAL foreign_key_checks=0",
      "SET foreign_key_checks=0",
      "SET time_zone = '+01:00'",
      "START TRANSACTION",
      "COMMIT",
      "ROLLBACK",
    ]) {
      expect(() =>
        assert0021SqlScope(sql, undefined, plan, ddl, true)
      ).toThrow("STAGING_WRITE_SCOPE_VIOLATION");
    }
  });
});
