import { vi } from "vitest";

/**
 * Deterministic stand-in for `trpc` (client/src/lib/trpc.ts). No network, no real payment.
 * Tests register handlers by procedure path, e.g. "stockCheckout.create.useMutation" or
 * "utils.stockCheckout.resume.fetch" (anything reached through `trpc.useUtils()`).
 */
type Handler = (...args: any[]) => any;
const handlers = new Map<string, Handler>();
const stable = new Map<string, unknown>();

export function setTrpc(path: string, handler: Handler) {
  handlers.set(path, handler);
}

export function resetTrpc() {
  handlers.clear();
  stable.clear();
}

function once<T>(key: string, make: () => T): T {
  if (!stable.has(key)) stable.set(key, make());
  return stable.get(key) as T;
}

function node(path: string[]): any {
  return new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === "then") return undefined;
      return node([...path, String(prop)]);
    },
    apply(_target, _this, args) {
      const key = path.join(".");
      const handler = handlers.get(key);
      if (handler) return handler(...args);
      const last = path[path.length - 1];
      if (last === "useUtils") return once("utils", () => node(["utils"]));
      if (last === "useQuery") {
        return once(`${key}:q`, () => ({ data: undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn() }));
      }
      if (last === "useMutation") {
        return once(`${key}:m`, () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false, error: null }));
      }
      if (last === "fetch") return Promise.resolve(undefined);
      return undefined;
    },
  });
}

export const trpc = node([]);
