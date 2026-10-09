// Optional local browser runner; reuse an installed Playwright without adding dependencies.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs pnpm exec vitest run server/database/preorderUi.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import { pathToFileURL } from "node:url";
import path from "node:path";

let server: ViteDevServer, browser: any, origin: string;
const product = (id = 1, remaining: number | null = 2, status = "OPEN") => ({
  id,
  name: `Synthetic ${id}`,
  description: "Fixture",
  category: "camisetas",
  price: 8000,
  stock: 0,
  imageUrl: null,
  salesMode: "PREORDER",
  optionSizes: ["M", "G"],
  optionColors: ["Preto"],
  images: [],
  variants: [],
  productionBatch: {
    id: 1,
    name: "Synthetic batch",
    status,
    salesOpenAt: null,
    salesCloseAt: null,
    estimatedShippingStart: null,
    estimatedShippingEnd: null,
    capacity: {
      maximumQuantity: remaining === null ? null : 2,
      claimedQuantity: remaining === null ? 0 : 2 - remaining,
      remainingQuantity: remaining,
    },
  },
});
const cartItem = (id = 1, quantity = 4, size = "M") => ({
  product: { ...product(id), price: 80, image: "/images/camisa.png" },
  quantity,
  selectedOptions: { cor: "Preto", tamanho: size },
  addedAt: new Date().toISOString(),
});

