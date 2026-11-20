import { resolveFinancialRuntimeAttestation, type FinancialRuntimeAttestation } from "./financialRuntimeAttestation";
import { resolveFinancialPhasePolicy } from "./financialPhasePolicy";
import { isIsolatedHomologationIdentity } from "./railwayEnvironment";

type RuntimeEnvironment = Record<string, string | undefined>;

export type FinancialBootstrapResult = {
  allowed: boolean;
  report: FinancialRuntimeAttestation;
};

/** Pure pre-import gate for the isolated homologation artifact. */
export function inspectFinancialBootstrap(
  env: RuntimeEnvironment,
  processId: number,
): FinancialBootstrapResult {
  const report = resolveFinancialRuntimeAttestation(env, processId);
  const phasePolicy = resolveFinancialPhasePolicy(env);
  const completeExecutionIdentity = Boolean(
    report.execution.deploymentId && report.execution.replicaId && report.execution.processId,
  );
  const sandboxReady = report.asaasMode === "sandbox" && report.asaasModeConsistent && report.asaasCredentialsPresent;
  const allowed = isIsolatedHomologationIdentity(env) &&
    report.verdict === "PASS" && phasePolicy.allowed &&
    completeExecutionIdentity && sandboxReady &&
    report.stockReservationExpirySchedulerEnabled === phasePolicy.checkoutEnabled &&
    report.automaticBackupSchedulerEnabled === false;

  return { allowed, report };
}


export type IsolatedHomologationLaunchResult = FinancialBootstrapResult & {
  applicationStarted: boolean;
};

/** Injectable only for proving that a failed preflight never imports the app graph. */
export async function launchAfterFinancialBootstrap(
  env: RuntimeEnvironment,
  processId: number,
  startApplication: () => Promise<unknown>,
  emitAttestation: (report: FinancialRuntimeAttestation) => void = () => undefined,
): Promise<IsolatedHomologationLaunchResult> {
  const result = inspectFinancialBootstrap(env, processId);
  emitAttestation(result.report);
  if (!result.allowed) return { ...result, applicationStarted: false };
  await startApplication();
  return { ...result, applicationStarted: true };
}
