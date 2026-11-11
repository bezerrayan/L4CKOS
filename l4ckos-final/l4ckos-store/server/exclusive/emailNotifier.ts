import type { ExclusiveDropNotifier, NotificationEvent } from "./store";

/**
 * Binds the exclusive-drop outbox to the EXISTING L4CKOS e-mail stack (React templates + Resend in `services/email`).
 * No second e-mail service: this module only maps an outbox event to a template and hands it to a `TransactionalEmailSender`.
 * The sender port is the single place to wire Resend (see docs/exclusive-drops-v1.md §E-mail): it MUST pass `idempotencyKey`
 * to Resend as the idempotency key so a retry after an ambiguous result cannot send twice.
 */
export type TransactionalEmail = {
  to: string;
  templateName: "exclusiveDropRequestReceived" | "exclusiveDropAccessApproved" | "exclusiveDropAccessRejected" | "exclusiveDropAccessRevoked";
  subjectKey: string;
  subjectPayload: { dropName: string };
  templatePayload: Record<string, unknown>;
  idempotencyKey: string;
};

export interface TransactionalEmailSender {
  send(email: TransactionalEmail): Promise<void>;
}

export type ExclusiveEmailContext = {
  userName: string | null;
  userEmail: string | null;
  dropName: string;
  timezone: string;
  purchaseStartsAt: Date;
  productId: number | null;
  unitLimit: number | null;
  expiresAt: Date | null;
};

const TEMPLATE_BY_EVENT = {
  request_received: "exclusiveDropRequestReceived",
  access_approved: "exclusiveDropAccessApproved",
  access_rejected: "exclusiveDropAccessRejected",
  access_revoked: "exclusiveDropAccessRevoked",
} as const;

/** Anything shaped like an access code (XXXXX-XXXXX-XXXXX-XXXXX) must never reach a message. */
const CODE_SHAPE = /\b[0-9A-Z]{5}(?:-[0-9A-Z]{5}){3}\b/;

const label = (date: Date, timeZone: string) => new Intl.DateTimeFormat("pt-BR", { timeZone, dateStyle: "short", timeStyle: "short" }).format(date);

export function buildExclusiveEmail(event: NotificationEvent, context: ExclusiveEmailContext, appBaseUrl = process.env.APP_BASE_URL || "https://l4ckos.com.br"): TransactionalEmail {
  const to = (context.userEmail ?? "").trim();
  if (!to) throw new Error("Exclusive drop e-mail: recipient has no e-mail address");
  const base = appBaseUrl.replace(/\/$/, "");
  const productUrl = context.productId ? `${base}/produto/${context.productId}` : undefined;
  const common = { customerName: context.userName?.trim() || undefined, dropName: context.dropName };
  let templatePayload: Record<string, unknown>;
  switch (event.eventType) {
    case "request_received": templatePayload = { ...common, productUrl }; break;
    case "access_approved":
      if (context.unitLimit == null || !context.expiresAt) throw new Error("Exclusive drop e-mail: approved notification needs the unit limit and expiry");
      templatePayload = { ...common, unitLimit: context.unitLimit, expiresAtLabel: label(context.expiresAt, context.timezone), purchaseStartsAtLabel: label(context.purchaseStartsAt, context.timezone), productUrl };
      break;
    case "access_rejected":
    case "access_revoked": templatePayload = { ...common }; break;
  }
  if (CODE_SHAPE.test(JSON.stringify(templatePayload))) throw new Error("Exclusive drop e-mail: refusing to send a payload that looks like an access code");
  const templateName = TEMPLATE_BY_EVENT[event.eventType];
  return { to, templateName, subjectKey: templateName, subjectPayload: { dropName: context.dropName }, templatePayload, idempotencyKey: event.eventKey };
}

export function createExclusiveEmailNotifier(deps: {
  loadContext: (requestId: number) => Promise<ExclusiveEmailContext | null>;
  sender: TransactionalEmailSender;
}): ExclusiveDropNotifier {
  return {
    async send(event) {
      const context = await deps.loadContext(event.requestId);
      if (!context) throw new Error("Exclusive drop e-mail: request not found");
      await deps.sender.send(buildExclusiveEmail(event, context));
    },
  };
}
