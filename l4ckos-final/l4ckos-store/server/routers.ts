import { getSessionCookieName, getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { productsRouter } from "./routers/products";
import { cartRouter } from "./routers/cart";
import { favoritesRouter } from "./routers/favorites";
import { ordersRouter } from "./routers/orders";
import { profileRouter } from "./routers/profile";
import { adminRouter } from "./routers/admin";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { sdk } from "./_core/sdk";
import { ENV, isEmailAllowedForProductionLocalAuth } from "./_core/env";
import { securityLog } from "./_core/security";
import { createAppError } from "./_core/appErrors";
import {
  createPasswordResetToken,
  deletePasswordResetTokensForUser,
  getActivePasswordResetTokenByHash,
  getLocalAuthCredentialByEmail,
  getLocalAuthCredentialByUserId,
  getUserById,
  getUserByOpenId,
  markPasswordResetTokenUsed,
  rotateUserSessionVersion,
  updateLocalAuthPasswordByUserId,
  upsertLocalAuthCredential,
  upsertUser,
} from "./db";
import { sendPasswordResetEmail, sendWelcomeAccountEmail } from "./services/emailService.js";
import { getPasswordPolicyDetails, PASSWORD_MAX_LENGTH } from "../shared/passwordPolicy";

type LoginAttemptState = {
  failCount: number;
  windowStartAt: number;
  blockedUntil: number;
};

const loginAttemptStore = new Map<string, LoginAttemptState>();
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;
const PASSWORD_HASH_ROUNDS = 12;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

function normalizeEmailInput(email: string) {
  return String(email ?? "").trim().toLowerCase();
}

function normalizeNameInput(name: string) {
  return String(name ?? "").replace(/\s+/g, " ").trim();
}

function getFrontendBaseUrl() {
  return String(ENV.frontendUrl || process.env.APP_URL || process.env.APP_BASE_URL || "https://l4ckos.com.br")
    .trim()
    .replace(/\/$/, "");
}

function createPasswordResetRawToken() {
  return randomBytes(32).toString("base64url");
}

function hashPasswordResetToken(token: string) {
  return createHash("sha256").update(String(token ?? ""), "utf8").digest("hex");
}

function getNameValidationDetails(name: string) {
  const details: string[] = [];
  if (name.length < 2) details.push("Informe um nome com pelo menos 2 caracteres.");
  if (name.length > 120) details.push("Informe um nome com no máximo 120 caracteres.");
  if (!/^[\p{L}\p{M}\s.'-]+$/u.test(name)) {
    details.push("Use apenas letras e caracteres válidos no nome.");
  }
  return details;
}

function getEmailValidationDetails(email: string) {
  const details: string[] = [];
  if (!email) {
    details.push("Informe um e-mail.");
  } else if (!z.string().email().safeParse(email).success) {
    details.push("Informe um e-mail válido.");
  }
  return details;
}

function assertSignupInput(input: { name: string; email: string; password: string }) {
  const nameDetails = getNameValidationDetails(input.name);
  if (nameDetails.length > 0) {
    throw createAppError({
      trpcCode: "BAD_REQUEST",
      appCode: "INVALID_NAME",
      message: "Revise o nome informado.",
      details: nameDetails,
    });
  }

  const emailDetails = getEmailValidationDetails(input.email);
  if (emailDetails.length > 0) {
    throw createAppError({
      trpcCode: "BAD_REQUEST",
      appCode: "INVALID_EMAIL",
      message: "Revise o e-mail informado.",
      details: emailDetails,
    });
  }

  const passwordDetails = getPasswordPolicyDetails(input.password);
  if (passwordDetails.length > 0) {
    throw createAppError({
      trpcCode: "BAD_REQUEST",
      appCode: "WEAK_PASSWORD",
      message: "A senha não atende aos requisitos de segurança.",
      details: passwordDetails,
    });
  }
}

function getNormalizedAttemptState(key: string, now: number): LoginAttemptState {
  const current = loginAttemptStore.get(key);
  if (!current) {
    return { failCount: 0, windowStartAt: now, blockedUntil: 0 };
  }

  if (current.blockedUntil > now) {
    return current;
  }

  if (now - current.windowStartAt > LOGIN_WINDOW_MS) {
    return { failCount: 0, windowStartAt: now, blockedUntil: 0 };
  }

  return current;
}

function assertLoginAttemptLimit(key: string) {
  const now = Date.now();
  const current = getNormalizedAttemptState(key, now);
  loginAttemptStore.set(key, current);

  if (current.blockedUntil > now) {
    const remainingMs = current.blockedUntil - now;
    const remainingMin = Math.max(1, Math.ceil(remainingMs / 60000));
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Muitas tentativas de login. Tente novamente em ${remainingMin} minuto(s).`,
    });
  }
}

function registerLoginAttemptFailure(key: string) {
  const now = Date.now();
  const current = getNormalizedAttemptState(key, now);

  if (current.blockedUntil > now) {
    loginAttemptStore.set(key, current);
    return;
  }

  const nextFailCount = current.failCount + 1;
  const shouldBlock = nextFailCount >= LOGIN_MAX_ATTEMPTS;

  loginAttemptStore.set(key, {
    failCount: shouldBlock ? 0 : nextFailCount,
    windowStartAt: shouldBlock ? now : current.windowStartAt,
    blockedUntil: shouldBlock ? now + LOGIN_BLOCK_MS : 0,
  });
}

function clearLoginAttemptLimit(...keys: string[]) {
  keys.forEach(key => loginAttemptStore.delete(key));
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    localLogin: publicProcedure
      .input(
        z.object({
          email: z.string().trim().min(1).max(255),
          password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (ENV.isProduction && !ENV.allowLocalAuthInProduction) {
          throw createAppError({
            trpcCode: "FORBIDDEN",
            appCode: "LOCAL_AUTH_DISABLED",
            message: "O login por e-mail está desativado neste ambiente.",
          });
        }

        const normalizedEmail = normalizeEmailInput(input.email);
        const emailDetails = getEmailValidationDetails(normalizedEmail);
        if (emailDetails.length > 0) {
          throw createAppError({
            trpcCode: "BAD_REQUEST",
            appCode: "INVALID_EMAIL",
            message: "Informe um e-mail válido para continuar.",
            details: emailDetails,
          });
        }

        if (ENV.isProduction && !isEmailAllowedForProductionLocalAuth(normalizedEmail)) {
          throw createAppError({
            trpcCode: "FORBIDDEN",
            appCode: "LOCAL_AUTH_DISABLED",
            message: "O login por e-mail está desativado para esta conta.",
          });
        }

        const requestIp = ctx.req.ip || "unknown";
        const emailIpKey = `local-login:email-ip:${normalizedEmail}:${requestIp}`;
        const ipKey = `local-login:ip:${requestIp}`;
        assertLoginAttemptLimit(emailIpKey);
        assertLoginAttemptLimit(ipKey);

        const credential = await getLocalAuthCredentialByEmail(normalizedEmail);
        if (!credential) {
          securityLog("warn", "auth.local_login_failed", { email: normalizedEmail, requestIp, reason: "missing_user" });
          registerLoginAttemptFailure(emailIpKey);
          registerLoginAttemptFailure(ipKey);
          throw createAppError({
            trpcCode: "UNAUTHORIZED",
            appCode: "INVALID_CREDENTIALS",
            message: "E-mail ou senha inválidos.",
          });
        }

        const passwordOk = await bcrypt.compare(input.password, credential.passwordHash);
        if (!passwordOk) {
          securityLog("warn", "auth.local_login_failed", { email: normalizedEmail, requestIp, reason: "invalid_password" });
          registerLoginAttemptFailure(emailIpKey);
          registerLoginAttemptFailure(ipKey);
          throw createAppError({
            trpcCode: "UNAUTHORIZED",
            appCode: "INVALID_CREDENTIALS",
            message: "E-mail ou senha inválidos.",
          });
        }

        const localOpenId = `local:${normalizedEmail}`;
        const inferredName = normalizedEmail.split("@")[0] || "Usuario Local";
        await upsertUser({
          openId: localOpenId,
          name: inferredName,
          email: normalizedEmail,
          loginMethod: "local-dev",
          lastSignedIn: new Date(),
        });

        const user = await getUserByOpenId(localOpenId);
        if (user?.isBlocked === 1 && user.role !== "admin") {
          securityLog("warn", "auth.local_login_blocked_user", { email: normalizedEmail, requestIp, userId: user?.id });
          throw createAppError({
            trpcCode: "FORBIDDEN",
            appCode: "ACCOUNT_BLOCKED",
            message: "Sua conta está temporariamente bloqueada. Entre em contato com o suporte.",
          });
        }

        if (!user) {
          throw createAppError({
            trpcCode: "INTERNAL_SERVER_ERROR",
            appCode: "AUTH_USER_LOAD_FAILED",
            message: "Não foi possível concluir o login agora.",
          });
        }

        const nextSessionVersion = await rotateUserSessionVersion(user.id);

        const sessionToken = await sdk.createSessionToken(localOpenId, {
          name: inferredName,
          expiresInMs: ENV.sessionTtlMs,
          sessionVersion: nextSessionVersion,
        });

        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(getSessionCookieName(), sessionToken, { ...cookieOptions, maxAge: ENV.sessionTtlMs });

        clearLoginAttemptLimit(emailIpKey, ipKey);
        securityLog("info", "auth.local_login_succeeded", { email: normalizedEmail, requestIp, userId: user.id });
        return { success: true, user: user ?? null } as const;
      }),
    localSignup: publicProcedure
      .input(
        z.object({
          name: z.string().trim().min(1).max(255),
          email: z.string().trim().min(1).max(255),
          password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (ENV.isProduction && (!ENV.allowLocalAuthInProduction || !ENV.allowPublicLocalSignupInProduction)) {
          throw createAppError({
            trpcCode: "FORBIDDEN",
            appCode: "LOCAL_SIGNUP_DISABLED",
            message: "O cadastro por e-mail está desativado neste ambiente.",
          });
        }

        const normalizedEmail = normalizeEmailInput(input.email);
        const requestIp = ctx.req.ip || "unknown";
        if (ENV.isProduction && !isEmailAllowedForProductionLocalAuth(normalizedEmail)) {
          throw createAppError({
            trpcCode: "FORBIDDEN",
            appCode: "LOCAL_SIGNUP_DISABLED",
            message: "O cadastro por e-mail está desativado para esta conta.",
          });
        }

        assertLoginAttemptLimit(`local-signup:${normalizedEmail}:${requestIp}`);
        const localOpenId = `local:${normalizedEmail}`;
        const normalizedName = normalizeNameInput(input.name);
        assertSignupInput({
          name: normalizedName,
          email: normalizedEmail,
          password: input.password,
        });

        const existingCredential = await getLocalAuthCredentialByEmail(normalizedEmail);
        if (existingCredential) {
          throw createAppError({
            trpcCode: "BAD_REQUEST",
            appCode: "EMAIL_ALREADY_IN_USE",
            message: "Já existe uma conta cadastrada com este e-mail.",
          });
        }

        await upsertUser({
          openId: localOpenId,
          name: normalizedName,
          email: normalizedEmail,
          loginMethod: "local-dev",
          lastSignedIn: new Date(),
        });

        const user = await getUserByOpenId(localOpenId);
        if (!user) {
          throw createAppError({
            trpcCode: "INTERNAL_SERVER_ERROR",
            appCode: "ACCOUNT_CREATION_FAILED",
            message: "Não foi possível criar sua conta agora.",
          });
        }

        const passwordHash = await bcrypt.hash(input.password, PASSWORD_HASH_ROUNDS);
        await upsertLocalAuthCredential({
          userId: user.id,
          email: normalizedEmail,
          passwordHash,
        });

        const nextSessionVersion = await rotateUserSessionVersion(user.id);

        const sessionToken = await sdk.createSessionToken(localOpenId, {
          name: normalizedName,
          expiresInMs: ENV.sessionTtlMs,
          sessionVersion: nextSessionVersion,
        });

        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(getSessionCookieName(), sessionToken, { ...cookieOptions, maxAge: ENV.sessionTtlMs });
        securityLog("info", "auth.local_signup_succeeded", { email: normalizedEmail, requestIp, userId: user.id });

        try {
          await sendWelcomeAccountEmail({
            email: normalizedEmail,
            name: normalizedName,
          });
        } catch (error) {
          securityLog("warn", "email.account_welcome_failed", {
            userId: user.id,
            reason: error instanceof Error ? error.message : "unknown",
          });
        }

        return { success: true, user: user ?? null } as const;
      }),
    requestPasswordReset: publicProcedure
      .input(
        z.object({
          email: z.string().trim().min(1).max(255),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const normalizedEmail = normalizeEmailInput(input.email);
        const requestIp = ctx.req.ip || "unknown";
        const neutralResponse = {
          success: true,
          message: "Se existir uma conta local com este e-mail, enviaremos as instruções para redefinir a senha.",
        } as const;

        const emailDetails = getEmailValidationDetails(normalizedEmail);
        if (emailDetails.length > 0) {
          throw createAppError({
            trpcCode: "BAD_REQUEST",
            appCode: "INVALID_EMAIL",
            message: "Informe um e-mail valido para continuar.",
            details: emailDetails,
          });
        }

        if (ENV.isProduction && !ENV.allowLocalAuthInProduction) {
          securityLog("info", "auth.password_reset_request_ignored", {
            email: normalizedEmail,
            requestIp,
            reason: "local_auth_disabled",
          });
          return neutralResponse;
        }

        const credential = await getLocalAuthCredentialByEmail(normalizedEmail);
        if (!credential) {
          securityLog("info", "auth.password_reset_request_ignored", {
            email: normalizedEmail,
            requestIp,
            reason: "missing_local_credential",
          });
          return neutralResponse;
        }

        const user = await getUserById(credential.userId);
        if (!user || (ENV.isProduction && !isEmailAllowedForProductionLocalAuth(normalizedEmail))) {
          securityLog("info", "auth.password_reset_request_ignored", {
            email: normalizedEmail,
            requestIp,
            reason: !user ? "missing_user" : "email_not_allowed",
          });
          return neutralResponse;
        }

        const rawToken = createPasswordResetRawToken();
        const tokenHash = hashPasswordResetToken(rawToken);
        const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
        const resetUrl = `${getFrontendBaseUrl()}/redefinir-senha?token=${encodeURIComponent(rawToken)}`;

        await createPasswordResetToken({
          userId: user.id,
          tokenHash,
          expiresAt,
        });

        try {
          await sendPasswordResetEmail({
            email: normalizedEmail,
            name: user.name || normalizedEmail.split("@")[0] || "cliente",
            resetUrl,
          });
          securityLog("info", "auth.password_reset_email_sent", {
            userId: user.id,
            requestIp,
            email: normalizedEmail,
          });
        } catch (error) {
          securityLog("warn", "auth.password_reset_email_failed", {
            userId: user.id,
            requestIp,
            email: normalizedEmail,
            reason: error instanceof Error ? error.message : "unknown",
          });
        }

        return neutralResponse;
      }),
    resetPassword: publicProcedure
      .input(
        z.object({
          token: z.string().trim().min(32).max(255),
          password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const requestIp = ctx.req.ip || "unknown";
        const passwordDetails = getPasswordPolicyDetails(input.password);
        if (passwordDetails.length > 0) {
          throw createAppError({
            trpcCode: "BAD_REQUEST",
            appCode: "WEAK_PASSWORD",
            message: "A senha não atende aos requisitos de segurança.",
            details: passwordDetails,
          });
        }

        const tokenHash = hashPasswordResetToken(input.token);
        const resetToken = await getActivePasswordResetTokenByHash(tokenHash);
        if (!resetToken) {
          throw createAppError({
            trpcCode: "BAD_REQUEST",
            appCode: "INVALID_OR_EXPIRED_RESET_TOKEN",
            message: "O link de redefinição é inválido ou expirou.",
          });
        }

        const credential = await getLocalAuthCredentialByUserId(resetToken.userId);
        if (!credential) {
          throw createAppError({
            trpcCode: "BAD_REQUEST",
            appCode: "INVALID_OR_EXPIRED_RESET_TOKEN",
            message: "O link de redefinição é inválido ou expirou.",
          });
        }

        const passwordHash = await bcrypt.hash(input.password, PASSWORD_HASH_ROUNDS);
        await updateLocalAuthPasswordByUserId({
          userId: resetToken.userId,
          passwordHash,
        });
        await markPasswordResetTokenUsed(resetToken.id);
        await deletePasswordResetTokensForUser(resetToken.userId);
        await rotateUserSessionVersion(resetToken.userId);

        securityLog("info", "auth.password_reset_completed", {
          userId: resetToken.userId,
          requestIp,
        });

        return {
          success: true,
          message: "Senha redefinida com sucesso. Você já pode entrar com a nova senha.",
        } as const;
      }),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      if (ctx.user) {
        try {
          await rotateUserSessionVersion(ctx.user.id);
        } catch (error) {
          securityLog("warn", "auth.logout_session_rotation_failed", {
            userId: ctx.user.id,
            reason: error instanceof Error ? error.message : "unknown",
          });
        }
        securityLog("info", "auth.logout", { userId: ctx.user.id, requestIp: ctx.req.ip || "unknown" });
      }
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(getSessionCookieName(), { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  // Feature routers
  products: productsRouter,
  cart: cartRouter,
  favorites: favoritesRouter,
  orders: ordersRouter,
  profile: profileRouter,
  admin: adminRouter,
});

export type AppRouter = typeof appRouter;
