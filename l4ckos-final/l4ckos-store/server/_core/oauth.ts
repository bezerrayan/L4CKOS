import { COOKIE_NAME } from "@shared/const";
import { parse as parseCookieHeader } from "cookie";
import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { ENV } from "./env";
import { sdk } from "./sdk";
import { sendWelcomeAccountEmail } from "../services/emailService.js";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

function getBaseUrl(req: Request): string {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const proto =
    typeof forwardedProto === "string"
      ? forwardedProto.split(",")[0]?.trim() || req.protocol
      : req.protocol;
  const forwardedHost = req.headers["x-forwarded-host"];
  const host =
    (typeof forwardedHost === "string"
      ? forwardedHost.split(",")[0]?.trim()
      : undefined) || req.get("host");
  return `${proto}://${host}`;
}

function getGoogleRedirectUri(req: Request): string {
  const runtimeRedirectUri = `${getBaseUrl(req)}/api/oauth/callback`;

  if (!ENV.googleRedirectUri) {
    return runtimeRedirectUri;
  }

  try {
    const configured = new URL(ENV.googleRedirectUri);
    const runtime = new URL(runtimeRedirectUri);
    const isLocalhostConfig =
      configured.hostname === "localhost" || configured.hostname === "127.0.0.1";

    if (isLocalhostConfig) {
      return runtimeRedirectUri;
    }

    return configured.toString();
  } catch {
    return runtimeRedirectUri;
  }
}

function getFrontendBaseUrl(req: Request): string {
  const configured = ENV.frontendUrl?.trim();
  if (configured) {
    try {
      return new URL(configured).toString();
    } catch {
      // ignore invalid configured URL and fallback
    }
  }

  return getBaseUrl(req);
}

function buildFrontendRedirectUrl(req: Request, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return new URL(normalizedPath, getFrontendBaseUrl(req)).toString();
}

function decodeState(state: string): { returnTo?: string; nonce?: string } {
  try {
    const raw = Buffer.from(state, "base64url").toString("utf8");
    return JSON.parse(raw) as { returnTo?: string; nonce?: string };
  } catch {
    return {};
  }
}

function encodeState(payload: { returnTo: string; nonce: string }): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function getGoogleCredentialStatus() {
  const hasClientId =
    typeof ENV.googleClientId === "string" &&
    ENV.googleClientId.trim() !== "" &&
    !ENV.googleClientId.includes("preencha_");

  const hasClientSecret =
    typeof ENV.googleClientSecret === "string" &&
    ENV.googleClientSecret.trim() !== "" &&
    !ENV.googleClientSecret.includes("preencha_");

  return { hasClientId, hasClientSecret };
}

function hasConfiguredGoogleCredentials() {
  const { hasClientId, hasClientSecret } = getGoogleCredentialStatus();

  return hasClientId && hasClientSecret;
}

