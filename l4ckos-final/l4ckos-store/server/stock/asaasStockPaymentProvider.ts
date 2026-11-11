import type { StockPaymentProvider } from "./stockCheckout";

export const ASAAS_SANDBOX_API_URL = "https://api-sandbox.asaas.com/v3";
const ASAAS_SANDBOX_CHECKOUT_HOST = "sandbox.asaas.com";

export type StockAsaasBuyer = {
  name: string;
  email: string;
  cpfCnpj: string;
  mobilePhone?: string;
};

export type StockAsaasChargeResult = {
  paymentId: string;
  checkoutUrl: string | null;
};

/**
 * STOCK uses the existing Asaas charge flow, but this adapter refuses to exist
 * unless the runtime explicitly confirms the sandbox endpoint. Asaas does not
 * provide a server-enforced idempotency key for this create-payment operation;
 * the STOCK state machine therefore never retries an uncertain create call.
 */
export function createSandboxAsaasStockPaymentProvider(input: {
  environment?: NodeJS.ProcessEnv;
  loadBuyer(orderId: string): Promise<StockAsaasBuyer | null>;
  createCharge(args: {
    orderId: number;
    value: number;
    method: "PIX";
    customer: { name: string; cpfCnpj: string; email: string; mobilePhone?: string };
    description: string;
    signal?: AbortSignal;
  }): Promise<StockAsaasChargeResult>;
}): StockPaymentProvider {
  const environment = input.environment ?? process.env;
  assertSandboxConfiguration(environment);

  return {
    supportsIdempotencyKey: false,
    async createPayment({ orderId, amountCents, idempotencyKey }) {
      assertSandboxConfiguration(environment);
      if (idempotencyKey !== `stock:${orderId}`) throw new Error("STOCK_PAYMENT_KEY_MISMATCH");
      const numericOrderId = Number(orderId);
      if (!Number.isSafeInteger(numericOrderId) || numericOrderId <= 0) throw new Error("STOCK_ORDER_ID_INVALID");
      if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new Error("STOCK_PAYMENT_AMOUNT_INVALID");

      const buyer = await input.loadBuyer(orderId);
      if (!buyer?.name.trim() || !buyer.email.trim() || !buyer.cpfCnpj.trim()) {
        throw new Error("STOCK_PAYMENT_BUYER_INCOMPLETE");
      }
      const charge = await input.createCharge({
        orderId: numericOrderId,
        value: amountCents / 100,
        method: "PIX",
        customer: buyer,
        description: `Pedido STOCK #${numericOrderId}`,
        signal: AbortSignal.timeout(15_000),
      });
      if (!charge.paymentId.trim() || !isSandboxCheckoutUrl(charge.checkoutUrl)) {
        // The remote charge may exist. Let the caller persist an ambiguous state;
        // never make a second create request to try to repair the response.
        throw new Error("STOCK_PAYMENT_RESPONSE_INCOMPLETE");
      }
      return { paymentId: charge.paymentId, checkoutUrl: charge.checkoutUrl };
    },
  };
}

function isSandboxCheckoutUrl(value: string | null): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === ASAAS_SANDBOX_CHECKOUT_HOST;
  } catch {
    return false;
  }
}

export function assertSandboxConfiguration(environment: NodeJS.ProcessEnv): void {
  if (environment.STOCK_ASAAS_MODE !== "sandbox" || environment.ASAAS_API_URL?.trim().replace(/\/+$/, "") !== ASAAS_SANDBOX_API_URL) {
    throw new Error("STOCK_ASAAS_SANDBOX_REQUIRED");
  }
  if (!environment.ASAAS_API_KEY?.trim()) throw new Error("STOCK_ASAAS_SANDBOX_KEY_REQUIRED");
}
