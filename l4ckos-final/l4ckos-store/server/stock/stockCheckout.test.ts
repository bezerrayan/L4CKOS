import { describe, expect, it } from "vitest";
import {
  createStockCheckout as createStockCheckoutDomain,
  processSignedStockWebhook,
  StockCheckoutError,
  StockProviderError,
  type StockAttempt,
  type StockCheckoutStore,
  type StockCheckoutTransaction,
  type StockVariant,
} from "./stockCheckout";
import { resumeStockAttemptHttp } from "./stockCheckoutHttpContract";

const createStockCheckout = (input: Omit<Parameters<typeof createStockCheckoutDomain>[0], "ownerUserId">) =>
  createStockCheckoutDomain({ ...input, ownerUserId: 71 });

class MemoryStockStore implements StockCheckoutStore {
  variants = new Map<number, StockVariant>();
  attempts = new Map<string, StockAttempt>();
  reserved = new Map<number, number>();
  webhookEvents = new Map<string, string>();
  ioCount = 0;
  private transactionTail: Promise<void> = Promise.resolve();

  constructor(variants: StockVariant[]) {
    for (const variant of variants) this.variants.set(variant.id, variant);
  }

  async transaction<T>(work: (tx: StockCheckoutTransaction) => Promise<T>): Promise<T> {
    this.ioCount++;
    const previous = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    const before = {
      attempts: structuredClone(this.attempts),
      reserved: structuredClone(this.reserved),
      webhookEvents: structuredClone(this.webhookEvents),
    };
    const tx: StockCheckoutTransaction = {
      lockOwnerForCheckout: async () => {},
      findAttempt: async id => this.attempts.get(id) ?? null,
      findOpenAttemptsForOwner: async ownerUserId => [...this.attempts.values()].filter(attempt => attempt.ownerUserId === ownerUserId && attempt.status === "reserved"),
      findVariant: async id => this.variants.get(id) ?? null,
      isSkuUnique: async (sku, variantId) => ![...this.variants.values()].some(row => row.id !== variantId && row.sku.normalize("NFKC").trim().toLowerCase() === sku.normalize("NFKC").trim().toLowerCase()),
      reserveVariant: async (id, quantity) => {
        const variant = this.variants.get(id);
        const reserved = this.reserved.get(id) ?? 0;
        if (!variant || variant.availableUnits - reserved < quantity) return false;
        this.reserved.set(id, reserved + quantity);
        return true;
      },
      createAttempt: async attempt => { this.attempts.set(attempt.attemptId, structuredClone(attempt)); return attempt.orderId; },
      beginProviderAttempt: async attemptId => {
        const attempt = this.attempts.get(attemptId);
        if (!attempt || attempt.status !== "reserved") return false;
        if (attempt.providerState === "definitive_failure") return false;
        attempt.providerState = "creating";
        return true;
      },
      markProviderAmbiguous: async attemptId => { this.attempts.get(attemptId)!.providerState = "ambiguous"; },
      markProviderFailure: async attemptId => {
        const attempt = this.attempts.get(attemptId)!;
        if (attempt.status !== "reserved") return false;
        attempt.status = "released";
        attempt.providerState = "definitive_failure";
        return true;
      },
      markReconciliationRequired: async attemptId => { this.attempts.get(attemptId)!.reconciliationRequiredAt = new Date().toISOString(); },
      recordPayment: async (attemptId, paymentId, checkoutUrl) => {
        const attempt = this.attempts.get(attemptId)!;
        attempt.paymentId = paymentId;
        if (checkoutUrl) attempt.checkoutUrl = checkoutUrl;
        attempt.providerState = "created";
      },
      claimWebhook: async (eventId, payloadHash) => {
        const previous = this.webhookEvents.get(eventId);
        if (previous === payloadHash) return "duplicate";
        if (previous) return "conflict";
        this.webhookEvents.set(eventId, payloadHash);
        return "claimed";
      },
      findAttemptByPayment: async paymentId => [...this.attempts.values()].find(attempt => attempt.paymentId === paymentId) ?? null,
      findAttemptByOrder: async orderId => [...this.attempts.values()].find(attempt => attempt.orderId === orderId) ?? null,
      consumeReservations: async attemptId => {
        const attempt = this.attempts.get(attemptId)!;
        for (const item of attempt.snapshots) this.reserved.set(item.id, Math.max(0, (this.reserved.get(item.id) ?? 0) - item.quantity));
      },
      releaseReservations: async attemptId => {
        const attempt = this.attempts.get(attemptId)!;
        for (const item of attempt.snapshots) this.reserved.set(item.id, Math.max(0, (this.reserved.get(item.id) ?? 0) - item.quantity));
      },
      markPaid: async attemptId => {
        const attempt = this.attempts.get(attemptId)!;
        if (attempt.status === "paid") return "already-paid";
        if (attempt.status !== "reserved") return "not-pending";
        attempt.status = "paid";
        return "paid";
      },
      markReleased: async attemptId => {
        const attempt = this.attempts.get(attemptId)!;
        if (attempt.status === "released") return "already-released";
        if (attempt.status !== "reserved") return "not-pending";
        attempt.status = "released";
        return "released";
      },
      expireDueReservations: async () => ({ releasedAttemptIds: [], reconciliationAttemptIds: [] }),
    };
    try {
      return await work(tx);
    } catch (error) {
      this.attempts = before.attempts;
      this.reserved = before.reserved;
      this.webhookEvents = before.webhookEvents;
      throw error;
    } finally {
      release();
    }
  }

