import {
  stockAttemptResumeV1Schema,
  stockCheckoutRequestV1Schema,
  stockCheckoutResponseV1Schema,
  type StockAttemptResumeV1,
  type StockCheckoutItemV1,
  type StockCheckoutRequestV1,
  type StockCheckoutResponseV1,
  type StockDeliveryV1,
} from "../../../shared/stockCheckoutV1";
import type { CartItem } from "../types/cart";

export type StockCatalogVariant = {
  id: number;
  productId: number;
  size: string;
  color: string;
  active: boolean;
  stock?: number;
};

export type StockCartLine = {
  productId: number;
  variantId?: number;
  quantity: number;
  variants?: readonly StockCatalogVariant[];
};

export function stockLinesFromCart(items: readonly CartItem[]): StockCartLine[] {
  return items.map(item => ({
    productId: item.product.id,
    variantId: item.variantId,
    quantity: item.quantity,
    variants: item.product.variants,
  }));
}

export type StockResumeStatus = StockAttemptResumeV1["status"];

export function stockAttemptStatusLabel(status: StockResumeStatus): string {
  switch (status) {
    case "reserved": return "Reserva criada; pagamento ainda não iniciado";
    case "creating": return "Preparando pagamento";
    case "pending": return "Aguardando confirmação do pagamento";
    case "ambiguous": return "Pagamento em análise; não inicie outra tentativa";
    case "paid": return "Pagamento confirmado";
    case "failed": return "Pagamento não concluído";
    case "expired": return "Reserva expirada; confirme o estado antes de tentar novamente";
    case "cancelled": return "Tentativa cancelada";
  }
}

export type StockAttemptRecord = {
  fingerprint: string;
  attemptId: string;
  createdAt: number;
  status: "reserved" | "creating" | "pending" | "ambiguous" | "paid" | "failed" | "expired" | "cancelled";
  canStartNewAttempt?: boolean;
};

export interface StockAttemptStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const ATTEMPTS_STORAGE_KEY = "l4ckos:stock-checkout-attempts:v1";
const TERMINAL_ATTEMPT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TERMINAL_ATTEMPTS = 40;
const REPLACEABLE_STATUSES = new Set(["failed", "expired", "cancelled"]);
const OPEN_STATUSES = new Set<StockAttemptRecord["status"]>(["pending", "reserved", "creating", "ambiguous"]);

function fail(code: string): never {
  throw new Error(code);
}

/** Stable backend error code (`error.data.appError.code`). Message text is never interpreted. */
export function appErrorCodeOf(error: unknown): string {
  const code = (error as { data?: { appError?: { code?: unknown } | null } | null } | null)?.data?.appError?.code;
  return typeof code === "string" ? code : "";
}

export function resolveStockVariant(
  variants: readonly StockCatalogVariant[],
  productId: number,
  size: string,
  color: string,
): StockCatalogVariant | null {
  const normalizedSize = size.normalize("NFKC").trim().toLocaleLowerCase();
  const normalizedColor = color.normalize("NFKC").trim().toLocaleLowerCase();
  const matches = variants.filter(variant =>
    variant.productId === productId &&
    variant.active &&
    variant.size.normalize("NFKC").trim().toLocaleLowerCase() === normalizedSize &&
    variant.color.normalize("NFKC").trim().toLocaleLowerCase() === normalizedColor,
  );
  return matches.length === 1 ? matches[0] : null;
}

function identityItems(lines: readonly StockCartLine[]): StockCheckoutItemV1[] {
  if (!lines.length || lines.length > 30) return fail("STOCK_ITEMS_INVALID");
  const items = lines.map(line => {
    if (!Number.isSafeInteger(line.variantId) || Number(line.variantId) <= 0) return fail("STOCK_VARIANT_ID_REQUIRED");
    return { productId: line.productId, variantId: line.variantId, quantity: line.quantity };
  });
  const parsed = stockCheckoutRequestV1Schema.shape.items.safeParse(items);
  if (!parsed.success) return fail("STOCK_ITEMS_INVALID");
  return parsed.data;
}

function checkoutItems(lines: readonly StockCartLine[]): StockCheckoutItemV1[] {
  const items = identityItems(lines);
  for (const line of lines) {
    const matching = (line.variants ?? []).filter(variant => variant.id === line.variantId && variant.productId === line.productId);
    if (matching.length !== 1 || !matching[0].active) return fail("STOCK_VARIANT_NOT_AVAILABLE");
  }
  return items;
}

export function stockCartFingerprint(items: readonly StockCheckoutItemV1[]): string {
  return JSON.stringify([...items]
    .map(({ productId, variantId, quantity }) => ({ productId, variantId, quantity }))
    .sort((a, b) => a.productId - b.productId || a.variantId - b.variantId || a.quantity - b.quantity));
}

