import { canonical, sha256 } from "../schema/fingerprint";
import { assertIdentity, TARGET, type StagingIdentity } from "./policy";

export function identityFromRailway(status: any, apiVars: any, mysqlVars: any, network: unknown): StagingIdentity {
  if (status?.id !== TARGET.projectId || status?.name !== TARGET.projectName) throw new Error("STAGING_TARGET_IDENTITY_MISMATCH");
  const environment = status.environments?.edges?.map((edge: any) => edge.node).find((item: any) => item.id === TARGET.environmentId);
  if (!environment || environment.name !== TARGET.environmentName) throw new Error("STAGING_TARGET_IDENTITY_MISMATCH");
  const services = environment.serviceInstances?.edges?.map((edge: any) => edge.node) ?? [];
  const api = services.find((service: any) => service.serviceId === TARGET.apiServiceId);
  const mysql = services.find((service: any) => service.serviceId === TARGET.mysqlServiceId);
  if (!api || api.serviceName !== "l4ckos-staging" || !mysql || mysql.serviceName !== "mysql" || services.filter((service: any) => service.serviceName === "mysql").length !== 1 || !api.domains?.customDomains?.some((domain: any) => domain.domain === "api-staging.l4ckos.com.br")) throw new Error("STAGING_TARGET_IDENTITY_MISMATCH");
  const active = api.activeDeployments?.edges?.map((edge: any) => edge.node) ?? api.activeDeployments ?? [];
  if (!Array.isArray(active) || active.length !== 1 || !/^[a-f0-9-]{36}$/.test(active[0]?.id || "")) throw new Error("STAGING_SINGLE_ACTIVE_DEPLOYMENT_REQUIRED");
  for (const [vars, serviceId] of [[apiVars, TARGET.apiServiceId], [mysqlVars, TARGET.mysqlServiceId]] as const) {
    if (vars.RAILWAY_PROJECT_ID !== TARGET.projectId || vars.RAILWAY_ENVIRONMENT_ID !== TARGET.environmentId || vars.RAILWAY_SERVICE_ID !== serviceId) throw new Error("STAGING_VARIABLE_IDENTITY_MISMATCH");
  }
  let appUrl: URL, mysqlUrl: URL;
  try { appUrl = new URL(apiVars.DATABASE_URL); mysqlUrl = new URL(mysqlVars.MYSQL_URL); } catch { throw new Error("STAGING_PRIVATE_DATABASE_REQUIRED"); }
  if (appUrl.protocol !== "mysql:" || mysqlUrl.protocol !== "mysql:" || appUrl.href !== mysqlUrl.href || appUrl.search || appUrl.hash || appUrl.pathname !== `/${TARGET.schema}` || !appUrl.hostname.endsWith(".railway.internal")) throw new Error("STAGING_DATABASE_NOT_EXCLUSIVE");
  const hosts = new Set<string>();
  const visit = (value: unknown) => { if (typeof value === "string" && value.endsWith(".railway.internal")) hosts.add(value); else if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === "object") Object.values(value).forEach(visit); };
  visit(network);
  if (hosts.size !== 1 || !hosts.has(appUrl.hostname)) throw new Error("STAGING_MYSQL_NETWORK_IDENTITY_MISMATCH");
  const connectionHash = sha256(canonical([appUrl.hostname, Number(appUrl.port || 3306), decodeURIComponent(appUrl.username), decodeURIComponent(appUrl.password), decodeURIComponent(appUrl.pathname.slice(1)), null]));
  const identity = { ...TARGET, deploymentId: active[0].id, databaseHost: appUrl.hostname, connectionHash };
  assertIdentity(identity);
  return identity;
}
