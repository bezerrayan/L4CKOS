import { readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { sha256, structuralHash, type StructuralSchema } from "./fingerprint";
import { SchemaError } from "./safety";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export async function readArtifact(relative: string, directory: string) {
  if (!relative.startsWith(`${directory}/`) || relative.includes("\\") || relative.split("/").some(part => part === ".." || part === ".")) throw new SchemaError("UNAPPROVED_ARTIFACT_PATH");
  const root = await realpath(path.join(ROOT, directory));
  const resolved = await realpath(path.join(ROOT, relative));
  if (!resolved.startsWith(root + path.sep)) throw new SchemaError("UNAPPROVED_ARTIFACT_PATH");
  return readFile(resolved);
}
export type SchemaContract = { version: number; fingerprint: string; schema: StructuralSchema };
export async function readContract(internal = false) {
  const bytes = await readArtifact(`database/schema/${internal ? "governance" : "contract"}-v1.json`, "database/schema");
  const contract = JSON.parse(bytes.toString("utf8")) as SchemaContract;
  if (contract.version !== 1 || structuralHash(contract.schema) !== contract.fingerprint) throw new SchemaError("INVALID_APPROVED_CONTRACT");
  return { ...contract, checksum: sha256(bytes) };
}
export async function bootstrapArtifacts() {
  const bytes = await readArtifact("database/bootstrap/manifest.json", "database/bootstrap");
  const manifest = JSON.parse(bytes.toString("utf8")) as { version: number; tables: { table: string; path: string; checksum: string }[] };
  if (manifest.version !== 1 || !Array.isArray(manifest.tables) || new Set(manifest.tables.map(t => t.table)).size !== manifest.tables.length) throw new SchemaError("INVALID_BOOTSTRAP_MANIFEST");
  const statements: { table: string; sql: string }[] = [];
  for (const entry of manifest.tables) {
    const content = await readArtifact(entry.path, "database/bootstrap/v1");
    if (sha256(content) !== entry.checksum) throw new SchemaError("BOOTSTRAP_CHECKSUM_MISMATCH");
    statements.push({ table: entry.table, sql: content.toString("utf8") });
  }
  const contract = await readContract();
  if (JSON.stringify([...statements.map(s => s.table)].sort()) !== JSON.stringify(contract.schema.tables.map(t => t.name).sort())) throw new SchemaError("BOOTSTRAP_TABLE_MANIFEST_MISMATCH");
  return { statements, checksum: sha256(bytes) };
}

export async function readRecognizedExistingContract() {
  const bytes = await readArtifact("database/schema/audited-existing-v1.json", "database/schema");
  const contract = JSON.parse(bytes.toString("utf8")) as SchemaContract;
  if (contract.version !== 1 || structuralHash(contract.schema) !== contract.fingerprint) throw new SchemaError("INVALID_APPROVED_CONTRACT");
  return { ...contract, checksum: sha256(bytes) };
}