function loadRecords(storage: StockAttemptStorage, now: number): StockAttemptRecord[] {
  try {
    const raw = storage.getItem(ATTEMPTS_STORAGE_KEY);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is StockAttemptRecord =>
      Boolean(item) && typeof item === "object" &&
      typeof item.fingerprint === "string" &&
      typeof item.attemptId === "string" && /^[A-Za-z0-9_-]{16,120}$/.test(item.attemptId) &&
      Number.isSafeInteger(item.createdAt) &&
      ["reserved", "creating", "pending", "ambiguous", "paid", "failed", "expired", "cancelled"].includes(item.status),
    ).map(item => ({ ...item, canStartNewAttempt: item.canStartNewAttempt === true }))
      .filter(item => !REPLACEABLE_STATUSES.has(item.status) || now - item.createdAt <= TERMINAL_ATTEMPT_TTL_MS);
  } catch {
    return [];
  }
}

function saveRecords(storage: StockAttemptStorage, records: StockAttemptRecord[]) {
  let terminalCount = 0;
  const retained = records.filter(record => {
    if (!REPLACEABLE_STATUSES.has(record.status)) return true;
    terminalCount += 1;
    return terminalCount <= MAX_TERMINAL_ATTEMPTS;
  });
  storage.setItem(ATTEMPTS_STORAGE_KEY, JSON.stringify(retained));
}

export function getOrCreateStockAttemptId(input: {
  storage: StockAttemptStorage;
  items: readonly StockCheckoutItemV1[];
  now?: number;
  createId: () => string;
}): string {
  const now = input.now ?? Date.now();
  const fingerprint = stockCartFingerprint(input.items);
  const records = loadRecords(input.storage, now);
  const existing = records.find(record => record.fingerprint === fingerprint);
  if (existing) return existing.attemptId;
  const attemptId = input.createId();
  if (!/^[A-Za-z0-9_-]{16,120}$/.test(attemptId)) return fail("STOCK_ATTEMPT_ID_INVALID");
  saveRecords(input.storage, [{ fingerprint, attemptId, createdAt: now, status: "pending" }, ...records]);
  return attemptId;
}

export function findStoredStockAttemptId(input: {
  storage: StockAttemptStorage;
  items: readonly StockCheckoutItemV1[];
  now?: number;
}): string | null {
  const fingerprint = stockCartFingerprint(input.items);
  return loadRecords(input.storage, input.now ?? Date.now()).find(record => record.fingerprint === fingerprint)?.attemptId ?? null;
}

export function saveStockAttemptStatus(input: {
  storage: StockAttemptStorage;
  items: readonly StockCheckoutItemV1[];
  attemptId: string;
  status: StockAttemptRecord["status"];
  canStartNewAttempt?: boolean;
  now?: number;
}) {
  const records = loadRecords(input.storage, input.now ?? Date.now());
  const fingerprint = stockCartFingerprint(input.items);
  const previous = records.find(record => record.fingerprint === fingerprint && record.attemptId === input.attemptId);
  saveRecords(input.storage, [
    { fingerprint, attemptId: input.attemptId, createdAt: previous?.createdAt ?? input.now ?? Date.now(), status: input.status, canStartNewAttempt: input.canStartNewAttempt ?? false },
    ...records.filter(record => record.fingerprint !== fingerprint),
  ]);
}

export type StockCheckoutTransport = {
  create(request: StockCheckoutRequestV1): Promise<unknown>;
  resume(attemptId: string): Promise<unknown>;
  /** Owner-scoped backend recovery when this browser has lost its attempt ID. */
  resumeLatest?(): Promise<unknown>;
};