describe.skipIf(!process.env.PLAYWRIGHT_MODULE)(
  "PREORDER real React browser flows, isolated API mocks",
  () => {
    beforeAll(async () => {
      const modulePath = pathToFileURL(process.env.PLAYWRIGHT_MODULE!).href;
      const { chromium } = await import(/* @vite-ignore */ modulePath);
      server = await createServer({
        envDir: false,
        define: {
          "import.meta.env.VITE_API_URL": JSON.stringify("same-origin"),
          "import.meta.env.VITE_SITE_MODE": JSON.stringify("store"),
        },
        server: {
          host: "127.0.0.1",
          port: 0,
          open: false,
          hmr: false,
          watch: null,
        },
        cacheDir: path.join("/tmp", "l4ckos-preorder-ui-vite-cache"),
      });
      await server.listen();
      origin = `http://127.0.0.1:${(server.httpServer!.address() as any).port}`;
      browser = await chromium.launch({ headless: true });
    }, 60000);
    afterAll(async () => {
      await browser?.close();
      await server?.close();
    });

    async function fixture(
      items: any[] = [],
      remaining: number | null = 2,
      status = "OPEN"
    ) {
      const page = await browser.newPage();
      page.setDefaultTimeout(15000);
      const state = {
        remaining,
        status,
        missing: false,
        charges: 0,
        catalogReads: 0,
        errors: [] as string[],
      };
      page.on("pageerror", (error: Error) => state.errors.push(error.message));
      await page.route("**/*", async (route: any) => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.abort();
        if (url.pathname.startsWith("/api/trpc/")) {
          const calls = decodeURIComponent(
            url.pathname.split("/api/trpc/")[1]
          ).split(",");
          const data = calls.map((call: string) => {
            if (call === "products.list") {
              state.catalogReads++;
              return state.missing
                ? []
                : [
                    product(1, state.remaining, state.status),
                    product(2, state.remaining, state.status),
                  ];
            }
            if (call === "products.getById")
              return product(1, state.remaining, state.status);
            if (call === "products.reviews")
              return { summary: { total: 0 }, reviews: [] };
            if (call === "auth.me")
              return {
                id: 1,
                name: "Synthetic",
                email: "fixture@example.invalid",
                role: "user",
              };
            if (call === "profile.get") return { addresses: [] };
            if (call === "orders.createAsaasCharge") {
              state.charges++;
              return null;
            }
            return [];
          });
          return route.fulfill({
            contentType: "application/json",
            body: JSON.stringify(
              data.map(json => ({ result: { data: { json } } }))
            ),
          });
        }
        if (url.pathname === "/api/csrf")
          return route.fulfill({ json: { csrfToken: "synthetic" } });
        if (url.pathname === "/api/shipping/quote")
          return route.fulfill({
            json: {
              options: [
                {
                  id: "local",
                  label: "Local",
                  price: 5,
                  minDays: 1,
                  maxDays: 2,
                },
              ],
            },
          });
        if (url.pathname === "/api/cep/70000000")
          return route.fulfill({
            json: {
              logradouro: "Fixture",
              bairro: "Fixture",
              localidade: "Brasilia",
              uf: "DF",
            },
          });
        if (url.pathname.startsWith("/__manus__/")) return route.abort();
        if (url.pathname.startsWith("/api/"))
          return route.fulfill({ json: {} });
        return route.continue();
      });
      await page.addInitScript((saved: any[]) => {
        localStorage.setItem("loja-escoteira:cart", JSON.stringify(saved));
        localStorage.setItem(
          "l4ckos:cookie-preferences",
          JSON.stringify({
            version: "2026-06-24",
            decidedAt: new Date().toISOString(),
            status: "essential-only",
            categories: { necessary: true },
          })
        );
      }, items);
      return { page, state };
    }

    it("old four-piece cart at zero capacity blocks cart, product and checkout without charging", async () => {
      const { page, state } = await fixture([cartItem()], 0);
      try {
        await page.goto(`${origin}/`);
        await page
          .getByText("PRÉ-VENDA ESGOTADA", { exact: true })
          .first()
          .waitFor();
        await page.goto(`${origin}/carrinho`);
        await page
          .getByText("Capacidade deste lote esgotada.")
          .first()
          .waitFor();
        expect(
          await page
            .getByRole("button", { name: "Pré-venda indisponível" })
            .first()
            .isDisabled()
        ).toBe(true);
        await page
          .getByRole("button", { name: "+", exact: true })
          .first()
          .click();
        expect(
          await page.evaluate(
            () =>
              JSON.parse(localStorage.getItem("loja-escoteira:cart")!)[0]
                .quantity
          )
        ).toBe(4);
        await page.goto(`${origin}/produto/1`);
        expect(
          await page
            .getByRole("button", { name: "Adicionar à sacola", exact: true })
            .isDisabled()
        ).toBe(true);
        await page.goto(`${origin}/checkout`);
        await page
          .getByText("IMPORTANTE SOBRE ESTE PEDIDO", { exact: true })
          .waitFor();
        expect(
          await page.locator(".l4-checkout-finish > button").isDisabled()
        ).toBe(true);
        expect(state.charges).toBe(0);
        expect(state.errors).toEqual([]);
      } finally {
        await page.close();
      }
    }, 60000);

    it.each([1, 2])(
      "shares remaining capacity across product/variant %i, blocks excess increments",
      async secondProduct => {
        const { page, state } = await fixture([
          cartItem(1, 1),
          cartItem(secondProduct, 1, "G"),
        ]);
        try {
          await page.goto(`${origin}/carrinho`);
          await page
            .getByRole("link", { name: "Finalizar compra", exact: true })
            .first()
            .waitFor();
          await page
            .getByRole("button", { name: "+", exact: true })
            .first()
            .click();
          expect(
            await page.evaluate(() =>
              JSON.parse(localStorage.getItem("loja-escoteira:cart")!).reduce(
                (n: number, i: any) => n + i.quantity,
                0
              )
            )
          ).toBe(2);
          await page.goto(`${origin}/produto/1`);
          expect(
            await page
              .getByRole("button", { name: "Adicionar à sacola", exact: true })
              .isDisabled()
          ).toBe(true);
          expect(state.errors).toEqual([]);
        } finally {
          await page.close();
        }
      },
      60000
    );

    it("revalidates a ready checkout after capacity changes before any charge request", async () => {
      const { page, state } = await fixture([cartItem(1, 1)]);
      try {
        await page.goto(`${origin}/checkout`);
        await page
          .getByLabel("CPF ou CNPJ", { exact: true })
          .fill("11144477735");
        await page.getByLabel("CEP", { exact: true }).fill("70000000");
        await page
          .getByRole("button", { name: "Consultar CEP", exact: true })
          .click();
        await page.getByLabel("Número", { exact: true }).fill("1");
        const finish = page.locator(".l4-checkout-finish > button");
        await page.waitForFunction(
          () =>
            !document.querySelector<HTMLButtonElement>(
              ".l4-checkout-finish > button"
            )?.disabled
        );
        const before = state.catalogReads;
        state.remaining = 0;
        await finish.click();
        await page
          .getByText(
            "A disponibilidade mudou ou não pôde ser atualizada. Revise a sacola antes de finalizar.",
            { exact: true }
          )
          .waitFor();
        expect(state.catalogReads).toBeGreaterThan(before);
        expect(state.charges).toBe(0);
        expect(state.errors).toEqual([]);
      } finally {
        await page.close();
      }
    }, 60000);

    it("adds from the real product page and prevents the drawer from exceeding capacity", async () => {
      const { page, state } = await fixture();
      try {
        await page.goto(`${origin}/produto/1`);
        await page
          .getByRole("button", { name: "Selecionar cor Preto", exact: true })
          .click();
        await page.getByRole("button", { name: "M", exact: true }).click();
        await page.locator('input[type="number"]').fill("4");
        expect(await page.locator('input[type="number"]').inputValue()).toBe(
          "2"
        );
        await page
          .getByRole("button", { name: "Adicionar à sacola", exact: true })
          .click();
        await page.getByRole("dialog", { name: "Sacola de compras" }).waitFor();
        await page
          .getByRole("button", { name: "Aumentar quantidade", exact: true })
          .click();
        expect(
          await page.evaluate(
            () =>
              JSON.parse(localStorage.getItem("loja-escoteira:cart")!)[0]
                .quantity
          )
        ).toBe(2);
        expect(state.charges).toBe(0);
        expect(state.errors).toEqual([]);
      } finally {
        await page.close();
      }
    }, 60000);

    it("unlimited batch keeps old cart above 99 available and allows quantity increases", async () => {
      const { page } = await fixture([cartItem(1, 98), cartItem(2, 99)], null);
      try {
        await page.goto(`${origin}/carrinho`);
        await page
          .getByRole("link", { name: "Finalizar compra", exact: true })
          .first()
          .waitFor();
        await page
          .getByRole("button", { name: "+", exact: true })
          .first()
          .click();
        expect(
          await page.evaluate(
            () =>
              JSON.parse(localStorage.getItem("loja-escoteira:cart")!)[0]
                .quantity
          )
        ).toBe(99);
      } finally {
        await page.close();
      }
    }, 60000);

    it.each(["CLOSED", "CANCELLED"])(
      "%s batch is unavailable",
      async status => {
        const { page } = await fixture([cartItem(1, 1)], 2, status);
        try {
          await page.goto(`${origin}/produto/1`);
          await page
            .getByText("Pré-venda indisponível para novas compras.")
            .first()
            .waitFor();
          expect(
            await page
              .getByRole("button", { name: "Adicionar à sacola", exact: true })
              .isDisabled()
          ).toBe(true);
        } finally {
          await page.close();
        }
      },
      60000
    );

    it("catalog polling updates exhaustion while navigating and missing products block an old cart", async () => {
      const { page, state } = await fixture([cartItem(1, 1)]);
      try {
        await page.goto(`${origin}/produtos`);
        await page
          .getByRole("heading", { name: "Synthetic 1", exact: true })
          .waitFor();
        state.remaining = 0;
        await page
          .getByText("PRÉ-VENDA ESGOTADA", { exact: true })
          .first()
          .waitFor({ timeout: 22000 });
        expect(state.catalogReads).toBeGreaterThan(1);
        state.missing = true;
        await page.goto(`${origin}/carrinho`);
        await page
          .getByRole("button", { name: "Pré-venda indisponível", exact: true })
          .first()
          .waitFor();
        expect(state.charges).toBe(0);
        expect(state.errors).toEqual([]);
      } finally {
        await page.close();
      }
    }, 60000);
  }
);
