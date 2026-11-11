/** Approved local delivery territory from stock-checkout P12: CEP 70000-000–73999-999. */
export const LOCAL_DELIVERY_CEP_MIN = "70000000";
export const LOCAL_DELIVERY_CEP_MAX = "73999999";

export function isLocalDeliveryCep(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const cep = value.replace(/\D/g, "");
  return cep.length === 8 && cep >= LOCAL_DELIVERY_CEP_MIN && cep <= LOCAL_DELIVERY_CEP_MAX;
}
