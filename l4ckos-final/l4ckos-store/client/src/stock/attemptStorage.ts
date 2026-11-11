import { type StockAttemptStorage } from "./stockCheckoutClient";

/** Attempt IDs are local resume handles: keep them isolated per signed-in user (and anonymous). */
export function createUserAttemptStorage(userId: number | string | null | undefined, storage: Storage = window.localStorage): StockAttemptStorage {
  const prefix = `l4ckos:user:${userId ?? "anonymous"}:`;
  return {
    getItem: key => storage.getItem(`${prefix}${key}`),
    setItem: (key, value) => storage.setItem(`${prefix}${key}`, value),
  };
}
