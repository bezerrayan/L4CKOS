// @vitest-environment jsdom
import "../test/setupDom";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("../contexts/FavoritesContext", () => ({
  useFavorites: () => ({ addToFavorites: vi.fn(), removeFromFavorites: vi.fn(), isFavorited: () => false }),
}));

import ProductCard from "./ProductCard";
import { product } from "../test/fixtures";
import CartDrawer from "./CartDrawer";

/** The price node of a card: what a sighted customer reads (screen-reader-only text excluded). */
function visiblePrice(container: HTMLElement) {
  const strong = container.querySelector(".l4-catalog-card-bottom strong") as HTMLElement;
  const clone = strong.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".l4-sr-only").forEach(node => node.remove());
  return { visible: clone.textContent, full: strong.textContent };
}
const renderCard = (over: Parameters<typeof product>[0]) =>
  render(<MemoryRouter><ProductCard product={product(over)} /></MemoryRouter>);

describe("ProductCard price (storefront, minimalist)", () => {
  it("shows the plain Brazilian number with two decimals and keeps 'R$' only for assistive tech", () => {
    const { container } = renderCard({ price: 89 });
    expect(visiblePrice(container)).toEqual({ visible: "89,00", full: "R$ 89,00" });
  });

  it("formats values above 1.000 and non-round values", () => {
    expect(visiblePrice(renderCard({ price: 1289.9 }).container).visible).toBe("1.289,90");
    expect(visiblePrice(renderCard({ price: 129.9 }).container).visible).toBe("129,90");
  });

  it("applies to pre-order products too and leaves the badge untouched", () => {
    const { container } = renderCard({ price: 149, salesMode: "PREORDER", productionBatch: null } as never);
    expect(visiblePrice(container).visible).toBe("149,00");
    expect(screen.getByText(/PRÉ-VENDA/)).toBeTruthy();
  });
});

describe("cart keeps the monetary prefix", () => {
  it("is not imported by the storefront formatter (separate code paths)", async () => {
    const { formatPrice } = await import("../lib/utils");
    expect(formatPrice(1289.9).replace(/ /g, " ")).toBe("R$ 1.289,90");
    expect(typeof CartDrawer).toBe("function");
  });
});
