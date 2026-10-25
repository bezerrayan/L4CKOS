import { createHash } from "node:crypto";

export const MANAGER_SYNC_TIMEZONE = "America/Sao_Paulo" as const;
export const MAX_MANAGER_SYNC_ORDERS = 5_000;
export const MAX_MANAGER_SYNC_ITEMS = 25_000;
export const MAX_MANAGER_SYNC_RESPONSE_BYTES = 10 * 1024 * 1024;

export function parseManagerSyncMonthPeriod(start: unknown, endExclusive: unknown) {
  if (typeof start !== "string" || typeof endExclusive !== "string") return null;
  const match = /^(\d{4})-(\d{2})-01$/.exec(start);
  if (!match || !/^\d{4}-\d{2}-\d{2}$/.test(endExclusive)) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12) return null;
  const next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  if (endExclusive !== next) return null;
  return { start, endExclusive };
}

export function isManagerSyncPeriodClosed(start: string, now = new Date()) {
  const match = /^(\d{4})-(\d{2})-01$/.exec(start);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MANAGER_SYNC_TIMEZONE,
    year: "numeric",
    month: "numeric",
  }).formatToParts(now);
  const currentYear = Number(parts.find((part) => part.type === "year")?.value);
  const currentMonth = Number(parts.find((part) => part.type === "month")?.value);
  return year * 12 + month < currentYear * 12 + currentMonth;
}

export type ManagerSyncIdentity = {
  system: "l4ckos-store";
  environment: "staging";
  projectId: string;
  environmentId: string;
  serviceId: string;
};

type SnapshotItem = {
  productId: number | null;
  variantId: number | null;
  productName: string | null;
  variantName: string | null;
  sku: string | null;
  color: string | null;
  size: string | null;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number | null;
};

type SnapshotOrder = {
  id: number;
  userId: number;
  createdAt: Date | string;
  updatedAt: Date | string;
  totalPriceCents: number;
  paymentStatus: "unconfirmed" | "confirmed";
  paymentConfirmationSource: "asaas_webhook" | "manual" | null;
  paymentConfirmedAt: Date | string | null;
  orderStatus: string;
  fulfillmentStatus: string | null;
  items: SnapshotItem[];
};

function iso(value: Date | string | null, field: string): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`MANAGER_SYNC_INVALID_${field.toUpperCase()}`);
  return date.toISOString();
}

