export type CheckoutShippingAddress = {
  cep: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
};

export type CepLookupAddress = {
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
};

export type ShippingSelectionState<T> = {
  options: T[];
  selectedId: string | null;
  error: string;
};

export type CheckoutShippingAddressField = keyof CheckoutShippingAddress;

export function sanitizeCep(value: string) {
  return value.replace(/\D/g, "").slice(0, 8);
}

export function formatCep(value: string) {
  const digits = sanitizeCep(value);
  return digits.length <= 5 ? digits : `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

export function applyCepLookupToAddress(
  current: CheckoutShippingAddress,
  cep: string,
  lookup: CepLookupAddress,
): CheckoutShippingAddress {
  return {
    ...current,
    cep: sanitizeCep(cep),
    // Logradouro e bairro pertencem ao CEP consultado: nunca reutilize dados
    // de um endereço anterior quando o provedor não os informa.
    street: lookup.logradouro?.trim() ?? "",
    neighborhood: lookup.bairro?.trim() ?? "",
    city: lookup.localidade?.trim() ?? "",
    state: lookup.uf?.trim().toUpperCase().slice(0, 2) ?? "",
  };
}

export function updateCheckoutShippingAddress(
  current: CheckoutShippingAddress,
  field: CheckoutShippingAddressField,
  value: string,
): CheckoutShippingAddress {
  if (field === "cep") {
    return {
      ...current,
      cep: sanitizeCep(value),
      street: "",
      neighborhood: "",
      city: "",
      state: "",
    };
  }

  return {
    ...current,
    [field]: field === "state" ? value.toUpperCase().slice(0, 2) : value,
  };
}

export function getShippingAddressKey(address: CheckoutShippingAddress) {
  return [
    sanitizeCep(address.cep),
    address.state.trim().toUpperCase(),
    address.city.trim(),
    address.neighborhood.trim(),
    address.street.trim(),
    address.number.trim(),
  ].join("|");
}

export function invalidateShippingSelection<T>(): ShippingSelectionState<T> {
  return { options: [], selectedId: null, error: "" };
}
