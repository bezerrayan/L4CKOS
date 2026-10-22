import { describe, expect, it } from 'vitest';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { packageRecovery } from '../../scripts/package-financial-recovery';
import { prepareTransport } from '../../database/financialRecovery/transport';
import { CANDIDATES, TARGET, assertEnvironment, requestSchema, digest, assertApproval } from '../../database/financialRecovery/policy';
import { deriveKernel } from '../../database/financialRecovery/reuse';
import { sha256 } from '../../database/schema/fingerprint';
const root=resolve(import.meta.dirname,'../..');
describe('Private operator packaging, CLI and source integrity',()=>{
  it.each(Object.entries(CANDIDATES))('preserves approved hash: %s',async(file,hash)=>{
    expect(sha256(await readFile(resolve(root,file)))).toBe(hash);
  });
  it.each(['financial','created'] as const)('reuses %s candidate through reviewed deterministic adaptation',async(kind)=>{
    const stem=kind==='financial'?'supervisedFinancialRecoveryRehearsal':'supervisedCreatedRecoveryRehearsal';
    expect(await readFile(resolve(root,'database/financialRecovery/'+kind+'Kernel.ts'),'utf8'))
      .toBe(deriveKernel(await readFile(resolve(root,'server/payments/'+stem+'.ts'),'utf8'),kind));
  });
  it('refuses altered candidate before packaging',()=>{expect(()=>deriveKernel('tampered','financial')).toThrow('RECOVERY_CANDIDATE_HASH_MISMATCH');});
  it('rejects modes, bypass flags and invented events in input',()=>{
    for(const input of [{operation:'PAYMENT_RECEIVED'},{operation:'financial-b',force:true},{operation:'financial-b',mode:'apply'},
      {operation:'created',providerUrl:'https://api.asaas.com/v3'}])expect(()=>requestSchema.parse(input)).toThrow();
  });
  it('verification execution request cannot acquire write permission',()=>{
    expect(()=>assertApproval(requestSchema.parse({operation:'verify-financial',mode:'execute'}),'a'.repeat(64)))
      .toThrow('RECOVERY_VERIFY_IS_READ_ONLY');
  });
  it('packages deterministically and proves import/secret/startup boundary; launcher refuses wrong environment before temp placement',async()=>{
    const dir='/tmp/l4ckos-financial-operator-'+randomUUID(),manifest=await packageRecovery(dir);
    const second=await packageRecovery(dir+'-copy');expect(manifest.artifactHash).toBe(second.artifactHash);
    const paths=Object.keys(manifest.sourceHashes);
    expect(paths.some(p=>/controllers|services\/|server\/db.ts|_core\/index|\.env|\.npmrc/.test(p))).toBe(false);
    expect(manifest.modeDefault).toBe('dry-run');expect(manifest.remoteExecuted).toBe(false);
    expect((await stat(dir+'/operator.cjs')).mode&0o777).toBe(0o600);
    const artifact=await readFile(dir+'/operator.cjs','utf8');
    expect(artifact).not.toContain('createAsaasCheckout');expect(artifact).not.toContain('sendPaymentApprovedEmail');
    const launcher=dir+'/dry.launcher.cjs',transport=await prepareTransport(dir+'/operator.cjs',{operation:'financial-b'},launcher,manifest.artifactHash);
    expect(transport.mode).toBe('dry-run');expect(transport.remoteExecuted).toBe(false);
    const r=spawnSync(process.execPath,[launcher],{encoding:'utf8',env:{PATH:process.env.PATH}});
    expect(r.status).toBe(1);expect(JSON.parse(r.stderr)).toMatchObject({code:'RECOVERY_ENVIRONMENT_MISMATCH'});
    const cli=spawnSync(process.execPath,[dir+'/operator.cjs'],{encoding:'utf8',input:'{"operation":"financial-b"}',
      env:{PATH:process.env.PATH,NODE_PATH:root+'/node_modules'}});
    expect(cli.status).toBe(1);expect(JSON.parse(cli.stderr)).toMatchObject({code:'RECOVERY_ENVIRONMENT_MISMATCH'});
    const missingApproval=spawnSync(process.execPath,[dir+'/operator.cjs'],{encoding:'utf8',input:'{"operation":"financial-b","mode":"execute"}',
      env:{PATH:process.env.PATH,NODE_PATH:root+'/node_modules',RAILWAY_PROJECT_ID:TARGET.projectId,RAILWAY_ENVIRONMENT_ID:TARGET.environmentId,
        RAILWAY_SERVICE_ID:TARGET.serviceId,RAILWAY_DEPLOYMENT_ID:TARGET.deploymentId,
        ASAAS_API_URL:'https://api-sandbox.asaas.com/v3',ASAAS_CHECKOUT_BASE_URL:'https://sandbox.asaas.com',ASAAS_API_KEY:'$aact_hmlg_synthetic',
        DATABASE_URL:'mysql://fixture:synthetic@mysql.railway.internal/l4ckos_staging'}});
    expect(missingApproval.status).toBe(1);expect(JSON.parse(missingApproval.stderr)).toMatchObject({code:'RECOVERY_EXPLICIT_APPROVAL_REQUIRED'});
    await expect(prepareTransport(dir+'/operator.cjs',{operation:'financial-b'},dir+'/bad.launcher.cjs','b'.repeat(64)))
      .rejects.toThrow('RECOVERY_ARTIFACT_HASH_MISMATCH');
    await expect(packageRecovery(dir)).rejects.toThrow(); // immutable wx artifacts
  });
});
