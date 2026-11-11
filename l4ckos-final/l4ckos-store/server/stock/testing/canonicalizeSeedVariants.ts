import { createVariantOptionKey } from "../../database/productVariantIdentity";

type Pool = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

/**
 * TEST SUPPORT ONLY. The V6 storefront publishes a variant only when it carries the canonical `optionKey`
 * (`v1:<sha256(color,size)>`, see productVariantIdentity). Synthetic seeds insert size/color only, so stamp the key
 * the same way the product-variant management code does, on rows that do not have one yet.
 */
export async function canonicalizeSeedVariants(pool: Pool): Promise<void> {
  const result = (await pool.query("SELECT id, color, size FROM productVariants WHERE optionKey IS NULL")) as unknown as [Array<{ id: number; color: string | null; size: string | null }>];
  for (const row of result[0]) {
    if (!row.color || !row.size) continue;
    await pool.query("UPDATE productVariants SET optionKey = ? WHERE id = ?", [createVariantOptionKey(row.color, row.size), row.id]);
  }
}
