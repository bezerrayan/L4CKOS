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

/** v1/v2 remain immutable. v3 is a verified additive contract over v2. */
export async function readCurrentContract() {
  const base=JSON.parse((await readArtifact('database/schema/contract-v2.json','database/schema')).toString('utf8')) as SchemaContract;
  const bytes=await readArtifact('database/schema/contract-v3.json','database/schema');
  const delta=JSON.parse(bytes.toString('utf8')) as { version:number; baseFingerprint:string; fingerprint:string; additions:Record<string,StructuralSchema['tables'][number]['columns']> };
  if(delta.version!==3 || structuralHash(base.schema)!==base.fingerprint || delta.baseFingerprint!==base.fingerprint) throw new SchemaError('INVALID_APPROVED_CONTRACT');
  for(const [name,columns] of Object.entries(delta.additions)) {
    const table=base.schema.tables.find(t=>t.name===name);
    if(!table || columns.some((c,i)=>c.position!==table.columns.length+i+1 || table.columns.some(old=>old.name===c.name))) throw new SchemaError('INVALID_APPROVED_CONTRACT');
    table.columns.push(...columns);
  }
  if(structuralHash(base.schema)!==delta.fingerprint) throw new SchemaError('INVALID_APPROVED_CONTRACT');
  return {version:3,fingerprint:delta.fingerprint,schema:base.schema,checksum:sha256(bytes)};
}
export async function currentBootstrapArtifacts() {
  const bytes=await readArtifact('database/bootstrap/manifest-v3.json','database/bootstrap');
  const manifest=JSON.parse(bytes.toString('utf8')) as {version:number;tables:{table:string;path:string;checksum:string}[]};
  if(manifest.version!==3 || new Set(manifest.tables.map(t=>t.table)).size!==manifest.tables.length) throw new SchemaError('INVALID_BOOTSTRAP_MANIFEST');
  const statements=[];
  for(const entry of manifest.tables){
    const directory=entry.path.startsWith('database/bootstrap/v3/') ? 'database/bootstrap/v3' : 'database/bootstrap/v2';
    const content=await readArtifact(entry.path,directory);
    if(sha256(content)!==entry.checksum) throw new SchemaError('BOOTSTRAP_CHECKSUM_MISMATCH');
    statements.push({table:entry.table,sql:content.toString('utf8')});
  }
  const contract=await readCurrentContract();
  if(JSON.stringify(statements.map(s=>s.table).sort())!==JSON.stringify(contract.schema.tables.map(t=>t.name).sort())) throw new SchemaError('BOOTSTRAP_TABLE_MANIFEST_MISMATCH');
  return {statements,checksum:sha256(bytes)};
}
