import {afterEach,describe,it,expect,vi} from "vitest";
import {createAsaasChargeForOrder,createAsaasStockChargeForOrder} from "./asaas";
import {createAsaasCheckout,createAsaasCustomer} from "./asaasService";
import {normalizeBuyerDocument} from "../../shared/buyerDocument";
import {assertSelectiveFinancialBuyer} from "../payments/stagingFinancialBuyer";
import {assertEmailRecipientsAllowed} from "./email/recipientPolicy.js";
const ax=vi.hoisted(()=>({post:vi.fn(),get:vi.fn()}));
vi.mock('axios',()=>({default:{create:()=>ax,isAxiosError:()=>false}}));
const buyer="yanbezerra651@gmail.com";
function config(staging=true){vi.stubEnv('ASAAS_API_KEY',staging?'$aact_hmlg_synthetic':'$aact_prod_synthetic');vi.stubEnv('ASAAS_API_URL',staging?'https://api-sandbox.asaas.com/v3':'https://api.asaas.com/v3');vi.stubEnv('ASAAS_ENV',staging?'sandbox':'production');if(!staging){vi.stubEnv('RAILWAY_PROJECT_ID','5937dcf3-18ae-4df8-83f0-5bb60ec9b8db');vi.stubEnv('RAILWAY_ENVIRONMENT_ID','7d065409-7cc2-44ba-9fff-5524653b0484');vi.stubEnv('RAILWAY_SERVICE_ID','743f3f4e-af1b-44f7-95c8-bb152e3c2f4b');}}
function scope(){config();for(const [k,v] of Object.entries({NODE_ENV:'production',RAILWAY_PROJECT_ID:'2bb90c8e-eb65-43ee-826b-f93750f0499c',RAILWAY_ENVIRONMENT_ID:'15545eee-bc02-4b70-afc4-19a5db9e6f46',RAILWAY_SERVICE_ID:'9f1c7705-f2f9-48cf-b957-8f63a6bba4db',ASAAS_WEBHOOK_RECOVERY_MODE:'review_only',EMAIL_MODE:'restricted',STAGING_EMAIL_ALLOWLIST:'synthetic@example.invalid'}))vi.stubEnv(k,v);}
const input={orderId:999901,method:'PIX' as const,value:99,customer:{name:'Synthetic',cpfCnpj:'11144477735'},description:'LOCAL FIXTURE'};
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.clearAllMocks();});
describe('PIX preflight customer/provider guard',()=>{
 it('creates silent customer and GET-verifies it before exactly one charge',async()=>{config();const calls:any[]=[];vi.stubGlobal('fetch',vi.fn(async(url:string,init:any)=>{calls.push({url,method:init.method,body:init.body&&JSON.parse(init.body)});return{ok:true,json:async()=>url.includes('/customers')?{id:'cus_fixture',notificationDisabled:true}:{id:'pay_fixture',pixQrCode:'fixture',pixCopyPaste:'fixture'}};}));await createAsaasChargeForOrder(input);expect(calls.map(x=>x.method)).toEqual(['POST','GET','POST']);expect(calls[0].body.notificationDisabled).toBe(true);expect(calls[2].body).toMatchObject({value:99,externalReference:'999901',billingType:'PIX'});});
 it.each([false,undefined])('blocks a new customer whose returned setting is %s',async flag=>{config();const fetch=vi.fn(async()=>({ok:true,json:async()=>({id:'cus_fixture',notificationDisabled:flag})}));vi.stubGlobal('fetch',fetch);await expect(createAsaasChargeForOrder(input)).rejects.toThrow('NOTIFICATIONS_NOT_DISABLED');expect(fetch).toHaveBeenCalledTimes(1);});
 it.each(['false','identity','network','http'])('blocks verification failure %s without a charge/retry',async kind=>{config();const fetch=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({id:'cus_fixture',notificationDisabled:true})});if(kind==='network')fetch.mockRejectedValueOnce(Error('synthetic'));else fetch.mockResolvedValueOnce({ok:kind!=='http',json:async()=>({id:kind==='identity'?'cus_other':'cus_fixture',notificationDisabled:kind!=='false'})});vi.stubGlobal('fetch',fetch);await expect(createAsaasChargeForOrder(input)).rejects.toThrow();expect(fetch).toHaveBeenCalledTimes(2);});
 it('keeps production request sequence and notification payload unchanged',async()=>{config(false);const calls:any[]=[];vi.stubGlobal('fetch',vi.fn(async(url:string,init:any)=>{calls.push({url,body:JSON.parse(init.body)});return{ok:true,json:async()=>url.endsWith('/customers')?{id:'cus_fixture'}:{id:'pay_fixture',pixQrCode:'fixture',pixCopyPaste:'fixture'}};}));await createAsaasChargeForOrder(input);expect(calls).toHaveLength(2);expect(calls[0].body).not.toHaveProperty('notificationDisabled');});
 it('guards the alternate new-customer adapter too',async()=>{config();ax.post.mockResolvedValueOnce({data:{id:'cus_fixture',notificationDisabled:true}});ax.get.mockResolvedValueOnce({data:{id:'cus_fixture',notificationDisabled:true}});await createAsaasCustomer({...input.customer,email:'synthetic@example.invalid'});expect(ax.post.mock.calls[0][1].notificationDisabled).toBe(true);expect(ax.get).toHaveBeenCalledTimes(1);});
 it.each([false,undefined])('never charges an existing customer with setting %s',async flag=>{config();ax.get.mockResolvedValueOnce({data:{id:'cus_fixture',notificationDisabled:flag}});await expect(createAsaasCheckout({name:'Synthetic',value:99,billingTypes:['PIX'],customer:'cus_fixture',redirectUrl:'https://staging.l4ckos.com.br'})).rejects.toThrow('NOTIFICATIONS_NOT_DISABLED');expect(ax.post).not.toHaveBeenCalled();});
 it('allows an existing silent customer after GET, without a customer mutation',async()=>{config();ax.get.mockResolvedValueOnce({data:{id:'cus_fixture',notificationDisabled:true}});ax.post.mockResolvedValueOnce({data:{id:'checkout_fixture'}});await createAsaasCheckout({name:'Synthetic',value:99,billingTypes:['PIX'],customer:'cus_fixture',redirectUrl:'https://staging.l4ckos.com.br'});expect(ax.get).toHaveBeenCalledTimes(1);expect(ax.post.mock.calls[0][0]).toBe('/checkouts');});
 it('blocks alternate hosted checkout in the supervised staging scope',async()=>{scope();ax.get.mockResolvedValueOnce({data:{id:'cus_fixture',notificationDisabled:true}});await expect(createAsaasCheckout({name:'Synthetic',value:99,billingTypes:['PIX'],customer:'cus_fixture',redirectUrl:'https://staging.l4ckos.com.br'})).rejects.toThrow('STAGING_OFFICIAL_CHECKOUT_REQUIRED');expect(ax.post).not.toHaveBeenCalled();});
});
describe('STOCK hosted Asaas card invoice — sandbox fixture only',()=>{
 it('creates one CREDIT_CARD invoice with a server callback and never sends PAN or CVV',async()=>{
  config();const calls:any[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,init:any)=>{
   const body=init.body&&JSON.parse(init.body);calls.push({url,method:init.method,body});
   if(url.endsWith('/customers'))return{ok:true,json:async()=>({id:'cus_stock_card_fixture',notificationDisabled:true})};
   if(url.includes('/customers/'))return{ok:true,json:async()=>({id:'cus_stock_card_fixture',notificationDisabled:true})};
   return{ok:true,json:async()=>({id:'pay_stock_card_fixture',invoiceUrl:'https://sandbox.asaas.com/i/fixture',billingType:'CREDIT_CARD'})};
  }));
  await createAsaasStockChargeForOrder({orderId:999902,method:'CARD',value:10,customer:{name:'Cliente Sintético',email:'buyer@example.invalid',cpfCnpj:'11144477735'},description:'STOCK sandbox fixture',externalReference:'L4CKOS-STOCK-ATTEMPT:v2:CARD:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',successUrl:'https://store.example.invalid/em-breve'});
  expect(calls.map(x=>x.method)).toEqual(['POST','GET','POST']);
  expect(calls[2].body).toMatchObject({billingType:'CREDIT_CARD',value:10,externalReference:'L4CKOS-STOCK-ATTEMPT:v2:CARD:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',callback:{successUrl:'https://store.example.invalid/em-breve',autoRedirect:true}});
  expect(calls[2].body).not.toHaveProperty('creditCard');expect(calls[2].body).not.toHaveProperty('creditCardHolderInfo');
  expect(calls[2].body).not.toHaveProperty('creditCardToken');expect(JSON.stringify(calls[2].body)).not.toMatch(/\b(number|ccv|expiryMonth|expiryYear)\b/i);
 });
 it('requires an HTTPS return path before creating a STOCK card payment',async()=>{
  config();const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  await expect(createAsaasStockChargeForOrder({orderId:999903,method:'CARD',value:10,customer:{name:'Synthetic',cpfCnpj:'11144477735'},description:'fixture',successUrl:'http://unsafe.example.invalid/em-breve'})).rejects.toMatchObject({phase:'preflight',definitelyNotCreated:true});
  expect(fetch).not.toHaveBeenCalled();
 });
});
describe('exact financial permission is never permission to email',()=>{
 it('permits only the named buyer with notifications=false and exact supported methods',()=>{scope();expect(()=>assertSelectiveFinancialBuyer(buyer,false,'PIX')).not.toThrow();expect(()=>assertSelectiveFinancialBuyer('other@example.invalid',false,'PIX')).toThrow();expect(()=>assertSelectiveFinancialBuyer(buyer,true,'PIX')).toThrow();expect(()=>assertSelectiveFinancialBuyer(buyer,false,'BOLETO')).not.toThrow();expect(()=>assertSelectiveFinancialBuyer(buyer,false,'CARD')).not.toThrow();expect(()=>assertSelectiveFinancialBuyer(buyer,false,'OTHER')).toThrow();expect(()=>assertEmailRecipientsAllowed({to:buyer})).toThrow();});
 it.each(['RAILWAY_PROJECT_ID','RAILWAY_ENVIRONMENT_ID','RAILWAY_SERVICE_ID','ASAAS_WEBHOOK_RECOVERY_MODE','EMAIL_MODE','NODE_ENV'])('has no bypass with divergent %s',key=>{scope();vi.stubEnv(key,'divergent');expect(()=>assertSelectiveFinancialBuyer(buyer,false,'PIX')).toThrow();});
});
describe('buyer-entered document validation; offline fixtures only',()=>{
 it.each(['','11111111111','11144477736','letters11144477735','11222333000182'])('rejects missing/invalid input #%#',v=>expect(normalizeBuyerDocument(v)).toBeNull());
 it.each(['11144477735','111.444.777-35','11222333000181','11.222.333/0001-81'])('accepts existing numeric fixture format #%#',v=>expect(normalizeBuyerDocument(v)).toBe(v.replace(/\D/g,'')));
});
