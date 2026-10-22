import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { packageWindow, privateJson } from "../../database/staging0022/package";
import {
  manualPublication,
  VERCEL,
} from "../../database/staging0022/publication";
import { RC, APPLICATION_RC, TARGET, SQL_SHA, SQL_SHA23 } from "../../database/staging0022/policy";
import { sha256 } from "../../database/schema/fingerprint";
import { assertPrivateUrl } from "../../database/staging0022/capability";
import { digest } from "../../database/staging0022/policy";
import { isStagingMaintenanceEnabled } from "../_core/stagingMaintenance";
import { operatorTransport } from '../../database/staging0022/transport';
import { notificationRecovery } from '../../database/staging0022/notificationRecovery';
import { gzipSync } from 'node:zlib';

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
    expect(manifest.applicationCommit).toBe(APPLICATION_RC);
    expect(manifest.sqlChecksum).toBeNull();
    expect(manifest.sqlSourceCommit).toBe(APPLICATION_RC);
    expect(code).toContain(SQL_SHA);
    expect(code).toContain(SQL_SHA23);
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
  it('refuses continuation when the private gzip differs from the restored proof',async()=>{
    const dir=await mkdtemp('/tmp/l4ckos-checkpoint-proof-'),artifact=dir+'/backup.sql.gz',output=dir+'/continue.json';
    await writeFile(artifact,gzipSync('-- synthetic local backup\n'),{mode:0o600});
    const files=[dir+'/checkpoint.json',dir+'/admission.json',dir+'/plan.json'];
    for(const file of files)await writeFile(file,JSON.stringify({backup:{artifactSha256:'0'.repeat(64),bytes:1}}),{mode:0o600});
    const child=spawnSync(process.execPath,['--import','tsx','scripts/staging0022.ts','continue0022',...files,artifact,output],{encoding:'utf8',env:{PATH:process.env.PATH},cwd:process.cwd()});
    expect(child.status).toBe(1);expect(JSON.parse(child.stderr)).toEqual({status:'STOPPED',code:'0022_PREPARATION_FAILED'});
    await expect(stat(output)).rejects.toThrow();
    expect(child.stdout).not.toContain('synthetic local backup');
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
  it('keeps credential and executable frames separate from live control stdin',async()=>{
    const identity={target:TARGET,deploymentId:randomUUID(),serverUuid:randomUUID(),endpointHash:'a'.repeat(64)};
    const argv=operatorTransport(identity,'a'.repeat(64));
    expect(argv).toContain(TARGET.projectId);expect(argv).toContain(TARGET.environmentId);expect(argv).toContain(TARGET.serviceId);
    const script=argv.at(-1)!;
    expect(script).toContain('exec node "$directory/operator.cjs"');
    expect(script).not.toContain('node -');expect(script).not.toContain('PASSWORD');
    // Real framing rehearsal: sh reads exactly two frames; a FILE-launched node
    // receives the following NDJSON commands without EOF-consuming the bundle.
    const dir=await mkdtemp('/tmp/l4ckos-transport-test-'),file=dir+'/operator.cjs';
    const code="let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>console.log(JSON.stringify({credential:process.env.L4CKOS_OPERATOR_DATABASE_URL==='synthetic-private',control:JSON.parse(s)})));";
    const child=spawnSync('sh',['-c',`IFS= read -r L4CKOS_OPERATOR_DATABASE_URL; export L4CKOS_OPERATOR_DATABASE_URL; IFS= read -r bundle; printf '%s' "$bundle" | base64 -d > "$1"; exec node "$1"`,'sh',file],{input:'synthetic-private\n'+Buffer.from(code).toString('base64')+'\n'+JSON.stringify({type:'inspect0023Recovery'})+'\n',encoding:'utf8'});
    expect(child.status).toBe(0);expect(JSON.parse(child.stdout)).toEqual({credential:true,control:{type:'inspect0023Recovery'}});
    expect(()=>operatorTransport({...identity,target:{...TARGET,projectId:'wrong'} as any},'a'.repeat(64))).toThrow('TRANSPORT_IDENTITY_REQUIRED');
  });
  it.each([
    ['pending',0,false,null,false,'unknown','VERIFY_LOGICAL_KEY_AND_PROVIDER_BEFORE_AUTHORIZED_DISPATCH'],
    ['processing',1,false,null,false,'unknown','HOLD_UNCERTAIN_RESULT_PROVIDER_RECONCILIATION_REQUIRED'],
    ['processing',1,false,200,true,'unknown','WAIT_ACTIVE_LEASE'],
    ['failed',1,false,null,false,'accepted','RECONCILE_PROVIDER_RECEIPT'],
    ['processing',1,false,null,false,'definitely-not-accepted','PREPARE_SEPARATE_AUTHORIZED_ATOMIC_CLAIM'],
    ['sent',1,true,null,false,'unknown','RECONCILE_PROVIDER_RECEIPT'],
  ] as const)('reconciles notification state %s without financial replay or blind resend',(state,attempts,providerIdPresent,leaseExpiresAt,tokenPresent,providerEvidence,action)=>{
    expect(notificationRecovery({state,attempts,providerIdPresent,leaseExpiresAt,tokenPresent,providerEvidence},100)).toEqual({action,resendAllowed:false,financialReplayAllowed:false});
  });
  it('prepares publication only for the exact approved RC2 SHA',()=>{
    expect(manualPublication(APPLICATION_RC,true,true,APPLICATION_RC).backend).toContain(`RC ${APPLICATION_RC} staging manual`);
    expect(()=>manualPublication(RC,true,true,APPLICATION_RC)).toThrow('PUBLICATION_SOURCE_REQUIRED');
  });
  it('portable socket transport verifies both hashes and preserves queued controls without a credential frame',async()=>{
    const identity={target:TARGET,deploymentId:randomUUID(),serverUuid:randomUUID(),endpointHash:'a'.repeat(64)},mysqlDeployment=randomUUID();
    const binary=await readFile(process.execPath),zipped=gzipSync(binary,{level:1});
    const code="const r=require('node:readline').createInterface({input:process.stdin});const q=r[Symbol.asyncIterator]();setTimeout(async()=>{for await(const line of q)console.log(JSON.stringify({node:process.version,command:JSON.parse(line)}));},30);";
    const argv=operatorTransport(identity,sha256(code),{mysqlDeployment,nodeSha256:sha256(binary),nodeGzipBytes:zipped.length});
    expect(argv).toContain(TARGET.mysqlServiceId);expect(argv.at(-1)).not.toContain('MYSQL_ROOT_PASSWORD');
    const child=spawnSync('sh',['-c',argv.at(-1)!],{input:Buffer.concat([zipped,Buffer.from(Buffer.from(code).toString('base64')+'\n'+JSON.stringify({type:'snapshot'})+'\n')]),encoding:'utf8',env:{PATH:process.env.PATH,RAILWAY_PROJECT_ID:TARGET.projectId,RAILWAY_ENVIRONMENT_ID:TARGET.environmentId,RAILWAY_SERVICE_ID:TARGET.mysqlServiceId,RAILWAY_DEPLOYMENT_ID:mysqlDeployment},timeout:20000});
    expect(child.status,child.stderr).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual({node:'v22.23.2',command:{type:'snapshot'}});
  },30000);
  it('v3 backup preparation is dry-run and requires 0022 present with 0023 absent',async()=>{
    const dir=await mkdtemp('/tmp/l4ckos-backup-dry-run-');
    const child=spawnSync('python3',['scripts/staging0022-backup.py','--directory',dir,'--server-uuid',randomUUID(),'--mysql-deployment',randomUUID(),'--estimated-bytes','1','--phase','0023'],{encoding:'utf8'});
    expect(child.status,child.stderr).toBe(0);
    expect(JSON.parse(child.stdout)).toMatchObject({mode:'DRY_RUN',remoteExecuted:false,phase:'0023',service:TARGET.mysqlServiceId});
    const probe=spawnSync('python3',['-c',"import runpy; m=runpy.run_path('scripts/staging0022-backup.py'); s=m['command']('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','0023')[-1]; print('present='+str('test \\\"$applied\\\" = \\\"1\\\"' in s)); print('absent='+str('test \\\"$inbox\\\" = \\\"0\\\"' in s))"],{encoding:'utf8'});
    expect(probe.status).toBe(0);expect(probe.stdout).toBe('present=True\nabsent=True\n');
  });
});
