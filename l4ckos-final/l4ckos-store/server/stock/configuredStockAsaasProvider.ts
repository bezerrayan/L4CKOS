import { getOrderById, getUserById, getUserPhoneById } from "../db";
import { createAsaasChargeForOrder } from "../services/asaas";
import { createSandboxAsaasStockPaymentProvider } from "./asaasStockPaymentProvider";

/** Bridges STOCK's stable provider contract to the existing Asaas charge code. */
export function createConfiguredStockAsaasProvider() {
  return createSandboxAsaasStockPaymentProvider({
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
      const result = await createAsaasChargeForOrder(args);
      return { paymentId: result.paymentId, checkoutUrl: result.invoiceUrl };
    },
  });
}
