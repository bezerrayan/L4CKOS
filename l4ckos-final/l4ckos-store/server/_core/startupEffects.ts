/** Starts background work only after the awaited server initialization succeeds. */
export async function initializeBeforeBackgroundEffects<T>(
  initialize: () => Promise<T>,
  startEffects: (result: T) => void,
): Promise<T> {
  const result = await initialize();
  startEffects(result);
  return result;
}
