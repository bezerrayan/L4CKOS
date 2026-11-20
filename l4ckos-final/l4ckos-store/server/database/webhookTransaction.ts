import { AsyncLocalStorage } from 'node:async_hooks';
import type { PoolConnection } from 'mysql2/promise';
import type { getDb } from '../db';
import {captureRecoveryFence,assertRecoveryFence,assertWebhookBusinessEffectsAllowed} from '../payments/webhookRecovery';
import {selectiveEffectsAllowed} from '../payments/stagingCheckoutAdmission';
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Context = { db: Db; effects: Array<() => Promise<void>>; mysqlConnection: PoolConnection | null };
const context = new AsyncLocalStorage<Context>();
export const webhookDb = () => context.getStore()?.db;
export const webhookTransactionActive = () => Boolean(context.getStore());
/** Drizzle's transaction session owns this same mysql2 promise connection. */
export const webhookMysqlConnection = () => context.getStore()?.mysqlConnection ?? null;
function transactionConnection(db: Db): PoolConnection | null {
  const client = (db as unknown as { session?: { client?: unknown } }).session?.client;
  if (!client || typeof client !== 'object') return null;
  const connection = client as Partial<PoolConnection>;
  return typeof connection.execute === 'function' && typeof connection.query === 'function' &&
    typeof connection.release === 'function' ? connection as PoolConnection : null;
}
export async function inWebhookTransaction<T>(db: Db, action: () => Promise<T>, effects: Context['effects']) {
  const fence=captureRecoveryFence();
  return context.run({ db, effects, mysqlConnection: transactionConnection(db) }, async()=>{const result=await action();assertRecoveryFence(fence);return result;});
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
