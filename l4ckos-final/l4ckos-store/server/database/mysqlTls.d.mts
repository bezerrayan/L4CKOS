import type { PoolOptions } from "mysql2";

export const MYSQL_TLS_HOST: string;
export const MYSQL_TLS_APPROVED_HOSTS: readonly string[];
export function isApprovedMysqlTlsHost(hostname: string): boolean;
export const MYSQL_TLS_CA_SHA256: string;
export function validateMysqlTlsCa(caPem: string, expectedSha256?: string): string;
export function assertApprovedMysqlTlsCa(): string;
export function createMysqlConnectionOptions(databaseUrl: string): PoolOptions;
export function createMysqlTlsRegistry(targets: Array<{ host: string; caPem: string; caSha256: string }>): { hosts: readonly string[]; find(hostname: string): { host: string; caPem: string; caSha256: string } | undefined };
export function mysqlTlsCaForHost(hostname: string): string;
export const MYSQL_TLS_C7_HOST: string;
export const MYSQL_TLS_C7_CA_SHA256: string;
