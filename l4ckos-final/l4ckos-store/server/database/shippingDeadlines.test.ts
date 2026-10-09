import { afterEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { shippingEstimate, salesDeadline, transportEstimate, TRANSPORT_DEADLINE_NOTICE } from "../../shared/preorder";
import { PreorderInfo, PurchasedPreorderInfo, PurchasedTransportInfo, MixedShippingNotice } from "../../client/src/components/PreorderInfo";
import { parseMelhorEnvioQuotes, quoteShipping, quoteShippingDetailed } from "../services/shippingService";
import { readShippingSnapshot } from "./orderShippingSnapshot";
import { batchEditSchema } from "./productionBatches";
import { renderEmailTemplate } from "../services/email/emailRenderer.js";

vi.mock("axios", () => ({ default: { post: vi.fn(), isAxiosError: () => false } }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
const now = Date.parse("2026-10-09T12:00:00Z");
const start = "2026-11-05T00:00:00Z", end = "2026-11-12T00:00:00Z";
const batch = { id: 1, name: "Fixture", status: "OPEN" as const, salesOpenAt: null, salesCloseAt: "2100-11-01T02:00:00Z", estimatedShippingStart: start, estimatedShippingEnd: end };

describe("deadline communication and historical conditions", () => {
  it("accepts a same-day postage window but never an empty sales interval", () => {
    const form = { name: "Fixture", salesOpenAt: null, salesCloseAt: null, estimatedShippingStart: start, estimatedShippingEnd: start, minimumQuantity: 0, maximumQuantity: null };
    expect(batchEditSchema.safeParse(form).success).toBe(true);
    expect(batchEditSchema.safeParse({ ...form, salesOpenAt: start, salesCloseAt: start }).success).toBe(false);
  });
  it.each([
    [start, end, "Postagem estimada entre 05/11/2026 e 12/11/2026."],
    [start, null, "Postagem estimada a partir de 05/11/2026."],
    [null, end, "Postagem estimada até 12/11/2026."],
    [null, null, "Previsão de postagem a confirmar."],
    ["invalid", null, "Previsão de postagem a confirmar."],
  ])("states only supported postage information: %s / %s", (s, e, expected) => {
    expect(shippingEstimate(s, e, { now })).toBe(expected);
  });
  it("identifies an expired window instead of inventing another date", () => {
    const text = shippingEstimate("2025-01-01", "2025-01-05", { now });
    expect(text).toContain("Cronograma aguardando atualização");
    expect(text).toContain("01/01/2025");
    expect(text).not.toContain("Postagem estimada entre");
  });
  it("keeps partial expired and reversed windows explicit", () => {
    expect(shippingEstimate("2025-01-01", null, { now })).toContain("nova previsão a confirmar");
    expect(shippingEstimate(end, start, { now })).toContain("cronograma inconsistente");
    expect(shippingEstimate("2026-10-01", end, { now })).toBe("Postagem estimada até 12/11/2026.");
  });
  it("retains the original purchase estimate even after its dates pass", () => {
    expect(shippingEstimate("2025-01-01", "2025-01-05", { historical: true, now })).toBe("Previsão de postagem registrada na compra entre 01/01/2025 e 05/01/2025.");
  });
  it("states the sales cutoff as a precise Brasilia instant", () => {
    expect(salesDeadline("2026-11-01T02:00:00Z")).toContain("31/10/2026, 23:00");
    expect(salesDeadline("2026-10-31T23:00:00-03:00")).toBe(salesDeadline("2026-11-01T02:00:00Z"));
    expect(salesDeadline("invalid")).toBe("encerramento a confirmar");
  });
  it("does not turn a quote into payment-based delivery or a local postal deadline", () => {
    expect(transportEstimate({ id: "melhor-envio-1", minDays: 2, maxDays: 5 })).toContain("dias após a postagem");
    expect(transportEstimate({ id: "melhor-envio-1", minDays: null, maxDays: null })).toContain("não informado");
    expect(transportEstimate({ id: "melhor-envio-1", minDays: 5, maxDays: 1 })).toContain("não informado");
    expect(transportEstimate({ id: "local-plano-piloto", minDays: 1, maxDays: 2 })).toContain("Data a combinar");
  });
  it("renders the real product component with distinct sales/postage/transport stages", () => {
    const html = renderToStaticMarkup(createElement(PreorderInfo, { product: { salesMode: "PREORDER", productionBatch: batch } }));
    expect(html).toContain("horário de Brasília");
    expect(html).toContain("Postagem estimada");
    expect(html).toContain("não inclui fabricação");
    expect(renderToStaticMarkup(createElement(PreorderInfo, { product: { salesMode: "STOCK" } }))).toBe("");
  });
  it("shows changed live schedule separately without replacing the historical snapshot", () => {
    const item = { salesModeAtPurchase: "PREORDER", estimatedShippingStartAtPurchase: start, estimatedShippingEndAtPurchase: end, currentEstimatedShippingStart: "2100-12-01", currentEstimatedShippingEnd: "2100-12-10" };
    const html = renderToStaticMarkup(createElement(PurchasedPreorderInfo, { item, status: "paid" }));
    expect(html).toContain("05/11/2026"); expect(html).toContain("01/12/2100");
    expect(html).toContain("O cronograma do lote mudou");
    expect(renderToStaticMarkup(createElement(PurchasedPreorderInfo, { item, status: "delivered" }))).not.toContain("O cronograma do lote mudou");
  });
  it("shows joint shipping also for different PREORDER batches", () => {
    const items = [1, 2].map(id => ({ product: { salesMode: "PREORDER" as const, productionBatch: { ...batch, id } } }));
    expect(renderToStaticMarkup(createElement(MixedShippingNotice, { items }))).toContain("única remessa");
  });
  it("handles missing historical transport without guessing a quote", () => {
    expect(renderToStaticMarkup(createElement(PurchasedTransportInfo, { status: "paid" }))).toContain("não registrado neste pedido histórico");
    expect(readShippingSnapshot(null)).toBeNull();
    expect(readShippingSnapshot("not json")).toBeNull();
    expect(readShippingSnapshot({ shippingAtPurchase: { id: "x", label: "x", minDays: 5, maxDays: 2 } })).toBeNull();
    expect(readShippingSnapshot({ shippingAtPurchase: { id: "x", label: "x", minDays: 2, maxDays: 5, secret: "ignore" } })).toEqual({ id: "x", label: "x", minDays: 2, maxDays: 5 });
  });
  it.each(["orderCreated", "paymentApproved"])("renders %s without adding production to transit automatically", template => {
    const html = renderToStaticMarkup(renderEmailTemplate(template, { salesMode: "PREORDER", orderNumber: "synthetic", items: [{ name: "Fixture — Pré-venda — DROP", quantity: 1, price: "R$ 1,00" }] }));
    expect(html).toContain(TRANSPORT_DEADLINE_NOTICE);
    expect(html).not.toContain("dias após a aprovação");
  });
});

describe("shipping integration, mocked provider only", () => {
  it("parses object ranges, zero days and missing transit without a made-up default", () => {
    expect(parseMelhorEnvioQuotes([{ id: 1, price: "12.50", delivery_range: { min: 0, max: 4 } }])[0]).toMatchObject({ price: 12.5, minDays: 0, maxDays: 4 });
    expect(parseMelhorEnvioQuotes([{ id: 1, price: "12.50" }])[0]).toMatchObject({ minDays: null, maxDays: null });
    expect(parseMelhorEnvioQuotes([{ id: 1, price: "12.50", custom_delivery_range: { min: 2, max: 3 }, delivery_range: { min: 1, max: 5 } }])[0]).toMatchObject({ minDays: 2, maxDays: 3 });
  });
  it("rejects invalid prices rather than turning a provider failure into free shipping", () => {
    expect(parseMelhorEnvioQuotes([{ price: "oops" }, {}, { price: -1 }, { price: null }])).toEqual([]);
    expect(parseMelhorEnvioQuotes([{ price: 0, delivery_time: 0 }])[0]).toMatchObject({ price: 0, minDays: 0, maxDays: 0 });
  });
  it("offers no invented local option outside the existing service area without a token", async () => {
    vi.stubEnv("MELHOR_ENVIO_TOKEN", "");
    expect((await quoteShippingDetailed({ cep: "01001000", itemCount: 1, subtotal: 80 })).options).toEqual([]);
    expect(await quoteShipping({ cep: "01001000", itemCount: 1, subtotal: 80 })).toEqual([]);
    expect(axios.post).not.toHaveBeenCalled();
  });
  it("keeps authorized local delivery as appointment-based, not 1-2 days", async () => {
    vi.stubEnv("MELHOR_ENVIO_TOKEN", "");
    const result = await quoteShippingDetailed({ cep: "70000000", itemCount: 1, subtotal: 80 });
    expect(result.options).toHaveLength(1);
    expect(result.options[0]).toMatchObject({ id: "local-plano-piloto", price: 0, minDays: null, maxDays: null });
  });
  it.each(["failure", "empty"])("fails closed outside the local area on provider %s", async mode => {
    vi.stubEnv("MELHOR_ENVIO_TOKEN", "synthetic-no-network");
    if (mode === "failure") vi.mocked(axios.post).mockRejectedValueOnce(new Error("synthetic outage"));
    else vi.mocked(axios.post).mockResolvedValueOnce({ data: [] });
    const result = await quoteShippingDetailed({ cep: "01001000", itemCount: 1, subtotal: 80 });
    expect(result.options).toEqual([]); expect(result.warning).toBeTruthy();
  });
});
