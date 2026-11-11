import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { OrderCancelled } from "./OrderCancelled.jsx";

describe("OrderCancelled transactional email", () => {
  it("renders order data and recorded refund state without invented delivery dates or secrets", async () => {
    const html = renderToStaticMarkup(
      createElement(OrderCancelled, {
        customerName: "Cliente",
        orderNumber: "ST-123",
        total: "R$ 150,00",
        refundStatus: "pending",
        items: [{ name: "XIV Bis", quantity: 2, price: "R$ 75,00" }],
      })
    );
    expect(html).toContain("Pedido #ST-123 cancelado");
    expect(html).toContain("XIV Bis");
    expect(html).toContain("2");
    expect(html).toContain("estorno ainda está em processamento");
    expect(html).not.toMatch(/20\/11|código de acesso|secret/i);
  });

  it("does not claim a refund when no persisted refund status is supplied", async () => {
    const html = renderToStaticMarkup(
      createElement(OrderCancelled, { orderNumber: "ST-124" })
    );
    expect(html).toContain("consulte o atendimento");
    expect(html).not.toContain("estorno foi confirmado");
  });
});
