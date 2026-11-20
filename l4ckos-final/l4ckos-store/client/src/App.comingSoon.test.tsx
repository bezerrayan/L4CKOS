// @vitest-environment jsdom
import "./test/setupDom";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const site = vi.hoisted(() => ({ mode: "coming-soon" as "coming-soon" | "store" }));
vi.mock("./config/site", () => ({ get siteMode() { return site.mode; } }));
vi.mock("./contexts/UserContext", () => ({ useUser: () => ({ user: null, isAuthenticated: false, isLoading: false }) }));
vi.mock("./hooks/useIsMobile", () => ({ useIsMobile: () => false }));
vi.mock("./components/Header", () => ({ default: () => <header data-testid="store-header" /> }));
vi.mock("./components/Footer", () => ({ default: () => <footer data-testid="store-footer" /> }));
vi.mock("./components/CartDrawer", () => ({ default: () => <div data-testid="cart-drawer" /> }));
vi.mock("./components/CookiePreferences", () => ({ default: () => <div data-testid="cookie-banner" /> }));
vi.mock("./pages/ComingSoon", () => ({ default: () => <div data-testid="coming-soon">Algo grande vem aí</div> }));

import App from "./App";

const open = (path: string) => {
  window.history.pushState({}, "", path);
  render(<App />);
};

beforeEach(() => { site.mode = "coming-soon"; });

describe("coming-soon mode: the teaser owns the viewport", () => {
  it.each(["/", "/em-breve", "/em-breve/"])("%s renders only the teaser, with no store Header, Footer or cookie banner over its calls to action", async path => {
    open(path);
    expect(await screen.findByTestId("coming-soon")).toBeTruthy();
    expect(screen.queryByTestId("store-header")).toBeNull();
    expect(screen.queryByTestId("store-footer")).toBeNull();
    expect(screen.queryByTestId("cookie-banner")).toBeNull();
  });

  it("still lets store pages be gated to the teaser for anonymous visitors", async () => {
    open("/produtos");
    expect(await screen.findByTestId("coming-soon")).toBeTruthy();
    expect(screen.queryByTestId("store-header")).toBeNull();
  });
});

describe("store mode: /em-breve keeps the regular store layout (unchanged)", () => {
  it("shows the Header, Footer and cookie banner around the page", async () => {
    site.mode = "store";
    open("/em-breve");
    expect(await screen.findByTestId("coming-soon")).toBeTruthy();
    expect(screen.getByTestId("store-header")).toBeTruthy();
    expect(screen.getByTestId("store-footer")).toBeTruthy();
    expect(screen.getByTestId("cookie-banner")).toBeTruthy();
  });
});
