import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { ForbiddenError } from "@shared/_core/errors";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isString = (value: unknown): value is string => typeof value === "string";

export type SessionPayload = {
  openId: string;
  appId: string;
  name: string;
  sessionVersion: number;
};

class SDKServer {
  private parseCookies(cookieHeader: string | undefined) {
    if (!cookieHeader) {
      return new Map<string, string>();
    }

    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }

  private getSessionSecret() {
    const secret = ENV.cookieSecret?.trim() ?? "";

    if (!secret) {
      const error = new Error("JWT_SECRET is missing");
      Object.assign(error, { code: "MISSING_JWT_SECRET" });
      throw error;
    }

    if (secret.length < 32) {
      const error = new Error("JWT_SECRET is too short");
      Object.assign(error, { code: "WEAK_JWT_SECRET" });
      throw error;
    }

    return new TextEncoder().encode(secret);
  }

  async createSessionToken(
    openId: string,
    options: { expiresInMs?: number; name?: string; sessionVersion?: number } = {}
  ): Promise<string> {
    const appId = ENV.appId?.trim() || "loja-escoteira";

    return this.signSession(
      {
        openId,
        appId,
        name: options.name || "",
        sessionVersion: options.sessionVersion ?? 1,
      },
      options
    );
  }

  async signSession(
    payload: SessionPayload,
    options: { expiresInMs?: number } = {}
  ): Promise<string> {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1000);
    const secretKey = this.getSessionSecret();

    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name,
      sessionVersion: payload.sessionVersion,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(ENV.jwtIssuer)
      .setAudience(ENV.jwtAudience)
      .setIssuedAt()
      .setExpirationTime(expirationSeconds)
      .sign(secretKey);
  }

  async verifySession(
    cookieValue: string | undefined | null
  ): Promise<{ openId: string; appId: string; name: string; sessionVersion: number } | null> {
    if (!cookieValue) {
      return null;
    }

    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"],
        issuer: ENV.jwtIssuer,
        audience: ENV.jwtAudience,
      });
      const { openId, appId, name, sessionVersion } = payload as Record<string, unknown>;

      if (
        !isNonEmptyString(openId) ||
        !isNonEmptyString(appId) ||
        !isString(name) ||
        !Number.isInteger(sessionVersion)
      ) {
        return null;
      }

      return {
        openId,
        appId,
        name,
        sessionVersion: Number(sessionVersion),
      };
    } catch {
      return null;
    }
  }

  async authenticateRequest(req: Request): Promise<User> {
    const cookies = this.parseCookies(req.headers.cookie);
    const sessionCookie = cookies.get(COOKIE_NAME);
    const session = await this.verifySession(sessionCookie);

    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }

    const user = await db.getUserByOpenId(session.openId);
    if (!user) {
      throw ForbiddenError("User not found");
    }

    if (user.isBlocked === 1) {
      throw ForbiddenError("User blocked");
    }

    if (user.sessionVersion !== session.sessionVersion) {
      throw ForbiddenError("Session invalidated");
    }

    await db.upsertUser({
      openId: user.openId,
      lastSignedIn: new Date(),
    });

    return user;
  }
}

export const sdk = new SDKServer();
