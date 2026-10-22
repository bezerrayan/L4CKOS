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

export async function readReleaseContract() {
  const v4Bytes = await readArtifact('database/schema/contract-v4.json', 'database/schema');
  const v4 = JSON.parse(v4Bytes.toString('utf8')) as { version: number; baseFingerprint: string; fingerprint: string; tables: StructuralSchema['tables'] };
  const base = await readCurrentContract();
  if (v4.version !== 4 || v4.baseFingerprint !== base.fingerprint || v4.tables.length !== 1 ||
    v4.tables[0].name !== 'asaasWebhookInbox' || base.schema.tables.some(t => t.name === v4.tables[0].name))
    throw new SchemaError('INVALID_APPROVED_CONTRACT');
  base.schema.tables.push(...v4.tables);
  base.schema.tables.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  if (structuralHash(base.schema) !== v4.fingerprint) throw new SchemaError('INVALID_APPROVED_CONTRACT');

  const bytes = await readArtifact('database/schema/contract-v5.json', 'database/schema');
  const delta = JSON.parse(bytes.toString('utf8')) as { version: number; baseFingerprint: string; fingerprint: string; tables: StructuralSchema['tables'] };
  if (delta.version !== 5 || delta.baseFingerprint !== v4.fingerprint || delta.tables.length !== 1 ||
    delta.tables[0].name !== 'homeHighlightSettings' || base.schema.tables.some(t => t.name === delta.tables[0].name))
    throw new SchemaError('INVALID_APPROVED_CONTRACT');
  base.schema.tables.push(...delta.tables);
  base.schema.tables.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  if (structuralHash(base.schema) !== delta.fingerprint) throw new SchemaError('INVALID_APPROVED_CONTRACT');

  const variantBytes = await readArtifact('database/schema/contract-v6.json', 'database/schema');
  const variants = JSON.parse(variantBytes.toString('utf8')) as {
    version: number;
    baseFingerprint: string;
    fingerprint: string;
    additions: Record<string, StructuralSchema['tables'][number]['columns']>;
    checks: Record<string, StructuralSchema['tables'][number]['checks']>;
  };
  if (variants.version !== 6 || variants.baseFingerprint !== delta.fingerprint ||
      Object.keys(variants.additions).length !== 1 || Object.keys(variants.checks).length !== 1 ||
      !variants.additions.productVariants || !variants.checks.productVariants)
    throw new SchemaError('INVALID_APPROVED_CONTRACT');
  const variantTable = base.schema.tables.find(table => table.name === 'productVariants');
  if (!variantTable || variants.additions.productVariants.length !== 1 ||
      variants.additions.productVariants[0].name !== 'isActive' ||
      variants.additions.productVariants[0].position !== variantTable.columns.length + 1 ||
      variantTable.columns.some(column => column.name === 'isActive') ||
      variants.checks.productVariants.length !== 1 || variants.checks.productVariants[0].enforced !== true ||
      variantTable.checks.some(check => check.clause === variants.checks.productVariants[0].clause))
    throw new SchemaError('INVALID_APPROVED_CONTRACT');
  variantTable.columns.push(...variants.additions.productVariants);
  variantTable.checks.push(...variants.checks.productVariants);
  variantTable.checks.sort((a, b) => a.clause < b.clause ? -1 : a.clause > b.clause ? 1 : 0);
  if (structuralHash(base.schema) !== variants.fingerprint) throw new SchemaError('INVALID_APPROVED_CONTRACT');
  return { version: 6, fingerprint: variants.fingerprint, schema: base.schema, checksum: sha256(variantBytes) };
}
