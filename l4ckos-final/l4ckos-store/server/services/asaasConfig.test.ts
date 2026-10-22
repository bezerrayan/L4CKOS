import * as checkoutPolicy from "../../shared/checkoutMethods";
import {afterEach,describe,it,expect,vi} from 'vitest';
import {validateAsaasWebhookSignature} from './asaasService';
import {getAsaasConfig} from './asaasConfig';
import {createAsaasChargeForOrder} from './asaas';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
function config(){vi.stubEnv('ASAAS_API_KEY','synthetic-key');vi.stubEnv('ASAAS_API_URL','https://api-sandbox.asaas.com/v3');vi.stubEnv('ASAAS_CHECKOUT_BASE_URL','');vi.stubEnv('ASAAS_ENV','sandbox');}
describe('Asaas fail-closed configuration and checkout adapter',()=>{
 it('requires a configured webhook token in every runtime and rejects missing/ambiguous headers',()=>{
  vi.stubEnv('NODE_ENV','development');vi.stubEnv('ASAAS_WEBHOOK_TOKEN','');expect(validateAsaasWebhookSignature({})).toBe(false);
  vi.stubEnv('ASAAS_WEBHOOK_TOKEN','synthetic-webhook-secret');
  expect(validateAsaasWebhookSignature({})).toBe(false);
  expect(validateAsaasWebhookSignature({'asaas-access-token':['synthetic-webhook-secret']})).toBe(false);
  expect(validateAsaasWebhookSignature({'asaas-access-token':'wrong'})).toBe(false);
  expect(validateAsaasWebhookSignature({'asaas-access-token':'synthetic-webhook-secret'})).toBe(true);
 });
 it('never defaults to production when configuration is missing',()=>{config();vi.stubEnv('ASAAS_API_URL','');expect(()=>getAsaasConfig()).toThrow('ASAAS_API_URL_REQUIRED');});
 it.each(['http://api-sandbox.asaas.com/v3','https://untrusted.invalid/v3','https://api-sandbox.asaas.com/v3?token=x','https://user:secret@api-sandbox.asaas.com/v3'])('rejects untrusted or credential-bearing API endpoint %s',url=>{config();vi.stubEnv('ASAAS_API_URL',url);expect(()=>getAsaasConfig()).toThrow();});
 it('rejects production URL for staging project and inconsistent checkout origin',()=>{config();vi.stubEnv('ASAAS_ENV','');vi.stubEnv('RAILWAY_PROJECT_ID','2bb90c8e-eb65-43ee-826b-f93750f0499c');vi.stubEnv('ASAAS_API_URL','https://api.asaas.com/v3');expect(()=>getAsaasConfig()).toThrow('ASAAS_ENVIRONMENT_MISMATCH');vi.stubEnv('ASAAS_API_URL','https://api-sandbox.asaas.com/v3');vi.stubEnv('ASAAS_CHECKOUT_BASE_URL','https://www.asaas.com');expect(()=>getAsaasConfig()).toThrow('ASAAS_CHECKOUT_ENVIRONMENT_MISMATCH');});
 it.each(['PIX','CARD','BOLETO'] as const)('creates one customer and one %s charge with authoritative order reference and no redirect',async method=>{
  config();const calls:{url:string;body:any}[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,init:any)=>{expect(init.redirect).toBe('error');expect(url.startsWith('https://api-sandbox.asaas.com/v3/')).toBe(true);calls.push({url,body:init.body?JSON.parse(init.body):null});
   return {ok:true,json:async()=>(url.endsWith('/customers')||url.endsWith('/customers/cus_synthetic'))?{id:'cus_synthetic',notificationDisabled:true}:url.endsWith('/pixQrCode')?{encodedImage:'synthetic-image',payload:'synthetic-code'}:{id:'pay_synthetic',invoiceUrl:'https://sandbox.asaas.com/i/synthetic',bankSlipUrl:'https://sandbox.asaas.com/b/synthetic'}};
  }));
  // Retain the old boleto adapter test as a disabled implementation fixture.
  const legacy=method==='BOLETO'?vi.spyOn(checkoutPolicy,'assertCheckoutMethodEnabled').mockImplementationOnce(()=>{}):null;
  const r=await createAsaasChargeForOrder({orderId:999901,method,value:123.45,customer:{name:'Synthetic fixture',cpfCnpj:'11144477735'},description:'SYNTHETIC CHECKOUT'});
  legacy?.mockRestore();
  expect(r.paymentId).toBe('pay_synthetic');expect(calls.filter(c=>c.url.endsWith('/payments'))).toHaveLength(1);
  expect(calls.find(c=>c.url.endsWith('/payments'))!.body).toMatchObject({externalReference:'999901',value:123.45,billingType:method==='CARD'?'CREDIT_CARD':method});
  const body=calls.find(c=>c.url.endsWith('/payments'))!.body;
  expect(Object.keys(body).sort()).toEqual(['billingType','customer','description','dueDate','externalReference','value']);
  expect(calls.find(c=>c.url.endsWith('/customers'))!.body.notificationDisabled).toBe(true);
  expect(calls.filter(c=>c.url.endsWith('/customers/cus_synthetic'))).toHaveLength(1);
  if(method==='CARD')expect(r.invoiceUrl).toBe('https://sandbox.asaas.com/i/synthetic');
  if(method==='PIX')expect(r.pixCopyPaste).toBe('synthetic-code');
 });
 it('does not retry an ambiguous provider failure',async()=>{config();const fetch=vi.fn().mockRejectedValue(Error('synthetic timeout'));vi.stubGlobal('fetch',fetch);await expect(createAsaasChargeForOrder({orderId:1,method:'PIX',value:1,customer:{name:'Synthetic',cpfCnpj:'11144477735'},description:'Synthetic'})).rejects.toThrow();expect(fetch).toHaveBeenCalledTimes(1);});
});
