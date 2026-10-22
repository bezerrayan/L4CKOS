import { mkdir, open, lstat } from "node:fs/promises";
import { digest } from "../financialRecovery/policy";
import type { RecoveryInventory } from "./controller";
const events = new Set([
  "before-isolation",
  "quarantine-proven",
  "exclusive-ready",
  "channel-revoked",
  "before-release",
  "released",
]);
/** Explicit private journal creation only. A persistence failure aborts activation.
 * No secrets or payloads; account inventory stays in the private file, not stdout.
 */
export async function createIsolationJournal(directory: string) {
  if (!/^\/tmp\/l4ckos-financial-isolation-[a-zA-Z0-9_-]+$/.test(directory))
    throw Error("ISOLATION_PRIVATE_JOURNAL_PATH");
  await mkdir(directory, { mode: 0o700 });
  const st = await lstat(directory);
  if (!st.isDirectory() || (st.mode & 0o777) !== 0o700)
    throw Error("ISOLATION_JOURNAL_PERMISSIONS");
  const file = await open(directory + "/journal.jsonl", "wx", 0o600);
  await file.sync();
  const dir = await open(directory, "r");
  await dir.sync();
  await dir.close();
  let previous = "0".repeat(64),
    sequence = 0;
  return {
    path: directory + "/journal.jsonl",
    persist: async (event: string, state: RecoveryInventory) => {
      if (!events.has(event)) throw Error("ISOLATION_JOURNAL_EVENT");
      const entry = {
        sequence: sequence + 1,
        at: new Date().toISOString(),
        event,
        previous,
        state: structuredClone(state),
      };
      const hash = digest(entry);
      await file.write(JSON.stringify({ ...entry, hash }) + "\n");
      await file.sync();
      previous = hash;
      sequence++;
    },
    close: () => file.close(),
  };
}
