import { sanitizeCep } from "./checkoutShippingAddress";

export type CheckoutCompletionInput = {
  isAuthenticated: boolean;
  customerName: string;
  customerEmail: string;
  cpfCnpj: string;
  cep: string;
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  hasSelectedShipping: boolean;
};

export type MissingCheckoutField =
  | "authentication"
  | "name"
  | "email"
  | "cpfCnpj"
  | "cep"
  | "street"
  | "number"
  | "neighborhood"
  | "city"
  | "state"
  | "shipping";

const fieldLabels: Record<MissingCheckoutField, string> = {
  authentication: "Faça login para finalizar a compra.",
  name: "Informe seu nome completo.",
  email: "Informe seu e-mail.",
  cpfCnpj: "Informe seu CPF ou CNPJ.",
  cep: "Informe um CEP válido.",
  street: "Informe a rua do endereço.",
  number: "Informe o número do endereço.",
  neighborhood: "Informe o bairro.",
  city: "Informe a cidade.",
  state: "Informe a UF.",
  shipping: "Selecione uma opção de entrega.",
};

export function getMissingCheckoutFields(input: CheckoutCompletionInput): MissingCheckoutField[] {
  const missing: MissingCheckoutField[] = [];

  if (!input.isAuthenticated) missing.push("authentication");
  if (!input.customerName.trim()) missing.push("name");
  if (!input.customerEmail.trim()) missing.push("email");
  if (!input.cpfCnpj.trim()) missing.push("cpfCnpj");
  if (sanitizeCep(input.cep).length !== 8) missing.push("cep");
  if (!input.street.trim()) missing.push("street");
  if (!input.number.trim()) missing.push("number");
  if (!input.neighborhood.trim()) missing.push("neighborhood");
  if (!input.city.trim()) missing.push("city");
  if (!input.state.trim()) missing.push("state");
  if (!input.hasSelectedShipping) missing.push("shipping");

  return missing;
}

export function getCheckoutValidationMessage(missing: MissingCheckoutField[]) {
  if (missing.length === 0) return null;
  if (missing.length === 1) return fieldLabels[missing[0]];

  return `Preencha os campos obrigatórios: ${missing.map(field => fieldLabels[field].replace(/[.!]$/, "")).join(", ")}.`;
}
