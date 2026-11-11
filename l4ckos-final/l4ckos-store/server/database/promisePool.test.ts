import { describe, expect, it, vi } from "vitest";
import { toPromisePool } from "./promisePool";

describe("toPromisePool", () => {
  it("wraps a callback-style pool (drizzle $client) with .promise()", () => {
    const promisePool = { getConnection: vi.fn(), execute: vi.fn(), query: vi.fn() };
    const callbackPool = { getConnection: vi.fn(), promise: vi.fn(() => promisePool) };
    expect(toPromisePool(callbackPool)).toBe(promisePool);
    expect(toPromisePool(callbackPool)).toBe(promisePool); // cached per client
    expect(callbackPool.promise).toHaveBeenCalledTimes(1);
  });
  it("passes an injected promise pool through unchanged", () => {
    const injected = { getConnection: vi.fn(), execute: vi.fn() };
    expect(toPromisePool(injected)).toBe(injected);
  });
  it("returns null when there is no pool API", () => {
    expect(toPromisePool(undefined)).toBeNull();
    expect(toPromisePool({})).toBeNull();
    expect(toPromisePool("pool")).toBeNull();
  });
});
