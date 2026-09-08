import "dotenv/config";
import mysql from "mysql2/promise";
import { assertStagingSeedTarget, readClientFixtureInput, upsertStagingClientFixture } from "./stagingSeedCommon.mjs";

const { databaseUrl, databaseName } = assertStagingSeedTarget();
const clientFixture = readClientFixtureInput();
const connection = await mysql.createConnection(databaseUrl);

try {
  await connection.beginTransaction();
  await upsertStagingClientFixture(connection, clientFixture);
  await connection.commit();
  console.log(JSON.stringify({ ok: true, database: databaseName, fixture: "staging-client", role: "user", address: 1 }));
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  await connection.end();
}
