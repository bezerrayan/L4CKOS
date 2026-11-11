import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout, RequestTimeoutError, withDeadline } from "./fetchWithTimeout";

const hanging = (_url: string, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new Error("aborted")));
  });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("fetchWithTimeout", () => {
  it("a request that never answers is aborted as a TimeoutError instead of hanging forever", async () => {
    const settled = fetchWithTimeout(hanging, "/api/trpc/stockCheckout.create", {}, 1000).catch(e => e);
    await vi.advanceTimersByTimeAsync(1000);
    const error = await settled;
    expect(error).toBeInstanceOf(RequestTimeoutError);
    expect((error as Error).name).toBe("TimeoutError");
  });

  it("a timely response is returned untouched and the timer is cleared", async () => {
    const response = new Response("ok");
    const result = await fetchWithTimeout(async () => response, "/x", {}, 1000);
    expect(result).toBe(response);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("the caller's own abort still wins", async () => {
    const caller = new AbortController();
    const settled = fetchWithTimeout(hanging, "/x", { signal: caller.signal }, 10_000).catch(e => e);
    caller.abort(new Error("caller cancelled"));
    expect((await settled as Error).message).toBe("caller cancelled");
  });

  it("withDeadline rejects a promise that never settles and passes through ones that do", async () => {
    const stuck = withDeadline(new Promise<string>(() => {}), 500).catch(e => e);
    await vi.advanceTimersByTimeAsync(500);
    expect(await stuck).toBeInstanceOf(RequestTimeoutError);
    await expect(withDeadline(Promise.resolve("token"), 500)).resolves.toBe("token");
  });
});
