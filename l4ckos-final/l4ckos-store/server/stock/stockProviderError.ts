export type StockProviderPhase =
  | "preflight"
  | "buyer_lookup"
  | "customer_create"
  | "customer_verify"
  | "payment_create"
  | "pix_qr_lookup"
  | "payment_correlation";

export type StockProviderErrorCategory =
  | "configuration"
  | "invalid_request"
  | "network"
  | "provider_rejection"
  | "invalid_response"
  | "unknown"
  | "persistence";

/** Safe classification only; never carries provider payloads, identifiers, or buyer data. */
export class StockProviderError extends Error {
  readonly phase: StockProviderPhase;
  readonly category: StockProviderErrorCategory;
  readonly httpStatus?: number;

  constructor(
    message: string,
    public readonly definitelyNotCreated: boolean,
    metadata: { phase?: StockProviderPhase; category?: StockProviderErrorCategory; httpStatus?: number } = {},
  ) {
    super(message);
    this.name = "StockProviderError";
    this.phase = metadata.phase ?? "payment_create";
    this.category = metadata.category ?? (definitelyNotCreated ? "invalid_request" : "unknown");
    if (Number.isInteger(metadata.httpStatus) && metadata.httpStatus! >= 100 && metadata.httpStatus! <= 599) {
      this.httpStatus = metadata.httpStatus;
    }
  }
}
