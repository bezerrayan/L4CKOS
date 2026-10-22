import { it, expect, vi, afterEach } from "vitest";
const mocks = vi.hoisted(() => ({
  tamper: false,
  insecure: false,
  connect: vi.fn(),
}));
vi.mock("node:fs", async original => {
  const actual = await original<any>();
  return {
    ...actual,
    readFileSync: (...args: any[]) =>
      mocks.tamper ? Buffer.from("{}") : actual.readFileSync(...args),
    lstatSync: (...args: any[]) =>
      mocks.insecure
        ? {
            isDirectory: () => true,
            isSymbolicLink: () => false,
            mode: 0o755,
            uid: process.getuid?.(),
          }
        : actual.lstatSync(...args),
  };
});
vi.mock("mysql2/promise", () => ({ createConnection: mocks.connect }));
import {
  approvedTcpBackupPolicy,
  assertTcpAuthenticatedIdentity,
  verifyTcpAuthenticatedIdentity,
  tcpBackupReference,
} from "../../database/financialWindow/tcpBackupPolicy";
import {
  validateTunnelEndpoint,
  validateDiscoveryEndpoint,
  PrivateMysqlTcpTunnel,
} from "../../database/financialWindow/privateMysqlTunnel";
import {
  verifyPhysicalBackupIdentity,
  BACKUP_TARGET,
} from "../../database/financialWindow/backupIdentity";
import { exportThroughPrivateTransport } from "../../database/financialWindow/externalBackup";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  mocks.tamper = false;
  mocks.insecure = false;
  mocks.connect.mockReset();
});
const endpoint = (user: string) => ({
  host: "127.0.0.1",
  port: 3307,
  user,
  password: "synthetic",
  database: BACKUP_TARGET.database,
});
it("loads the private approved reference independently of environment and keeps distinct fields", () => {
  vi.stubEnv("MYSQL_USER", "synthetic_wrong");
  vi.stubEnv("CURRENT_USER", "synthetic_wrong@%");
  const p = approvedTcpBackupPolicy();
  expect(Object.isFrozen(p)).toBe(true);
  expect(
    typeof p.expectedLogin === "string" &&
      p.expectedCurrentUser.endsWith("@%") &&
      p.expectedCurrentUser.startsWith(p.expectedLogin + "@")
  ).toBe(true);
  expect(
    tcpBackupReference().login === p.expectedLogin &&
      tcpBackupReference().account === p.expectedCurrentUser
  ).toBe(true);
});
it("accepts only the pinned login at the backup endpoint while discovery does not approve alternatives", () => {
  const p = approvedTcpBackupPolicy();
  validateTunnelEndpoint(endpoint(p.expectedLogin), BACKUP_TARGET.database);
  const other = endpoint("synthetic_unapproved_account");
  validateDiscoveryEndpoint(other, BACKUP_TARGET.database);
  expect(() => validateTunnelEndpoint(other, BACKUP_TARGET.database)).toThrow(
    "WINDOW_TUNNEL_ENDPOINT_USER"
  );
});
it.each(["login", "account"])(
  "rejects divergent authenticated %s without exposing values",
  field => {
    const p = approvedTcpBackupPolicy(),
      id = {
        login: p.expectedLogin + "@synthetic_source",
        account: p.expectedCurrentUser,
      };
    id[field as "login" | "account"] = "synthetic_unapproved@%";
    expect(() => assertTcpAuthenticatedIdentity(id)).toThrow(
      "WINDOW_BACKUP_TCP_ACCOUNT"
    );
  }
);
it("validates USER login separately from the authenticated account and allows varying connection origin", () => {
  const p = approvedTcpBackupPolicy();
  assertTcpAuthenticatedIdentity({
    login: p.expectedLogin + "@synthetic_origin",
    account: p.expectedCurrentUser,
  });
});
it("decodes no identities learned from MySQL and refuses malformed USER", () => {
  const p = approvedTcpBackupPolicy();
  expect(() =>
    assertTcpAuthenticatedIdentity({
      login: "%72oot@host",
      account: p.expectedCurrentUser,
    })
  ).toThrow("WINDOW_BACKUP_TCP_ACCOUNT");
  expect(() =>
    assertTcpAuthenticatedIdentity({
      login: p.expectedLogin,
      account: p.expectedCurrentUser,
    })
  ).toThrow("WINDOW_BACKUP_TCP_ACCOUNT");
});
it("checks both identities with a fixed query and sanitizes database errors", async () => {
  const p = approvedTcpBackupPolicy(),
    query = vi
      .fn()
      .mockResolvedValue([
        [
          {
            login: p.expectedLogin + "@synthetic",
            account: p.expectedCurrentUser,
          },
        ],
      ]);
  await verifyTcpAuthenticatedIdentity({ query } as any);
  expect(query.mock.calls).toEqual([
    ["SELECT USER() login,CURRENT_USER() account"],
  ]);
  query.mockRejectedValue(Error("synthetic-secret"));
  await expect(
    verifyTcpAuthenticatedIdentity({ query } as any)
  ).rejects.toThrow("WINDOW_BACKUP_TCP_ACCOUNT");
});
it("rejects tampering with the pinned reference", () => {
  mocks.tamper = true;
  expect(() => approvedTcpBackupPolicy()).toThrow(
    "WINDOW_BACKUP_TCP_POLICY_INTEGRITY"
  );
});
it("rejects non-private policy permissions", () => {
  mocks.insecure = true;
  expect(() => approvedTcpBackupPolicy()).toThrow(
    "WINDOW_BACKUP_TCP_POLICY_INTEGRITY"
  );
});
it("rejects physical identity login divergence before any schema or business query", async () => {
  const ref = tcpBackupReference(),
    query = vi
      .fn()
      .mockResolvedValue([
        [
          {
            db: ref.database,
            uuidHash: ref.uuidHash,
            version: ref.mysqlVersion,
            account: ref.account,
            login: "synthetic_wrong@%",
          },
        ],
      ]);
  await expect(
    verifyPhysicalBackupIdentity({ query } as any, ref)
  ).rejects.toThrow("WINDOW_BACKUP_PHYSICAL_IDENTITY");
  expect(query).toHaveBeenCalledTimes(1);
});
it("preserves UNIX default account and original identity query", async () => {
  const query = vi
    .fn()
    .mockResolvedValue([
      [
        {
          db: BACKUP_TARGET.database,
          uuidHash: BACKUP_TARGET.uuidHash,
          version: BACKUP_TARGET.mysqlVersion,
          account: "synthetic_wrong@%",
        },
      ],
    ]);
  await expect(
    verifyPhysicalBackupIdentity({ query } as any, BACKUP_TARGET)
  ).rejects.toThrow("WINDOW_BACKUP_PHYSICAL_IDENTITY");
  expect(query.mock.calls[0][0]).toBe(
    "SELECT DATABASE() db,SHA2(@@server_uuid,256) uuidHash,VERSION() version,CURRENT_USER() account"
  );
});
it("counterfeit TCP transport cannot export with a divergent authenticated account", async () => {
  const ref = tcpBackupReference(),
    query = vi
      .fn()
      .mockResolvedValue([
        [
          {
            db: ref.database,
            uuidHash: ref.uuidHash,
            version: ref.mysqlVersion,
            account: "synthetic_wrong@%",
            login: ref.login + "@synthetic",
          },
        ],
      ]),
    close = vi.fn();
  const c = { query, end: vi.fn().mockResolvedValue(undefined) };
  const transport = {
    kind: "tcp" as const,
    attest: async () => ({
      authenticated: true,
      restricted: true,
      railway: {
        RAILWAY_PROJECT_ID: ref.projectId,
        RAILWAY_ENVIRONMENT_ID: ref.environmentId,
        RAILWAY_SERVICE_ID: ref.mysqlServiceId,
        RAILWAY_DEPLOYMENT_ID: ref.mysqlDeploymentId,
      },
    }),
    connectTcp: async () => c as any,
    close,
  };
  const custody = {
    recoverKey: vi.fn().mockResolvedValue(Buffer.alloc(32)),
    putCiphertext: vi.fn(),
    readCiphertext: vi.fn(),
  };
  await expect(
    exportThroughPrivateTransport(transport, custody, {
      path: "/tmp/l4ckos-synthetic/backup.enc",
      keyReference: "synthetic",
    })
  ).rejects.toThrow("WINDOW_BACKUP_PHYSICAL_IDENTITY");
  expect(query).toHaveBeenCalledTimes(1);
  expect(custody.putCiphertext).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalled();
});

