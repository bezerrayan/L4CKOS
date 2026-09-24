import { describe, expect, it } from "vitest";
import { getCheckoutValidationMessage, getMissingCheckoutFields, type CheckoutCompletionInput } from "../client/src/lib/checkoutValidation";

const completeCheckout: CheckoutCompletionInput = {
  isAuthenticated: true,
  customerName: "Cliente Staging",
  customerEmail: "cliente@example.test",
  cpfCnpj: "cpf-digitado",
  cep: "70000-000",
  street: "Rua de Teste",
  number: "100",
  neighborhood: "Centro de Testes",
  city: "Brasília",
  state: "DF",
  hasSelectedShipping: true,
};

describe("checkout completion feedback", () => {
  it("A. habilita o checkout quando todos os requisitos atuais estão presentes", () => {
    expect(getMissingCheckoutFields(completeCheckout)).toEqual([]);
    expect(getCheckoutValidationMessage([])).toBeNull();
  });

  it("B. identifica CPF/CNPJ ausente sem expor o seu valor", () => {
    const missing = getMissingCheckoutFields({ ...completeCheckout, cpfCnpj: "" });

    expect(missing).toEqual(["cpfCnpj"]);
    expect(getCheckoutValidationMessage(missing)).toBe("Informe seu CPF ou CNPJ.");
  });

  it("C. identifica número do endereço ausente", () => {
    const missing = getMissingCheckoutFields({ ...completeCheckout, number: "  " });

    expect(missing).toEqual(["number"]);
    expect(getCheckoutValidationMessage(missing)).toBe("Informe o número do endereço.");
  });

  it("D. identifica bairro ausente", () => {
    const missing = getMissingCheckoutFields({ ...completeCheckout, neighborhood: "" });

    expect(missing).toEqual(["neighborhood"]);
    expect(getCheckoutValidationMessage(missing)).toBe("Informe o bairro.");
  });

  it("E. identifica frete ainda não selecionado", () => {
    const missing = getMissingCheckoutFields({ ...completeCheckout, hasSelectedShipping: false });

    expect(missing).toEqual(["shipping"]);
    expect(getCheckoutValidationMessage(missing)).toBe("Selecione uma opção de entrega.");
  });

  it("F. considera CPF/CNPJ digitado como preenchido sem alterar o seu valor", () => {
    const typedCpfCnpj = "cpf-digitado";
    const missing = getMissingCheckoutFields({ ...completeCheckout, cpfCnpj: typedCpfCnpj });

    expect(missing).not.toContain("cpfCnpj");
    expect(getCheckoutValidationMessage(missing)).toBeNull();
  });
});
