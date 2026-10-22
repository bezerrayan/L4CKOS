import { fail } from './policy';

/** Read-only proposal, never a dispatcher. An ambiguous external result must be
 * reconciled independently from the already committed financial transaction. */
export function notificationRecovery(input: {
  state: 'pending'|'processing'|'failed'|'sent'|'scheduled';
  attempts: number;
  providerIdPresent: boolean;
  leaseExpiresAt: number|null;
  tokenPresent: boolean;
  providerEvidence: 'unknown'|'accepted'|'definitely-not-accepted';
}, now=Date.now()) {
  if(!['pending','processing','failed','sent','scheduled'].includes(input.state)||
     !['unknown','accepted','definitely-not-accepted'].includes(input.providerEvidence)||
     typeof input.providerIdPresent!=='boolean'||typeof input.tokenPresent!=='boolean'||
     !Number.isSafeInteger(input.attempts)||input.attempts<0||
     (input.leaseExpiresAt!==null&&!Number.isFinite(input.leaseExpiresAt)))fail('NOTIFICATION_EVIDENCE_INVALID');
  if(['sent','scheduled'].includes(input.state)||input.providerIdPresent||input.providerEvidence==='accepted')
    return {action:'RECONCILE_PROVIDER_RECEIPT',resendAllowed:false,financialReplayAllowed:false};
  if(input.state==='processing'&&input.tokenPresent&&input.leaseExpiresAt!==null&&input.leaseExpiresAt>now)
    return {action:'WAIT_ACTIVE_LEASE',resendAllowed:false,financialReplayAllowed:false};
  if(input.state==='pending'&&input.attempts===0)
    return {action:'VERIFY_LOGICAL_KEY_AND_PROVIDER_BEFORE_AUTHORIZED_DISPATCH',resendAllowed:false,financialReplayAllowed:false};
  if(input.providerEvidence!=='definitely-not-accepted')
    return {action:'HOLD_UNCERTAIN_RESULT_PROVIDER_RECONCILIATION_REQUIRED',resendAllowed:false,financialReplayAllowed:false};
  // Even a negative provider result does not authorize this read-only tool to
  // reclaim/send. A separate approved atomic claim and deterministic key are needed.
  return {action:'PREPARE_SEPARATE_AUTHORIZED_ATOMIC_CLAIM',resendAllowed:false,financialReplayAllowed:false};
}
