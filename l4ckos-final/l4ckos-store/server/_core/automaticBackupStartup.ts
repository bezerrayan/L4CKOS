import { isIsolatedHomologationIdentity, type RailwayEnvironment } from "./railwayEnvironment";

/** The isolated MySQL is 9.7.2; its approved Gate 4 age backup is the recovery point.
 * Keep the legacy JSON backup path unchanged for production and the older staging service. */
export function shouldScheduleAutomaticBackup(env: RailwayEnvironment = process.env): boolean {
  return !isIsolatedHomologationIdentity(env);
}
