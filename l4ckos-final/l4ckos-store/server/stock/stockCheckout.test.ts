import { describe, expect, it, vi } from "vitest";
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
  productNames = new Map<number, string>();
  attempts = new Map<string, StockAttempt>();
  divergences = new Map<string, unknown>();
  reserved = new Map<number, number>();
  quotaCalls = 0;
  expiryCalls = 0;
  purchaseCatalogLockModes: boolean[] = [];
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
      reserveExclusiveQuota: async () => { this.quotaCalls++; },
      getProductPurchaseCatalog: async (productIds, lock) => {
        this.purchaseCatalogLockModes.push(lock);
        return productIds.map(productId => ({
          productId,
          name: this.productNames.get(productId) ?? "Synthetic STOCK product",
          skus: [...this.variants.values()].filter(row => row.productId === productId).map(row => row.sku),
        }));
      },
      findAttempt: async id => this.attempts.get(id) ?? null,
      findAttemptByPaymentReference: async reference =>
        [...this.attempts.values()].find(attempt =>
          reference === `L4CKOS-STOCK-ATTEMPT:v1:${"A".repeat(32)}`
        ) ?? null,
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
      markTerminalFailure: async (attemptId, paymentId) => {
        const attempt = this.attempts.get(attemptId)!;
        if (attempt.status === "released") return attempt.providerState === "definitive_failure" && attempt.paymentId === paymentId ? "already-released" : "not-pending";
        if (attempt.status !== "reserved" || attempt.providerState !== "created" || attempt.paymentId !== paymentId) return "not-pending";
        attempt.status = "released";
        attempt.providerState = "definitive_failure";
        return "released";
      },
      recordFinancialDivergence: async divergence => {
        const key = `${divergence.kind}:${divergence.attemptId}:${divergence.paymentId}`;
        if (this.divergences.has(key)) return "duplicate";
        this.divergences.set(key, divergence);
        return "recorded";
      },
      expireDueReservations: async () => {
        this.expiryCalls++;
        return { releasedAttemptIds: [], reconciliationAttemptIds: [] };
      },
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
const provider = (fn?: () => Promise<{ paymentId: string; checkoutUrl: string | null }>, expectedAmountCents = 12900) => ({
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
  strongReference?: string;
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
  it("keeps ordinary products purchasable through the V1 STOCK domain", async () => {
    const store = new MemoryStockStore([variant()]);
    const payments = provider();
    await expect(createStockCheckout({ enabled: true, store, provider: payments, request: request("attempt-policy-common-001") }))
      .resolves.toMatchObject({ replayed: false });
    expect(store.attempts.size).toBe(1);
    expect(payments.calls).toBe(1);
    expect(store.purchaseCatalogLockModes).toEqual([false, true]);
  });

  it("rejects hosted card for PREORDER at the server boundary before provider creation", async () => {
    const store = new MemoryStockStore([variant({ salesMode: "PREORDER", productionBatchId: 91 })]);
    const payments = provider();
    await expect(createStockCheckout({ enabled: true, cardCheckoutEnabled: true, store, provider: payments, request: request("attempt-card-preorder-0001", { paymentMethod: "CARD" }) }))
      .rejects.toMatchObject({ code: "CHECKOUT_PAYMENT_METHOD_UNSUPPORTED" });
    expect(store.attempts.size).toBe(0);
    expect(store.reserved.size).toBe(0);
    expect(payments.calls).toBe(0);
  });

  it("uses the existing reservation transitions for hosted card confirmation and terminal refusal", async () => {
    const store = new MemoryStockStore([variant()]);
    const createPayment = vi.fn(async (input: { orderId: string; amountCents: number; paymentMethod?: "PIX" | "CARD" }) => {
      expect(input.paymentMethod).toBe("CARD");
      return { paymentId: "pay-card-sandbox-fixture", checkoutUrl: "https://sandbox.asaas.com/i/fixture" };
    });
    const paymentProvider = { supportsIdempotencyKey: true, createPayment };
    const created = await createStockCheckout({
      enabled: true, cardCheckoutEnabled: true, store, provider: paymentProvider,
      request: request("attempt-card-settlement-0001", { paymentMethod: "CARD" }),
    });
    expect(store.reserved.get(8)).toBe(1);
    await sendWebhook({ signatureVerified: true, store, eventId: "evt-card-confirmed-synthetic", orderId: created.orderId,
      paymentId: created.paymentId, status: "paid", amountCents: created.amountCents, payload: { event: "PAYMENT_CONFIRMED" } });
    expect(store.attempts.get("attempt-card-settlement-0001")?.status).toBe("paid");
    expect(store.reserved.get(8)).toBe(0);

    const refusedStore = new MemoryStockStore([variant()]);
    const refused = await createStockCheckout({ enabled: true, cardCheckoutEnabled: true, store: refusedStore, provider: paymentProvider,
      request: request("attempt-card-refused-00001", { paymentMethod: "CARD" }) });
    await sendWebhook({ signatureVerified: true, store: refusedStore, eventId: "evt-card-refused-synthetic", orderId: refused.orderId,
      paymentId: refused.paymentId, status: "failed", amountCents: refused.amountCents, payload: { event: "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED" } });
    expect(refusedStore.attempts.get("attempt-card-refused-00001")?.status).toBe("released");
    expect(refusedStore.reserved.get(8)).toBe(0);
  });

  describe("independent card checkout switch (STOCK_CARD_CHECKOUT_ENABLED)", () => {
    const cardRequest = (id: string) => request(id, { paymentMethod: "CARD" });

    it.each([undefined, false] as const)("keeps NEW hosted-card purchases closed when the switch is %s, before any reservation or provider call", async flag => {
      const store = new MemoryStockStore([variant()]);
      const payments = provider();
      await expect(createStockCheckout({ enabled: true, ...(flag === undefined ? {} : { cardCheckoutEnabled: flag }), store, provider: payments, request: cardRequest("attempt-card-disabled-0001") }))
        .rejects.toMatchObject({ code: "CHECKOUT_CARD_DISABLED" });
      expect(store.attempts.size).toBe(0);
      expect(store.reserved.size).toBe(0);
      expect(payments.calls).toBe(0);
    });

    it("never interrupts PIX, whether the card switch is off or on", async () => {
      for (const flag of [undefined, false, true]) {
        const store = new MemoryStockStore([variant()]);
        const payments = provider();
        await expect(createStockCheckout({ enabled: true, ...(flag === undefined ? {} : { cardCheckoutEnabled: flag }), store, provider: payments, request: request(`attempt-pix-flag-${String(flag)}-01`) }))
          .resolves.toMatchObject({ replayed: false });
        expect(payments.calls).toBe(1);
      }
    });

    it("cannot open a closed public checkout: the card switch only narrows the gate", async () => {
      const store = new MemoryStockStore([variant()]);
      const payments = provider();
      await expect(createStockCheckout({ enabled: false, cardCheckoutEnabled: true, store, provider: payments, request: cardRequest("attempt-card-closed-gate-01") }))
        .rejects.toMatchObject({ code: "PUBLIC_CHECKOUT_DISABLED" });
      expect(store.attempts.size).toBe(0);
      expect(payments.calls).toBe(0);
    });

    it("keeps a card attempt that already started working after the switch is turned off: replay, webhook settlement and refusal", async () => {
      const store = new MemoryStockStore([variant()]);
      const payments = provider();
      const first = await createStockCheckout({ enabled: true, cardCheckoutEnabled: true, store, provider: payments, request: cardRequest("attempt-card-switched-off-01") });
      expect(store.reserved.get(8)).toBe(1);

      const replay = await createStockCheckout({ enabled: true, cardCheckoutEnabled: false, store, provider: payments, request: cardRequest("attempt-card-switched-off-01") });
      expect(replay).toMatchObject({ replayed: true, orderId: first.orderId, paymentId: first.paymentId });
      expect(payments.calls).toBe(1);

      // A different NEW card attempt is closed...
      await expect(createStockCheckout({ enabled: true, cardCheckoutEnabled: false, store, provider: payments, request: { ...cardRequest("attempt-card-switched-off-02") } }))
        .rejects.toMatchObject({ code: "CHECKOUT_CARD_DISABLED" });

      // ...while webhooks for the attempt that already started are independent of the switch.
      await sendWebhook({ signatureVerified: true, store, eventId: "evt-card-switched-off-paid", orderId: first.orderId,
        paymentId: first.paymentId, status: "paid", amountCents: first.amountCents, payload: { event: "PAYMENT_CONFIRMED" } });
      expect(store.attempts.get("attempt-card-switched-off-01")?.status).toBe("paid");
      expect(store.reserved.get(8)).toBe(0);
    });
  });

  it.each([
    ["restricted product name", "Clã 14 Bis", [variant()]],
    ["QA-STAGING product with a normal SKU", "[QA-STAGING] Fixture", [variant()]],
    ["QA-STAGING product with a malformed QA SKU", "[QA-STAGING] Fixture", [variant({ sku: "not-a-valid-qa-sku" })]],
    ["selected 14B SKU", "Synthetic STOCK product", [variant({ sku: "14B-DROP-PT-M" })]],
    ["mixed SKUs with common selected", "Synthetic STOCK product", [variant(), variant({ id: 9, sku: "14B-DROP-BR-G", size: "G", active: true })]],
    ["inactive 14B SKU with common selected", "Synthetic STOCK product", [variant(), variant({ id: 9, sku: "14B-DROP-BR-G", size: "G", active: false })]],
  ] as const)("blocks V1 STOCK checkout for %s before attempt, reservation, or provider effects", async (_scenario, name, variants) => {
    const store = new MemoryStockStore([...variants]);
    store.productNames.set(4, name);
    const payments = provider();

    await expect(createStockCheckout({ enabled: true, store, provider: payments, request: request(`attempt-policy-${String(_scenario).replaceAll(" ", "-")}-001`) }))
      .rejects.toMatchObject({ code: "CHECKOUT_PRODUCT_REQUIRES_AUTHORIZATION" });
    expect(store.attempts.size).toBe(0);
    expect(store.reserved.size).toBe(0);
    expect(store.expiryCalls).toBe(0);
    expect(store.quotaCalls).toBe(0);
    expect(payments.calls).toBe(0);
  });

  it("does not replay an existing V1 payment after current catalog becomes restricted", async () => {
    const store = new MemoryStockStore([variant()]);
    const payments = provider();
    const requestBody = request("attempt-policy-replay-001");
    await createStockCheckout({ enabled: true, store, provider: payments, request: requestBody });
    store.variants.set(9, variant({ id: 9, sku: "14B-DROP-BR-G", size: "G", active: false }));

    await expect(createStockCheckout({ enabled: true, store, provider: payments, request: requestBody }))
      .rejects.toMatchObject({ code: "CHECKOUT_PRODUCT_REQUIRES_AUTHORIZATION" });
    expect(payments.calls).toBe(1);
    expect(store.purchaseCatalogLockModes.at(-1)).toBe(true);
  });

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
    expect(store.expiryCalls).toBe(1);
  });

  it("enforces the owner test amount ceiling before order, reservation, or provider writes", async () => {
    const store = new MemoryStockStore([variant({ unitPriceCents: 26000 })]);
    const payments = provider(undefined, 26000);
    await expect(createStockCheckout({
      enabled: true,
      ownerUserId: 71,
      store,
      provider: payments,
      maximumAmountCents: 25000,
      request: request("owner-pix-amount-limit-0001"),
    })).rejects.toMatchObject({ code: "OWNER_PIX_TEST_AMOUNT_LIMIT" });
    expect(store.attempts.size).toBe(0);
    expect(store.reserved.size).toBe(0);
    expect(store.expiryCalls).toBe(0);
    expect(store.quotaCalls).toBe(0);
    expect(payments.calls).toBe(0);
  });

  it("replays one owner attempt idempotently and rejects changed cart data", async () => {
    const store = new MemoryStockStore([variant()]);
    const payments = provider();
    const ownerAttemptId = "owner-pix-single-attempt-20261119-001";
    const authorized = { enabled: true, ownerUserId: 71, store, provider: payments, maximumAmountCents: 25000 };
    const first = await createStockCheckout({ ...authorized, request: request(ownerAttemptId) });
    expect(store.expiryCalls).toBe(0);
    const replay = await createStockCheckout({ ...authorized, request: request(ownerAttemptId) });
    expect(replay.replayed).toBe(true);
    expect(replay.paymentId).toBe(first.paymentId);
    expect(payments.calls).toBe(1);
    await expect(createStockCheckout({
      ...authorized,
      request: request(ownerAttemptId, { items: [{ productId: 4, variantId: 8, size: "M", color: "Preto", quantity: 2 }] }),
    })).rejects.toMatchObject({ code: "CHECKOUT_ATTEMPT_CHANGED" });
    expect(payments.calls).toBe(1);
    expect(store.attempts.size).toBe(1);
  });

  it("returns inline PIX on create and re-reads it by the stored payment id on replay without a second charge", async () => {
    const store = new MemoryStockStore([variant()]);
    const pix = { qrCodeBase64: "iVBORw0KGgo=", copyPaste: "00020126580014br.gov.bcb.pix0136synthetic" };
    const payments = {
      ...provider(async () => ({ paymentId: "pay-pix-1", checkoutUrl: "https://sandbox.example.test/pay/1", pix })),
      getPixPayment: vi.fn(async () => pix),
    };
    const authorized = { enabled: true, ownerUserId: 71, store, provider: payments, maximumAmountCents: 25000 };
    const first = await createStockCheckout({ ...authorized, request: request("attempt-pix-inline-0000001") });
    expect(first.pix).toEqual(pix);
    expect(payments.getPixPayment).not.toHaveBeenCalled();
    // Unknown reservation TTL: fail closed (no lookup, no PIX).
    const unknownTtl = await createStockCheckout({ ...authorized, request: request("attempt-pix-inline-0000001") });
    expect(unknownTtl).toMatchObject({ replayed: true, paymentId: "pay-pix-1" });
    expect(unknownTtl).not.toHaveProperty("pix");
    expect(payments.getPixPayment).not.toHaveBeenCalled();
    // Expired reservation: no PIX even though the worker has not released it yet.
    store.attempts.get("attempt-pix-inline-0000001")!.reservationExpiresAt = new Date(Date.now() - 1000).toISOString();
    expect(await createStockCheckout({ ...authorized, request: request("attempt-pix-inline-0000001") })).not.toHaveProperty("pix");
    expect(payments.getPixPayment).not.toHaveBeenCalled();
    // Valid reservation: re-read by the stored payment id only.
    store.attempts.get("attempt-pix-inline-0000001")!.reservationExpiresAt = new Date(Date.now() + 600_000).toISOString();
    const replay = await createStockCheckout({ ...authorized, request: request("attempt-pix-inline-0000001") });
    expect(replay).toMatchObject({ replayed: true, paymentId: "pay-pix-1", pix });
    expect(payments.getPixPayment).toHaveBeenCalledTimes(1);
    expect(payments.getPixPayment).toHaveBeenCalledWith("pay-pix-1");
    expect(payments.calls).toBe(1);
  });

  it("replays without pix (and without a new charge) when the PIX lookup fails", async () => {
    const store = new MemoryStockStore([variant()]);
    const payments = { ...provider(), getPixPayment: vi.fn(async () => { throw new Error("asaas unavailable"); }) };
    const authorized = { enabled: true, ownerUserId: 71, store, provider: payments, maximumAmountCents: 25000 };
    await createStockCheckout({ ...authorized, request: request("attempt-pix-inline-0000002") });
    store.attempts.get("attempt-pix-inline-0000002")!.reservationExpiresAt = new Date(Date.now() + 600_000).toISOString();
    const replay = await createStockCheckout({ ...authorized, request: request("attempt-pix-inline-0000002") });
    expect(replay).toMatchObject({ replayed: true, paymentId: "pay-1" });
    expect(replay).not.toHaveProperty("pix");
    expect(payments.getPixPayment).toHaveBeenCalledTimes(1);
    expect(payments.calls).toBe(1);
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
    const previous = await createStockCheckout({ enabled: true, store, provider: payments, request: request("attempt-next-buy-00001") });
    await store.transaction(tx => tx.markTerminalFailure("attempt-next-buy-00001", previous.paymentId));
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

  it("retains inventory and never repeats an ambiguous create without provider idempotency", async () => {
    const store = new MemoryStockStore([variant()]);
    const payments = provider(async () => { throw new Error("timeout"); });
    payments.supportsIdempotencyKey = false;
    await expect(createStockCheckout({ enabled: true, store, provider: payments, request: request("attempt-unknown-0001") }))
      .rejects.toMatchObject({ code: "CHECKOUT_PROVIDER_OUTCOME_UNKNOWN" });
    await expect(createStockCheckout({ enabled: true, store, provider: payments, request: request("attempt-unknown-0001") }))
      .rejects.toMatchObject({ code: "CHECKOUT_PROVIDER_RECONCILIATION_REQUIRED" });
    expect(store.reserved.get(8)).toBe(1);
    expect(payments.calls).toBe(1);
  });

  it("persists a returned payment ID without a checkout URL and replays it without another charge", async () => {
    const store = new MemoryStockStore([variant()]);
    const payments = provider(async () => ({ paymentId: "pay-qr-unavailable", checkoutUrl: null }));
    payments.supportsIdempotencyKey = false;
    const requestBody = request("attempt-payment-id-retained-001");

    await expect(createStockCheckout({ enabled: true, store, provider: payments, request: requestBody }))
      .resolves.toMatchObject({ paymentId: "pay-qr-unavailable", checkoutUrl: null, replayed: false });
    expect(store.attempts.get("attempt-payment-id-retained-001")?.paymentId).toBe("pay-qr-unavailable");
    await expect(createStockCheckout({ enabled: true, store, provider: payments, request: requestBody }))
      .resolves.toMatchObject({ paymentId: "pay-qr-unavailable", checkoutUrl: null, replayed: true });
    expect(payments.calls).toBe(1);
  });

  it("rejects invalid webhooks, deduplicates delivery and consumes once after payment", async () => {
    const store = new MemoryStockStore([variant()]);
    await createStockCheckout({ enabled: true, store, provider: provider(), request: request("attempt-webhook-0001") });
    const event = { signatureVerified: true, store, eventId: "evt-1", orderId: [...store.attempts.values()][0]?.orderId ?? "", paymentId: "pay-1", status: "paid" as const, amountCents: 12900, payload: { id: "evt-1" } };
    const ioBeforeInvalidSignature = store.ioCount;
    await expect(sendWebhook({ ...event, signatureVerified: false })).rejects.toBeInstanceOf(StockCheckoutError);
    expect(store.ioCount).toBe(ioBeforeInvalidSignature);
    expect(await sendWebhook({ ...event, eventId: "evt-bad-amount", payload: { id: "evt-bad-amount" }, amountCents: 12899 })).toBe("conflict");
    expect([...store.divergences.values()]).toContainEqual(expect.objectContaining({ kind: "PAID_AMOUNT_MISMATCH", observedAmountCents: 12899 }));
    expect(store.attempts.get("attempt-webhook-0001")?.status).toBe("reserved");
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

  it("rejects a late payment for a released ambiguous attempt without consuming inventory", async () => {
    const store = new MemoryStockStore([variant()]);
    const payments = provider(async () => { throw new Error("timeout"); });
    payments.supportsIdempotencyKey = false;
    await expect(createStockCheckout({ enabled: true, store, provider: payments, request: request("attempt-owner-pix-close-late-001") }))
      .rejects.toMatchObject({ code: "CHECKOUT_PROVIDER_OUTCOME_UNKNOWN" });

    const attempt = store.attempts.get("attempt-owner-pix-close-late-001")!;
    attempt.status = "released";
    attempt.providerState = "ambiguous";
    attempt.paymentId = null;
    store.reserved.set(8, 0); // Mirrors the one-time supervised release under test.
    const before = { status: attempt.status, providerState: attempt.providerState, paymentId: attempt.paymentId, reserved: store.reserved.get(8) };
    const strongReference = `L4CKOS-STOCK-ATTEMPT:v1:${"A".repeat(32)}`;

    await expect(sendWebhook({
      signatureVerified: true, store, eventId: "evt-owner-pix-late-synthetic", orderId: strongReference,
      paymentId: "pay-late-synthetic", status: "paid", amountCents: 12900, payload: { id: "evt-owner-pix-late-synthetic" },
      strongReference,
    })).resolves.toBe("conflict");
    expect({ status: attempt.status, providerState: attempt.providerState, paymentId: attempt.paymentId, reserved: store.reserved.get(8) }).toEqual(before);
    expect([...store.divergences.values()]).toContainEqual(expect.objectContaining({ kind: "PAYMENT_WITHOUT_CORRELATION" }));
  });
});
