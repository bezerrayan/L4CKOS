import { Router } from "express";
import { getManagerSyncPayload } from "../db";
import { sendApiError } from "../_core/httpApi";
import { securityLog } from "../_core/security";
import { resolveManagerSyncConfig, isManagerSyncAuthorizationValid } from "../services/managerSyncAuth";
import { isManagerSyncPeriodClosed, MAX_MANAGER_SYNC_RESPONSE_BYTES, parseManagerSyncMonthPeriod } from "../services/managerSyncSnapshot";

const managerSyncRoutes = Router();

managerSyncRoutes.get("/sync", async (req, res) => {
  const config = resolveManagerSyncConfig();
  if (!config) {
    securityLog("warn", "manager_sync.not_configured", { path: req.path });
    sendApiError(res, 503, "MANAGER_SYNC_UNAVAILABLE", "Manager sync is not configured for the authorized staging source.");
    return;
  }
  if (!isManagerSyncAuthorizationValid(req.headers.authorization, config.token)) {
    securityLog("warn", "manager_sync.auth_failed", { requestIp: req.ip || "unknown", path: req.path });
    res.setHeader("WWW-Authenticate", 'Bearer realm="l4ckos-manager-sync-v2"');
    sendApiError(res, 401, "MANAGER_SYNC_UNAUTHORIZED", "Unauthorized");
    return;
  }
  const queryKeys = Object.keys(req.query);
  const period = parseManagerSyncMonthPeriod(req.query.periodStart, req.query.periodEndExclusive);
  if (!period || queryKeys.some((key) => !["periodStart", "periodEndExclusive"].includes(key))) {
    sendApiError(res, 400, "INVALID_SYNC_PERIOD", "A full monthly period is required.");
    return;
  }
  if (!isManagerSyncPeriodClosed(period.start)) {
    sendApiError(res, 400, "SYNC_PERIOD_NOT_CLOSED", "Only closed monthly periods are available for Manager sync.");
    return;
  }

  try {
    const payload = await getManagerSyncPayload(period.start, period.endExclusive, config.identity);
    const body = JSON.stringify(payload);
    const bytes = Buffer.byteLength(body, "utf8");
    if (bytes > MAX_MANAGER_SYNC_RESPONSE_BYTES) {
      sendApiError(res, 413, "MANAGER_SYNC_RESPONSE_TOO_LARGE", "The complete monthly snapshot exceeds the configured response limit.");
      return;
    }
    res.setHeader("Cache-Control", "no-store, private");
    res.setHeader("Content-Length", String(bytes));
    res.status(200).type("application/json").send(body);
    securityLog("info", "manager_sync.snapshot_served", {
      environment: config.identity.environment,
      periodStart: period.start,
      periodEndExclusive: period.endExclusive,
      snapshotId: payload.snapshot.id,
      revision: payload.snapshot.revision,
      ordersCount: payload.orders.length,
      result: "success",
    });
  } catch (error) {
    const code = error instanceof Error && /^MANAGER_SYNC_[A-Z0-9_]+$/.test(error.message) ? error.message : "MANAGER_SYNC_FAILED";
    securityLog("error", "manager_sync.snapshot_failed", {
      environment: config.identity.environment,
      periodStart: period.start,
      periodEndExclusive: period.endExclusive,
      code,
    });
    const status = code.endsWith("LIMIT_EXCEEDED") ? 413 : code.includes("INVALID_PERIOD") ? 400 : 422;
    sendApiError(res, status, code, "A complete consistent snapshot could not be produced.");
  }
});

export default managerSyncRoutes;
