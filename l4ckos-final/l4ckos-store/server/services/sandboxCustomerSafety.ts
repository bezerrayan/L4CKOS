import { getAsaasConfig } from "./asaasConfig";
export type SilentCustomer = { id: string; notificationDisabled?: boolean };
export const sandboxSilenceRequired = () => getAsaasConfig().apiUrl === "https://api-sandbox.asaas.com/v3";
export function assertSilentCustomer(id: string, customer: SilentCustomer) {
  if (!id || customer?.id !== id || customer.notificationDisabled !== true)
    throw Error("ASAAS_SANDBOX_CUSTOMER_NOTIFICATIONS_NOT_DISABLED");
}
export async function verifySandboxCustomer(id: string, load: () => Promise<SilentCustomer>) {
  if (!sandboxSilenceRequired()) return;
  let customer: SilentCustomer;
  try { customer = await load(); } catch { throw Error("ASAAS_SANDBOX_CUSTOMER_VERIFICATION_FAILED"); }
  assertSilentCustomer(id, customer);
}
