import type { StockPaymentProvider } from "./stockCheckout";
import { parseStockPaymentReference } from "./stockPaymentReference";
import { isFinancialSandboxPhase, resolveFinancialPhasePolicy } from "../_core/financialPhasePolicy";
import { ASAAS_PRODUCTION_CHECKOUT_HOST, assertProductionStockPolicy } from "../_core/productionFinancialPolicy";

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
  /** Provider customer created for this charge (identifier only); persisted as the durable customer link. */
  customerId?: string | null;
};

/**
 * STOCK uses the existing Asaas charge flow, but this adapter refuses to exist
 * unless the runtime explicitly confirms the sandbox endpoint. Asaas does not
 * provide a server-enforced idempotency key for this create-payment operation;
 * the STOCK state machine therefore never retries an uncertain create call.
 */
type StockProviderInput = {
  environment?: NodeJS.ProcessEnv;
  loadBuyer(orderId: string): Promise<StockAsaasBuyer | null>;
  createCharge(args: {
    orderId: number;
    value: number;
    method: "PIX";
    customer: { name: string; cpfCnpj: string; email: string; mobilePhone?: string };
    description: string;
    /** Strong attempt reference. When absent the legacy numeric order reference is used. */
    externalReference?: string;
    signal?: AbortSignal;
  }): Promise<StockAsaasChargeResult>;
};
type StockProviderMode = { assertConfiguration(environment: NodeJS.ProcessEnv): void; isCheckoutUrl(value: string | null): value is string };

export function createSandboxAsaasStockPaymentProvider(input: StockProviderInput): StockPaymentProvider {
  return createAsaasStockPaymentProvider(input, { assertConfiguration: assertSandboxConfiguration, isCheckoutUrl: isSandboxCheckoutUrl });
}

/** Production adapter: exists only when the explicit production contract (identity, DB, Asaas production, webhook binding) holds. */
export function createProductionAsaasStockPaymentProvider(input: StockProviderInput): StockPaymentProvider {
  return createAsaasStockPaymentProvider(input, { assertConfiguration: assertProductionConfiguration, isCheckoutUrl: isProductionCheckoutUrl });
}

function createAsaasStockPaymentProvider(input: StockProviderInput, mode: StockProviderMode): StockPaymentProvider {
  const environment = input.environment ?? process.env;
  mode.assertConfiguration(environment);

  return {
    supportsIdempotencyKey: false,
    async createPayment({ orderId, amountCents, idempotencyKey, externalReference }) {
      mode.assertConfiguration(environment);
      const referenceToken = externalReference ? (parseStockPaymentReference(externalReference).kind === "strong" ? externalReference.slice(externalReference.lastIndexOf(":") + 1) : null) : "";
      if (referenceToken === null) throw new Error("STOCK_PAYMENT_REFERENCE_INVALID"); // a non-strong custom reference is never accepted
      if (idempotencyKey !== (referenceToken ? `stock:${orderId}:${referenceToken}` : `stock:${orderId}`)) throw new Error("STOCK_PAYMENT_KEY_MISMATCH");
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
        ...(externalReference ? { externalReference } : {}),
        signal: AbortSignal.timeout(15_000),
      });
      if (!charge.paymentId.trim() || !mode.isCheckoutUrl(charge.checkoutUrl)) {
        // The remote charge may exist. Let the caller persist an ambiguous state;
        // never make a second create request to try to repair the response.
        throw new Error("STOCK_PAYMENT_RESPONSE_INCOMPLETE");
      }
      return { paymentId: charge.paymentId, checkoutUrl: charge.checkoutUrl, customerId: charge.customerId ?? null };
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

function isProductionCheckoutUrl(value: string | null): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === ASAAS_PRODUCTION_CHECKOUT_HOST;
  } catch {
    return false;
  }
}

export function assertProductionConfiguration(environment: NodeJS.ProcessEnv): void {
  try { assertProductionStockPolicy(environment); } catch { throw new Error("STOCK_ASAAS_PRODUCTION_CONFIGURATION_INVALID"); }
}

export function assertSandboxConfiguration(environment: NodeJS.ProcessEnv): void {
  if (environment.STOCK_ASAAS_MODE !== "sandbox" || environment.ASAAS_API_URL?.trim().replace(/\/+$/, "") !== ASAAS_SANDBOX_API_URL) {
    throw new Error("STOCK_ASAAS_SANDBOX_REQUIRED");
  }
  const sandboxPhase = isFinancialSandboxPhase(environment.G4_FINANCIAL_PHASE);
  if (sandboxPhase && (!resolveFinancialPhasePolicy(environment).allowed || environment.ASAAS_API_KEY?.trim())) {
    throw new Error("STOCK_ASAAS_SANDBOX_PHASE_INVALID");
  }
  if (!(sandboxPhase ? environment.ASAAS_SANDBOX_API_KEY : environment.ASAAS_API_KEY)?.trim()) {
    throw new Error("STOCK_ASAAS_SANDBOX_KEY_REQUIRED");
  }
}
