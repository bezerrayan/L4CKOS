import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { diagnosticStage, safeDiagnostic } from '../../database/financialRecovery/diagnostics';
import { runRecovery, type Runtime } from '../../database/financialRecovery/operator';
import { fetchOfficialEvidence } from '../../database/financialRecovery/provider';
import { TARGET } from '../../database/financialRecovery/policy';
const env={RAILWAY_PROJECT_ID:TARGET.projectId,RAILWAY_ENVIRONMENT_ID:TARGET.environmentId,
 RAILWAY_SERVICE_ID:TARGET.serviceId,RAILWAY_DEPLOYMENT_ID:TARGET.deploymentId,
 DATABASE_URL:'mysql://fixture:synthetic@mysql.railway.internal/l4ckos_staging',
 ASAAS_API_URL:'https://api-sandbox.asaas.com/v3',ASAAS_CHECKOUT_BASE_URL:'https://sandbox.asaas.com',ASAAS_API_KEY:'$aact_hmlg_synthetic'};
const secret='PRIVATE_FIXTURE_NO_OUTPUT';
const failure=(code:string)=>Object.assign(new Error(secret),{code,sql:secret,sqlMessage:secret,stack:secret});
describe('Private recovery sanitized diagnostics, no network or database',()=>{
 it.each([['ER_ACCESS_DENIED_ERROR','mysql-authentication'],['ER_TABLEACCESS_DENIED_ERROR','mysql-permission'],
  ['ER_BAD_FIELD_ERROR','mysql-schema'],['ER_PARSE_ERROR','mysql-query'],['ENOTFOUND','network'],
  ['MODULE_NOT_FOUND','import'],['ENOENT','filesystem']])('retains allowlisted %s without private text',async(code,category)=>{
  const original=failure(code);let caught:unknown;
  try{await diagnosticStage('schema-verification',async()=>{throw original;});}catch(e){caught=e;}
  expect(caught).toBe(original);expect(safeDiagnostic(caught)).toEqual({phase:'schema-verification',category,causeCode:code});
  expect(JSON.stringify(safeDiagnostic(caught))).not.toContain(secret);
 });
 it('retains first stage through nested wrappers',async()=>{
  const error=failure('ECONNREFUSED');
  await expect(diagnosticStage('mysql-open',()=>diagnosticStage('mysql-connect',async()=>{throw error;}))).rejects.toBe(error);
  expect(safeDiagnostic(error).phase).toBe('mysql-connect');
 });
 it('does not serialize arbitrary codes, messages, causes or validation values',()=>{
  expect(safeDiagnostic(failure(secret)).causeCode).toBe('UNCLASSIFIED_ERROR');
  const parsed=z.literal('expected').safeParse(secret);expect(parsed.success).toBe(false);
  if(!parsed.success){expect(safeDiagnostic(parsed.error).causeCode).toBe('ZOD_VALIDATION_FAILED');expect(JSON.stringify(safeDiagnostic(parsed.error))).not.toContain(secret);}
 });
 it('recognizes a nested network cause and keeps unknown errors failures',()=>{
  expect(safeDiagnostic(new Error(secret,{cause:failure('ETIMEDOUT')}))).toMatchObject({causeCode:'ETIMEDOUT'});
  expect(safeDiagnostic(new Error(secret))).toMatchObject({category:'unknown',causeCode:'UNCLASSIFIED_ERROR'});
 });
 it.each(['mysql-open','database-identity','schema-verification'])('locates actual %s failure without provider, writer or commit',async(stage)=>{
  const error=failure(stage==='mysql-open'?'ECONNREFUSED':stage==='database-identity'?'ER_SPECIFIC_ACCESS_DENIED_ERROR':'ER_BAD_FIELD_ERROR');
  const c={query:vi.fn(async()=>{throw error;}),end:vi.fn(),commit:vi.fn(),rollback:vi.fn()};
  const runtime:Runtime={environment:env,artifactHash:'a'.repeat(64),open:vi.fn(async()=>{if(stage==='mysql-open')throw error;return c as any;}),
   identity:vi.fn(async()=>{if(stage==='database-identity')throw error;return {database:TARGET.database,uuidHash:TARGET.mysqlUuidHash};}),
   bundleHash:vi.fn(async()=>TARGET.bundleHash),fetch:vi.fn() as any};
  await expect(runRecovery({operation:'financial-b'},runtime)).rejects.toBe(error);
  expect(safeDiagnostic(error).phase).toBe(stage);expect(runtime.fetch).not.toHaveBeenCalled();expect(c.commit).not.toHaveBeenCalled();
 });
 it('locates provider validation without returning body',async()=>{
  let error:unknown;
  try{await fetchOfficialEvidence(env,vi.fn(async()=>new Response(JSON.stringify({secret}),{status:200})) as any);}catch(e){error=e;}
  expect(safeDiagnostic(error)).toMatchObject({phase:'provider-payment-validation',category:'validation',causeCode:'ZOD_VALIDATION_FAILED'});
  expect(JSON.stringify(safeDiagnostic(error))).not.toContain(secret);
 });
 it('locates provider transport failure and retains GET-only scope',async()=>{
  const error=new Error(secret,{cause:failure('ENOTFOUND')});
  const fetcher=vi.fn(async(_url:any,options:any)=>{expect(options.method).toBe('GET');expect(options.redirect).toBe('error');throw error;});
  await expect(fetchOfficialEvidence(env,fetcher as any)).rejects.toBe(error);
  expect(safeDiagnostic(error)).toMatchObject({phase:'provider-payment-get',causeCode:'ENOTFOUND'});expect(fetcher).toHaveBeenCalledTimes(1);
 });
});
