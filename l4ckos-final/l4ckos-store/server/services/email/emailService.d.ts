export function sendExclusiveAccessNotificationEmail(input: {
  email: string;
  name?: string | null;
  eventType: "request_received" | "access_approved" | "access_rejected" | "access_revoked";
  eventKey: string;
}): Promise<unknown>;
