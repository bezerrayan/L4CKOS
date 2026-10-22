import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Connection } from "mysql2/promise";
import { openBackupConnection } from "./backupRestore";
import { bootstrapReleaseDatabase } from "../../database/bootstrap/bootstrap";
import { readReleaseContract } from "../../database/schema/artifacts";
import { quote } from "../../database/schema/fingerprint";

const socketPath = process.env.L4CKOS_LOCAL_MYSQL_SOCKET ?? "/tmp/l4ckos-0022-socket/mysqld.sock";
const databaseName = `l4ckos_test_highlights_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const previousLocalSchemaFlag = process.env.L4CKOS_LOCAL_SCHEMA;
let rootConnection: Connection | undefined;
let testConnection: Connection | undefined;

describe.skipIf(process.env.L4CKOS_MYSQL_TEST !== "1")("MySQL Home highlight settings migration 0024", () => {
  beforeAll(async () => {
    process.env.L4CKOS_LOCAL_SCHEMA = "1";
    rootConnection = await openBackupConnection("mysql://root@localhost/mysql", socketPath);
    await rootConnection.query(`CREATE DATABASE ${quote(databaseName)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    testConnection = await openBackupConnection(`mysql://root@localhost/${databaseName}`, socketPath);
    const contract = await readReleaseContract();
    await bootstrapReleaseDatabase(testConnection, {
      url: `mysql://root@localhost/${databaseName}`,
      socketPath,
      applicationCommit: "a".repeat(40),
      approvedFingerprint: contract.fingerprint,
    });
  });

  afterAll(async () => {
    await testConnection?.end();
    if (rootConnection) {
      await rootConnection.query(`DROP DATABASE ${quote(databaseName)}`);
      await rootConnection.end();
    }
    if (previousLocalSchemaFlag === undefined) delete process.env.L4CKOS_LOCAL_SCHEMA;
    else process.env.L4CKOS_LOCAL_SCHEMA = previousLocalSchemaFlag;
  });

  it("bootstraps the singleton defaults and enforces the id and interval constraints", async () => {
    const [rows] = await testConnection!.query<any[]>("SELECT id,displayMode,rotationIntervalSeconds FROM homeHighlightSettings");
    expect(rows).toEqual([{ id: 1, displayMode: "single", rotationIntervalSeconds: 8 }]);
    await expect(testConnection!.query("INSERT INTO homeHighlightSettings (id,displayMode,rotationIntervalSeconds) VALUES (2,'rotate',8)")).rejects.toBeTruthy();
    await expect(testConnection!.query("UPDATE homeHighlightSettings SET rotationIntervalSeconds=7 WHERE id=1")).rejects.toBeTruthy();
    const [after] = await testConnection!.query<any[]>("SELECT id,displayMode,rotationIntervalSeconds FROM homeHighlightSettings");
    expect(after).toEqual([{ id: 1, displayMode: "single", rotationIntervalSeconds: 8 }]);
  });
});
