import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getAdminSalesReport: vi.fn(),
  getOrdersByFilters: vi.fn(),
  createAuditLog: vi.fn(),
}));

vi.mock("../db", async importOriginal => ({
  ...await importOriginal<typeof import("../db")>(),
  getAdminSalesReport: dbMocks.getAdminSalesReport,
  getOrdersByFilters: dbMocks.getOrdersByFilters,
  createAuditLog: dbMocks.createAuditLog,
}));

const adminUser = { id: 101, openId: "reports-admin", email: "admin@local.dev", role: "admin" };
const regularUser = { id: 102, openId: "reports-user", email: "reports-user@local.invalid", role: "user" };
const range = { from: "2026-10-20T00:00:00.000Z", to: "2026-10-21T23:59:59.999Z" };
const report = {
  ...range,
  timeZone: "UTC" as const,
  ordersCount: 1,
  ordersTotalCents: 8990,
  confirmedPaymentsCount: 0,
  confirmedPaymentsCents: 0,
  statuses: [{ status: "pending", count: 1, totalCents: 8990 }],
  daily: [{ day: "2026-10-21", ordersCount: 1, totalCents: 8990 }],
  orders: [{ id: 15, createdAt: "2026-10-21T12:00:00.000Z", status: "pending", paymentStatus: "unconfirmed", totalPriceCents: 8990 }],
};

async function caller(user: typeof adminUser | typeof regularUser | null) {
  const { adminRouter } = await import("./admin");
  return adminRouter.createCaller({ user, req: {} as any, res: {} as any } as any);
}

describe("admin reports contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getAdminSalesReport.mockResolvedValue(report);
    dbMocks.getOrdersByFilters.mockResolvedValue([{
      id: 15, createdAt: new Date("2026-10-21T12:00:00.000Z"), status: "pending", totalPrice: 8990,
      customerName: "=HYPERLINK(\"https://example.invalid\")", customerEmail: "customer@example.invalid",
      trackingCode: null, items: [{ productName: "Item de teste", productId: 1, quantity: 1 }],
    }]);
    dbMocks.createAuditLog.mockResolvedValue(undefined);
  });

  it("protects report summary and rejects reversed intervals before querying", async () => {
    await expect((await caller(adminUser)).reportsSummary(range)).resolves.toEqual(report);
    await expect((await caller(regularUser)).reportsSummary(range)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect((await caller(adminUser)).reportsSummary({ ...range, from: "2026-10-22T00:00:00.000Z" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(dbMocks.getAdminSalesReport).toHaveBeenCalledTimes(1);
  });

  it("accepts a one-day inclusive interval and rejects oversized exports", async () => {
    const oneDay = { from: "2026-10-21T00:00:00.000Z", to: "2026-10-21T23:59:59.999Z" };
    await expect((await caller(adminUser)).reportsSummary(oneDay)).resolves.toEqual(report);
    const { SalesReportTooLargeError } = await import("../db");
    dbMocks.getAdminSalesReport.mockRejectedValue(new SalesReportTooLargeError());
    await expect((await caller(adminUser)).reportsSalesPdf(range)).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });

  it("preserves CSV columns and values while neutralizing formula-leading user text and auditing the export", async () => {
    const result = await (await caller(adminUser)).reportsSalesCsv(range);
    expect(result.csv).toContain("customerName,customerEmail,trackingCode,itemCount,items");
    expect(result.csv).toContain("'=HYPERLINK(");
    expect(result.csv).toContain("customer@example.invalid");
    expect(result.csv).toContain("totalSalesCents");
    expect(dbMocks.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: adminUser.id,
      action: "report.export.csv",
      entity: "report",
      metadata: { from: range.from, to: range.to, rows: 1 },
    }));
    await expect((await caller(regularUser)).reportsSalesCsv(range)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("generates authorized PDF bytes from server data without including customer PII", async () => {
    const result = await (await caller(adminUser)).reportsSalesPdf(range);
    const pdf = Buffer.from(result.pdfBase64, "base64").toString("ascii");
    expect(result.fileName).toContain("2026-10-20-2026-10-21");
    expect(pdf).toContain("%PDF-1.4");
    expect(pdf).not.toContain("customer@example.invalid");
    expect(pdf).not.toContain(Buffer.from("customer@example.invalid").toString("hex").toUpperCase());
    expect(pdf).not.toContain(Buffer.from("=HYPERLINK").toString("hex").toUpperCase());
    expect(dbMocks.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "report.export.pdf", actorUserId: adminUser.id }));
    await expect((await caller(regularUser)).reportsSalesPdf(range)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
