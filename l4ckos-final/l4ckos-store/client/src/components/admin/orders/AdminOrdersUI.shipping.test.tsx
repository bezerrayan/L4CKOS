// @vitest-environment jsdom
import "../../../test/setupDom";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OrderDetailPanel, type AdminOrderView } from "./AdminOrdersUI";

const base: AdminOrderView = { id: 7, userId: 1, status: "shipped", paymentStatus: "confirmed", totalPrice: 13962, trackingCode: "BR123456789BR", items: [], shippingAddress: null };
const props = { statusLabel: (s: string) => s, statusTone: () => ({}), addressLines: () => [] as string[] };

describe("OrderDetailPanel freight", () => {
  it("shows carrier, service, price, mode, parcel and tracking", () => {
    render(<OrderDetailPanel {...props} order={{ ...base, shippingSummary: { method: "carrier", carrier: "Correios", serviceName: "PAC", shippingPriceCents: 2062, package: { heightCm: 6, widthCm: 22, lengthCm: 32, weightGrams: 300 } } }} />);
    expect(screen.getByText("Correios · PAC")).toBeTruthy();
    expect(screen.getByText("Envio por transportadora")).toBeTruthy();
    expect(screen.getByText(/Frete cobrado:.*20,62/)).toBeTruthy();
    expect(screen.getByText(/32 × 22 × 6 cm · 300 g/)).toBeTruthy();
    expect(screen.getByText(/Rastreio: BR123456789BR/)).toBeTruthy();
  });

  it("says so plainly when no freight record exists (legacy order)", () => {
    render(<OrderDetailPanel {...props} order={{ ...base, shippingSummary: null }} />);
    expect(screen.getByText("Frete contratado não registrado para este pedido.")).toBeTruthy();
  });
});