it.each([true, false])(
  "TCP connection validates authenticated identity before delivery (match=%s)",
  async matches => {
    const p = approvedTcpBackupPolicy(),
      query = vi
        .fn()
        .mockResolvedValue([
          [
            {
              login: p.expectedLogin + "@synthetic",
              account: matches ? p.expectedCurrentUser : "synthetic_wrong@%",
            },
          ],
        ]);
    const c = { query, config: { password: "synthetic" }, destroy: vi.fn() };
    mocks.connect.mockResolvedValue(c);
    const credentials = endpoint(p.expectedLogin),
      close = vi.fn().mockResolvedValue(undefined);
    const inventory = async () => ({
      projectId: BACKUP_TARGET.projectId,
      environmentId: BACKUP_TARGET.environmentId,
      capturedAt: Date.now(),
      services: [
        {
          id: BACKUP_TARGET.mysqlServiceId,
          name: "SyntheticMysql",
          deploymentId: BACKUP_TARGET.mysqlDeploymentId,
          active: true,
        },
      ],
    });
    const t = new PrivateMysqlTcpTunnel(inventory, () => ({
      ready: Promise.resolve(credentials),
      alive: () => true,
      onStop: () => {},
      close,
    }));
    if (matches) {
      expect((await t.connectTcp()) === c).toBe(true);
      await t.close();
    } else
      await expect(t.connectTcp()).rejects.toThrow("WINDOW_TUNNEL_CONNECTION");
    expect(query.mock.calls).toEqual([
      ["SELECT USER() login,CURRENT_USER() account"],
    ]);
    expect(close).toHaveBeenCalled();
    expect(c.destroy).toHaveBeenCalled();
    expect(c.config.password).toBe("");
    expect(credentials.password).toBe("");
  }
);
