import { createHash } from "node:crypto";
import type { Connection, RowDataPacket } from "mysql2/promise";

export const INTERNAL_TABLES = ["_l4ckos_schema_migrations", "_l4ckos_schema_executions"] as const;
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
export const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
export const structuralHash = (value: unknown) => sha256(canonical(value));
export const quote = (name: string) => `\`${name.replace(/`/g, "``")}\``;
export async function rows(connection: Connection, sql: string, values: unknown[] = []) {
  const [result] = await connection.query<RowDataPacket[]>(sql, values);
  return result;
}
/** Only default expressions on temporal columns are equivalent. String literals are untouched. */
export function normalizeDefault(value: unknown, type: string) {
  if (value === null) return null;
  const text = String(value);
  if (/^(timestamp|datetime)/.test(type)) {
    const match = text.match(/^(?:\()?\s*(?:now|current_timestamp)\((\d*)\)\s*\)?$/i) || text.match(/^current_timestamp$/i);
    if (match) return `CURRENT_TIMESTAMP(${match[1] || "0"})`;
  }
  return text;
}
const sorted = <T>(items: T[]) => items.sort((a, b) => canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0);
export type StructuralSchema = Awaited<ReturnType<typeof readStructuralSchema>>;

/** Metadata only. No SHOW TABLES discovery for execution and no business data SELECT. */
export async function readStructuralSchema(connection: Connection, internal = false) {
  const database = String((await rows(connection, "SELECT DATABASE() AS name"))[0].name);
  const tables = await rows(connection, "SELECT TABLE_NAME name, TABLE_TYPE type, ENGINE engine, TABLE_COLLATION collation, CREATE_OPTIONS options FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME");
  const columns = await rows(connection, "SELECT TABLE_NAME tableName, COLUMN_NAME name, ORDINAL_POSITION position, COLUMN_TYPE type, IS_NULLABLE nullable, COLUMN_DEFAULT defaultValue, EXTRA extra, GENERATION_EXPRESSION generationExpression, CHARACTER_SET_NAME charset, COLLATION_NAME collation, CHARACTER_MAXIMUM_LENGTH length, NUMERIC_PRECISION numericPrecision, NUMERIC_SCALE numericScale, DATETIME_PRECISION datetimePrecision FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION");
  const indexes = await rows(connection, "SELECT TABLE_NAME tableName, INDEX_NAME name, NON_UNIQUE nonUnique, SEQ_IN_INDEX sequence, COLUMN_NAME columnName, COLLATION direction, SUB_PART prefixLength, INDEX_TYPE indexType, IS_VISIBLE isVisible, EXPRESSION expression FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX");
  const foreignKeys = await rows(connection, "SELECT r.TABLE_NAME tableName, r.CONSTRAINT_NAME name, r.REFERENCED_TABLE_NAME parent, r.UPDATE_RULE updateRule, r.DELETE_RULE deleteRule, k.COLUMN_NAME columnName, k.REFERENCED_COLUMN_NAME parentColumn, k.REFERENCED_TABLE_SCHEMA parentSchema, k.ORDINAL_POSITION position FROM information_schema.REFERENTIAL_CONSTRAINTS r JOIN information_schema.KEY_COLUMN_USAGE k ON k.CONSTRAINT_SCHEMA=r.CONSTRAINT_SCHEMA AND k.TABLE_NAME=r.TABLE_NAME AND k.CONSTRAINT_NAME=r.CONSTRAINT_NAME WHERE r.CONSTRAINT_SCHEMA=DATABASE() ORDER BY r.TABLE_NAME, r.CONSTRAINT_NAME, k.ORDINAL_POSITION");
  const checks = await rows(connection, "SELECT t.TABLE_NAME tableName, c.CHECK_CLAUSE clause, t.ENFORCED enforced FROM information_schema.TABLE_CONSTRAINTS t JOIN information_schema.CHECK_CONSTRAINTS c ON c.CONSTRAINT_SCHEMA=t.CONSTRAINT_SCHEMA AND c.CONSTRAINT_NAME=t.CONSTRAINT_NAME WHERE t.CONSTRAINT_SCHEMA=DATABASE() AND t.CONSTRAINT_TYPE='CHECK'");
  const grouped = (items: RowDataPacket[], table: string) => {
    const groups = new Map<string, RowDataPacket[]>();
    for (const item of items.filter(i => i.tableName === table)) groups.set(item.name, [...(groups.get(item.name) || []), item]);
    return [...groups.values()];
  };
  const selected = tables.filter(t => internal === (INTERNAL_TABLES as readonly string[]).includes(t.name));
  const objects = selected.map(table => ({
    name: String(table.name), type: String(table.type), engine: table.engine, collation: table.collation, options: table.options,
    columns: columns.filter(c => c.tableName === table.name).map(c => ({
      name: c.name, position: Number(c.position), type: c.type, nullable: c.nullable === "YES",
      defaultValue: normalizeDefault(c.defaultValue, c.type),
      extra: String(c.extra).replace(/DEFAULT_GENERATED\s*/g, "").trim().replace(/current_timestamp(?:\(\))?/gi, "CURRENT_TIMESTAMP(0)"),
      generationExpression: c.generationExpression, charset: c.charset, collation: c.collation,
      length: c.length === null ? null : Number(c.length), numericPrecision: c.numericPrecision === null ? null : Number(c.numericPrecision),
      numericScale: c.numericScale === null ? null : Number(c.numericScale), datetimePrecision: c.datetimePrecision === null ? null : Number(c.datetimePrecision),
    })),
    // Index labels are excluded; uniqueness, order, prefixes, expressions, visibility and multiplicity remain.
    indexes: sorted(grouped(indexes, table.name).map(parts => ({ primary: parts[0].name === "PRIMARY", unique: Number(parts[0].nonUnique) === 0, type: parts[0].indexType, visible: parts[0].isVisible === "YES", columns: parts.map(i => ({ name: i.columnName, direction: i.direction, prefixLength: i.prefixLength, expression: i.expression })) }))),
    foreignKeys: sorted(grouped(foreignKeys, table.name).map(parts => ({ parent: parts[0].parent, parentSchema: parts[0].parentSchema === database ? "$self" : parts[0].parentSchema, updateRule: parts[0].updateRule, deleteRule: parts[0].deleteRule, columns: parts.map(k => ({ name: k.columnName, parentColumn: k.parentColumn })) }))),
    // Conservative: preserve CHECK expressions exactly as MySQL emits them; do not rewrite literals/parentheses.
    checks: sorted(checks.filter(c => c.tableName === table.name).map(c => ({ clause: c.clause, enforced: c.enforced === "YES" }))),
  }));
  const unsupported: Record<string, number> = {};
  for (const [view, field] of [["TRIGGERS", "TRIGGER_SCHEMA"], ["ROUTINES", "ROUTINE_SCHEMA"], ["EVENTS", "EVENT_SCHEMA"]]) {
    unsupported[view.toLowerCase()] = Number((await rows(connection, `SELECT COUNT(*) n FROM information_schema.${view} WHERE ${field}=DATABASE()`))[0].n);
  }
  return { algorithmVersion: 1, tables: objects, unsupported };
}
