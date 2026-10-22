import { it, expect, vi } from "vitest";
import { verifyStagingIsolationIdentity } from "../../database/financialIsolation/identity";
import { TARGET } from "../../database/financialRecovery/policy";
const env = {
  RAILWAY_PROJECT_ID: TARGET.projectId,
  RAILWAY_ENVIRONMENT_ID: TARGET.environmentId,
  RAILWAY_SERVICE_ID: TARGET.serviceId,
  RAILWAY_DEPLOYMENT_ID: TARGET.deploymentId,
  ASAAS_API_URL: "https://api-sandbox.asaas.com/v3",
  ASAAS_CHECKOUT_BASE_URL: "https://sandbox.asaas.com",
  ASAAS_API_KEY: "$aact_hmlg_synthetic",
  DATABASE_URL:
    "mysql://fixture:synthetic@mysql.railway.internal/l4ckos_staging",
};
it.each([
  "RAILWAY_PROJECT_ID",
  "RAILWAY_ENVIRONMENT_ID",
  "RAILWAY_SERVICE_ID",
  "RAILWAY_DEPLOYMENT_ID",
])("rejects incorrect %s before database access", async key => {
  const c: any = {
    query: vi.fn(),
    config: { socketPath: "/var/run/mysqld/mysqld.sock" },
  };
  await expect(
    verifyStagingIsolationIdentity(
      c,
      { ...env, [key]: "wrong" },
      "bcda5d78-4a0d-4682-8659-8316847addb7",
      Buffer.alloc(0)
    )
  ).rejects.toThrow("ENVIRONMENT");
  expect(c.query).not.toHaveBeenCalled();
});
it("rejects TCP and wrong MySQL service before database access", async () => {
  for (const [socket, service] of [
    ["/tmp/mysql.sock", "bcda5d78-4a0d-4682-8659-8316847addb7"],
    ["/var/run/mysqld/mysqld.sock", "wrong"],
  ]) {
    const c: any = { query: vi.fn(), config: { socketPath: socket } };
    await expect(
      verifyStagingIsolationIdentity(c, env, service, Buffer.alloc(0))
    ).rejects.toThrow("SOCKET");
    expect(c.query).not.toHaveBeenCalled();
  }
});
it("rejects actual server identity even with matching environment", async () => {
  const c: any = {
    query: vi.fn().mockResolvedValue([
      [
        {
          db: "wrong",
          uuidHash: TARGET.mysqlUuidHash,
          version: "8.4.11",
          account: "root@localhost",
        },
      ],
    ]),
    config: { socketPath: "/var/run/mysqld/mysqld.sock" },
  };
  await expect(
    verifyStagingIsolationIdentity(
      c,
      env,
      "bcda5d78-4a0d-4682-8659-8316847addb7",
      Buffer.alloc(0)
    )
  ).rejects.toThrow("DATABASE");
});
