import {
  Router,
} from "express";

import {
  getManagerSyncPayload,
} from "../db";

import {
  sendApiError,
} from "../_core/httpApi";

import {
  securityLog,
} from "../_core/security";

import {
  isManagerSyncAuthorizationValid,
} from "../services/managerSyncAuth";

const managerSyncRoutes =
  Router();

managerSyncRoutes.get(
  "/sync",
  async (
    req,
    res,
  ) => {
    const expectedToken =
      process.env
        .MANAGER_SYNC_TOKEN
        ?.trim();

    if (
      !expectedToken ||
      expectedToken.length <
        32
    ) {
      securityLog(
        "error",
        "manager_sync.token_unavailable",
        {
          path:
            req.path,
        },
      );

      sendApiError(
        res,
        503,
        "MANAGER_SYNC_UNAVAILABLE",
        "Manager synchronization is not configured",
      );

      return;
    }

    const authorization =
      typeof req.headers
        .authorization ===
      "string"
        ? req.headers
            .authorization
        : undefined;

    if (
      !isManagerSyncAuthorizationValid(
        authorization,
        expectedToken,
      )
    ) {
      securityLog(
        "warn",
        "manager_sync.auth_failed",
        {
          requestIp:
            req.ip ||
            "unknown",

          path:
            req.path,
        },
      );

      res.setHeader(
        "WWW-Authenticate",
        'Bearer realm="l4ckos-manager-sync"',
      );

      sendApiError(
        res,
        401,
        "MANAGER_SYNC_UNAUTHORIZED",
        "Unauthorized",
      );

      return;
    }

    const rawAfter =
      req.query.after;

    if (
      rawAfter !==
        undefined &&
      typeof rawAfter !==
        "string"
    ) {
      sendApiError(
        res,
        400,
        "INVALID_SYNC_CURSOR",
        "Invalid synchronization cursor",
      );

      return;
    }

    let after:
      Date | null =
      null;

    if (rawAfter) {
      const parsed =
        new Date(
          rawAfter,
        );

      if (
        Number.isNaN(
          parsed.getTime(),
        )
      ) {
        sendApiError(
          res,
          400,
          "INVALID_SYNC_CURSOR",
          "Invalid synchronization cursor",
        );

        return;
      }

      after =
        parsed;
    }

    try {
      const payload =
        await getManagerSyncPayload(
          after,
        );

      res
        .status(200)
        .type(
          "application/json",
        )
        .json(
          payload,
        );
    } catch (
      error
    ) {
      securityLog(
        "error",
        "manager_sync.failed",
        {
          requestIp:
            req.ip ||
            "unknown",

          message:
            error instanceof
              Error
              ? error.message
              : "unknown",
        },
      );

      sendApiError(
        res,
        500,
        "MANAGER_SYNC_FAILED",
        "Manager synchronization failed",
      );
    }
  },
);

export default managerSyncRoutes;