export function registerOAuthRoutes(app: Express) {
  app.get("/api/oauth/login", async (req: Request, res: Response) => {
    if (!hasConfiguredGoogleCredentials()) {
      const status = getGoogleCredentialStatus();
      res.status(500).json({
        error: "Google OAuth nao configurado. Preencha GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no .env",
        status,
      });
      return;
    }

    const returnToRaw = getQueryParam(req, "returnTo");
    const returnTo =
      typeof returnToRaw === "string" && returnToRaw.startsWith("/")
        ? returnToRaw
        : "/";

    const nonce = randomBytes(16).toString("hex");
    const state = encodeState({ returnTo, nonce });
    const cookieOptions = getSessionCookieOptions(req);

    res.cookie("oauth_state", state, {
      ...cookieOptions,
      httpOnly: true,
      maxAge: 10 * 60 * 1000,
    });

    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", ENV.googleClientId);
    url.searchParams.set("redirect_uri", getGoogleRedirectUri(req));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    url.searchParams.set("prompt", "select_account");

    res.redirect(302, url.toString());
  });

  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    let callbackStage = "init";

    if (!code || !state) {
      res.redirect(302, buildFrontendRedirectUrl(req, "/login?oauthError=missing_code_or_state"));
      return;
    }

    try {
      callbackStage = "validate_state";
      const cookies = parseCookieHeader(req.headers.cookie ?? "");
      const expectedState = cookies.oauth_state;
      if (!expectedState || expectedState !== state) {
        res.status(400).json({ error: "invalid oauth state" });
        return;
      }

      callbackStage = "validate_credentials";
      if (!hasConfiguredGoogleCredentials()) {
        const status = getGoogleCredentialStatus();
        res.status(500).json({
          error: "Google OAuth nao configurado no servidor. Verifique GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET",
          status,
        });
        return;
      }

      callbackStage = "token_exchange";
      const redirectUri = getGoogleRedirectUri(req);

      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: ENV.googleClientId,
          client_secret: ENV.googleClientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });

      if (!tokenResponse.ok) {
        const details = await tokenResponse.text();
        console.error("[OAuth] Token exchange failed", details);
        res.status(500).json({ error: "failed to exchange google token" });
        return;
      }

      const tokenPayload = (await tokenResponse.json()) as {
        access_token?: string;
      };
      if (!tokenPayload.access_token) {
        res.status(500).json({ error: "google access_token missing" });
        return;
      }

      callbackStage = "userinfo";
      const userInfoResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: {
          Authorization: `Bearer ${tokenPayload.access_token}`,
        },
      });

      if (!userInfoResponse.ok) {
        const details = await userInfoResponse.text();
        console.error("[OAuth] Failed to fetch user info", details);
        res.status(500).json({ error: "failed to fetch google userinfo" });
        return;
      }

      const userInfo = (await userInfoResponse.json()) as {
        sub?: string;
        name?: string;
        email?: string;
        email_verified?: boolean;
      };

      const openId = userInfo.sub;

      if (!openId) {
        res.status(400).json({ error: "google sub missing from user info" });
        return;
      }

      callbackStage = "upsert_user";
      const normalizedEmail = String(userInfo.email ?? "").trim().toLowerCase();
      const googleRole = getGoogleRoleForUserInfo({
        openId,
        email: normalizedEmail,
        emailVerified: userInfo.email_verified === true,
      });
      const existingUser = await db.getUserByOpenId(openId);

      await db.upsertUser({
        openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: "google",
        role: googleRole,
        lastSignedIn: new Date(),
      });

      callbackStage = "verify_user_persisted";
      const persistedUser = await db.getUserByOpenId(openId);
      if (!persistedUser) {
        const persistenceError = new Error("User was not persisted or retrieved after OAuth upsert");
        Object.assign(persistenceError, { code: "USER_NOT_PERSISTED" });
        throw persistenceError;
      }

      if (!existingUser && normalizedEmail) {
        try {
          await sendWelcomeAccountEmail({
            email: normalizedEmail,
            name: userInfo.name || normalizedEmail.split("@")[0] || "cliente",
          });
        } catch (emailError) {
          console.warn("[OAuth] Welcome email failed", {
            userId: persistedUser.id,
            reason: emailError instanceof Error ? emailError.message : "unknown",
          });
        }
      }

      const nextSessionVersion = await db.rotateUserSessionVersion(persistedUser.id);

      callbackStage = "create_session";
      const sessionToken = await sdk.createSessionToken(openId, {
        name: userInfo.name || "",
        expiresInMs: ENV.sessionTtlMs,
        sessionVersion: nextSessionVersion,
      });

      callbackStage = "set_cookie_redirect";
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ENV.sessionTtlMs });
      res.clearCookie("oauth_state", { ...cookieOptions, maxAge: -1 });

      const decodedState = decodeState(state);
      const returnTo =
        typeof decodedState.returnTo === "string" && decodedState.returnTo.startsWith("/")
          ? decodedState.returnTo
          : "/";

      res.redirect(302, buildFrontendRedirectUrl(req, returnTo));
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: unknown }).code ?? "unknown")
          : "unknown";
      console.error("[OAuth] Callback failed", { stage: callbackStage, code, error });
      res.status(500).json({
        error: "OAuth callback failed",
        status: { stage: callbackStage, code },
      });
    }
  });
}

export function getGoogleRoleForUserInfo(input: { openId: string; email?: string | null; emailVerified: boolean }) {
  const normalizedEmail = String(input.email ?? "").trim().toLowerCase();
  if (input.openId === ENV.ownerOpenId) return "admin";
  if (input.emailVerified && normalizedEmail && ENV.adminEmails.includes(normalizedEmail)) return "admin";
  return "user";
}
