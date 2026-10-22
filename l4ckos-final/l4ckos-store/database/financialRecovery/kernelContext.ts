import type { MySql2Database } from 'drizzle-orm/mysql2';
import { stop } from './policy';
export type Db = MySql2Database<Record<string, never>>;
export type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];
export type KernelContext = {
  db: Db; assertIdentity: () => Promise<void>; beforeWrite: () => Promise<void>;
  transaction: <T>(run: (tx: Transaction) => Promise<T>) => Promise<T>;
  approvalHash: string; artifactHash: string;
};
const bound = new WeakSet<KernelContext>();
// Binding is only made by the guarded orchestrator after environment, database,
// schema, bundle and approval gates. This is not a CLI bypass or a local-name alias.
export function bindKernel(context: KernelContext) { bound.add(context); return context; }
export async function assertKernelContext(context: KernelContext) {
  if (!bound.has(context)) stop('RECOVERY_UNBOUND_KERNEL');
  await context.assertIdentity();
}
