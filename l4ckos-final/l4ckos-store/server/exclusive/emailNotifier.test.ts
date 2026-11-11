import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderEmailTemplate } from "../services/email/emailRenderer.js";
import { emailSubjects } from "../utils/email/emailSubjects.js";
import { buildExclusiveEmail, createExclusiveEmailNotifier, type ExclusiveEmailContext, type TransactionalEmail } from "./emailNotifier";
import { generateAccessCode } from "./codes";

// Synthetic fixtures only: no real customer, address or provider.
const context: ExclusiveEmailContext = {
  userName: "Integrante Sintético", userEmail: "integrante@example.invalid", dropName: "Clã XIV Bis × L4CKOS", timezone: "America/Sao_Paulo",
  purchaseStartsAt: new Date("2026-11-20T12:00:00Z"), productId: 4, unitLimit: 3, expiresAt: new Date("2026-11-30T15:00:00Z"),
};
const event = (eventType: any, eventKey = `req:1:${eventType}:1`) => ({ eventKey, eventType, userId: 81, requestId: 1 });
const html = (email: TransactionalEmail) => `<!doctype html>${renderToStaticMarkup(renderEmailTemplate(email.templateName, email.templatePayload))}`;
const subject = (email: TransactionalEmail) => { const s = emailSubjects[email.subjectKey]; return typeof s === "function" ? s(email.subjectPayload) : s; };
const text = (markup: string) => markup.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("exclusive drop e-mails (synthetic fixtures)", () => {
  it.each([
    ["request_received", "exclusiveDropRequestReceived", /Pedido de acesso recebido/],
    ["access_approved", "exclusiveDropAccessApproved", /Seu acesso foi aprovado/],
    ["access_rejected", "exclusiveDropAccessRejected", /Sobre o seu pedido de acesso/],
    ["access_revoked", "exclusiveDropAccessRevoked", /Seu acesso foi encerrado/],
  ])("%s renders with the L4CKOS layout, the drop name and a subject", (eventType, template, headline) => {
    const email = buildExclusiveEmail(event(eventType), context, "https://l4ckos.example");
    expect(email.templateName).toBe(template);
    const markup = html(email);
    expect(markup).toMatch(/^<!doctype html>/);
    expect(markup).toContain('lang="pt-BR"');
    expect(text(markup)).toMatch(headline);
    expect(text(markup)).toContain("Clã XIV Bis × L4CKOS");
    expect(text(markup)).toContain("Olá, Integrante Sintético.");
    expect(subject(email)).toContain("Clã XIV Bis × L4CKOS");
    expect(email.to).toBe("integrante@example.invalid");
  });

  it("approval states limit and dates in the DROP's timezone, links the product, and says the code comes separately", () => {
    const email = buildExclusiveEmail(event("access_approved"), context, "https://l4ckos.example");
    const body = text(html(email));
    expect(body).toContain("até 3 unidades");
    expect(body).toContain("20/11/2026, 09:00"); // 12:00Z in America/Sao_Paulo
    expect(body).toContain("30/11/2026, 12:00"); // 15:00Z
    expect(body).toMatch(/código individual será enviado separadamente/);
    expect(html(email)).toContain("https://l4ckos.example/produto/4");
  });

  it("NO template or payload can carry an access code (manual-delivery contract)", () => {
    for (const type of ["request_received", "access_approved", "access_rejected", "access_revoked"]) {
      const email = buildExclusiveEmail(event(type), context);
      expect(JSON.stringify(email)).not.toMatch(/[0-9A-Z]{5}(-[0-9A-Z]{5}){3}/);
      expect(html(email)).not.toMatch(/[0-9A-Z]{5}(-[0-9A-Z]{5}){3}/);
    }
    // even if a code sneaks into a field, the builder refuses to produce a message
    expect(() => buildExclusiveEmail(event("request_received"), { ...context, userName: `oi ${generateAccessCode()}` })).toThrow(/looks like an access code/);
  });

  it("refuses to build an incomplete message (no recipient / approval without limit or expiry)", () => {
    expect(() => buildExclusiveEmail(event("request_received"), { ...context, userEmail: null })).toThrow(/no e-mail address/);
    expect(() => buildExclusiveEmail(event("access_approved"), { ...context, unitLimit: null })).toThrow(/unit limit and expiry/);
    expect(() => buildExclusiveEmail(event("access_approved"), { ...context, expiresAt: null })).toThrow(/unit limit and expiry/);
  });

  it("the idempotency key handed to the sender is the outbox eventKey (stable across retries)", async () => {
    const send = vi.fn(async () => undefined);
    const notifier = createExclusiveEmailNotifier({ loadContext: async () => context, sender: { send } });
    await notifier.send(event("access_approved", "req:1:approved:5"));
    await notifier.send(event("access_approved", "req:1:approved:5"));
    expect((send.mock.calls as unknown as Array<[TransactionalEmail]>).map(([mail]) => mail.idempotencyKey)).toEqual(["req:1:approved:5", "req:1:approved:5"]);
  });

  it("a missing request fails (so the outbox marks it failed) instead of sending to nobody", async () => {
    const send = vi.fn();
    const notifier = createExclusiveEmailNotifier({ loadContext: async () => null, sender: { send } });
    await expect(notifier.send(event("access_revoked"))).rejects.toThrow(/request not found/);
    expect(send).not.toHaveBeenCalled();
  });
});
