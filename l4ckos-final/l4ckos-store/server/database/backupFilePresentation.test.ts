import { describe, expect, it } from "vitest";
import { describeBackupFile } from "../../shared/backupFilePresentation";

describe("backup file presentation metadata", () => {
  it("derives source and UTC creation time only from the known naming convention", () => {
    expect(describeBackupFile("backup-2026-10-20T12-30-00-125Z-550e8400-e29b-41d4-a716-446655440000.json")).toMatchObject({
      type: "manual", createdAt: "2026-10-20T12:30:00.125Z",
    });
    expect(describeBackupFile("auto-backup-2026-10-20T00-00-00-000Z-550e8400-e29b-41d4-a716-446655440000.json")).toMatchObject({
      type: "automatic", createdAt: "2026-10-20T00:00:00.000Z",
    });
  });

  it("keeps unknown legacy names unclassified", () => {
    expect(describeBackupFile("legacy-export.json")).toEqual({ fileName: "legacy-export.json", type: "unknown", createdAt: null });
  });
});
