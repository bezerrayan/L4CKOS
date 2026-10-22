import {z} from 'zod';
import {describe,it,expect,vi} from 'vitest';
import {fetchOfficialEvidence,parsePaymentResponse} from '../../database/financialRecovery/provider';
import {safeDiagnostic} from '../../database/financialRecovery/diagnostics';
import {TARGET} from '../../database/financialRecovery/policy';
// Contract fixture, reconstructed from sanitized prior facts + documented null.
// This is NOT the real JSON returned by the failed preflight.
const fixture=()=>({id:TARGET.paymentId,externalReference:'13',status:'RECEIVED',billingType:'PIX',value:99,
 netValue:98.01,deleted:false,refunds:null,chargeback:null,paymentDate:'2026-10-11'});
const env={ASAAS_API_URL:'https://api-sandbox.asaas.com/v3',ASAAS_API_KEY:'$aact_hmlg_synthetic'};
const fetchFor=(payment:unknown,refunds:unknown={data:[],hasMore:false,totalCount:0})=>vi.fn(async(url:any)=>
 new Response(JSON.stringify(String(url).endsWith('/refunds')?refunds:payment),{status:200})) as any;
describe('Asaas Sandbox payment response contract and reversal gates',()=>{
 it('reproduces legacy contract failure for nullable refunds',()=>{
  const previous=z.object({refunds:z.array(z.unknown()).optional()}).safeParse({refunds:null});
  expect(previous.success).toBe(false);if(!previous.success)expect(previous.error.issues).toMatchObject([{path:['refunds'],code:'invalid_type'}]);
 });
 it('accepts documented nullable refunds only with independent empty refund list',async()=>{
  const fetcher=fetchFor(fixture());expect((await fetchOfficialEvidence(env,fetcher)).status).toBe('RECEIVED');
  expect(fetcher).toHaveBeenCalledTimes(2);expect(fetcher.mock.calls[1][0]).toContain('/refunds');
 });
 it('accepts optional fields absent, without defaulting financial fields',async()=>{
  const p:any=fixture();delete p.refunds;delete p.chargeback;delete p.paymentDate;
  expect((await fetchOfficialEvidence(env,fetchFor(p))).financialReceivedAt).toBeNull();
 });
 it('accepts date-only and null dates without manufacturing receipt time',async()=>{
  expect((await fetchOfficialEvidence(env,fetchFor({...fixture(),confirmedDate:null,creditDate:null}))).timestampMeaning).toBe('not_proven');
 });
 it.each(['id','externalReference','status','billingType','value','netValue','deleted'])('rejects absent critical field %s',async(field)=>{
  const p:any=fixture();delete p[field];const fetcher=fetchFor(p);
  await expect(fetchOfficialEvidence(env,fetcher)).rejects.toThrow();expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it.each(['id','externalReference','status','billingType','value','netValue','deleted'])('rejects null critical field %s',async(field)=>{
  await expect(fetchOfficialEvidence(env,fetchFor({...fixture(),[field]:null}))).rejects.toThrow();
 });
 it.each([{id:'pay_other'},{externalReference:'14'},{value:100},{status:'PENDING'},{netValue:'98.01'},{deleted:true}])('rejects changed identity/financial state %j',async(change)=>{
  await expect(fetchOfficialEvidence(env,fetchFor({...fixture(),...change}))).rejects.toThrow();
 });
 it.each([null,[],42,'malformed'])('rejects malformed payment %j',async(p)=>{
  await expect(fetchOfficialEvidence(env,fetchFor(p))).rejects.toThrow();
 });
 it('emits every issue with path/code/type but never literal values',()=>{
  let error:unknown;try{parsePaymentResponse({...fixture(),id:'PRIVATE_VALUE',status:'PRIVATE_STATUS',value:'PRIVATE_AMOUNT',refunds:{secret:'PRIVATE'}});}catch(e){error=e;}
  const diagnostic=safeDiagnostic(error);expect(diagnostic.issues).toEqual([
   {path:['id'],code:'invalid_value',expectedType:'string',receivedType:'string'},
   {path:['status'],code:'invalid_value',expectedType:'string',receivedType:'string'},
   {path:['value'],code:'invalid_value',expectedType:'number',receivedType:'string'},
   {path:['refunds'],code:'invalid_type',expectedType:'array|null|undefined',receivedType:'object'},
  ]);expect(JSON.stringify(diagnostic)).not.toContain('PRIVATE');
 });
 it.each([{refunds:[{status:'DONE'}]},{refunds:[{status:'PENDING'}]},{chargeback:{}},{chargeback:{status:'REQUESTED'}}])('blocks any reversal observation %j',async(change)=>{
  await expect(fetchOfficialEvidence(env,fetchFor({...fixture(),...change}))).rejects.toThrow('RECOVERY_REVERSAL_OR_INCOMPLETE_EVIDENCE');
 });
 it('nullable embedded refunds cannot hide a separate refund',async()=>{
  await expect(fetchOfficialEvidence(env,fetchFor(fixture(),{data:[{}],hasMore:false,totalCount:0}))).rejects.toThrow('RECOVERY_REVERSAL_OR_INCOMPLETE_EVIDENCE');
 });
 it('repeated read keeps identity/time semantics and only uses two GETs each time',async()=>{
  const fetcher=fetchFor(fixture());for(let i=0;i<2;i++)expect((await fetchOfficialEvidence(env,fetcher)).amountCents).toBe(9900);
  expect(fetcher).toHaveBeenCalledTimes(4);for(const call of fetcher.mock.calls){expect(call[1].method).toBe('GET');expect(call[1].redirect).toBe('error');}
 });
});
