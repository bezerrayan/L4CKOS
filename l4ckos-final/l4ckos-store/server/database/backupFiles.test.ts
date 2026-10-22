import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createBackupFile, listBackupFileNames, writeBackupArtifact } from "./backupFiles";

const temporaryDirectories: string[] = [];
async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), "l4ckos-backup-files-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe("isolated backup file storage helpers", () => {
  it("writes a complete JSON artifact with restricted file mode and lists regular JSON files only", async () => {
    const directory = await temporaryDirectory();
    const result = await writeBackupArtifact(directory, "manual", { fixture: "synthetic" }, new Date("2026-10-20T12:30:00.125Z"));
    const contents = JSON.parse(await readFile(path.join(directory, result.fileName), "utf8"));
    expect(contents).toEqual({ fixture: "synthetic" });
    expect((await stat(path.join(directory, result.fileName))).mode & 0o777).toBe(0o600);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect(await readdir(directory)).toEqual([result.fileName]);

    const outsideFile = path.join(await temporaryDirectory(), "outside.json");
    await writeFile(outsideFile, "{}", { mode: 0o600 });
    await symlink(outsideFile, path.join(directory, "linked.json"));
    await writeFile(path.join(directory, "notes.txt"), "ignored");
    expect(await listBackupFileNames(directory)).toEqual([result.fileName]);
  });

  it("uses unique names for overlapping executions and does not expose directory paths", async () => {
    const directory = await temporaryDirectory();
    const results = await Promise.all(Array.from({ length: 6 }, () => writeBackupArtifact(directory, "automatic", { fixture: true }, new Date("2026-10-20T00:00:00.000Z"))));
    expect(new Set(results.map(result => result.fileName)).size).toBe(6);
    expect(results.every(result => !("filePath" in result))).toBe(true);
    expect((await listBackupFileNames(directory)).length).toBe(6);
  });

  it("rejects a second active snapshot job within the same server process", async () => {
    const directory = await temporaryDirectory();
    let release!: (artifact: unknown) => void;
    const first = createBackupFile(directory, "manual", () => new Promise(resolve => { release = resolve; }));
    await Promise.resolve();
    await expect(createBackupFile(directory, "automatic", async () => ({ shouldNotRun: true }))).rejects.toThrow("BACKUP_ALREADY_RUNNING");
    release({ fixture: "synthetic" });
    await expect(first).resolves.toMatchObject({ fileName: expect.stringContaining("backup-") });
  });

  it("returns an empty list for a missing directory without creating it", async () => {
    const parent = await temporaryDirectory();
    const missing = path.join(parent, "not-created");
    expect(await listBackupFileNames(missing)).toEqual([]);
    await expect(stat(missing)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("hides serialization and filesystem diagnostics behind a stable error", async () => {
    const directory = await temporaryDirectory();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(writeBackupArtifact(directory, "manual", circular)).rejects.toThrow("BACKUP_WRITE_FAILED");
    expect(await readdir(directory)).toEqual([]);
  });
});