function validInteger(value: number, minimum = 0) {
  return Number.isSafeInteger(value) && value >= minimum;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function buildManagerSyncSnapshot(input: {
  identity: ManagerSyncIdentity;
  periodStart: string;
  periodEndExclusive: string;
  generatedAt: Date;
  newCustomers: number;
  customersWithOrders: number;
  orders: SnapshotOrder[];
}) {
  if (input.periodEndExclusive <= input.periodStart) throw new Error("MANAGER_SYNC_INVALID_PERIOD");
  if (!validInteger(input.newCustomers) || !validInteger(input.customersWithOrders)) throw new Error("MANAGER_SYNC_INVALID_CUSTOMER_METRICS");
  if (input.orders.length > MAX_MANAGER_SYNC_ORDERS) throw new Error("MANAGER_SYNC_ORDER_LIMIT_EXCEEDED");
  const itemCount = input.orders.reduce((count, order) => count + order.items.length, 0);
  if (itemCount > MAX_MANAGER_SYNC_ITEMS) throw new Error("MANAGER_SYNC_ITEM_LIMIT_EXCEEDED");

  const orders = input.orders.map((order) => {
    if (!validInteger(order.id, 1) || !validInteger(order.userId, 1) || !validInteger(order.totalPriceCents)) throw new Error("MANAGER_SYNC_INVALID_ORDER");
    if (order.items.length === 0) throw new Error("MANAGER_SYNC_ORDER_ITEMS_MISSING");
    if (!(order.paymentStatus === "confirmed" || order.paymentStatus === "unconfirmed")) throw new Error("MANAGER_SYNC_INVALID_PAYMENT_STATUS");
    if (order.paymentConfirmationSource !== null && !["asaas_webhook", "manual"].includes(order.paymentConfirmationSource)) throw new Error("MANAGER_SYNC_INVALID_PAYMENT_SOURCE");
    if (typeof order.orderStatus !== "string" || order.orderStatus.length === 0 || order.orderStatus.length > 80) throw new Error("MANAGER_SYNC_INVALID_ORDER_STATUS");
    if (order.fulfillmentStatus !== null && (typeof order.fulfillmentStatus !== "string" || order.fulfillmentStatus.length > 80)) throw new Error("MANAGER_SYNC_INVALID_FULFILLMENT_STATUS");

    return {
      id: order.id,
      // This V2 contract does not export customer identifiers. Aggregate metrics remain available.
      customerReference: null,
      createdAt: iso(order.createdAt, "created_at")!,
      updatedAt: iso(order.updatedAt, "updated_at")!,
      totalPriceCents: order.totalPriceCents,
      paymentStatus: order.paymentStatus,
      paymentConfirmationSource: order.paymentConfirmationSource,
      paymentConfirmedAt: iso(order.paymentConfirmedAt, "payment_confirmed_at"),
      // External gateway references are not needed for the Manager's aggregate reports.
      paymentConfirmationReference: null,
      orderStatus: order.orderStatus,
      fulfillmentStatus: order.fulfillmentStatus,
      items: order.items.map((item) => {
        if (item.productName === null || item.productName.trim() === "") throw new Error("MANAGER_SYNC_ITEM_SNAPSHOT_INCOMPLETE");
        if (item.lineTotalCents === null) throw new Error("MANAGER_SYNC_ITEM_TOTAL_MISSING");
        if (!validInteger(item.quantity, 1) || !validInteger(item.unitPriceCents) || !validInteger(item.lineTotalCents)) throw new Error("MANAGER_SYNC_INVALID_ITEM");
        return {
          productId: item.productId,
          variantId: item.variantId,
          productName: item.productName,
          variantName: item.variantName,
          sku: item.sku,
          color: item.color,
          size: item.size,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          lineTotalCents: item.lineTotalCents,
        };
      }),
    };
  });

  const generatedAt = input.generatedAt.toISOString();
  const content = {
    source: input.identity,
    period: { start: input.periodStart, endExclusive: input.periodEndExclusive, timezone: MANAGER_SYNC_TIMEZONE },
    customerMetrics: { newCustomers: input.newCustomers, customersWithOrders: input.customersWithOrders },
    orders,
  };
  const revision = createHash("sha256").update(canonicalJson(content), "utf8").digest("hex");
  const payload = {
    schemaVersion: 2 as const,
    source: input.identity,
    snapshot: {
      id: `staging-${input.periodStart}-${revision}`,
      revision,
      generatedAt,
      cursor: generatedAt,
      complete: true as const,
      timezone: MANAGER_SYNC_TIMEZONE,
      periodStart: input.periodStart,
      periodEndExclusive: input.periodEndExclusive,
    },
    customerMetrics: content.customerMetrics,
    orders,
  };
  const responseBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  if (responseBytes > MAX_MANAGER_SYNC_RESPONSE_BYTES) throw new Error("MANAGER_SYNC_RESPONSE_LIMIT_EXCEEDED");
  return payload;
}

function datePartsAt(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MANAGER_SYNC_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

/** Convert a local calendar midnight to UTC using the IANA timezone rules. */
export function saoPauloMidnightUtc(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("MANAGER_SYNC_INVALID_PERIOD");
  const [year, month, date] = day.split("-").map(Number);
  const desiredUtcParts = Date.UTC(year, month - 1, date, 0, 0, 0);
  if (new Date(desiredUtcParts).toISOString().slice(0, 10) !== day) throw new Error("MANAGER_SYNC_INVALID_PERIOD");
  let candidate = desiredUtcParts;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const local = datePartsAt(new Date(candidate));
    const represented = Date.UTC(local.year!, local.month! - 1, local.day!, local.hour!, local.minute!, local.second!);
    const adjustment = desiredUtcParts - represented;
    candidate += adjustment;
    if (adjustment === 0) return new Date(candidate);
  }
  const result = new Date(candidate);
  const local = datePartsAt(result);
  if (local.year !== year || local.month !== month || local.day !== date || local.hour !== 0 || local.minute !== 0 || local.second !== 0) throw new Error("MANAGER_SYNC_LOCAL_MIDNIGHT_UNRESOLVABLE");
  return result;
}
