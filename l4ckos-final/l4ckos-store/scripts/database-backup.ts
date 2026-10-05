// No dotenv: the operator supplies an explicitly local configuration.
import { readFile, writeFile } from "node:fs/promises";
import { assertLocalRestoreTarget, backupDatabase, restoreDatabase, openBackupConnection, BackupError } from "../server/database/backupRestore";

async function main() {
  const [operation, file] = process.argv.slice(2);
  if (!["backup", "restore"].includes(operation) || !file) throw new BackupError("USAGE_DATABASE_BACKUP_BACKUP_OR_RESTORE_FILE");
  const url = process.env.DATABASE_URL || "";
  const socketPath = process.env.L4CKOS_LOCAL_MYSQL_SOCKET;
  // CLI intentionally local-only for both operations; no implicit .env loading.
  assertLocalRestoreTarget(url, socketPath);
  const connection = await openBackupConnection(url, socketPath);
  try {
    if (operation === "backup") {
      const artifact = await backupDatabase(connection);
      await writeFile(file, JSON.stringify(artifact), { mode: 0o600, flag: "wx" });
      console.log(`Backup verified: ${Object.keys(artifact.tables).length} tables`);
    } else {
      const result = await restoreDatabase(connection, JSON.parse(await readFile(file, "utf8")), { url, socketPath });
      console.log(`Restore verified: ${result.tables} tables, ${result.rows} rows`);
    }
  } finally { await connection.end(); }
}
main().catch(error => {
  console.error(error instanceof BackupError ? error.code : "LOCAL_BACKUP_OPERATION_FAILED");
  process.exitCode = 1;
});