/** Local client adapter only. The caller must keep enabled=false until the HTTP/schema gates are approved. */
export function createStockCheckoutClient(input: {
  enabled: boolean;
  storage: StockAttemptStorage;
  transport: StockCheckoutTransport;
  createId?: () => string;
  now?: () => number;
}) {
  const buildItems = (lines: readonly StockCartLine[]) => checkoutItems(lines);
  return {
    async create(lines: readonly StockCartLine[], delivery?: StockDeliveryV1): Promise<StockCheckoutResponseV1> {
      if (!input.enabled) return fail("PUBLIC_CHECKOUT_DISABLED");
      const items = buildItems(lines);
      const now = input.now?.() ?? Date.now();
      const fingerprint = stockCartFingerprint(items);
      const records = loadRecords(input.storage, now);
      const previous = records.find(record => record.fingerprint === fingerprint);
      let attemptId: string;
      if (previous?.canStartNewAttempt && REPLACEABLE_STATUSES.has(previous.status)) {
        attemptId = (input.createId ?? (() => globalThis.crypto.randomUUID()))();
        if (!/^[A-Za-z0-9_-]{16,120}$/.test(attemptId)) return fail("STOCK_ATTEMPT_ID_INVALID");
        saveRecords(input.storage, [{ fingerprint, attemptId, createdAt: now, status: "pending" }, ...records.filter(record => record.fingerprint !== fingerprint)]);
      } else {
        attemptId = getOrCreateStockAttemptId({ storage: input.storage, items, createId: input.createId ?? (() => globalThis.crypto.randomUUID()), now });
      }
      const request = stockCheckoutRequestV1Schema.parse({ attemptId, items, ...(delivery ? { delivery } : {}) });
      let raw: unknown;
      try {
        raw = await input.transport.create(request);
      } catch (error) {
        const code = appErrorCodeOf(error);
        // Definitive contract outcomes are recorded so the next call can never resend a dead attemptId.
        if (code === "CHECKOUT_ATTEMPT_EXPIRED") {
          // Reservation expired before reaching the provider: this attemptId must not be retried.
          saveStockAttemptStatus({ storage: input.storage, items, attemptId, status: "expired", now: input.now?.(), canStartNewAttempt: true });
        } else if (code === "PAYMENT_UNDER_ANALYSIS") {
          saveStockAttemptStatus({ storage: input.storage, items, attemptId, status: "ambiguous", now: input.now?.(), canStartNewAttempt: false });
        }
        throw error;
      }
      const response = stockCheckoutResponseV1Schema.parse(raw);
      const status: StockAttemptRecord["status"] = response.status === "reconciliation_required" ? "ambiguous" : response.status;
      saveStockAttemptStatus({ storage: input.storage, items, attemptId, status, now: input.now?.(), canStartNewAttempt: false });
      return response;
    },
    async resume(lines: readonly StockCartLine[]): Promise<StockAttemptResumeV1> {
      if (!input.enabled) return fail("PUBLIC_CHECKOUT_DISABLED");
      const items = identityItems(lines);
      const attemptId = findStoredStockAttemptId({ storage: input.storage, items, now: input.now?.() });
      if (!attemptId) {
        if (!input.transport.resumeLatest) return fail("STOCK_ATTEMPT_NOT_FOUND_LOCALLY");
        // Owner-scoped on the server. Only an attempt still in flight may block a new one: a settled or
        // dead attempt (paid/failed/expired/cancelled) belongs to an older purchase and must never be
        // shown as pending, confirm this cart, or clear it.
        const latest = await input.transport.resumeLatest();
        if (latest == null) return fail("STOCK_ATTEMPT_NOT_FOUND_ON_SERVER");
        const parsed = stockAttemptResumeV1Schema.parse(latest);
        if (!OPEN_STATUSES.has(parsed.status)) return fail("STOCK_ATTEMPT_NOT_FOUND_ON_SERVER");
        return parsed;
      }
      const response = stockAttemptResumeV1Schema.parse(await input.transport.resume(attemptId));
      if (response.attemptId !== attemptId) return fail("STOCK_ATTEMPT_CORRELATION_MISMATCH");
      saveStockAttemptStatus({ storage: input.storage, items, attemptId, status: response.status, now: input.now?.(), canStartNewAttempt: response.canStartNewAttempt });
      return response;
    },
    async startNewAfterTerminal(lines: readonly StockCartLine[]): Promise<string> {
      if (!input.enabled) return fail("PUBLIC_CHECKOUT_DISABLED");
      const items = buildItems(lines);
      const fingerprint = stockCartFingerprint(items);
      const now = input.now?.() ?? Date.now();
      const records = loadRecords(input.storage, now);
      const previous = records.find(record => record.fingerprint === fingerprint);
      if (!previous || !previous.canStartNewAttempt || !["failed", "expired", "cancelled"].includes(previous.status)) {
        return fail("STOCK_ATTEMPT_NOT_DEFINITIVELY_TERMINAL");
      }
      const attemptId = (input.createId ?? (() => globalThis.crypto.randomUUID()))();
      if (!/^[A-Za-z0-9_-]{16,120}$/.test(attemptId)) return fail("STOCK_ATTEMPT_ID_INVALID");
      saveRecords(input.storage, [
        { fingerprint, attemptId, createdAt: now, status: "pending" },
        ...records.filter(record => record.fingerprint !== fingerprint),
      ]);
      return attemptId;
    },
  };
}

/**
 * Attempts this browser started that are not known to be settled (no `paid`, no definitive terminal state).
 * Used to offer "retomar pedido" when the cart no longer matches the attempt fingerprint
 * (cart cleared/changed, or user opened the checkout on an empty cart).
 * Only the opaque `attemptId` is exposed; the backend `resume` stays the authority.
 */
export function listOpenStockAttempts(storage: StockAttemptStorage, now: number = Date.now()): Array<Pick<StockAttemptRecord, "attemptId" | "createdAt" | "status">> {
  return loadRecords(storage, now)
    .filter(record => OPEN_STATUSES.has(record.status))
    .map(({ attemptId, createdAt, status }) => ({ attemptId, createdAt, status }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Records the backend-reported status of a known attempt, addressed by ID (recovery path). */
export function updateStoredStockAttemptById(input: {
  storage: StockAttemptStorage;
  attemptId: string;
  status: StockAttemptRecord["status"];
  canStartNewAttempt?: boolean;
  now?: number;
}): boolean {
  const now = input.now ?? Date.now();
  const records = loadRecords(input.storage, now);
  const target = records.find(record => record.attemptId === input.attemptId);
  if (!target) return false;
  saveRecords(input.storage, records.map(record => record === target
    ? { ...record, status: input.status, canStartNewAttempt: input.canStartNewAttempt === true }
    : record));
  return true;
}
