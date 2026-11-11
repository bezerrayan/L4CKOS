import { z } from "zod";

/**
 * Exclusive drops V1 — shared contract (server + storefront + admin).
 *
 * Exclusivity is a CONTROL LAYER over STOCK V1. It never prices, reserves, pays or confirms anything:
 * those stay in the STOCK checkout. All instants are UTC ISO-8601 strings with an explicit offset on input.
 */

export const EXCLUSIVE_DROP_ERROR_CODES = {
  accessRequired: "EXCLUSIVE_ACCESS_REQUIRED",
  quotaExceeded: "EXCLUSIVE_QUOTA_EXCEEDED",
  dropClosed: "EXCLUSIVE_DROP_CLOSED",
  codeInvalid: "EXCLUSIVE_CODE_INVALID",
  codeRateLimited: "EXCLUSIVE_CODE_RATE_LIMITED",
  requestWindowClosed: "EXCLUSIVE_REQUEST_WINDOW_CLOSED",
  unverifiable: "EXCLUSIVE_ACCESS_UNVERIFIABLE",
} as const;
export type ExclusiveDropErrorCode = (typeof EXCLUSIVE_DROP_ERROR_CODES)[keyof typeof EXCLUSIVE_DROP_ERROR_CODES];

export const dropStoredStatusSchema = z.enum(["draft", "published", "closed"]);
export type DropStoredStatus = z.infer<typeof dropStoredStatusSchema>;

/** Derived lifecycle: `scheduled` (before purchase window), `active`, `closed` (after it, or closed by an admin). */
export type DropState = "hidden" | "scheduled" | "active" | "closed";

export const accessRequestStatusSchema = z.enum(["pending", "approved", "rejected", "revoked"]);
export type AccessRequestStatus = z.infer<typeof accessRequestStatusSchema>;

/** What the storefront renders for the signed-in (or anonymous) viewer on an exclusive product. */
export type ViewerAccessStatus =
  | "login_required" // anonymous
  | "none" // signed in, never requested
  | "pending"
  | "rejected"
  | "revoked"
  | "approved" // approved, code not redeemed yet
  | "unlocked" // approved + code redeemed: may buy up to the remaining units
  | "expired"; // grant expired

export type DropWindows = {
  requestStartsAt: Date | null;
  requestEndsAt: Date | null;
  purchaseStartsAt: Date;
  purchaseEndsAt: Date;
};

export type DropLike = DropWindows & { storedStatus: DropStoredStatus };

export function computeDropState(drop: DropLike, now: Date): DropState {
  if (drop.storedStatus === "draft") return "hidden";
  if (drop.storedStatus === "closed") return "closed";
  const t = now.getTime();
  if (t < drop.purchaseStartsAt.getTime()) return "scheduled";
  if (t >= drop.purchaseEndsAt.getTime()) return "closed";
  return "active";
}

/** Access requests are accepted inside the request window (open-ended sides allowed) while the drop is not closed/hidden. */
export function isRequestWindowOpen(drop: DropLike, now: Date): boolean {
  const state = computeDropState(drop, now);
  if (state === "hidden" || state === "closed") return false;
  const t = now.getTime();
  if (drop.requestStartsAt && t < drop.requestStartsAt.getTime()) return false;
  if (drop.requestEndsAt && t >= drop.requestEndsAt.getTime()) return false;
  return true;
}

export function isPurchaseWindowOpen(drop: DropLike, now: Date): boolean {
  return computeDropState(drop, now) === "active";
}

/** Inputs must carry an explicit UTC offset ("Z" or ±hh:mm): a bare local time is ambiguous and rejected. */
const OFFSET_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
export const instantSchema = z
  .string()
  .regex(OFFSET_ISO, "Informe data e hora com fuso explícito (ex.: 2026-11-30T12:00:00-03:00).")
  .transform(value => new Date(value))
  .refine(date => !Number.isNaN(date.getTime()), "Data inválida.");

export const dropTimezoneSchema = z.string().min(3).max(64).refine(zone => {
  try { new Intl.DateTimeFormat("pt-BR", { timeZone: zone }); return true; } catch { return false; }
}, "Fuso horário inválido.");

export const adminSaveDropInputSchema = z.object({
  id: z.number().int().positive().optional(),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(3).max(80),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000).optional(),
  timezone: dropTimezoneSchema.default("America/Sao_Paulo"),
  requestStartsAt: instantSchema.nullable().optional(),
  requestEndsAt: instantSchema.nullable().optional(),
  purchaseStartsAt: instantSchema,
  purchaseEndsAt: instantSchema,
  isPublic: z.boolean().default(true),
  requiresAuthorization: z.boolean().default(true),
  defaultUnitLimit: z.number().int().min(1).max(99).default(1),
  status: dropStoredStatusSchema.default("draft"),
  productIds: z.array(z.number().int().positive()).min(1).max(30),
}).strict().superRefine((value, ctx) => {
  // Field errors (e.g. a date without offset) leave raw strings here: report only those, never throw.
  if (!(value.purchaseStartsAt instanceof Date) || !(value.purchaseEndsAt instanceof Date)) return;
  if (value.purchaseEndsAt.getTime() <= value.purchaseStartsAt.getTime()) {
    ctx.addIssue({ code: "custom", path: ["purchaseEndsAt"], message: "O fim da compra deve ser posterior ao início." });
  }
  if (value.requestStartsAt instanceof Date && value.requestEndsAt instanceof Date && value.requestEndsAt.getTime() <= value.requestStartsAt.getTime()) {
    ctx.addIssue({ code: "custom", path: ["requestEndsAt"], message: "O fim das solicitações deve ser posterior ao início." });
  }
});
export type AdminSaveDropInput = z.infer<typeof adminSaveDropInputSchema>;

export const adminApproveInputSchema = z.object({
  requestId: z.number().int().positive(),
  unitLimit: z.number().int().min(1).max(99),
  expiresAt: instantSchema,
}).strict();

export const accessCodeInputSchema = z.object({
  // Crockford-style groups; separators and case are ignored server-side.
  code: z.string().trim().min(16).max(40),
}).strict();

/** Public, non-sensitive view of a drop, safe for anonymous visitors. */
export type PublicDropView = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  state: DropState;
  timezone: string;
  requiresAuthorization: boolean;
  requestWindow: { startsAt: string | null; endsAt: string | null; open: boolean };
  purchaseWindow: { startsAt: string; endsAt: string; open: boolean };
};

export type ViewerAccessView = {
  status: ViewerAccessStatus;
  unitLimit?: number;
  unitsUsed?: number;
  unitsRemaining?: number;
  expiresAt?: string;
};

export type ProductDropView =
  | { exclusive: false }
  | { exclusive: true; drop: PublicDropView; viewer: ViewerAccessView };

/** Storefront rule: only an unlocked viewer inside an open purchase window with units left may buy. */
export function canPurchaseExclusive(view: ProductDropView): boolean {
  if (!view.exclusive) return true;
  if (!view.drop.requiresAuthorization) return view.drop.purchaseWindow.open;
  return view.drop.purchaseWindow.open && view.viewer.status === "unlocked" && (view.viewer.unitsRemaining ?? 0) > 0;
}
