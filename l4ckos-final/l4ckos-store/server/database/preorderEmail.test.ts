import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderEmailTemplate } from "../services/email/emailRenderer.js";
import { shippingEstimate, purchasedSalesMode, MIXED_SHIPPING_NOTICE } from "../../shared/preorder";
describe("preorder order confirmation rendering (no provider)", () => {
  it("shows historical batch/estimate, full payment and mixed shipping even past the four-item summary", () => {
    const items = Array.from({ length: 4 }, (_, i) => ({
      name: `STOCK ${i}`,
      quantity: 1,
      price: "R$ 1,00",
    }));
    items.push({
      name: `Produto histórico — Pré-venda — DROP <script>. ${shippingEstimate("2026-11-05T00:00:00Z", "2026-11-12T00:00:00Z")}`,
      quantity: 2,
      price: "R$ 160,00",
    });
    const html = renderToStaticMarkup(
      renderEmailTemplate("orderCreated", {
        customerName: "Synthetic",
        orderNumber: "1",
        total: "R$ 164,00",
        items,
        orderUrl: "http://localhost/orders/1",
      })
    );
    expect(html).toContain("confirmação do pagamento integral");
    expect(html).toContain("DROP &lt;script&gt;");
    expect(html).toContain("05/11/2026");
    expect(html).toContain("12/11/2026");
    expect(html).toContain("todos os itens");
    expect(html).not.toContain("<script>");
  });
  it("keeps STOCK confirmation wording", () => {
    const html = renderToStaticMarkup(
      renderEmailTemplate("orderCreated", {
        items: [{ name: "STOCK", quantity: 1, price: "R$ 1,00" }],
        orderUrl: "http://localhost/orders/1",
      })
    );
    expect(html).toContain("reservamos os itens selecionados");
    expect(html).not.toContain("demanda do lote");
  });
});

describe("payment approved purchase snapshots (provider-free)", () => {
  it.each(["STOCK", "PREORDER", "MIXED"] as const)("renders %s without implying premature preparation", mode => {
    const items = mode === "STOCK" ? [{}] : mode === "PREORDER" ? [{ salesModeAtPurchase: "PREORDER" }] : [...Array.from({length: 5}, () => ({salesModeAtPurchase: "STOCK"})), {salesModeAtPurchase: "PREORDER"}];
    expect(purchasedSalesMode(items)).toBe(mode);
    const html = renderToStaticMarkup(renderEmailTemplate("paymentApproved", { customerName: "Synthetic <script>", orderNumber: "42", total: "R$ 100,00", salesMode: purchasedSalesMode(items) }));
    expect(html).not.toContain("<script>");
    if (mode === "STOCK") expect(html).toContain("liberar o pedido para separação");
    else {
      expect(html).toContain("Os itens em pré-venda estão confirmados");
      expect(html).toContain("serão produzidos conforme o calendário dos respectivos lançamentos");
      expect(html).not.toContain("liberar o pedido para separação");
    }
    if (mode === "MIXED") expect(html).toContain(MIXED_SHIPPING_NOTICE);
    else expect(html).not.toContain(MIXED_SHIPPING_NOTICE);
  });
});
