import { afterEach, describe, expect, it, vi } from "vitest";
import { startStockReservationExpiryScheduler } from "./stockReservationExpiryScheduler";

describe("STOCK reservation expiry scheduler", () => {
  afterEach(() => vi.useRealTimers());

  it("sweeps immediately after startup to recover work missed during downtime", async () => {
    vi.useFakeTimers();
    const expire = vi.fn().mockResolvedValue(undefined);
    const stop = startStockReservationExpiryScheduler(expire, { intervalMs: 5_000 });
    await vi.waitFor(() => expect(expire).toHaveBeenCalledTimes(1));
    stop();
  });

  it("does not overlap a slow sweep and retries after a failed run", async () => {
    vi.useFakeTimers();
    let resolveFirst!: () => void;
    const first = new Promise<void>(resolve => { resolveFirst = resolve; });
    const onError = vi.fn();
    const expire = vi.fn()
      .mockImplementationOnce(() => first)
      .mockRejectedValueOnce(new Error("temporary database outage"))
      .mockResolvedValue(undefined);
    const stop = startStockReservationExpiryScheduler(expire, { intervalMs: 5_000, onError });
    await vi.waitFor(() => expect(expire).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(expire).toHaveBeenCalledTimes(1);
    resolveFirst();
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(expire).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(expire).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledOnce();
    stop();
  });

  it("stops future runs cleanly", async () => {
    vi.useFakeTimers();
    const expire = vi.fn().mockResolvedValue(undefined);
    const stop = startStockReservationExpiryScheduler(expire, { intervalMs: 1_000 });
    await vi.waitFor(() => expect(expire).toHaveBeenCalledTimes(1));
    stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(expire).toHaveBeenCalledTimes(1);
  });
});
