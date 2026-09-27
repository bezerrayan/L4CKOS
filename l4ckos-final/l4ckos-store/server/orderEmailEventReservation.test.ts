import { describe, expect, it, vi } from "vitest";
import { isDuplicateKeyError, reserveOrderEmailEvent } from "./db";

function transactionStub(input: { insertError?: unknown; eventId?: number }) {
  const values = input.insertError ? vi.fn().mockRejectedValue(input.insertError) : vi.fn().mockResolvedValue(undefined);
  const limit = vi.fn().mockResolvedValue([{ id: input.eventId ?? 42 }]);
  return {
    insert: vi.fn(() => ({ values })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit })),
      })),
    })),
    values,
  };
}

describe("order email event reservation", () => {
  it("creates the first event reservation", async () => {
    const tx = transactionStub({ eventId: 42 });

    await expect(reserveOrderEmailEvent(tx, 7, "order_delivered_email"))
      .resolves.toEqual({ reserved: true, eventId: 42 });
    expect(tx.values).toHaveBeenCalledOnce();
  });

  it("treats a Drizzle-wrapped MySQL duplicate as an idempotent no-op", async () => {
    const duplicate = Object.assign(new Error("Failed query"), {
      cause: Object.assign(new Error("duplicate"), {
        code: "ER_DUP_ENTRY",
        errno: 1062,
        sqlState: "23000",
      }),
    });
    const tx = transactionStub({ insertError: duplicate, eventId: 42 });

    expect(isDuplicateKeyError(duplicate)).toBe(true);
    await expect(reserveOrderEmailEvent(tx, 7, "order_delivered_email"))
      .resolves.toEqual({ reserved: false, eventId: 42 });
    expect(tx.values).toHaveBeenCalledOnce();
  });

  it("propagates a non-duplicate database failure", async () => {
    const failure = Object.assign(new Error("connection lost"), {
      cause: Object.assign(new Error("connection lost"), { code: "PROTOCOL_CONNECTION_LOST" }),
    });
    const tx = transactionStub({ insertError: failure });

    expect(isDuplicateKeyError(failure)).toBe(false);
    await expect(reserveOrderEmailEvent(tx, 7, "order_delivered_email")).rejects.toBe(failure);
  });
});
