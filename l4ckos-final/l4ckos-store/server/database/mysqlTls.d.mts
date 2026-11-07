import type { PoolOptions } from "mysql2";
import type { X509Certificate } from "node:crypto";

export const MYSQL_TLS_HOST: string;
export const MYSQL_TLS_CA_SHA256: string;
export const MYSQL_STAGING_TLS_HOST: string;
export const MYSQL_STAGING_TLS_CA_SHA256: string;
export type MysqlTlsProfileName = "production" | "staging" | "local-test";
export type MysqlTlsProfile = Readonly<{
  profile: MysqlTlsProfileName;
  hostname: string;
  caPem: string;
  caSha256: string;
}>;
export function validateMysqlTlsCa(caPem: string, expectedSha256?: string): string;
export function assertApprovedMysqlTlsCa(): string;
export function validateMysqlStagingTlsCa(caPem: string, expectedSha256?: string, now?: number | Date): X509Certificate;
export function resolveMysqlTlsProfile(databaseUrl: string, environment?: NodeJS.ProcessEnv): MysqlTlsProfile;
export function createMysqlConnectionOptions(
  databaseUrl: string,
  environment?: NodeJS.ProcessEnv,
  options?: { socketPath?: string },
): PoolOptions;
export function assertMysqlConnectionReady(options?: {
  databaseUrl?: string;
  environment?: NodeJS.ProcessEnv;
  socketPath?: string;
  connect?: (options: PoolOptions) => Promise<{ end(): Promise<void> }>;
}): Promise<void>;
