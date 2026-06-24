import { TRPCError } from "@trpc/server";
import type { Request } from "express";
import type { User } from "../../drizzle/schema";
import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "../../shared/const";
import { ENV } from "./env";
import { sdk } from "./sdk";
import { securityLog } from "./security";

export type AuthenticatedUser = User;
export type UserRole = "user" | "admin";

export function isConfiguredAdmin(user: Pick<User, "email" | "openId" | "role"> | null | undefined) {
  if (!user) return false;

  const normalizedEmail = String(user.email ?? "").trim().toLowerCase();
  const hasAdminEmail = Boolean(normalizedEmail) && ENV.adminEmails.includes(normalizedEmail);
  const hasOwnerOpenId = Boolean(ENV.ownerOpenId && user.openId === ENV.ownerOpenId);

  return user.role === "admin" && (hasAdminEmail || hasOwnerOpenId);
}

export function requireAuth(user: User | null | undefined): User {
  if (!user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return user;
}

export function requireRole(user: User | null | undefined, role: UserRole): User {
  const authenticatedUser = requireAuth(user);

  if (role === "admin" && !isConfiguredAdmin(authenticatedUser)) {
    securityLog("warn", "auth.admin_required_denied", {
      userId: authenticatedUser.id,
      role: authenticatedUser.role,
    });
    throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
  }

  if (role !== "admin" && authenticatedUser.role !== role) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Você não tem permissão para acessar este recurso." });
  }

  return authenticatedUser;
}

export function requireOwnershipOrRole<T extends { userId?: number | null }>(
  user: User | null | undefined,
  resource: T | null | undefined,
  role: UserRole,
): T {
  const authenticatedUser = requireAuth(user);

  if (!resource) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Recurso não encontrado." });
  }

  if (resource.userId === authenticatedUser.id) {
    return resource;
  }

  requireRole(authenticatedUser, role);
  return resource;
}

export async function authenticateHttpRequest(req: Request): Promise<User> {
  return sdk.authenticateRequest(req);
}
