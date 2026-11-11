import { getUserById } from "../db";
import { sendExclusiveAccessNotificationEmail } from "../services/email/emailService.js";
import type { ExclusiveDropNotifier, NotificationEvent } from "./store";

type Recipient = { email?: string | null; name?: string | null } | undefined;
type EmailInput = { email: string; name?: string | null; eventType: NotificationEvent["eventType"]; eventKey: string };

/** Bridges the transactional outbox to the existing Resend email service. Call only from an explicit worker. */
export function createExclusiveDropEmailNotifier(options: {
  getRecipient?: (userId: number) => Promise<Recipient>;
  send?: (input: EmailInput) => Promise<unknown>;
} = {}): ExclusiveDropNotifier {
  const getRecipient = options.getRecipient ?? (getUserById as (userId: number) => Promise<Recipient>);
  const send = options.send ?? sendExclusiveAccessNotificationEmail;
  return {
    async send(event) {
      const user = await getRecipient(event.userId);
      const email = String(user?.email ?? "").trim();
      if (!email) throw new Error("Exclusive notification recipient is unavailable");
      await send({ email, name: user?.name, eventType: event.eventType, eventKey: event.eventKey });
    },
  };
}
