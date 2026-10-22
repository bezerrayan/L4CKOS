import { AsyncLocalStorage } from 'node:async_hooks';
const recoveryRecipient = new AsyncLocalStorage();
// Called only after a transactional selective grant check; never grants financial scope.
export function withRecoveryRecipient(email, action) {
  if(process.env.NODE_ENV!=='production'||process.env.RAILWAY_PROJECT_ID!==STAGING_PROJECT
    ||process.env.RAILWAY_ENVIRONMENT_ID!==STAGING_ENVIRONMENT
    ||process.env.RAILWAY_SERVICE_ID!=='9f1c7705-f2f9-48cf-b957-8f63a6bba4db'
    ||process.env.ASAAS_WEBHOOK_RECOVERY_MODE!=='review_only'||process.env.EMAIL_MODE!=='restricted')
    throw new EmailPolicyError('ASAAS_WEBHOOK_RECOVERY_EMAIL_BLOCKED');
  return recoveryRecipient.run(normalize(email), action);
}
const STAGING_PROJECT = "2bb90c8e-eb65-43ee-826b-f93750f0499c";
const STAGING_ENVIRONMENT = "15545eee-bc02-4b70-afc4-19a5db9e6f46";
const normalize = (value) => String(value ?? "").trim().toLowerCase();
// Only plain mailboxes are accepted. Display names, wildcards and address lists
// embedded in a single recipient fail closed instead of being partially parsed.
const mailbox = /^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

export class EmailPolicyError extends Error {
  constructor(code) {
    super(code);
    this.name = "EmailPolicyError";
    this.code = code;
    this.retryable = false;
  }
}

export function isStagingEmailEnvironment() {
  return normalize(process.env.APP_ENV) === "staging"
    || normalize(process.env.EMAIL_ENV) === "staging"
    || process.env.RAILWAY_PROJECT_ID === STAGING_PROJECT
    || process.env.RAILWAY_ENVIRONMENT_ID === STAGING_ENVIRONMENT;
}

export function assertEmailRecipientsAllowed(payload) {
  const recoveryMode=process.env.ASAAS_WEBHOOK_RECOVERY_MODE||"";
  if(recoveryMode&&recoveryMode!=="off") {
    const selected = recoveryRecipient.getStore();
    if(recoveryMode!=="review_only" || !selected || normalize(payload?.to)!==selected
      || Array.isArray(payload?.to) || payload?.cc!==undefined || payload?.bcc!==undefined)
      throw new EmailPolicyError("ASAAS_WEBHOOK_RECOVERY_EMAIL_BLOCKED");
  }
  assertRestrictedEmailRecipientsAllowed(payload);
}
// Policy validation alone does not authorize sending while recovery is active.
export function assertRestrictedEmailRecipientsAllowed(payload) {
  if (!isStagingEmailEnvironment()) return;
  if (normalize(process.env.EMAIL_MODE) !== "restricted") {
    throw new EmailPolicyError("STAGING_EMAIL_CONFIG_INVALID");
  }
  const entries = String(process.env.STAGING_EMAIL_ALLOWLIST ?? "").split(",").map(normalize);
  if (entries.some((entry) => !mailbox.test(entry) || entry.includes("*"))) {
    throw new EmailPolicyError("STAGING_EMAIL_ALLOWLIST_INVALID");
  }
  const allowed = new Set(entries);
  for (const field of ["to", "cc", "bcc"]) {
    const value = payload?.[field];
    if (value === undefined && field !== "to") continue;
    const recipients = Array.isArray(value) ? value : [value];
    if (!recipients.length || recipients.some((recipient) => typeof recipient !== "string"
      || !mailbox.test(normalize(recipient)) || !allowed.has(normalize(recipient)))) {
      throw new EmailPolicyError("STAGING_EMAIL_RECIPIENT_BLOCKED");
    }
  }
}
