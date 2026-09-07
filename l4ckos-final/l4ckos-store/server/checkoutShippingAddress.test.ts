import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyCepLookupToAddress,
  getShippingAddressKey,
  invalidateShippingSelection,
  updateCheckoutShippingAddress,
  type CheckoutShippingAddress,
} from "../client/src/lib/checkoutShippingAddress";
import { quoteShippingDetailed } from "./services/shippingService";

const brasiliaAddress: CheckoutShippingAddress = {
  cep: "70000-000",
  street: "Quadra SQS 402 Bloco O",
  number: "201",
  complement: "",
  neighborhood: "Asa Sul",
  city: "Brasília",
  state: "DF",
};

const oldToken = process.env.MELHOR_ENVIO_TOKEN;
const oldPrefixes = process.env.LOCAL_DELIVERY_CEP_PREFIXES;

beforeEach(() => {
  delete process.env.MELHOR_ENVIO_TOKEN;
  process.env.LOCAL_DELIVERY_CEP_PREFIXES = "700,701,702,703,704,706,707,708,709";
});

afterEach(() => {
  if (oldToken === undefined) delete process.env.MELHOR_ENVIO_TOKEN;
  else process.env.MELHOR_ENVIO_TOKEN = oldToken;
  if (oldPrefixes === undefined) delete process.env.LOCAL_DELIVERY_CEP_PREFIXES;
  else process.env.LOCAL_DELIVERY_CEP_PREFIXES = oldPrefixes;
});

describe("checkout shipping effective address", () => {
  it("A. mostra entrega local somente para o endereço efetivo elegível de Brasília", async () => {
    const [quote, normalizedQuote, incompleteQuote] = await Promise.all([
      quoteShippingDetailed({ cep: brasiliaAddress.cep, itemCount: 1, subtotal: 99, address: brasiliaAddress }),
      quoteShippingDetailed({ cep: brasiliaAddress.cep, itemCount: 1, subtotal: 99, address: { city: "  brasilia ", state: " df " } }),
      quoteShippingDetailed({ cep: brasiliaAddress.cep, itemCount: 1, subtotal: 99 }),
    ]);

    expect(quote.options.map(option => option.id)).toContain("local-plano-piloto");
    expect(normalizedQuote.options.map(option => option.id)).toContain("local-plano-piloto");
    expect(incompleteQuote.options).toEqual([]);
  });

  it("B. troca Brasília por Assis Brasil sem reutilizar rua/bairro e invalida a cotação anterior", async () => {
    const next = applyCepLookupToAddress(brasiliaAddress, "69935-000", {
      localidade: "Assis Brasil",
      uf: "AC",
    });
    const invalidated = invalidateShippingSelection<{ id: string }>();
    const quote = await quoteShippingDetailed({ cep: next.cep, itemCount: 1, subtotal: 99, address: next });

    expect(next).toMatchObject({ cep: "69935000", street: "", neighborhood: "", city: "Assis Brasil", state: "AC", number: "201" });
    expect(invalidated).toEqual({ options: [], selectedId: null, error: "" });
    expect(quote.options).toEqual([]);
  });

  it("C. usa o formulário editado, e não o endereço salvo, para decidir entrega local", async () => {
    const editedForm = { ...brasiliaAddress, cep: "69935000", street: "", neighborhood: "", city: "Assis Brasil", state: "AC" };
    const quote = await quoteShippingDetailed({ cep: editedForm.cep, itemCount: 1, subtotal: 99, address: editedForm });

    expect(getShippingAddressKey(editedForm)).not.toBe(getShippingAddressKey(brasiliaAddress));
    expect(quote.options).toEqual([]);
  });

  it("D. CEP externo sem cotação nacional deixa somente frete indisponível", async () => {
    const quote = await quoteShippingDetailed({
      cep: "69935000",
      itemCount: 1,
      subtotal: 99,
      address: { city: "Assis Brasil", state: "AC" },
    });

    expect(quote.options).toEqual([]);
    expect(quote.warning).toContain("Frete indisponível");
  });

  it("E. entrega local reaparece apenas quando o formulário volta a Brasília/DF elegível", async () => {
    const restored = applyCepLookupToAddress({ ...brasiliaAddress, cep: "69935000", street: "", neighborhood: "", city: "Assis Brasil", state: "AC" }, "70000-000", {
      logradouro: "SQS 402",
      bairro: "Asa Sul",
      localidade: "Brasília",
      uf: "DF",
    });
    const quote = await quoteShippingDetailed({ cep: restored.cep, itemCount: 1, subtotal: 99, address: restored });

    expect(quote.options.map(option => option.id)).toContain("local-plano-piloto");
  });

  it("F. alterar um campo relevante após selecionar frete limpa métodos e seleção", () => {
    const changed = updateCheckoutShippingAddress(brasiliaAddress, "street", "Rua nova");
    const invalidated = invalidateShippingSelection<{ id: string }>();

    expect(changed.street).toBe("Rua nova");
    expect(invalidated.options).toEqual([]);
    expect(invalidated.selectedId).toBeNull();
    expect(invalidated.error).toBe("");
  });
});
