// @vitest-environment jsdom
import "../test/setupDom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StockPixInstructions } from "./StockPixInstructions";

const pix = { qrCodeBase64: "iVBORw0KGgo=", copyPaste: "00020126580014br.gov.bcb.pix0136synthetic" };

describe("StockPixInstructions (DOM)", () => {
  it("copies the PIX code to the clipboard and confirms it", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<StockPixInstructions pix={pix} checkoutUrl="https://www.asaas.com/i/abc" />);
    expect(screen.getByAltText("QR Code PIX").getAttribute("src")).toBe("data:image/png;base64,iVBORw0KGgo=");
    await userEvent.click(screen.getByRole("button", { name: "Copiar código PIX" }));
    expect(writeText).toHaveBeenCalledWith(pix.copyPaste);
    await waitFor(() => expect(screen.queryByText("Código copiado.")).not.toBeNull());
  });

  it("explains a clipboard failure instead of failing silently", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => { throw new Error("denied"); }) }, configurable: true });
    render(<StockPixInstructions pix={pix} />);
    await userEvent.click(screen.getByRole("button", { name: "Copiar código PIX" }));
    await waitFor(() => expect(screen.queryByText(/Não foi possível copiar automaticamente/)).not.toBeNull());
  });
});
