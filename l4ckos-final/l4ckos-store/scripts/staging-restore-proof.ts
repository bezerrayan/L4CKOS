import { openBackupConnection, assertLocalRestoreTarget } from "../server/database/backupRestore";
import { quote } from "../database/schema/fingerprint";
import { restoreProof } from "../database/staging/proof";
import { restoreDiagnostic } from "../database/staging/restoreDiagnostics";
async function main() {
  const [url, socketPath, ...extra] = process.argv.slice(2);
  if (extra.length) throw Error();
  assertLocalRestoreTarget(url, socketPath);
  const name = new URL(url).pathname.slice(1);
  const root = await openBackupConnection("mysql://root@localhost/mysql", socketPath);
  try { await root.query(`CREATE DATABASE ${quote(name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); }
  finally { await root.end(); }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const c = await openBackupConnection(url, socketPath);
  try { console.log(JSON.stringify(await restoreProof(c, { url, socketPath }, Buffer.concat(chunks)))); }
  finally { await c.end(); }
}
main().catch(error => { console.error(JSON.stringify({ event: "restore_proof_failed", diagnostic: restoreDiagnostic(error) })); process.exitCode = 1; });