  async findAttemptForOwner(attemptId: string, ownerUserId: number) {
    this.ioCount++;
    const attempt = this.attempts.get(attemptId);
    if (!attempt || attempt.ownerUserId !== ownerUserId) return null;
    const now = Date.now();
    const reservationExpiresAt = attempt.reservationExpiresAt ?? new Date(now + 15 * 60_000).toISOString();
    return {
      attemptId: attempt.attemptId,
      orderId: attempt.orderId,
      status: attempt.status,
      providerState: attempt.providerState,
      paymentId: attempt.paymentId ?? null,
      checkoutUrl: attempt.checkoutUrl ?? null,
      amountCents: attempt.snapshots.reduce((sum, item) => sum + item.totalCents, 0),
      reservationExpiresAt,
      reservationExpired: new Date(reservationExpiresAt).getTime() <= now,
      reconciliationRequired: Boolean(attempt.reconciliationRequiredAt),
    };
  }
}

const variant = (overrides: Partial<StockVariant> = {}): StockVariant => ({
  id: 8, productId: 4, active: true, sku: "TSHIRT-BLK-M", size: "M", color: "Preto",
  unitPriceCents: 12900, availableUnits: 1, ...overrides,
});
const request = (attemptId: string, overrides: Record<string, unknown> = {}) => ({
  attemptId,
  items: [{ productId: 4, variantId: 8, size: "M", color: "Preto", quantity: 1 }],
  ...overrides,
});
const provider = (fn?: () => Promise<{ paymentId: string; checkoutUrl: string }>, expectedAmountCents = 12900) => ({
  calls: 0,
  supportsIdempotencyKey: true,
  async createPayment(input: { orderId: string; amountCents: number; idempotencyKey: string }) {
    this.calls++;
    expect(input.amountCents).toBe(expectedAmountCents);
    expect(input.idempotencyKey).toBe(`stock:${input.orderId}`);
    return fn ? fn() : { paymentId: "pay-1", checkoutUrl: "https://sandbox.example.test/pay/1" };
  },
});

function sendWebhook(input: {
  signatureVerified: boolean;
  store: StockCheckoutStore;
  eventId: string;
  orderId: string;
  paymentId: string;
  status: "pending" | "paid" | "failed";
  amountCents: number;
  payload: unknown;
}) {
  const { signatureVerified, store, ...event } = input;
  return processSignedStockWebhook({
    rawBody: JSON.stringify(event.payload),
    headers: {},
    store,
    boundary: {
      verifySignature: async () => signatureVerified,
      decodeSignedEvent: () => event,
    },
  });
}

