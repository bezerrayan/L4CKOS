import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { pixQrCodeSource, StockPixInstructions } from "./StockPixInstructions";
import { describeStockAttempt } from "../stock/stockAttemptView";
import { stockAttemptResumeV1Schema, stockCheckoutResponseV1Schema } from "../../../shared/stockCheckoutV1";

const pix = { qrCodeBase64: "iVBORw0KGgo=", copyPaste: "00020126580014br.gov.bcb.pix0136synthetic" };
const render = (props: Parameters<typeof StockPixInstructions>[0]) => renderToStaticMarkup(<StockPixInstructions {...props} />);

describe("StockPixInstructions", () => {
  it("shows the QR image, the copy/paste code, the copy button and keeps the Asaas link as an alternative", () => {
    const html = render({ pix, checkoutUrl: "https://www.asaas.com/i/abc" });
    expect(html).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    expect(html).toContain('alt="QR Code PIX"');
    expect(html).toContain(`>${pix.copyPaste}</textarea>`);
    expect(html).toContain("Copiar código PIX");
    expect(html).toContain('href="https://www.asaas.com/i/abc"');
    expect(html).toContain("Abrir no Asaas");
  });

  it("does not double-prefix a data: URL", () => {
    expect(pixQrCodeSource("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    expect(pixQrCodeSource("AAAA")).toBe("data:image/png;base64,AAAA");
  });

  it("falls back to the Asaas link alone when no PIX data is available", () => {
    const html = render({ pix: undefined, checkoutUrl: "https://www.asaas.com/i/abc" });
    expect(html).not.toContain("QR Code PIX\"");
    expect(html).not.toContain("<textarea");
    expect(html).toContain("Continuar pagamento");
    expect(html).toContain('href="https://www.asaas.com/i/abc"');
  });

  it("renders PIX alone when the Asaas link is missing, and nothing when both are missing", () => {
    expect(render({ pix })).not.toContain("<a ");
    expect(render({})).toBe("");
  });

  it("the attempt view lets a pending attempt show PIX even when only inline data exists", () => {
    expect(describeStockAttempt({ status: "pending", paymentId: "pay_1", pix })).toMatchObject({ canContinuePayment: true });
    expect(describeStockAttempt({ status: "pending", paymentId: "pay_1" }).canContinuePayment).toBe(false);
  });

  it("accepts old STOCK responses without pix, real payloads with spaces, and ignores a malformed pix block", () => {
    const resume = { attemptId: "attempt-0123456789abcdef", status: "pending", orderId: "o1", paymentId: "pay_1", checkoutUrl: "https://www.asaas.com/i/1", amountCents: 1000, reservationExpiresAt: new Date().toISOString(), canStartNewAttempt: false };
    expect(stockAttemptResumeV1Schema.parse(resume).pix).toBeUndefined();
    const spaced = { qrCodeBase64: "iVBORw0KGgo=", copyPaste: "00020126580014br.gov.bcb.pix5909L4CKOS LTDA6009SAO PAULO6304ABCD" };
    expect(stockAttemptResumeV1Schema.parse({ ...resume, pix: spaced }).pix).toEqual(spaced);
    const broken = stockAttemptResumeV1Schema.parse({ ...resume, pix: { qrCodeBase64: "<script>" } });
    expect(broken.status).toBe("pending");
    expect(broken.pix).toBeUndefined();
    expect(stockCheckoutResponseV1Schema.parse({ attemptId: "a", orderId: "o1", status: "pending", paymentId: "pay_1", amountCents: 1000, replayed: false }).pix).toBeUndefined();
  });
});
