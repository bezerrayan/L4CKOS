import { EXCLUSIVE_DROP_ERROR_CODES as CODES } from "../../shared/exclusiveDropsV1";
import { toTrpcError } from "./errors";
import { getExclusiveStore } from "./runtime";
import { ExclusiveError, type CheckoutItem } from "./store";

/**
 * Control layer over the STOCK V1 create. Runs the exclusivity check and takes the unit claim BEFORE any STOCK write, then
 * lets STOCK do everything else (price, stock, reservation, payment). It never touches STOCK internals: quota release for
 * cancelled/expired attempts is derived from STOCK state (see store.ts). Fails closed when access cannot be proven.
 */
export async function withExclusiveCheckoutGuard<T>(
  input: { userId: number; attemptId: string; items: CheckoutItem[] },
  run: () => Promise<T>,
): Promise<T> {
  const store = await getExclusiveStore();
  if (!store) throw toTrpcError(new ExclusiveError(CODES.unverifiable, "Não foi possível verificar o acesso a este produto."));
  let claimed = false;
  try {
    ({ claimed } = await store.reserveForCheckout(input));
  } catch (error) {
    throw toTrpcError(error);
  }
  try {
    return await run();
  } finally {
    if (claimed) await store.settleCheckout(input.attemptId).catch(() => undefined);
  }
}

/** Legacy/non-STOCK purchase paths cannot carry exclusive products at all. */
export async function assertNoExclusiveInLegacyCheckout(productIds: number[]): Promise<void> {
  const store = await getExclusiveStore();
  if (!store) throw toTrpcError(new ExclusiveError(CODES.unverifiable, "Não foi possível verificar o acesso a este produto."));
  try {
    await store.assertNoExclusiveProducts(productIds);
  } catch (error) {
    throw toTrpcError(error);
  }
}

export async function assertCanAddToServerCart(input: { userId: number; productId: number; quantity: number }): Promise<void> {
  const store = await getExclusiveStore();
  if (!store) return; // cart is non-financial; checkout enforcement is the hard gate
  try {
    await store.assertCanAddToCart(input);
  } catch (error) {
    throw toTrpcError(error);
  }
}
