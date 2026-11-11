import type { PoolOptions } from "mysql2";

export type DatabaseEnvironment = "production" | "staging" | "local-test";
export function resolveDatabaseEnvironment(env?: Record<string, string | undefined>): DatabaseEnvironment;
export function resolveMysqlConnection(
  databaseUrl: string,
  env?: Record<string, string | undefined>,
): { environment: DatabaseEnvironment; options: PoolOptions };
export function createMysqlConnectionOptionsForEnvironment(
  databaseUrl: string,
  env?: Record<string, string | undefined>,
): PoolOptions;
