/** Longest a checkout-critical request may stay silent before the UI treats the outcome as unknown. */
export const REQUEST_TIMEOUT_MS = 45_000;

export class RequestTimeoutError extends Error {
  constructor(ms: number) {
    super(`Request timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

/**
 * `fetch` that aborts when the server stays silent. A timed-out mutation is NOT a failure: the request may
 * have been processed, so callers must treat it as an unknown outcome and re-query (the STOCK flow does).
 */
export async function fetchWithTimeout(
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>,
  url: string,
  init: RequestInit | undefined,
  ms: number = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const upstream = init?.signal;
  const onUpstreamAbort = () => controller.abort(upstream?.reason);
  if (upstream) {
    if (upstream.aborted) controller.abort(upstream.reason);
    else upstream.addEventListener("abort", onUpstreamAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(new RequestTimeoutError(ms)), ms);
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    upstream?.removeEventListener("abort", onUpstreamAbort);
  }
}

/** Rejects if `promise` does not settle in time (used for the CSRF token fetch that precedes mutations). */
export function withDeadline<T>(promise: Promise<T>, ms: number = REQUEST_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new RequestTimeoutError(ms)), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}
