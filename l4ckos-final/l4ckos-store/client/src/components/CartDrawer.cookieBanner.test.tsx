// @vitest-environment jsdom
import "../test/setupDom";
import { readFileSync } from "node:fs";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/trpc", async () => await import("../test/fakeTrpc"));
import { CartProvider, useCart } from "../contexts/CartContext";
import { cartItem, seedCart } from "../test/fixtures";
import { resetTrpc } from "../test/fakeTrpc";
import { serveCatalog } from "../test/v6Catalog";
import CartDrawer from "./CartDrawer";
import CookiePreferences, { COOKIE_BANNER_OFFSET_VAR } from "./CookiePreferences";

const CONSENT_KEY = "l4ckos:cookie-preferences";

beforeEach(() => { resetTrpc(); serveCatalog(); });

function OpenDrawer() {
  const { openCartDrawer } = useCart();
  return <button onClick={openCartDrawer}>abrir sacola</button>;
}

async function setup({ consented = false } = {}) {
  seedCart([cartItem()]);
  if (consented) {
    window.localStorage.setItem(CONSENT_KEY, JSON.stringify({ version: "2026-06-24", decidedAt: "x", status: "essential-only", categories: { necessary: true } }));
  }
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={["/"]}>
      <CartProvider>
        <OpenDrawer />
        <Routes>
          <Route path="/" element={<main>home</main>} />
          <Route path="/checkout" element={<main>pagina de checkout</main>} />
        </Routes>
        <CartDrawer />
        <CookiePreferences />
      </CartProvider>
    </MemoryRouter>,
  );
  await user.click(screen.getByRole("button", { name: "abrir sacola" }));
  return user;
}

const offset = () => document.documentElement.style.getPropertyValue(COOKIE_BANNER_OFFSET_VAR);

afterEach(() => {
  document.documentElement.style.removeProperty(COOKIE_BANNER_OFFSET_VAR);
  document.body.style.overflow = "";
  vi.restoreAllMocks();
});

describe("cookie banner + CartDrawer (first visit)", () => {
  it("keeps the banner visible while the drawer is open and does not decide for the user", async () => {
    await setup();
    expect(screen.getByRole("region", { name: "AVISO SOBRE COOKIES" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Finalizar compra" })).toBeTruthy();
    expect(window.localStorage.getItem(CONSENT_KEY)).toBeNull();
  });

  it("publishes the banner's occupied height so the drawer ends above it", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ top: window.innerHeight - 180 } as DOMRect);
    await setup();
    expect(offset()).toBe("180px");
  });

  it("the checkout button works with the banner showing and still does not record consent", async () => {
    const user = await setup();
    await waitFor(() => expect((screen.getByRole("button", { name: "Finalizar compra" }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole("button", { name: "Finalizar compra" }));
    expect(screen.getByText("pagina de checkout")).toBeTruthy();
    expect(window.localStorage.getItem(CONSENT_KEY)).toBeNull();
    expect(screen.getByRole("region", { name: "AVISO SOBRE COOKIES" })).toBeTruthy();
  });

  it("clears the offset and stores consent only after the user clicks ENTENDI", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ top: window.innerHeight - 180 } as DOMRect);
    const user = await setup();
    expect(offset()).toBe("180px");
    await user.click(screen.getByRole("button", { name: "ENTENDI" }));
    expect(screen.queryByRole("region", { name: "AVISO SOBRE COOKIES" })).toBeNull();
    expect(offset()).toBe("");
    expect(JSON.parse(window.localStorage.getItem(CONSENT_KEY) || "null")).toMatchObject({ status: "essential-only" });
  });

  it("publishes no offset when consent already exists", async () => {
    await setup({ consented: true });
    expect(screen.queryByRole("region", { name: "AVISO SOBRE COOKIES" })).toBeNull();
    expect(offset()).toBe("");
  });

  it("the banner is inside the focus trap: Tab reaches SAIBA MAIS / ENTENDI and wraps back to the drawer", async () => {
    const user = await setup();
    expect(document.activeElement).toBe(document.querySelector(".l4-cart-drawer-close"));
    const visited: string[] = [];
    for (let i = 0; i < 14; i += 1) {
      await user.tab();
      visited.push(document.activeElement?.textContent?.trim() || document.activeElement?.getAttribute("aria-label") || "");
    }
    expect(visited).toContain("SAIBA MAIS");
    expect(visited).toContain("ENTENDI");
    // Never escapes to the page behind the dialog.
    expect(visited.every(Boolean)).toBe(true);
    expect(document.querySelector("main")?.contains(document.activeElement)).toBe(false);
  });

  it("Shift+Tab from the first control wraps to the banner (last), and Enter on ENTENDI works", async () => {
    const user = await setup();
    await user.tab({ shift: true });
    expect(document.activeElement?.textContent?.trim()).toBe("ENTENDI");
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("region", { name: "AVISO SOBRE COOKIES" })).toBeNull();
  });

  it("after the banner is dismissed, the next Tab returns focus to the drawer instead of the page", async () => {
    const user = await setup();
    await user.tab({ shift: true });
    await user.keyboard("{Enter}");
    await user.tab();
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
  });
});

describe("assistive-technology semantics (drawer + pending banner)", () => {
  const dialog = () => screen.getByRole("dialog", { hidden: true });
  const isInert = (el: Element | null) => Boolean(el?.closest("[inert]"));

  it("does not declare aria-modal while a banner outside the dialog is pending (it would hide the banner from AT)", async () => {
    await setup();
    expect(dialog().getAttribute("aria-modal")).toBeNull();
  });

  it("the page behind is truly inert, while the drawer and the pending banner stay operable", async () => {
    await setup();
    expect(isInert(screen.getByRole("main"))).toBe(true);
    expect(isInert(screen.getByRole("button", { name: "abrir sacola", hidden: true }))).toBe(true);
    expect(isInert(dialog())).toBe(false);
    expect(isInert(document.querySelector("[data-l4-cookie-banner]"))).toBe(false);
  });

  it("becomes aria-modal once the banner is decided, and the background stays inert", async () => {
    const user = await setup();
    await user.click(screen.getByRole("button", { name: "ENTENDI" }));
    expect(dialog().getAttribute("aria-modal")).toBe("true");
    expect(isInert(screen.getByRole("main"))).toBe(true);
    expect(isInert(dialog())).toBe(false);
  });

  it("is aria-modal from the start when consent already exists", async () => {
    await setup({ consented: true });
    expect(dialog().getAttribute("aria-modal")).toBe("true");
  });

  it("closing the drawer restores the page (nothing stays inert) and returns focus to the opener", async () => {
    const user = await setup({ consented: true });
    await user.keyboard("{Escape}");
    expect(document.querySelector("[inert]")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "abrir sacola" }));
  });
});

describe("layout contract (CSS)", () => {
  const dir = `${process.cwd()}/client/src/components/`;
  const drawerCss = readFileSync(`${dir}CartDrawer.css`, "utf8");
  const cookieCss = readFileSync(`${dir}CookiePreferences.css`, "utf8");

  it("drawer layer shrinks by the banner offset (so the footer is never covered)", () => {
    const layer = drawerCss.split("\n").find(line => line.startsWith(".l4-cart-drawer-layer {")) || "";
    expect(layer).toContain(COOKIE_BANNER_OFFSET_VAR);
  });

  it("banner stays fixed within the viewport width (no horizontal scroll)", () => {
    expect(cookieCss).toMatch(/\.l4-cookie-banner \{[^}]*position: fixed;[^}]*left: clamp\([^}]*right: clamp\(/s);
  });
});
