import { getOrderById, getUserById, getUserPhoneById } from "../db";
import { createAsaasStockChargeForOrder, fetchAsaasPixQrCode } from "../services/asaas";
import { createProductionAsaasStockPaymentProvider, createSandboxAsaasStockPaymentProvider } from "./asaasStockPaymentProvider";
import { isProductionStockRuntimeIdentity } from "../_core/productionFinancialPolicy";
import { getAllowedOrigins } from "../_core/corsPolicy";

/** Uses only the configured storefront origin and returns to the order follow-up page (/pedido/retorno). */
export function getStockHostedCardReturnUrl(environment: NodeJS.ProcessEnv = process.env): string | null {
  const configured = environment.FRONTEND_URL?.trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    const allowedOrigins = getAllowedOrigins({
      isProduction: environment.NODE_ENV === "production",
      configuredOrigins: environment.CORS_ORIGINS,
    });
    if (url.protocol !== "https:" || !allowedOrigins.some(origin => new URL(origin).origin === url.origin)) return null;
    // The storefront order follow-up page. Coming back from the hosted card page proves nothing about the payment:
    // that page reads the backend state and only a validated provider event confirms an order.
    return new URL("/pedido/retorno", url.origin).toString();
  } catch {
    return null;
  }
}

/** Bridges STOCK's stable provider contract to the existing Asaas charge code. */
export function createConfiguredStockAsaasProvider() {
  const create = isProductionStockRuntimeIdentity(process.env) ? createProductionAsaasStockPaymentProvider : createSandboxAsaasStockPaymentProvider;
  return create({
    loadBuyer: async orderId => {
      const order = await getOrderById(Number(orderId));
      if (!order?.stockAttemptId) return null;
      const user = await getUserById(order.userId);
      if (!user) return null;
      return {
        name: user.name ?? "",
        email: user.email ?? "",
        cpfCnpj: user.cpf ?? "",
        mobilePhone: user.phone || await getUserPhoneById(user.id) || undefined,
      };
    },
    createCharge: async args => {
      const result = await createAsaasStockChargeForOrder(args);
      return { paymentId: result.paymentId, checkoutUrl: result.invoiceUrl, customerId: result.customerId ?? null, pixQrCode: result.pixQrCode, pixCopyPaste: result.pixCopyPaste };
    },
    getCardReturnUrl: () => getStockHostedCardReturnUrl(),
    getPixQrCode: (paymentId, signal) => fetchAsaasPixQrCode(paymentId, signal),
  });
}