describe("local STOCK checkout core", () => {
  it("fails closed before repository or provider IO", async () => {
    const store = new MemoryStockStore([variant()]);
    const payments = provider();
    await expect(createStockCheckout({ enabled: false, store, provider: payments, request: request("attempt-0000000001") }))
      .rejects.toMatchObject({ code: "PUBLIC_CHECKOUT_DISABLED" });
    expect(store.ioCount).toBe(0);
    expect(payments.calls).toBe(0);
  });

  it("requires a server-authenticated owner before any enabled checkout IO", async () => {
    const store = new MemoryStockStore([variant()]);
    const payments = provider();
    await expect(createStockCheckoutDomain({
      enabled: true,
      ownerUserId: 0,
      store,
      provider: payments,
      request: request("attempt-owner-required-001"),
    })).rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
    expect(store.ioCount).toBe(0);
    expect(payments.calls).toBe(0);
  });

  it("uses server price and snapshots the selected variant identity", async () => {
    const store = new MemoryStockStore([variant()]);
    const result = await createStockCheckout({ enabled: true, store, provider: provider(), request: request("attempt-price-00001") });
    expect(result.amountCents).toBe(12900);
    expect(result.snapshots[0]).toMatchObject({ id: 8, productId: 4, sku: "TSHIRT-BLK-M", size: "M", color: "Preto", unitPriceCents: 12900, quantity: 1, totalCents: 12900 });
  });

  it("accepts the V1 product/variant/quantity payload and snapshots dimensions from the server", async () => {
    const store = new MemoryStockStore([variant()]);
    const result = await createStockCheckout({
      enabled: true,
      store,
      provider: provider(),
      request: request("attempt-v1-shape-0001", { items: [{ productId: 4, variantId: 8, quantity: 1 }] }),
    });
    expect(result.snapshots[0]).toMatchObject({ id: 8, productId: 4, sku: "TSHIRT-BLK-M", size: "M", color: "Preto", unitPriceCents: 12900 });
  });

  it("uses the current server price and rejects stock that changed after the catalog was loaded", async () => {
    const priceStore = new MemoryStockStore([variant({ unitPriceCents: 17700 })]);
    const result = await createStockCheckout({
      enabled: true,
      store: priceStore,
      provider: provider(undefined, 17700),
      request: request("attempt-current-price-01", { items: [{ productId: 4, variantId: 8, quantity: 1 }] }),
    });
    expect(result.amountCents).toBe(17700);

    const depletedStore = new MemoryStockStore([variant({ availableUnits: 0 })]);
    await expect(createStockCheckout({
      enabled: true,
      store: depletedStore,
      provider: provider(),
      request: request("attempt-current-stock-001"),
    })).rejects.toMatchObject({ code: "CHECKOUT_STOCK_INSUFFICIENT" });
  });

  it("rejects order totals that cannot fit the legacy signed INT before creating an order or payment", async () => {
    const store = new MemoryStockStore([variant({ unitPriceCents: 21_700_000, availableUnits: 99 })]);
    const payments = provider();
    await expect(createStockCheckout({
      enabled: true,
      store,
      provider: payments,
      request: request("attempt-money-overflow-01", { items: [{ productId: 4, variantId: 8, quantity: 99 }] }),
    })).rejects.toMatchObject({ code: "CHECKOUT_MONEY_INVALID" });
    expect(store.attempts.size).toBe(0);
    expect(store.reserved.size).toBe(0);
    expect(payments.calls).toBe(0);
  });

  it.each([
    [variant({ productId: 99 }), "CHECKOUT_VARIANT_OWNERSHIP"],
    [variant({ active: false }), "CHECKOUT_VARIANT_INACTIVE"],
  ])("rejects a mismatched or inactive variant", async (row, code) => {
    await expect(createStockCheckout({ enabled: true, store: new MemoryStockStore([row]), provider: provider(), request: request("attempt-variant-0001") }))
      .rejects.toMatchObject({ code });
  });

  it("allows only one checkout to reserve the last unit concurrently", async () => {
    const store = new MemoryStockStore([variant()]);
    const outcomes = await Promise.allSettled([
      createStockCheckout({ enabled: true, store, provider: provider(), request: request("attempt-race-000001") }),
      createStockCheckout({ enabled: true, store, provider: provider(), request: request("attempt-race-000002") }),
    ]);
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === "rejected")).toHaveLength(1);
    expect(store.reserved.get(8)).toBe(1);
  });

  it("replays an identical attempt and rejects a changed replay", async () => {
    const store = new MemoryStockStore([variant()]);
    const payments = provider();
    const first = await createStockCheckout({ enabled: true, store, provider: payments, request: request("attempt-replay-0001") });
    const replay = await createStockCheckout({ enabled: true, store, provider: payments, request: request("attempt-replay-0001") });
    expect(replay.replayed).toBe(true);
    expect(replay.checkoutUrl).toBe(first.checkoutUrl);
    expect(payments.calls).toBe(1); // replay returns the persisted payment correlation
    await expect(createStockCheckout({ enabled: true, store, provider: payments, request: request("attempt-replay-0001", { items: [{ productId: 4, variantId: 8, size: "M", color: "Preto", quantity: 2 }] }) }))
      .rejects.toMatchObject({ code: "CHECKOUT_ATTEMPT_CHANGED" });
  });

  it("blocks equivalent open carts with different attemptIds under concurrent creates", async () => {
    const store = new MemoryStockStore([variant({ availableUnits: 5 })]);
    const payments = provider(undefined, 25800);
    const equivalentButReordered = request("attempt-dedupe-000002", {
      items: [
        { productId: 4, variantId: 8, size: "M", color: "Preto", quantity: 1 },
        { productId: 4, variantId: 8, size: "M", color: "Preto", quantity: 1 },
      ],
    });
    const outcomes = await Promise.allSettled([
      createStockCheckout({ enabled: true, store, provider: payments, request: request("attempt-dedupe-000001", { items: [{ productId: 4, variantId: 8, size: "M", color: "Preto", quantity: 2 }] }) }),
      createStockCheckout({ enabled: true, store, provider: payments, request: equivalentButReordered }),
    ]);
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === "rejected")).toHaveLength(1);
    expect(outcomes.find(outcome => outcome.status === "rejected")).toMatchObject({ reason: { code: "CHECKOUT_ATTEMPT_NOT_REUSABLE" } });
    expect(store.attempts.size).toBe(1);
    expect(store.reserved.get(8)).toBe(2);
    expect(payments.calls).toBe(1);
  });

  it("allows a new equivalent cart only after the earlier attempt is no longer open", async () => {
    const store = new MemoryStockStore([variant({ availableUnits: 3 })]);
    const payments = provider();
    await createStockCheckout({ enabled: true, store, provider: payments, request: request("attempt-next-buy-00001") });
    await store.transaction(tx => tx.markReleased("attempt-next-buy-00001"));
    await expect(createStockCheckout({ enabled: true, store, provider: payments, request: request("attempt-next-buy-00002") })).resolves.toMatchObject({ replayed: false });
    expect(payments.calls).toBe(2);
  });

  it("does not treat a paid purchase as an open attempt for a later legitimate purchase", async () => {
    const store = new MemoryStockStore([variant({ availableUnits: 3 })]);
    const payments = provider();
    const first = await createStockCheckout({ enabled: true, store, provider: payments, request: request("attempt-paid-prior-0001") });
    await store.transaction(tx => tx.markPaid("attempt-paid-prior-0001", first.paymentId));
    await expect(createStockCheckout({ enabled: true, store, provider: payments, request: request("attempt-paid-next-00001") })).resolves.toMatchObject({ replayed: false });
    expect(payments.calls).toBe(2);
  });

  it("does not reuse an open payment when the same cart changes delivery address", async () => {
    const store = new MemoryStockStore([variant({ availableUnits: 3 })]);
    const payments = provider();
    const delivery = (number: string) => ({
      optionId: "local-plano-piloto",
      address: {
        recipient: "Cliente de Teste", zipCode: "70000000", street: "Rua de Teste", number,
        neighborhood: "Centro", city: "Brasília", state: "DF",
      },
    });
    await createStockCheckout({
      enabled: true, store, provider: payments,
      request: request("attempt-address-first-001", { delivery: delivery("10") }),
    });
    await expect(createStockCheckout({
      enabled: true, store, provider: payments,
      request: request("attempt-address-next-001", { delivery: delivery("20") }),
    })).rejects.toMatchObject({ code: "CHECKOUT_ATTEMPT_NOT_REUSABLE" });
    expect(payments.calls).toBe(1);
    expect(store.attempts.size).toBe(1);
  });

  it("does not reveal or replay an attempt owned by another authenticated user", async () => {
    const store = new MemoryStockStore([variant()]);
    const payments = provider();
    await createStockCheckout({ enabled: true, store, provider: payments, request: request("attempt-owner-guard-001") });
    await expect(createStockCheckoutDomain({
      enabled: true,
      ownerUserId: 72,
      store,
      provider: payments,
      request: request("attempt-owner-guard-001"),
    })).rejects.toMatchObject({ code: "CHECKOUT_ATTEMPT_NOT_FOUND" });
    expect(payments.calls).toBe(1);
  });

  it("releases reservations idempotently on definitive provider failure", async () => {
    const store = new MemoryStockStore([variant()]);
    await expect(createStockCheckout({ enabled: true, store, provider: provider(async () => { throw new StockProviderError("declined before creation", true); }), request: request("attempt-release-0001") }))
      .rejects.toThrow("declined before creation");
    expect(store.reserved.get(8)).toBe(0);
    expect(store.attempts.get("attempt-release-0001")?.status).toBe("released");
  });

  it("retains inventory when provider outcome is ambiguous", async () => {
    const store = new MemoryStockStore([variant()]);
    await expect(createStockCheckout({ enabled: true, store, provider: provider(async () => { throw new Error("timeout"); }), request: request("attempt-unknown-0001") }))
      .rejects.toMatchObject({ code: "CHECKOUT_PROVIDER_OUTCOME_UNKNOWN" });
    expect(store.reserved.get(8)).toBe(1);
  });

  it("rejects invalid webhooks, deduplicates delivery and consumes once after payment", async () => {
    const store = new MemoryStockStore([variant()]);
    await createStockCheckout({ enabled: true, store, provider: provider(), request: request("attempt-webhook-0001") });
    const event = { signatureVerified: true, store, eventId: "evt-1", orderId: [...store.attempts.values()][0]?.orderId ?? "", paymentId: "pay-1", status: "paid" as const, amountCents: 12900, payload: { id: "evt-1" } };
    const ioBeforeInvalidSignature = store.ioCount;
    await expect(sendWebhook({ ...event, signatureVerified: false })).rejects.toBeInstanceOf(StockCheckoutError);
    expect(store.ioCount).toBe(ioBeforeInvalidSignature);
    await expect(sendWebhook({ ...event, amountCents: 12899 })).rejects.toMatchObject({ code: "WEBHOOK_AMOUNT_MISMATCH" });
    expect(await sendWebhook(event)).toBe("processed");
    expect(await sendWebhook(event)).toBe("duplicate");
    expect(store.attempts.get("attempt-webhook-0001")?.status).toBe("paid");
    expect(store.reserved.get(8)).toBe(0);
  });

  it("releases a failed payment and leaves subsequent failure replay harmless", async () => {
    const store = new MemoryStockStore([variant()]);
    await createStockCheckout({ enabled: true, store, provider: provider(), request: request("attempt-failed-00001") });
    const base = { signatureVerified: true, store, orderId: [...store.attempts.values()][0]?.orderId ?? "", paymentId: "pay-1", status: "failed" as const, amountCents: 12900 };
    expect(await sendWebhook({ ...base, eventId: "evt-fail-1", payload: 1 })).toBe("processed");
    expect(store.reserved.get(8)).toBe(0);
    expect(store.attempts.get("attempt-failed-00001")?.status).toBe("released");
  });
});
