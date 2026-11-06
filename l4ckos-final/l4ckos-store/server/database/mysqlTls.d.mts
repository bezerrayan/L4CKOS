import type { PoolOptions } from "mysql2";

export const MYSQL_TLS_HOST: string;
export const MYSQL_TLS_CA_SHA256: string;
export function validateMysqlTlsCa(caPem: string, expectedSha256?: string): string;
export function assertApprovedMysqlTlsCa(): string;
export function createMysqlConnectionOptions(databaseUrl: string): PoolOptions;
