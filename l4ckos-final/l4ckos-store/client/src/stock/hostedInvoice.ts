/**
 * The hosted Asaas invoice URL comes from the backend, but the browser still only navigates to the exact Asaas
 * checkout host of the environment it was built for: production -> www.asaas.com, anything else -> sandbox.asaas.com.
 */
export const ASAAS_PRODUCTION_INVOICE_HOST = "www.asaas.com";
export const ASAAS_SANDBOX_INVOICE_HOST = "sandbox.asaas.com";

export function isTrustedHostedInvoiceUrl(value: unknown, deployTarget: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const production = String(deployTarget ?? "").trim().toLowerCase() === "production";
  return url.hostname === (production ? ASAAS_PRODUCTION_INVOICE_HOST : ASAAS_SANDBOX_INVOICE_HOST);
}
