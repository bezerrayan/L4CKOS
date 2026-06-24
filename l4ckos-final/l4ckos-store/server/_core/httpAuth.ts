import type { NextFunction, Request, Response } from "express";
import { securityLog } from "./security";
import { buildApiErrorResponse } from "./appErrors";
import { authenticateHttpRequest, isConfiguredAdmin } from "./authz";

export type AuthenticatedRequest = Request & {
  authUser?: {
    id: number;
    role: "user" | "admin";
    email: string | null;
  };
};

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: string[],
) {
  res.status(status).json(buildApiErrorResponse({ status, code, message, details }));
}

export async function requireAuthenticatedUser(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await authenticateHttpRequest(req);
    (req as AuthenticatedRequest).authUser = {
      id: user.id,
      role: user.role,
      email: user.email ?? null,
    };
    next();
  } catch {
    sendError(res, 401, "AUTH_REQUIRED", "Faça login para continuar.");
  }
}

export async function requireAdminUser(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await authenticateHttpRequest(req);

    if (!isConfiguredAdmin(user)) {
      securityLog("warn", "auth.admin_route_denied", {
        userId: user.id,
        requestIp: req.ip || "unknown",
      });
      sendError(res, 403, "ADMIN_REQUIRED", "Você não tem permissão para acessar este recurso.");
      return;
    }

    (req as AuthenticatedRequest).authUser = {
      id: user.id,
      role: user.role,
      email: user.email ?? null,
    };
    next();
  } catch {
    sendError(res, 401, "AUTH_REQUIRED", "Faça login para continuar.");
  }
}
