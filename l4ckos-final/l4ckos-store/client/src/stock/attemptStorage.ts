import { ATTEMPTS_STORAGE_KEY, type StockAttemptStorage } from "./stockCheckoutClient";

/** Attempt IDs are local resume handles: keep them isolated per signed-in user (and anonymous). */
export function createUserAttemptStorage(userId: number | string | null | undefined, storage: Storage = window.localStorage): StockAttemptStorage {
  const prefix = `l4ckos:user:${userId ?? "anonymous"}:`;
  return {
    getItem: key => storage.getItem(`${prefix}${key}`),
    setItem: (key, value) => storage.setItem(`${prefix}${key}`, value),
  };
}

/** True when a `storage` event key is THIS user's attempt registry (another tab changed it). */
export function isUserAttemptStorageKey(userId: number | string | null | undefined, key: string | null): boolean {
  return key === `l4ckos:user:${userId ?? "anonymous"}:${ATTEMPTS_STORAGE_KEY}`;
}
