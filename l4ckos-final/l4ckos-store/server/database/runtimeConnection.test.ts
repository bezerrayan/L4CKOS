import { describe, expect, it } from "vitest";
import { runtimeConnectionOptions, runtimeTlsOptions } from "./runtimeConnection";
import { MYSQL_TLS_HOST } from "./mysqlTls.mjs";

const prod = { NODE_ENV: "production", APP_ENV: "production", DATABASE_URL: `mysql://u:p@${MYSQL_TLS_HOST}:3306/railway` };
const local = { NODE_ENV: "test", APP_ENV: "local-test", L4CKOS_LOCAL_DB_EXCEPTION: "disposable-loopback", DATABASE_URL: "mysql://root@localhost/l4ckos_test_x" };

describe("direct runtime connections follow the environment TLS policy", () => {
  it("production: pinned CA with identity verification, caller extras preserved", () => {
    const options = runtimeConnectionOptions({ timezone: "Z" }, prod);
    expect(options).toMatchObject({ uri: prod.DATABASE_URL, timezone: "Z", ssl: { rejectUnauthorized: true, verifyIdentity: true } });
    expect(runtimeTlsOptions(prod).ssl).toBeTruthy();
  });
  it("local disposable database: no TLS, still loopback-only", () => {
    expect(runtimeConnectionOptions({}, local)).toEqual({ uri: local.DATABASE_URL });
    expect(runtimeTlsOptions(local)).toEqual({});
  });
  it("fails closed: wrong host in production, missing URL, local exception in production", () => {
    expect(() => runtimeConnectionOptions({}, { ...prod, DATABASE_URL: "mysql://u:p@evil.example/railway" })).toThrow("MYSQL_TLS_HOST_MISMATCH");
    expect(() => runtimeConnectionOptions({}, { ...prod, DATABASE_URL: undefined })).toThrow("DATABASE_URL_REQUIRED");
    expect(() => runtimeConnectionOptions({}, { ...local, NODE_ENV: "production" })).toThrow("DB_LOCAL_EXCEPTION_FORBIDDEN");
  });
});
