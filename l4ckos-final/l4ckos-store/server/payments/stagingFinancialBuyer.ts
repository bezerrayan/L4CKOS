import { createHash } from "node:crypto";
import { assertRestrictedEmailRecipientsAllowed } from "../services/email/recipientPolicy.js";
import { isApprovedStagingIdentity } from "../_core/railwayEnvironment";
// Exact owner-authorized financial test identity; this is not an email allowlist.
const BUYER = "073e42d05593f216f3fdb47f6833d7db695a3c6cd66ad597bfbd47e56e1e1209";
const exactBuyer = (email: string) => createHash("sha256").update(email.trim().toLowerCase()).digest("hex") === BUYER;
export function stagingFinancialScope() {
  const e = process.env;
  return e.NODE_ENV === "production" && isApprovedStagingIdentity(e) &&
    e.ASAAS_WEBHOOK_RECOVERY_MODE === "review_only" && e.EMAIL_MODE === "restricted";
}
export function assertSelectiveFinancialBuyer(email: string, notifications: boolean, method: string) {
  if (stagingFinancialScope() && exactBuyer(email)) {
    if (notifications !== false || !["PIX", "BOLETO", "CARD"].includes(method)) throw Error("STAGING_FINANCIAL_BUYER_SCOPE_INVALID");
    return;
  }
  assertRestrictedEmailRecipientsAllowed({ to: email });
}
