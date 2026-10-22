/** Commercial launch policy. Re-enabling a method requires an explicit reviewed release.
 * Never use environment defaults or historical billing types as purchase authorization.
 * Historical payment/webhook types deliberately remain unchanged.
 */
export type CheckoutMethod = "PIX" | "CARD" | "BOLETO";
export const CHECKOUT_METHOD_POLICY = Object.freeze({ PIX: true, CARD: true, BOLETO: false });
export const ENABLED_CHECKOUT_METHODS: readonly CheckoutMethod[] = Object.freeze(
  (["PIX", "CARD", "BOLETO"] as CheckoutMethod[]).filter(method => CHECKOUT_METHOD_POLICY[method])
);
export const DEFAULT_CHECKOUT_METHOD: CheckoutMethod = "PIX";
export const DEFAULT_CHECKOUT_BILLING_TYPES = Object.freeze(["PIX", "CREDIT_CARD"] as const);
export const CHECKOUT_METHOD_DISABLED_MESSAGE = "Forma de pagamento indisponível. Escolha PIX ou cartão de crédito.";
export class CheckoutMethodDisabledError extends Error {
  readonly code = "CHECKOUT_PAYMENT_METHOD_DISABLED";
  constructor() { super(CHECKOUT_METHOD_DISABLED_MESSAGE); }
}
export function isCheckoutMethodEnabled(method: unknown): method is CheckoutMethod {
  return typeof method === "string" && Object.hasOwn(CHECKOUT_METHOD_POLICY, method) &&
    CHECKOUT_METHOD_POLICY[method as CheckoutMethod] === true;
}
export function assertCheckoutMethodEnabled(method: unknown): void {
  if (!isCheckoutMethodEnabled(method)) throw new CheckoutMethodDisabledError();
}
export function assertEnabledBillingTypes(types: unknown): void {
  if (!Array.isArray(types) || types.length === 0 ||
      !Array.from(types).every(type => (type === "PIX" && isCheckoutMethodEnabled("PIX")) ||
        (type === "CREDIT_CARD" && isCheckoutMethodEnabled("CARD"))))
    throw new CheckoutMethodDisabledError();
}
