import { ENV } from "./env";

/**
 * The owner is the only identity that can bootstrap an admin role during auth
 * provisioning. ADMIN_EMAILS is intentionally not consulted here: it is an
 * additional authorization check, not a source of role grants.
 */
export function isOwnerOpenId(openId: string | null | undefined) {
  return Boolean(ENV.ownerOpenId) && openId === ENV.ownerOpenId;
}

export function resolveProvisionedUserRole(
  openId: string,
  requestedRole?: "user" | "admin",
): "user" | "admin" | undefined {
  if (isOwnerOpenId(openId)) return "admin";
  return requestedRole === "admin" ? "user" : requestedRole;
}
