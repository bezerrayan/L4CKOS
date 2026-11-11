import { EXCLUSIVE_DROP_ERROR_CODES as CODES } from "../../shared/exclusiveDropsV1";
import { toTrpcError } from "./errors";
import { getExclusiveStore } from "./runtime";
import { ExclusiveError } from "./store";

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
