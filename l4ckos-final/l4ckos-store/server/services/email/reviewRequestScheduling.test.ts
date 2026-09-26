import { beforeEach, describe, expect, it, vi } from "vitest";

const resendSendMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ data: { id: "email_123" }, error: null }),
);

vi.mock("./resendClient.js", () => ({
  getResendClient: () => ({
    emails: {
      send: resendSendMock,
    },
  }),
}));

vi.mock("./emailRenderer.js", () => ({
  renderEmailTemplate: () => null,
}));

vi.mock("./emailSubscriptions.js", () => ({
  buildUnsubscribeUrl: () => "https://l4ckos.com.br/descadastrar",
  ensureMarketingAllowed: () => Promise.resolve(true),
}));

import { sendReviewRequestEmail } from "./emailService.js";

describe("review request email delivery", () => {
  beforeEach(() => {
    resendSendMock.mockClear();
    process.env.EMAIL_FROM_MARKETING = "L4CKOS <contato@l4ckos.com.br>";
  });

  it("forwards the scheduled delivery time to Resend", async () => {
    const scheduledAt = "2026-07-19T22:25:43.000Z";

    await sendReviewRequestEmail({
      customerEmail: "cliente@example.com",
      customerName: "Cliente",
      orderNumber: "42",
      reviewUrl: "https://l4ckos.com.br/meus-pedidos/42",
      scheduledAt,
    });

    expect(resendSendMock).toHaveBeenCalledOnce();
    expect(resendSendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["cliente@example.com"],
        scheduledAt,
      }),
    );
  });
});
