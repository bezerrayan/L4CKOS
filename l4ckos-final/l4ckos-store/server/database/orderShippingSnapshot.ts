import { z } from "zod";

const snapshot = z.object({
  id: z.string().min(1).max(120),
  label: z.string().min(1).max(255),
  minDays: z.number().int().nonnegative().nullable(),
  maxDays: z.number().int().nonnegative().nullable(),
}).refine(v => v.minDays === null && v.maxDays === null || v.minDays !== null && v.maxDays !== null && v.maxDays >= v.minDays);

// Return only transport fields, never arbitrary audit metadata/provider credentials.
export function readShippingSnapshot(metadata: unknown) {
  try {
    const value = typeof metadata === "string" ? JSON.parse(metadata) : metadata;
    const parsed = snapshot.safeParse(value?.shippingAtPurchase);
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}
