export type StockShippingAddressV1 = {
  recipient: string;
  zipCode: string;
  street: string;
  number: string;
  complement?: string;
  neighborhood: string;
  city: string;
  state: string;
};

export type StockShippingMethodV1 = "local_scheduled" | "carrier";

/** Values authorized by a server-issued quote and suitable for an order snapshot. */
export type StockShippingAcceptanceV1 = {
  version: 1;
  method: StockShippingMethodV1;
  optionId: string;
  carrier: string | null;
  serviceId: string;
  serviceName: string;
  quoteReference: string;
  providerQuoteId: string | null;
  currency: "BRL";
  shippingPriceCents: number;
  destinationZipCode: string;
  address: StockShippingAddressV1;
  package: {
    heightCm: number;
    widthCm: number;
    lengthCm: number;
    weightGrams: number;
  };
  itemCount: number;
  merchandiseSubtotalCents: number;
};
