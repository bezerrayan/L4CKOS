export type AsaasRequestPhase = "preflight" | "customer_create" | "customer_verify" | "payment_create" | "pix_qr_lookup";
export type AsaasRequestCategory = "configuration" | "invalid_request" | "network" | "provider_rejection" | "invalid_response" | "unknown";

/** Sanitized Asaas failure metadata. The response body and request are deliberately never retained. */
export class AsaasRequestFailure extends Error {
  constructor(
    readonly phase: AsaasRequestPhase,
    readonly category: AsaasRequestCategory,
    readonly definitelyNotCreated: boolean,
    readonly httpStatus?: number,
  ) {
    super(`ASAAS_${phase.toUpperCase()}_${category.toUpperCase()}`);
    this.name = "AsaasRequestFailure";
  }
}
