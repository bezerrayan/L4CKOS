import { describe, expect, it } from "vitest";
import { buildManagerSyncSnapshot, isManagerSyncPeriodClosed, parseManagerSyncMonthPeriod, saoPauloMidnightUtc } from "./managerSyncSnapshot";

const identity = {
  system: "l4ckos-store" as const,
  environment: "staging" as const,
  projectId: "2bb90c8e-eb65-43ee-826b-f93750f0499c",
  environmentId: "15545eee-bc02-4b70-afc4-19a5db9e6f46",
  serviceId: "9f1c7705-f2f9-48cf-b957-8f63a6bba4db",
};

const order = {
  id: 1001,
  userId: 55,
  createdAt: "2026-10-02T12:00:00.000Z",
  updatedAt: "2026-10-03T12:00:00.000Z",
  totalPriceCents: 9_000,
  paymentStatus: "confirmed" as const,
  paymentConfirmationSource: "asaas_webhook" as const,
  paymentConfirmedAt: "2026-10-03T12:00:00.000Z",
  logisticsStatus: "delivered",
  items: [{ productId: 9, variantId: 17, productName: "Camiseta histórica", variantName: "Preto / M", sku: "QA-001", color: "Preto", size: "M", quantity: 1, unitPriceCents: 10_000, lineTotalCents: 10_000 }],
};

describe("Manager sync V2 snapshot", () => {
  it("builds an identifiable staging snapshot without customer or gateway PII", () => {
    const payload = buildManagerSyncSnapshot({ identity, periodStart: "2026-10-01", periodEndExclusive: "2026-11-01", generatedAt: new Date("2026-11-01T00:00:00Z"), newCustomers: 1, customersWithOrders: 1, orders: [order] });
    expect(payload.schemaVersion).toBe(2);
    expect(payload.snapshot.complete).toBe(true);
    expect(payload.snapshot.timezone).toBe("America/Sao_Paulo");
    expect(payload.orders[0]?.customerReference).toBeNull();
    expect(payload.orders[0]?.paymentConfirmationReference).toBeNull();
    expect(JSON.stringify(payload)).not.toContain("email");
    expect(JSON.stringify(payload)).not.toContain("userId");
  });

  it("uses one canonical content revision and keeps historical line amounts even with order discounts", () => {
    const first = buildManagerSyncSnapshot({ identity, periodStart: "2026-10-01", periodEndExclusive: "2026-11-01", generatedAt: new Date("2026-11-01T00:00:00Z"), newCustomers: 1, customersWithOrders: 1, orders: [order] });
    const second = buildManagerSyncSnapshot({ identity, periodStart: "2026-10-01", periodEndExclusive: "2026-11-01", generatedAt: new Date("2026-11-02T00:00:00Z"), newCustomers: 1, customersWithOrders: 1, orders: [order] });
    expect(first.snapshot.revision).toEqual(second.snapshot.revision);
    expect(first.snapshot.id).toEqual(second.snapshot.id);
    expect(first.orders[0]?.items[0]?.lineTotalCents).toBe(10_000);
  });

  it("fails closed on absent historical item fields and invalid periods", () => {
    expect(() => buildManagerSyncSnapshot({ identity, periodStart: "2026-10-01", periodEndExclusive: "2026-11-01", generatedAt: new Date(), newCustomers: 0, customersWithOrders: 0, orders: [{ ...order, items: [{ ...order.items[0]!, productName: null }] }] })).toThrow("MANAGER_SYNC_ITEM_SNAPSHOT_INCOMPLETE");
    expect(() => saoPauloMidnightUtc("2026-02-30")).toThrow("MANAGER_SYNC_INVALID_PERIOD");
  });

  it("converts month boundaries by America/Sao_Paulo calendar", () => {
    expect(saoPauloMidnightUtc("2026-10-01").toISOString()).toBe("2026-10-01T03:00:00.000Z");
    expect(saoPauloMidnightUtc("2026-11-01").toISOString()).toBe("2026-11-01T03:00:00.000Z");
    expect(saoPauloMidnightUtc("2018-11-01").toISOString()).toBe("2018-11-01T03:00:00.000Z");
  });

  it("accepts only complete monthly half-open periods", () => {
    expect(parseManagerSyncMonthPeriod("2024-02-01", "2024-03-01")).toEqual({ start: "2024-02-01", endExclusive: "2024-03-01" });
    expect(parseManagerSyncMonthPeriod("2026-10-01", "2026-10-31")).toBeNull();
    expect(parseManagerSyncMonthPeriod("2026-13-01", "2027-01-01")).toBeNull();
  });

  it("allows only competencies closed in the Sao Paulo calendar", () => {
    const now = new Date("2026-10-25T15:00:00.000Z");
    expect(isManagerSyncPeriodClosed("2026-09-01", now)).toBe(true);
    expect(isManagerSyncPeriodClosed("2026-10-01", now)).toBe(false);
    expect(isManagerSyncPeriodClosed("2026-11-01", now)).toBe(false);
  });
});
