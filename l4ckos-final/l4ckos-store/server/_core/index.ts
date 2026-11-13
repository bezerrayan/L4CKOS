import "dotenv/config";
import { hasIsolatedHomologationIdentityMarker } from "./railwayEnvironment";

if (hasIsolatedHomologationIdentityMarker(process.env)) {
  // The ordinary entrypoint must never silently bypass the isolated guard.
  console.error("[Startup] isolated homologation requires start:isolated-homologation");
  process.exitCode = 1;
} else {
  // Preserve the ordinary Production and legacy-staging application path.
  const { startServer } = await import("./application");
  startServer().catch(console.error);
}
