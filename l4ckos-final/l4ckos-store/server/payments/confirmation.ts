import { z } from "zod";

export type PaymentConfirmationRecord = {
  paymentStatus?: string | null;
  paymentConfirmationSource?: string | null;
  paymentConfirmedAt?: Date | string | null;
  paymentConfirmedBy?: number | null;
  paymentConfirmationReference?: string | null;
};

export type TrustedPaymentConfirmation =
  | {
      source: "asaas_webhook";
      reference: string;
      confirmedAt?: Date;
    }
  | {
      source: "manual";
      actorUserId: number;
      confirmedAt?: Date;
    };

export const manualPaymentConfirmationInputSchema = z
  .object({
    orderId: z.number().int().positive(),
  })
  .strict();

export function isTrustedPaymentConfirmation(record: PaymentConfirmationRecord) {
  if (record.paymentStatus !== "confirmed" || !record.paymentConfirmedAt) {
    return false;
  }

  if (record.paymentConfirmationSource === "manual") {
    return Number.isInteger(record.paymentConfirmedBy) && Number(record.paymentConfirmedBy) > 0;
  }

  if (record.paymentConfirmationSource === "asaas_webhook") {
    return Boolean(String(record.paymentConfirmationReference ?? "").trim());
  }

  return false;
}

export function buildPaymentConfirmationValues(confirmation: TrustedPaymentConfirmation) {
  const confirmedAt = confirmation.confirmedAt ?? new Date();

  if (confirmation.source === "manual") {
    return {
      paymentStatus: "confirmed" as const,
      paymentConfirmationSource: "manual" as const,
      paymentConfirmedAt: confirmedAt,
      paymentConfirmedBy: confirmation.actorUserId,
      paymentConfirmationReference: null,
    };
  }

  return {
    paymentStatus: "confirmed" as const,
    paymentConfirmationSource: "asaas_webhook" as const,
    paymentConfirmedAt: confirmedAt,
    paymentConfirmedBy: null,
    paymentConfirmationReference: confirmation.reference.trim(),
  };
}
