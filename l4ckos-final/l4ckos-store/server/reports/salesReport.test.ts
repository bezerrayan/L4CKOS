import { describe, expect, it } from "vitest";
import { aggregateSalesReport, renderSalesReportPdf } from "./salesReport";

describe("sales report aggregation and PDF", () => {
  const from = new Date("2026-10-20T00:00:00.000Z");
  const to = new Date("2026-10-21T23:59:59.999Z");

  it("separates all-state order totals from confirmed payment status and groups creation dates in UTC", () => {
    const report = aggregateSalesReport([
      { id: 1, createdAt: "2026-10-20T23:59:59.000Z", status: "pending", paymentStatus: "unconfirmed", totalPrice: 8990 },
      { id: 2, createdAt: "2026-10-21T00:00:00.000Z", status: "cancelled", paymentStatus: "confirmed", totalPrice: 1000 },
      { id: 3, createdAt: "2026-10-21T12:00:00.000Z", status: "paid", paymentStatus: "confirmed", totalPrice: 15990 },
    ], from, to, [
      { orderId: 1, productId: 4, productName: "Camiseta teste", quantity: 2 },
      { orderId: 2, productId: 4, productName: "Camiseta teste", quantity: 1 },
      { orderId: 3, productId: 5, productName: null, quantity: 3 },
    ]);

    expect(report.timeZone).toBe("UTC");
    expect(report.ordersCount).toBe(3);
    expect(report.ordersTotalCents).toBe(25980);
    expect(report.confirmedPaymentsCount).toBe(2);
    expect(report.confirmedPaymentsCents).toBe(16990);
    expect(report.statuses).toEqual([
      { status: "pending", count: 1, totalCents: 8990 },
      { status: "processing", count: 0, totalCents: 0 },
      { status: "paid", count: 1, totalCents: 15990 },
      { status: "shipped", count: 0, totalCents: 0 },
      { status: "delivered", count: 0, totalCents: 0 },
      { status: "cancelled", count: 1, totalCents: 1000 },
    ]);
    expect(report.daily).toEqual([
      { day: "2026-10-20", ordersCount: 1, totalCents: 8990 },
      { day: "2026-10-21", ordersCount: 2, totalCents: 16990 },
    ]);
    expect(report.products).toEqual([
      { productId: 4, productName: "Camiseta teste", unitsInOrders: 3, unitsInCancelledOrders: 1 },
      { productId: 5, productName: "Produto #5", unitsInOrders: 3, unitsInCancelledOrders: 0 },
    ]);
  });

  it("keeps zero-value/empty periods valid and generates an A4 PDF without customer fields", () => {
    const report = aggregateSalesReport([], from, to);
    expect(report.ordersCount).toBe(0);
    expect(report.ordersTotalCents).toBe(0);
    const pdf = renderSalesReportPdf(report, new Date("2026-10-22T12:00:00.000Z"));
    expect(pdf.subarray(0, 8).toString("ascii")).toBe("%PDF-1.4");
    expect(pdf.toString("ascii")).toContain("/MediaBox [0 0 595 842]");
    expect(pdf.toString("ascii")).toContain("%%EOF");
  });

  it("splits long reports across valid A4 pages with page numbering", () => {
    const rows = Array.from({ length: 120 }, (_, index) => ({
      id: index + 1,
      createdAt: new Date(Date.UTC(2026, 9, 1 + (index % 20), 12)).toISOString(),
      status: index % 2 ? "paid" : "pending",
      paymentStatus: index % 2 ? "confirmed" : "unconfirmed",
      totalPrice: 8990 + index,
    }));
    const report = aggregateSalesReport(rows, from, to);
    const pdf = renderSalesReportPdf(report, new Date("2026-10-22T12:00:00.000Z")).toString("ascii");
    expect(pdf.match(/\/Type \/Page\b/g)?.length).toBeGreaterThan(1);
    expect(pdf).toContain(Buffer.from("PAGINA 0001 DE", "ascii").toString("hex").toUpperCase());
  });
});
