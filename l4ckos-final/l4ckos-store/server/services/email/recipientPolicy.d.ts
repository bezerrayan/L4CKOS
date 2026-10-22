export class EmailPolicyError extends Error {
  code: string;
  retryable: false;
  constructor(code: string);
}
export function isStagingEmailEnvironment(): boolean;
export function assertEmailRecipientsAllowed(payload: {
  to?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
}): void;
export function assertRestrictedEmailRecipientsAllowed(payload: {to?: string | string[];cc?:string|string[];bcc?:string|string[]}): void;
export function withRecoveryRecipient<T>(email:string,action:()=>T):T;
