// @vitest-environment jsdom
import "../test/setupDom";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StockCardContinue } from "./StockCardContinue";

afterEach(() => vi.unstubAllEnvs());

describe("StockCardContinue (DOM)", () => {
  it("links only to the exact Asaas host of this build and explains that the card is entered on Asaas", () => {
    vi.stubEnv("VITE_DEPLOY_TARGET", "production");
    render(<StockCardContinue checkoutUrl="https://www.asaas.com/i/abc123" />);
    const link = screen.getByRole("link", { name: "Continuar no pagamento seguro" });
    expect(link.getAttribute("href")).toBe("https://www.asaas.com/i/abc123");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(screen.getByText(/não recebe nem armazena o número do cartão/)).not.toBeNull();
  });

  it("refuses a link outside the build's Asaas host instead of rendering it", () => {
    vi.stubEnv("VITE_DEPLOY_TARGET", "production");
    render(<StockCardContinue checkoutUrl="https://sandbox.asaas.com/i/abc123" />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByTestId("stock-card-unavailable")).not.toBeNull();
  });
});
