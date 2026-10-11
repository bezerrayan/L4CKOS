import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { packageWindow, privateJson } from "../../database/staging0022/package";
import {
  manualPublication,
  VERCEL,
} from "../../database/staging0022/publication";
import { RC, TARGET, SQL_SHA } from "../../database/staging0022/policy";
import { sha256 } from "../../database/schema/fingerprint";
import { assertPrivateUrl } from "../../database/staging0022/capability";
import { digest } from "../../database/staging0022/policy";
import { isStagingMaintenanceEnabled } from "../_core/stagingMaintenance";

describe("0022 operator packaging and manual publication dry run", () => {
  it("rejects extra identity fields before copying them into an artifact", async () => {
    const dir = await mkdtemp("/tmp/l4ckos-0022-package-"),
      output = `${dir}/invalid.cjs`;
    await expect(
      packageWindow(
        "inspect",
        {
          target: TARGET,
          deploymentId: randomUUID(),
          serverUuid: randomUUID(),
          endpointHash: "a".repeat(64),
          DATABASE_URL: "unexpected-extra-field",
        } as any,
        "-",
        output
      )
    ).rejects.toThrow("INSPECTION_IDENTITY_INVALID");
    await expect(stat(output)).rejects.toThrow();
  });
  it("embeds exactly reviewed SQL/contracts and separate operational code, with no remote calls", async () => {
    const dir = await mkdtemp("/tmp/l4ckos-0022-package-"),
      output = `${dir}/operator.cjs`;
    const manifest = await packageWindow(
      "inspect",
      {
        target: TARGET,
        deploymentId: randomUUID(),
        serverUuid: randomUUID(),
        endpointHash: "a".repeat(64),
      },
      "-",
      output
    );
    const code = await readFile(output, "utf8");
    expect(manifest.applicationCommit).toBe(RC);
    expect(manifest.sqlChecksum).toBe(SQL_SHA);
    expect(manifest.payloadSha256).toBe(sha256(code));
    expect(Object.keys(manifest.operatorFiles).length).toBeGreaterThan(4);
    expect((await stat(output)).mode & 0o777).toBe(0o600);
    expect(manifest.draft).toBe(true);
    // Real bundle execution is safely rejected BEFORE a network/DB connection,
    // without forging Railway IDs or exposing environment/secret values.
    const child = spawnSync(process.execPath, [], {
      input: code,
      encoding: "utf8",
      env: { PATH: process.env.PATH },
      cwd: process.cwd(),
    });
    expect(child.status).toBe(1);
    expect(JSON.parse(child.stdout)).toEqual({
      status: "STOPPED",
      code: "WINDOW_PREFLIGHT_FAILED",
    });
    expect(child.stderr).toBe("");
  });
  it("refuses apply without a valid proof/approval and writes no executable", async () => {
    const dir = await mkdtemp("/tmp/l4ckos-0022-package-"),
      output = `${dir}/invalid.cjs`;
    await expect(
      packageWindow("apply", {} as any, "invalid", output)
    ).rejects.toThrow();
    await expect(stat(output)).rejects.toThrow();
  });
  it("rejects public manifests and preserves private evidence", async () => {
    const dir = await mkdtemp("/tmp/l4ckos-0022-package-"),
      file = `${dir}/manifest.json`;
    await writeFile(file, "{}", { mode: 0o644 });
    await expect(privateJson(file)).rejects.toThrow(
      "PRIVATE_EXTERNAL_MANIFEST_REQUIRED"
    );
  });
  it("manual publication consumes local source, never pushes or refers to remote RC availability", () => {
    const spec = manualPublication(RC, true, true);
    expect(spec.backend).toContain(TARGET.projectId);
    expect(spec.backend).toContain(TARGET.environmentId);
    expect(spec.backend).toContain(TARGET.serviceId);
    expect(spec.frontend).toContain("--skip-domain");
    expect(spec.frontend).toContain("--prebuilt");
    expect(spec.frontend).toContain(VERCEL.team);
    expect(spec.environment).toMatchObject({
      VERCEL_PROJECT_ID: VERCEL.project,
      VITE_DEPLOY_TARGET: "staging",
      VITE_API_URL: "https://api-staging.l4ckos.com.br",
    });
    expect(spec.noGitPush).toBe(true);
    expect(
      manualPublication("a".repeat(40), true, true, "a".repeat(40)).noGitPush
    ).toBe(true);
    expect(spec.automaticPromotion).toBe(false);
    expect(
      [...spec.backend, ...spec.frontend!].some(v =>
        ["push", "merge", "source", "accept-deploy", "--new"].includes(v)
      )
    ).toBe(false);
    expect(manualPublication(RC, true, false).frontend).toBeNull();
    expect(() => manualPublication("a".repeat(40), true, true)).toThrow(
      "PUBLICATION_SOURCE_REQUIRED"
    );
    expect(() => manualPublication(RC, false, true)).toThrow(
      "PUBLICATION_SOURCE_REQUIRED"
    );
  });
  it("rejects wrong endpoint/database before opening any connection", () => {
    const identity = {
      target: TARGET,
      deploymentId: randomUUID(),
      serverUuid: randomUUID(),
      endpointHash: digest([
        "mysql-staging.railway.internal",
        3306,
        "l4ckos_staging",
      ]),
    };
    expect(
      assertPrivateUrl(
        "mysql://fixture@mysql-staging.railway.internal/l4ckos_staging",
        identity
      ).hostname
    ).toBe("mysql-staging.railway.internal");
    for (const url of [
      "mysql://fixture@another.railway.internal/l4ckos_staging",
      "mysql://fixture@mysql-staging.railway.internal/other",
      "mysql://fixture@localhost/l4ckos_staging",
      "mysql://fixture@mysql-staging.railway.internal/l4ckos_staging?host=other",
    ])
      expect(() => assertPrivateUrl(url, identity)).toThrow(
        "STAGING_ENDPOINT_NOT_APPROVED"
      );
  });
  it("the four unimplemented flags cannot activate the actual maintenance barrier", () => {
    expect(
      isStagingMaintenanceEnabled({
        NODE_ENV: "production",
        RAILWAY_PROJECT_ID: TARGET.projectId,
        RAILWAY_ENVIRONMENT_ID: TARGET.environmentId,
        RAILWAY_SERVICE_ID: TARGET.serviceId,
        MAINTENANCE_MODE: "true",
        CHECKOUT_ENABLED: "false",
        JOB_ENDPOINTS_ENABLED: "false",
        OPERATIONAL_JOBS_ENABLED: "false",
      })
    ).toBe(false);
  });
});
