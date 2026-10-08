import { createServer } from "node:http";
import { assertStagingIdentity } from "./guard.mjs";
import { handleMaintenanceRequest } from "./http.mjs";

try {
  assertStagingIdentity(process.env);

  const port = Number(process.env.PORT ?? "3000");

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("INVALID_PORT");
  }

  const server = createServer(handleMaintenanceRequest);

  server.on("error", () => {
    console.error("[MAINTENANCE] SERVER_START_FAILED");
    process.exitCode = 1;
  });

  server.listen(port, "0.0.0.0", () => {
    console.log("[MAINTENANCE] STAGING_READY");
  });
} catch {
  console.error("[MAINTENANCE] STARTUP_BLOCKED");
  process.exitCode = 1;
}
