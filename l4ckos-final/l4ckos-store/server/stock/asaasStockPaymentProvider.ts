import type { StockPaymentProvider } from "./stockCheckout";
import { stockPixPaymentV1Schema, type StockPixPaymentV1 } from "../../shared/stockCheckoutV1";
import { StockProviderError, type StockProviderErrorCategory, type StockProviderPhase } from "./stockProviderError";
import { AsaasRequestFailure } from "../services/asaasRequestFailure";
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
  /** Raw PIX data when the charge adapter already obtained it (best effort; absent when the QR lookup failed). */
  pixQrCode?: string | null;
  pixCopyPaste?: string | null;
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
  /** Read-only PIX lookup for an existing charge. Never creates anything. */
  getPixQrCode?(paymentId: string, signal?: AbortSignal): Promise<{ qrCodeBase64: string | null; copyPaste: string | null } | null>;
};

/** Normalizes provider PIX data to the strict wire shape; anything malformed is dropped (never trusted, never logged). */
export function toStockPixPayment(qrCodeBase64: string | null | undefined, copyPaste: string | null | undefined): StockPixPaymentV1 | undefined {
  const image = typeof qrCodeBase64 === "string" ? qrCodeBase64.replace(/^data:image\/png;base64,/, "").trim() : "";
  const text = typeof copyPaste === "string" ? copyPaste.trim() : "";
  const full = stockPixPaymentV1Schema.safeParse({ ...(image ? { qrCodeBase64: image } : {}), ...(text ? { copyPaste: text } : {}) });
  if (full.success) return full.data;
  // One malformed half must not discard the other.
  for (const part of [text ? { copyPaste: text } : null, image ? { qrCodeBase64: image } : null]) {
    if (!part) continue;
    const parsed = stockPixPaymentV1Schema.safeParse(part);
    if (parsed.success) return parsed.data;
  }
  return undefined;
}
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
    async getPixPayment(paymentId, signal) {
      if (!input.getPixQrCode) return null;
      try {
        const pix = await input.getPixQrCode(paymentId, signal ?? AbortSignal.timeout(10_000));
        return pix ? toStockPixPayment(pix.qrCodeBase64, pix.copyPaste) ?? null : null;
      } catch {
        // Read-only and best effort: the Asaas link remains the fallback and nothing is created or retried.
        console.warn("[StockPayment] pix_lookup_unavailable", { phase: "pix_qr_lookup" });
        return null;
      }
    },
    async createPayment({ orderId, amountCents, idempotencyKey, externalReference }) {
      try {
        mode.assertConfiguration(environment);
      } catch {
        const code = environment.STOCK_ASAAS_MODE === "production"
          ? "STOCK_ASAAS_PRODUCTION_CONFIGURATION_INVALID"
          : "STOCK_ASAAS_CONFIGURATION_INVALID";
        throw new StockProviderError(code, true, { phase: "preflight", category: "configuration" });
      }
      const referenceToken = externalReference ? (parseStockPaymentReference(externalReference).kind === "strong" ? externalReference.slice(externalReference.lastIndexOf(":") + 1) : null) : "";
      if (referenceToken === null) throw new StockProviderError("STOCK_PAYMENT_REFERENCE_INVALID", true, { phase: "preflight", category: "invalid_request" }); // a non-strong custom reference is never accepted
      if (idempotencyKey !== (referenceToken ? `stock:${orderId}:${referenceToken}` : `stock:${orderId}`)) throw new StockProviderError("STOCK_PAYMENT_KEY_MISMATCH", true, { phase: "preflight", category: "invalid_request" });
      const numericOrderId = Number(orderId);
      if (!Number.isSafeInteger(numericOrderId) || numericOrderId <= 0) throw new StockProviderError("STOCK_ORDER_ID_INVALID", true, { phase: "preflight", category: "invalid_request" });
      if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new StockProviderError("STOCK_PAYMENT_AMOUNT_INVALID", true, { phase: "preflight", category: "invalid_request" });

      let buyer: StockAsaasBuyer | null;
      try {
        buyer = await input.loadBuyer(orderId);
      } catch {
        throw new StockProviderError("STOCK_PAYMENT_BUYER_LOOKUP_FAILED", true, { phase: "buyer_lookup", category: "unknown" });
      }
      if (!buyer?.name.trim() || !buyer.email.trim() || !buyer.cpfCnpj.trim()) {
        throw new StockProviderError("STOCK_PAYMENT_BUYER_INCOMPLETE", true, { phase: "buyer_lookup", category: "invalid_request" });
      }
      let charge: StockAsaasChargeResult;
      try {
        charge = await input.createCharge({
          orderId: numericOrderId,
          value: amountCents / 100,
          method: "PIX",
          customer: buyer,
          description: `Pedido STOCK #${numericOrderId}`,
          ...(externalReference ? { externalReference } : {}),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (error) {
        if (error instanceof AsaasRequestFailure) {
          const phase = toStockPhase(error.phase);
          const category = toStockCategory(error.category);
          throw new StockProviderError("STOCK_ASAAS_REQUEST_FAILED", error.definitelyNotCreated, {
            phase, category, ...(error.httpStatus ? { httpStatus: error.httpStatus } : {}),
          });
        }
        // Untyped exceptions around the financial adapter could be post-POST. Keep them ambiguous.
        throw new StockProviderError("STOCK_ASAAS_OUTCOME_UNKNOWN", false, { phase: "payment_create", category: "unknown" });
      }
      if (typeof charge.paymentId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(charge.paymentId.trim())) {
        throw new StockProviderError("STOCK_PAYMENT_RESPONSE_INCOMPLETE", false, { phase: "payment_create", category: "invalid_response" });
      }
      const checkoutUrl = mode.isCheckoutUrl(charge.checkoutUrl) ? charge.checkoutUrl : null;
      if (!checkoutUrl) console.warn("[StockPayment] checkout_url_unavailable", { phase: "payment_create", category: "invalid_response" });
      // A valid provider ID must survive missing/invalid checkout URL; caller persists the correlation and never recreates.
      const pix = toStockPixPayment(charge.pixQrCode, charge.pixCopyPaste);
      return { paymentId: charge.paymentId, checkoutUrl, customerId: charge.customerId ?? null, ...(pix ? { pix } : {}) };
    },
  };
}

function toStockPhase(phase: AsaasRequestFailure["phase"]): StockProviderPhase {
  return phase;
}

function toStockCategory(category: AsaasRequestFailure["category"]): StockProviderErrorCategory {
  return category;
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
