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
        shippingMode: "quote" as "quote" | "empty" | "failure" | "local",
        shippingRequests: 0,
        shippingDelayMs: 0,
        role: "user" as "user" | "admin",
        shippingStart: "2100-11-05T00:00:00Z",
        shippingEnd: "2100-11-12T00:00:00Z",
        manufacturingStart: "2100-10-10" as string | null,
        manufacturingEnd: "2100-10-20" as string | null,
        savedBatch: null as any,
        orderStatus: "paid",
      };
      const catalogProduct = (id: number) => {
        const p = product(id, state.remaining, state.status);
        return { ...p, productionBatch: { ...p.productionBatch, estimatedManufacturingStart:state.manufacturingStart, estimatedManufacturingEnd:state.manufacturingEnd, estimatedShippingStart: state.shippingStart, estimatedShippingEnd: state.shippingEnd, salesCloseAt: "2100-11-01T02:00:00Z" } };
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
                    catalogProduct(1),
                    catalogProduct(2),
                  ];
            }
            if (call === "products.getById")
              return catalogProduct(1);
            if (call === "products.reviews")
              return { summary: { total: 0 }, reviews: [] };
            if (call === "auth.me")
              return {
                id: 1,
                name: "Synthetic",
                email: "fixture@example.invalid",
                role: state.role,
              };
            if (call === "profile.get") return { addresses: [] };
            if (call === "admin.dashboard") return {};
            if (call === "productionBatches.save") {
              const body=route.request().postDataJSON(); state.savedBatch=body?.["0"]?.json ?? body?.json;
              return {id:77};
            }
            if (call === "orders.list") return [{ id: 9001, status: "paid", totalPrice: 8500, createdAt: "2026-10-01T12:00:00Z", awaitingProduction: true }];
            if (call === "orders.detail" || call === "orders.track") return {
              id: 9001, status: state.orderStatus, totalPrice: 8500, createdAt: "2026-10-01T12:00:00Z",
              shippingAtPurchase: { id: "melhor-envio-fixture", label: "Synthetic transport", minDays: 2, maxDays: 5 },
              items: [{ id: 1, productId: 1, productName: "Synthetic purchase", quantity: 1, productPrice: 8000, salesModeAtPurchase: "PREORDER", productionBatchId: 1, productionBatchNameAtPurchase: "Original batch", productionStatus: "IN_PRODUCTION", estimatedManufacturingStartAtPurchase:"2026-10-10",estimatedManufacturingEndAtPurchase:"2026-10-20",currentEstimatedManufacturingStart:"2026-12-01",currentEstimatedManufacturingEnd:"2026-12-10", estimatedShippingStartAtPurchase: "2026-11-05T00:00:00Z", estimatedShippingEndAtPurchase: "2026-11-12T00:00:00Z", currentEstimatedShippingStart: "2100-12-01T00:00:00Z", currentEstimatedShippingEnd: "2100-12-10T00:00:00Z" }],
            };
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
        if (url.pathname === "/api/shipping/quote") {
          state.shippingRequests++;
          const mode = state.shippingMode;
          if (state.shippingDelayMs) await new Promise(resolve => setTimeout(resolve, state.shippingDelayMs));
          if (mode === "failure") return route.fulfill({ status: 503, json: { error: "Synthetic outage" } });
          return route.fulfill({
            json: {
              options: mode === "empty" ? [] : [
                {
                  id: mode === "local" ? "local-plano-piloto" : "melhor-envio-fixture",
                  label: mode === "local" ? "Local" : "Synthetic transport",
                  price: 5,
                  minDays: 1,
                  maxDays: 2,
                },
              ],
            },
          });
        }
        if (url.pathname.startsWith("/api/cep/"))
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

    it("communicates sales, postage and transport consistently in product, cart and checkout", async () => {
      const { page, state } = await fixture([cartItem(1, 1)]);
      try {
        await page.goto(`${origin}/produto/1`);
        await page.getByText(/31\/10\/2100, 23:00/).first().waitFor();
        await page.getByText(/Postagem estimada entre 05\/11\/2100 e 12\/11\/2100/).first().waitFor();
        await page.getByText(/Fabricação estimada entre 10\/10\/2100 e 20\/10\/2100/).first().waitFor();
        await page.getByLabel("CEP para calcular frete").fill("70000000");
        await page.getByRole("button", { name: "Calcular", exact: true }).click();
        await page.getByText(/Transporte estimado: 1 a 2 dias após a postagem/).first().waitFor();
        await page.goto(`${origin}/carrinho`);
        await page.getByText(/Fabricação estimada entre 10\/10\/2100 e 20\/10\/2100/).first().waitFor();
        await page.getByText(/Postagem estimada entre 05\/11\/2100 e 12\/11\/2100/).first().waitFor();
        await page.goto(`${origin}/checkout`);
        await page.getByText(/Fabricação estimada entre 10\/10\/2100 e 20\/10\/2100/).first().waitFor();
        await page.getByLabel("CEP", { exact: true }).fill("70000000");
        await page.getByRole("button", { name: "Consultar CEP", exact: true }).click();
        await page.getByText(/Transporte estimado: 1 a 2 dias após a postagem/).first().waitFor();
        const text = await page.locator("body").innerText();
        expect(text).not.toContain("após a aprovação do pagamento");
        expect(text).toContain("não inclui fabricação");
        expect(state.charges).toBe(0); expect(state.errors).toEqual([]);
      } finally { await page.close(); }
    }, 60000);

    it.each(["empty", "failure"] as const)("does not invent a freight option on %s response", async mode => {
      const { page, state } = await fixture([cartItem(1, 1)]);
      state.shippingMode = mode;
      try {
        await page.goto(`${origin}/checkout`);
        await page.getByLabel("CEP", { exact: true }).fill("01001000");
        await page.getByRole("button", { name: "Consultar CEP", exact: true }).click();
        await page.getByText(mode === "empty" ? /Não há cotação disponível/ : /nenhuma opção de entrega foi presumida/).first().waitFor();
        expect(await page.locator(".l4-checkout-shipping-options button").count()).toBe(0);
        expect(await page.locator(".l4-checkout-finish > button").isDisabled()).toBe(true);
        expect(state.charges).toBe(0); expect(state.errors).toEqual([]);
      } finally { await page.close(); }
    }, 60000);

    it("communicates local delivery as an appointment and invalidates a quote after a CEP change", async () => {
      const { page, state } = await fixture([cartItem(1, 1)]);
      state.shippingMode = "local";
      try {
        await page.goto(`${origin}/checkout`);
        await page.getByLabel("CEP", { exact: true }).fill("70000000");
        await page.getByRole("button", { name: "Consultar CEP", exact: true }).click();
        await page.getByText(/Data a combinar/).first().waitFor();
        expect(await page.locator("body").innerText()).not.toContain("1 a 2 dias");
        await page.getByLabel("CEP", { exact: true }).fill("01001");
        await page.waitForFunction(() => !document.querySelector(".l4-checkout-shipping-options button"));
        expect(await page.locator(".l4-checkout-finish > button").isDisabled()).toBe(true);
        expect(state.charges).toBe(0); expect(state.errors).toEqual([]);
      } finally { await page.close(); }
    }, 60000);

    it("preserves purchase dates and distinguishes schedule changes in real order and tracking pages", async () => {
      const { page, state } = await fixture();
      try {
        await page.goto(`${origin}/meus-pedidos`);
        await page.getByText("Acompanhando produção", { exact: true }).first().waitFor();
        for (const route of ["/meus-pedidos/9001", "/acompanhar-pedido?pedido=9001"]) {
          await page.goto(`${origin}${route}`);
          await page.getByText(/Previsão de postagem registrada na compra entre 05\/11\/2026 e 12\/11\/2026/).first().waitFor();
          await page.getByText(/O cronograma do lote mudou/).first().waitFor();
          await page.getByText(/Fabricação estimada registrada na compra entre 10\/10\/2026 e 20\/10\/2026/).first().waitFor();
          await page.getByText(/O cronograma de fabricação mudou/).first().waitFor();
          await page.getByText(/Synthetic transport: Transporte estimado: 2 a 5 dias após a postagem/).first().waitFor();
          expect(await page.locator("body").innerText()).toContain("01/12/2100");
        }
        expect(state.charges).toBe(0); expect(state.errors).toEqual([]);
      } finally { await page.close(); }
    }, 60000);

    it("cancelled order explicitly does not claim cancelled charge or completed refund", async () => {
      const {page,state}=await fixture();state.orderStatus="cancelled";
      try {
        await page.goto(`${origin}/meus-pedidos/9001`);
        await page.getByText(/Pedido cancelado não significa cobrança cancelada ou reembolso concluído/).waitFor();
        expect(state.charges).toBe(0);expect(state.errors).toEqual([]);
      } finally {await page.close();}
    },60000);
    it("labels admin dates as UTC postage estimates and warns about historical purchase conditions", async () => {
      const { page, state } = await fixture();
      state.role = "admin";
      try {
        await page.goto(`${origin}/admin`);
        await page.getByRole("button", { name: "Lotes / Pré-venda", exact: true }).click();
        await page.getByLabel("Postagem estimada — início (UTC)", { exact: true }).waitFor();
        await page.getByLabel("Postagem estimada — fim (UTC)", { exact: true }).waitFor();
        await page.getByLabel("Início estimado da fabricação (data de Brasília)", {exact:true}).fill("2026-10-10");
        await page.getByLabel("Término estimado da fabricação (data de Brasília)", {exact:true}).fill("2026-10-20");
        await page.getByLabel("Nome", {exact:true}).fill("Synthetic manufacture");
        await page.getByText(/não substitui as condições registradas em pedidos anteriores/).first().waitFor();
        const saved = page.waitForResponse((response:any)=>response.url().includes("productionBatches.save"));
        await page.getByRole("button",{name:"Criar lote",exact:true}).click();
        await saved;
        expect(state.savedBatch).toMatchObject({estimatedManufacturingStart:"2026-10-10",estimatedManufacturingEnd:"2026-10-20"});
        expect(state.charges).toBe(0); expect(state.errors).toEqual([]);
      } finally { await page.close(); }
    }, 60000);

    it("discards a delayed quote for the previous CEP instead of restoring obsolete availability", async () => {
      const { page, state } = await fixture([cartItem(1, 1)]);
      state.shippingDelayMs = 1200;
      try {
        await page.goto(`${origin}/checkout`);
        await page.getByLabel("CEP", { exact: true }).fill("70000000");
        const requested = page.waitForRequest((request: any) => new URL(request.url()).pathname === "/api/shipping/quote");
        await page.getByRole("button", { name: "Consultar CEP", exact: true }).click();
        await requested;
        state.shippingDelayMs = 0; state.shippingMode = "empty";
        await page.getByLabel("CEP", { exact: true }).fill("01001000");
        await page.getByText(/Não há cotação disponível/).first().waitFor();
        await page.waitForTimeout(1400);
        expect(await page.locator(".l4-checkout-shipping-options button").count()).toBe(0);
        expect(await page.locator(".l4-checkout-finish > button").isDisabled()).toBe(true);
        expect(state.charges).toBe(0); expect(state.errors).toEqual([]);
      } finally { await page.close(); }
    }, 60000);

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
