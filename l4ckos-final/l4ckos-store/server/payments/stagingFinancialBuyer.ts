import { createHash } from "node:crypto";
import { assertRestrictedEmailRecipientsAllowed } from "../services/email/recipientPolicy.js";
// Exact owner-authorized financial test identity; this is not an email allowlist.
const BUYER = "073e42d05593f216f3fdb47f6833d7db695a3c6cd66ad597bfbd47e56e1e1209";
const exactBuyer = (email: string) => createHash("sha256").update(email.trim().toLowerCase()).digest("hex") === BUYER;
export function stagingFinancialScope() {
  const e = process.env;
  return e.NODE_ENV === "production" && e.RAILWAY_PROJECT_ID === "2bb90c8e-eb65-43ee-826b-f93750f0499c" &&
    e.RAILWAY_ENVIRONMENT_ID === "15545eee-bc02-4b70-afc4-19a5db9e6f46" && e.RAILWAY_SERVICE_ID === "9f1c7705-f2f9-48cf-b957-8f63a6bba4db" &&
    e.ASAAS_WEBHOOK_RECOVERY_MODE === "review_only" && e.EMAIL_MODE === "restricted";
}
export function assertSelectiveFinancialBuyer(email: string, notifications: boolean, method: string) {
  if (stagingFinancialScope() && exactBuyer(email)) {
    if (notifications !== false || !["PIX", "BOLETO", "CARD"].includes(method)) throw Error("STAGING_FINANCIAL_BUYER_SCOPE_INVALID");
    return;
  }
  assertRestrictedEmailRecipientsAllowed({ to: email });
}
