import { AsyncLocalStorage } from 'node:async_hooks';
import type { getDb } from '../db';
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Context = { db: Db; effects: Array<() => Promise<void>> };
const context = new AsyncLocalStorage<Context>();
export const webhookDb = () => context.getStore()?.db;
export async function inWebhookTransaction<T>(db: Db, action: () => Promise<T>, effects: Context['effects']) {
  return context.run({ db, effects }, action);
}
/** External notifications must never run before the financial transaction commits. */
export async function afterWebhookCommit(effect: () => Promise<void>) {
  const current = context.getStore();
  if (current) current.effects.push(effect);
  else await effect();
}
