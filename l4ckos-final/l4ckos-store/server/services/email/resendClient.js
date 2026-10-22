import { Resend } from "resend";
import { assertEmailRecipientsAllowed, isStagingEmailEnvironment, EmailPolicyError } from "./recipientPolicy.js";

let resendClient = null;

// Never expose the raw SDK in staging: generic HTTP methods would bypass the
// recipient policy. The facade also rechecks configuration on every invocation.
const guardedClient = Object.freeze({
  emails: Object.freeze({
    send: async (payload, options) => {
      if (!isStagingEmailEnvironment()) throw new EmailPolicyError("STAGING_EMAIL_ENVIRONMENT_CHANGED");
      // Snapshot recipients before checking to prevent mutation during dispatch.
      const snapshot = { ...payload };
      for (const field of ["to", "cc", "bcc"]) {
        if (Array.isArray(snapshot[field])) snapshot[field] = [...snapshot[field]];
      }
      assertEmailRecipientsAllowed(snapshot);
      return resendClient.emails.send(snapshot, options);
    },
  }),
  batch: Object.freeze({
    send: async (payloads, options) => {
      if (!isStagingEmailEnvironment()) throw new EmailPolicyError("STAGING_EMAIL_ENVIRONMENT_CHANGED");
      if (!Array.isArray(payloads) || !payloads.length) throw new EmailPolicyError("STAGING_EMAIL_RECIPIENT_BLOCKED");
      const snapshots = payloads.map((payload) => {
        const snapshot = { ...payload };
        for (const field of ["to", "cc", "bcc"]) {
          if (Array.isArray(snapshot[field])) snapshot[field] = [...snapshot[field]];
        }
        assertEmailRecipientsAllowed(snapshot);
        return snapshot;
      });
      return resendClient.batch.send(snapshots, options);
    },
  }),
});

export function getResendClient() {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("Missing env var: RESEND_API_KEY");
  }

  if (!resendClient) {
    resendClient = new Resend(apiKey);
  }

  return isStagingEmailEnvironment() ? guardedClient : resendClient;
}
