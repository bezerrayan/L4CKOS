import { AsyncLocalStorage } from 'node:async_hooks';
import type { getDb } from '../db';
import {captureRecoveryFence,assertRecoveryFence,assertWebhookBusinessEffectsAllowed} from '../payments/webhookRecovery';
import {selectiveEffectsAllowed} from '../payments/stagingCheckoutAdmission';
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Context = { db: Db; effects: Array<() => Promise<void>> };
const context = new AsyncLocalStorage<Context>();
export const webhookDb = () => context.getStore()?.db;
export async function inWebhookTransaction<T>(db: Db, action: () => Promise<T>, effects: Context['effects']) {
  const fence=captureRecoveryFence();
  return context.run({ db, effects }, async()=>{const result=await action();assertRecoveryFence(fence);return result;});
}
/** External notifications must never run before the financial transaction commits. */
export async function afterWebhookCommit(effect: () => Promise<void>) {
  assertWebhookBusinessEffectsAllowed();
  // Selective staging deliveries use only the durable, recipient-bound notification outbox.
  if(selectiveEffectsAllowed())return;
  const current = context.getStore();
  if (current) current.effects.push(effect);
  else await effect();
}
