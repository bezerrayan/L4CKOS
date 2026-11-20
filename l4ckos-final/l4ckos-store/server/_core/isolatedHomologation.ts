import { launchAfterFinancialBootstrap } from "./financialRuntimeBootstrap";
import { emitFinancialRuntimeAttestation } from "./financialRuntimeAttestation";

try {
  const result = await launchAfterFinancialBootstrap(
    process.env,
    process.pid,
    async () => {
      // This dynamic import is the boundary: application imports (including payment,
      // database and worker modules) cannot run until the attestation passes.
      const { startServer } = await import("./application");
      await startServer();
    },
    report =>
      emitFinancialRuntimeAttestation(report, process.env.G4_FINANCIAL_PHASE)
  );
  if (!result.allowed) {
    console.error("[Startup] isolated homologation bootstrap blocked");
    process.exitCode = 1;
  }
} catch {
  // Never serialize arbitrary errors from the app bootstrap; they may contain secrets.
  console.error("[Startup] isolated homologation application startup failed");
  process.exitCode = 1;
}
