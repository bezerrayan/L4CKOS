export type StockReservationExpiry = () => Promise<unknown>;

export type StockReservationExpirySchedulerOptions = {
  intervalMs?: number;
  onError?: (error: unknown) => void;
};

/**
 * Runs an immediate recovery sweep on process start, then repeats periodically.
 * Each process prevents local overlap; MySQL row locks/SKIP LOCKED coordinate
 * separate processes. A failed sweep is retried on the next tick.
 */
export function startStockReservationExpiryScheduler(
  expireReservations: StockReservationExpiry,
  options: StockReservationExpirySchedulerOptions = {},
): () => void {
  const intervalMs = options.intervalMs ?? 60_000;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000) {
    throw new RangeError("intervalMs must be an integer of at least 1000ms");
  }

  let stopped = false;
  let running = false;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await expireReservations();
    } catch (error) {
      options.onError?.(error);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => { void tick(); }, intervalMs);
  timer.unref?.();
  void tick();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
