import { it, expect } from "vitest";
import { readFile, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createIsolationJournal } from "../../database/financialIsolation/journal";
import { digest } from "../../database/financialRecovery/policy";
it("persists private chained inventory before admitting writes", async () => {
  const j = await createIsolationJournal(
    "/tmp/l4ckos-financial-isolation-journal-" + randomUUID()
  );
  const state = {
    accounts: [],
    readOnly: 0,
    scheduler: "OFF",
    controllerId: 1,
    rescueId: 2,
    executorIds: [3],
  };
  await j.persist("before-isolation", state);
  await j.persist("channel-revoked", state);
  await j.close();
  const entries = (await readFile(j.path, "utf8"))
    .trim()
    .split("\n")
    .map(x => JSON.parse(x));
  expect(entries[1].previous).toBe(entries[0].hash);
  for (const entry of entries) {
    const { hash, ...value } = entry;
    expect(hash).toBe(digest(value));
  }
  expect((await stat(j.path)).mode & 0o777).toBe(0o600);
});
it("rejects journal paths outside private local evidence directory", async () => {
  await expect(createIsolationJournal("/app/journal")).rejects.toThrow("PATH");
});
