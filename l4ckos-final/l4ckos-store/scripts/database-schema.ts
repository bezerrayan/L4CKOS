// Deliberately no dotenv, URL discovery, remote override or --force.
import { execFileSync } from "node:child_process";
import { openBackupConnection } from "../server/database/backupRestore";
import { assertLocalSchemaTarget, verifyLocalConnection, SchemaError } from "../database/schema/safety";
import { readStructuralSchema, structuralHash } from "../database/schema/fingerprint";
import { baselineDatabase } from "../database/schema/baseline";
import { bootstrapCurrentDatabase } from "../database/bootstrap/bootstrap";
import { migrateDatabase } from "../database/migrations/runner";
async function main() {
  const [operation, acceptanceFlag, approvedFingerprint, ...extra] = process.argv.slice(2);
  if (!["fingerprint", "baseline", "bootstrap", "migrate"].includes(operation) || extra.length ||
      (operation === "fingerprint" ? acceptanceFlag !== undefined : acceptanceFlag !== "--accept-fingerprint" || !/^[a-f0-9]{64}$/.test(approvedFingerprint || ""))) throw new SchemaError("INVALID_SCHEMA_COMMAND_ARGUMENTS");
  const target = { url: process.env.DATABASE_URL || "", socketPath: process.env.L4CKOS_LOCAL_MYSQL_SOCKET };
  assertLocalSchemaTarget(target); // Fail before any connection.
  const applicationCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const connection = await openBackupConnection(target.url, target.socketPath);
  try {
    const context = { ...target, applicationCommit, approvedFingerprint };
    if (operation === "fingerprint") {
      await verifyLocalConnection(connection, target);
      console.log(JSON.stringify({ fingerprint: structuralHash(await readStructuralSchema(connection)) }));
    } else {
      const result = operation === "bootstrap" ? await bootstrapCurrentDatabase(connection, context) : operation === "baseline" ? await baselineDatabase(connection, context) : await migrateDatabase(connection, context);
      console.log(JSON.stringify(result));
    }
  } finally { await connection.end(); }
}
main().catch(error => { console.error(error instanceof SchemaError ? JSON.stringify({ code: error.code, evidence: error.evidence }) : "SCHEMA_OPERATION_FAILED"); process.exitCode = 1; });
