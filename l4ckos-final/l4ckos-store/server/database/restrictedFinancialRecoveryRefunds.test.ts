import {describe,it,expect,vi} from 'vitest';
import {parseRefundsResponse,fetchOfficialEvidence} from '../../database/financialRecovery/provider';
import {safeDiagnostic} from '../../database/financialRecovery/diagnostics';
import {TARGET} from '../../database/financialRecovery/policy';
const empty=()=>({data:[],hasMore:false,totalCount:0});
const env={ASAAS_API_URL:'https://api-sandbox.asaas.com/v3',ASAAS_API_KEY:'$aact_hmlg_synthetic'};
const payment={id:TARGET.paymentId,externalReference:'13',status:'RECEIVED',billingType:'PIX',value:99,netValue:98.01,deleted:false,refunds:null};
function fetchFor(body:unknown){return vi.fn(async(url:any)=>new Response(JSON.stringify(String(url).endsWith('/refunds')?body:payment),{status:200})) as any;}
describe('Refunds documented object shape, strict fail-closed policy and sanitized diagnosis',()=>{
 it('accepts only proven empty complete collection, optional metadata absent',async()=>{
  expect(parseRefundsResponse(empty())).toEqual(empty());expect((await fetchOfficialEvidence(env,fetchFor(empty()))).refundCount).toBe(0);
 });
 it('normalizes the observed Sandbox null only after complete zero/false validation',async()=>{
  const raw={data:null,hasMore:false,totalCount:0};expect(parseRefundsResponse(raw)).toEqual(empty());
  expect(raw.data).toBeNull();expect((await fetchOfficialEvidence(env,fetchFor(raw))).refundCount).toBe(0);
 });
 it.each([{data:null,totalCount:1,hasMore:false},{data:null,totalCount:0,hasMore:true},
  {data:null,totalCount:0},{data:null,hasMore:false},{data:null,totalCount:'0',hasMore:false},
  {data:null,totalCount:0,hasMore:'false'},{data:null,totalCount:null,hasMore:false},
  {data:null,totalCount:0,hasMore:null},{data:null}])('never normalizes an incomplete or divergent null envelope %j',async(raw)=>{
  expect(()=>parseRefundsResponse(raw)).toThrow();await expect(fetchOfficialEvidence(env,fetchFor(raw))).rejects.toThrow();
 });
 it('null compatibility cannot override a nonreceived payment or embedded reversal',async()=>{
  for(const change of [{status:'PENDING'},{id:'pay_other'},{value:100},{refunds:[{status:'PENDING',value:1}]},{chargeback:{status:'REQUESTED'}}]){
   const f=vi.fn(async(url:any)=>new Response(JSON.stringify(String(url).endsWith('/refunds')?{data:null,hasMore:false,totalCount:0}:{...payment,...change}),{status:200})) as any;
   await expect(fetchOfficialEvidence(env,f)).rejects.toThrow();
  }
 });
 it.each([500,401])('aborts refunds HTTP%s without retry',async(status)=>{
  const f=vi.fn(async(url:any)=>new Response(JSON.stringify(String(url).endsWith('/refunds')?{}:payment),{status:String(url).endsWith('/refunds')?status:200})) as any;
  await expect(fetchOfficialEvidence(env,f)).rejects.toThrow('RECOVERY_PROVIDER_READ_FAILED');expect(f).toHaveBeenCalledTimes(2);
 });
 it('aborts network failure without retry or manufactured empty list',async()=>{
  const f=vi.fn(async(url:any)=>{if(String(url).endsWith('/refunds'))throw Error('synthetic-network-failure');return new Response(JSON.stringify(payment),{status:200});}) as any;
  await expect(fetchOfficialEvidence(env,f)).rejects.toThrow();expect(f).toHaveBeenCalledTimes(2);
 });
 it('accepts optional paging metadata without affecting empty evidence',()=>{
  expect(parseRefundsResponse({...empty(),object:'list',limit:10,offset:0})).toEqual(empty());
 });
 it.each(['data','hasMore','totalCount'])('rejects absent %s rather than defaulting it',async(field)=>{
  const r:any=empty();delete r[field];await expect(fetchOfficialEvidence(env,fetchFor(r))).rejects.toThrow();
 });
 it.each(['hasMore','totalCount'])('rejects null %s',async(field)=>{
  await expect(fetchOfficialEvidence(env,fetchFor({...empty(),[field]:null}))).rejects.toThrow();
 });
 it.each([[],null,'malformed',42,{data:{}},{data:[],hasMore:'false',totalCount:'0'}, {data:[],hasMore:true,totalCount:0},{data:[],hasMore:false,totalCount:1}])('rejects unsupported root/type/pagination/count %j',async(r)=>{
  await expect(fetchOfficialEvidence(env,fetchFor(r))).rejects.toThrow();
 });
 it.each(['DONE','PENDING','AWAITING_CRITICAL_ACTION_AUTHORIZATION','AWAITING_CUSTOMER_EXTERNAL_AUTHORIZATION','CANCELLED','INVALID'])('blocks every refund, including partial or pending %s',async(status)=>{
  // No refund state or quantity is safe to silently ignore in this recovery.
  const body={data:[{id:'fixture-refund',payment:TARGET.paymentId,value:1,status}],hasMore:false,totalCount:1};
  await expect(fetchOfficialEvidence(env,fetchFor(body))).rejects.toThrow();
 });
 it.each([{payment:'pay_other',value:1,status:'DONE'},null,{},'malformed'])('blocks divergent identity and malformed items even if count falsely says zero: %j',async(item)=>{
  await expect(fetchOfficialEvidence(env,fetchFor({data:[item],hasMore:false,totalCount:0}))).rejects.toThrow('RECOVERY_REVERSAL_OR_INCOMPLETE_EVIDENCE');
 });
 it('returns every validation path/type/code without values or arbitrary keys',()=>{
  let error:unknown;try{parseRefundsResponse({data:'PRIVATE',hasMore:'PRIVATE',totalCount:'PRIVATE',PRIVATE:'PRIVATE'});}catch(e){error=e;}
  expect(safeDiagnostic(error).issues).toEqual([
   {path:['data'],code:'invalid_type',expectedType:'array',receivedType:'string'},
   {path:['hasMore'],code:'invalid_value',expectedType:'boolean',receivedType:'string'},
   {path:['totalCount'],code:'invalid_value',expectedType:'number',receivedType:'string'},
  ]);expect(JSON.stringify(safeDiagnostic(error))).not.toContain('PRIVATE');
 });
 it('locates failure at provider-refunds-validation with no retry',async()=>{
  const f=fetchFor([]);let error:unknown;try{await fetchOfficialEvidence(env,f);}catch(e){error=e;}
  expect(safeDiagnostic(error)).toMatchObject({phase:'provider-refunds-validation',category:'validation',causeCode:'ZOD_VALIDATION_FAILED',issues:[{path:[],expectedType:'object',receivedType:'array'}]});
  expect(f).toHaveBeenCalledTimes(2);for(const call of f.mock.calls)expect(call[1].method).toBe('GET');
 });
});
