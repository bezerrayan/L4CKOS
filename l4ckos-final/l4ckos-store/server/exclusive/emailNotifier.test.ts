import { describe, expect, it, vi } from "vitest";
import { createExclusiveDropEmailNotifier } from "./emailNotifier";

describe("exclusive outbox email adapter", () => {
  it("uses the existing transactional email service contract with provider idempotency and no access code", async () => {
    const send = vi.fn(async () => undefined);
    const notifier = createExclusiveDropEmailNotifier({
      getRecipient: async userId => userId === 81 ? { email: "synthetic@example.invalid", name: "Cliente de Teste" } : undefined,
      send,
    });
    const event = { eventKey: "req:4:approved:9", eventType: "access_approved" as const, userId: 81, requestId: 4 };
    await notifier.send(event);
    expect(send).toHaveBeenCalledWith({ email: "synthetic@example.invalid", name: "Cliente de Teste", eventType: "access_approved", eventKey: "req:4:approved:9" });
    expect(JSON.stringify(send.mock.calls)).not.toMatch(/[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}/);
  });

  it("does not send when the user has no usable recipient", async () => {
    const send = vi.fn();
    const notifier = createExclusiveDropEmailNotifier({ getRecipient: async () => undefined, send });
    await expect(notifier.send({ eventKey: "req:4:received:1", eventType: "request_received", userId: 81, requestId: 4 })).rejects.toThrow("recipient is unavailable");
    expect(send).not.toHaveBeenCalled();
  });
});
