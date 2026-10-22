export type BackupFileEntry = {
  fileName: string;
  type: "manual" | "automatic" | "unknown";
  createdAt: string | null;
};

export function describeBackupFile(fileName: string): BackupFileEntry {
  const match = fileName.match(/^(auto-)?backup-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z(?:-[a-f0-9-]{36})?\.json$/);
  if (!match) return { fileName, type: "unknown", createdAt: null };
  const [, automatic, date, hour, minute, second, millisecond] = match;
  const parsed = new Date(`${date}T${hour}:${minute}:${second}.${millisecond}Z`);
  return { fileName, type: automatic ? "automatic" : "manual", createdAt: Number.isNaN(parsed.getTime()) ? null : parsed.toISOString() };
}
