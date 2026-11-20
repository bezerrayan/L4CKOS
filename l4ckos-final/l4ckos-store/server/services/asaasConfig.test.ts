import * as checkoutPolicy from "../../shared/checkoutMethods";
import {afterEach,describe,it,expect,vi} from 'vitest';
import {validateAsaasWebhookSignature} from './asaasService';
import {classifyAsaasRuntime,getAsaasConfig} from './asaasConfig';
import {createAsaasChargeForOrder} from './asaas';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
function config(){vi.stubEnv('ASAAS_API_KEY','$aact_hmlg_synthetic-key');vi.stubEnv('ASAAS_API_URL','https://api-sandbox.asaas.com/v3');vi.stubEnv('ASAAS_CHECKOUT_BASE_URL','');vi.stubEnv('ASAAS_ENV','sandbox');}
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
 it('rejects production URL for staging project and inconsistent checkout origin',()=>{config();vi.stubEnv('ASAAS_ENV','');vi.stubEnv('RAILWAY_PROJECT_ID','2bb90c8e-eb65-43ee-826b-f93750f0499c');vi.stubEnv('RAILWAY_ENVIRONMENT_ID','15545eee-bc02-4b70-afc4-19a5db9e6f46');vi.stubEnv('RAILWAY_SERVICE_ID','9f1c7705-f2f9-48cf-b957-8f63a6bba4db');vi.stubEnv('ASAAS_API_URL','https://api.asaas.com/v3');expect(()=>getAsaasConfig()).toThrow('ASAAS_ENVIRONMENT_MISMATCH');vi.stubEnv('ASAAS_API_URL','https://api-sandbox.asaas.com/v3');vi.stubEnv('ASAAS_CHECKOUT_BASE_URL','https://www.asaas.com');expect(()=>getAsaasConfig()).toThrow('ASAAS_CHECKOUT_ENVIRONMENT_MISMATCH');});
 it('keeps provider configuration aligned for Production and legacy staging',()=>{
  config();
  vi.stubEnv('APP_ENV','production');vi.stubEnv('EMAIL_ENV','');
  vi.stubEnv('RAILWAY_PROJECT_ID','5937dcf3-18ae-4df8-83f0-5bb60ec9b8db');
  vi.stubEnv('RAILWAY_ENVIRONMENT_ID','7d065409-7cc2-44ba-9fff-5524653b0484');vi.stubEnv('RAILWAY_SERVICE_ID','743f3f4e-af1b-44f7-95c8-bb152e3c2f4b');
  vi.stubEnv('ASAAS_ENV','production');vi.stubEnv('ASAAS_API_KEY','$aact_prod_synthetic-key');vi.stubEnv('ASAAS_API_URL','https://api.asaas.com/v3');
  vi.stubEnv('ASAAS_CHECKOUT_BASE_URL','https://www.asaas.com');
  expect(classifyAsaasRuntime(process.env)).toMatchObject({mode:'production',consistent:true,credentialsPresent:true,issue:null});
  expect(getAsaasConfig()).toMatchObject({apiUrl:'https://api.asaas.com/v3',checkoutBaseUrl:'https://www.asaas.com'});

  vi.stubEnv('APP_ENV','');vi.stubEnv('RAILWAY_PROJECT_ID','2bb90c8e-eb65-43ee-826b-f93750f0499c');
  vi.stubEnv('RAILWAY_ENVIRONMENT_ID','15545eee-bc02-4b70-afc4-19a5db9e6f46');
  vi.stubEnv('RAILWAY_SERVICE_ID','9f1c7705-f2f9-48cf-b957-8f63a6bba4db');
  vi.stubEnv('ASAAS_ENV','sandbox');vi.stubEnv('ASAAS_API_KEY','$aact_hmlg_synthetic-key');vi.stubEnv('ASAAS_API_URL','https://api-sandbox.asaas.com/v3');
  vi.stubEnv('ASAAS_CHECKOUT_BASE_URL','https://sandbox.asaas.com');
  expect(classifyAsaasRuntime(process.env)).toMatchObject({mode:'sandbox',consistent:true,credentialsPresent:true,issue:null});
  expect(getAsaasConfig()).toMatchObject({apiUrl:'https://api-sandbox.asaas.com/v3',checkoutBaseUrl:'https://sandbox.asaas.com'});
 });
 it('recognizes the isolated homologation identity and rejects incomplete identity metadata',()=>{config();vi.stubEnv('APP_ENV','');vi.stubEnv('EMAIL_ENV','');vi.stubEnv('ASAAS_ENV','');vi.stubEnv('RAILWAY_PROJECT_ID','66faf690-a068-40d1-b85c-cb5d8595560a');vi.stubEnv('RAILWAY_ENVIRONMENT_ID','5335340d-311c-47e9-9713-6e5a86969c88');vi.stubEnv('RAILWAY_SERVICE_ID','d66762a4-422a-4656-94a1-502215a27aa2');vi.stubEnv('ASAAS_API_URL','https://api.asaas.com/v3');expect(()=>getAsaasConfig()).toThrow('ASAAS_ENVIRONMENT_MISMATCH');vi.stubEnv('ASAAS_API_URL','https://api-sandbox.asaas.com/v3');expect(getAsaasConfig().apiUrl).toBe('https://api-sandbox.asaas.com/v3');vi.stubEnv('RAILWAY_SERVICE_ID','unknown');expect(()=>getAsaasConfig()).toThrow('ASAAS_RAILWAY_IDENTITY_INVALID');});
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

// ---- P2.1: environment / endpoint / credential-type binding (no network, synthetic keys only) ----
import { resolveAsaasConfig, ASAAS_PRODUCTION_KEY_PREFIX, ASAAS_SANDBOX_KEY_PREFIX } from "./asaasConfig";
const SBX = `${ASAAS_SANDBOX_KEY_PREFIX}synthetic-sandbox-secret-1`, PRD = `${ASAAS_PRODUCTION_KEY_PREFIX}synthetic-production-secret-1`;
const SBX_URL = "https://api-sandbox.asaas.com/v3", PRD_URL = "https://api.asaas.com/v3";
type E = Record<string, string | undefined>;
const sandboxEnv = (o: E = {}): E => ({ ASAAS_ENV: "sandbox", ASAAS_API_URL: SBX_URL, ASAAS_API_KEY: SBX, ...o });
import { PRODUCTION_RAILWAY_IDENTITY as PRODID } from "../_core/productionFinancialPolicy";
import { ISOLATED_HOMOLOGATION_IDENTITY as HOMID, LEGACY_STAGING_IDENTITY as STGID } from "../_core/railwayEnvironment";
const prodIdentity: E = { RAILWAY_PROJECT_ID: PRODID.projectId, RAILWAY_ENVIRONMENT_ID: PRODID.environmentId, RAILWAY_SERVICE_ID: PRODID.serviceId };
const idOf = (i: { projectId: string; environmentId: string; serviceId: string }): E => ({ RAILWAY_PROJECT_ID: i.projectId, RAILWAY_ENVIRONMENT_ID: i.environmentId, RAILWAY_SERVICE_ID: i.serviceId });
const productionEnv = (o: E = {}): E => ({ ...prodIdentity, ASAAS_ENV: "production", ASAAS_API_URL: PRD_URL, ASAAS_API_KEY: PRD, ...o });
describe("P2.1 Asaas environment/endpoint/credential binding", () => {
  it("accepts exactly the valid sandbox and production combinations", () => {
    expect(resolveAsaasConfig(sandboxEnv())).toMatchObject({ apiKey: SBX, apiUrl: SBX_URL, checkoutBaseUrl: "https://sandbox.asaas.com" });
    expect(resolveAsaasConfig(sandboxEnv({ ASAAS_API_KEY: undefined, ASAAS_SANDBOX_API_KEY: SBX }))).toMatchObject({ apiKey: SBX });
    expect(resolveAsaasConfig(productionEnv())).toMatchObject({ apiKey: PRD, apiUrl: PRD_URL, checkoutBaseUrl: "https://www.asaas.com" });
    expect(resolveAsaasConfig(productionEnv({ ASAAS_API_URL: `${PRD_URL}/` }))).toMatchObject({ apiUrl: PRD_URL });
  });
  it.each([
    ["sandbox key on the production endpoint (generic slot)", productionEnv({ ASAAS_API_KEY: SBX }), "ASAAS_CREDENTIAL_ENVIRONMENT_MISMATCH"],
    ["sandbox key on the production endpoint without any production identity (the reproduced defect)", { ASAAS_API_URL: PRD_URL, ASAAS_SANDBOX_API_KEY: SBX }, "ASAAS_PRODUCTION_REQUIRES_PRODUCTION_IDENTITY"],
    ["sandbox key on the production endpoint under the production identity, ASAAS_ENV unset", { ...prodIdentity, ASAAS_API_URL: PRD_URL, ASAAS_SANDBOX_API_KEY: SBX }, "ASAAS_PRODUCTION_IDENTITY_REQUIRES_PRODUCTION"],
    ["sandbox slot present on the production endpoint with ASAAS_ENV=production", productionEnv({ ASAAS_API_KEY: undefined, ASAAS_SANDBOX_API_KEY: SBX }), "ASAAS_PRODUCTION_IDENTITY_REQUIRES_PRODUCTION"],
    ["production key on the sandbox endpoint", sandboxEnv({ ASAAS_API_KEY: PRD }), "ASAAS_CREDENTIAL_ENVIRONMENT_MISMATCH"],
    ["production key on the sandbox endpoint (ASAAS_ENV unset: the reproduced defect)", { ASAAS_API_URL: SBX_URL, ASAAS_API_KEY: PRD }, "ASAAS_ENV_REQUIRED"],
    ["production key in the sandbox slot", sandboxEnv({ ASAAS_API_KEY: undefined, ASAAS_SANDBOX_API_KEY: PRD }), "ASAAS_CREDENTIAL_ENVIRONMENT_MISMATCH"],
    ["both slots set (no silent fallback)", sandboxEnv({ ASAAS_SANDBOX_API_KEY: SBX }), "ASAAS_PRODUCTION_CREDENTIAL_ALIAS_FORBIDDEN"],
    ["unprefixed key on production", productionEnv({ ASAAS_API_KEY: "synthetic-no-prefix" }), "ASAAS_CREDENTIAL_ENVIRONMENT_MISMATCH"],
    ["unprefixed key on sandbox", sandboxEnv({ ASAAS_API_KEY: "synthetic-no-prefix" }), "ASAAS_CREDENTIAL_ENVIRONMENT_MISMATCH"],
    ["production endpoint without a production identity", { ASAAS_API_URL: PRD_URL, ASAAS_API_KEY: PRD }, "ASAAS_PRODUCTION_REQUIRES_PRODUCTION_IDENTITY"],
    ["ASAAS_ENV missing under the production identity", productionEnv({ ASAAS_ENV: undefined }), "ASAAS_ENV_REQUIRED"],
    ["ASAAS_ENV unknown value", productionEnv({ ASAAS_ENV: "prod" }), "ASAAS_ENV_INVALID"],
    ["ASAAS_ENV=sandbox with the production URL", sandboxEnv({ ASAAS_API_URL: PRD_URL }), "ASAAS_ENVIRONMENT_MISMATCH"],
    ["ASAAS_ENV=production with the sandbox URL", productionEnv({ ASAAS_API_URL: SBX_URL }), "ASAAS_PRODUCTION_IDENTITY_REQUIRES_PRODUCTION"],
    ["APP_ENV=staging label under the production identity", productionEnv({ APP_ENV: "staging" }), "ASAAS_PRODUCTION_IDENTITY_REQUIRES_PRODUCTION"],
    ["explicit port", productionEnv({ ASAAS_API_URL: "https://api.asaas.com:443/v3" }), "ASAAS_API_URL_INVALID"],
    ["upper-case host variant", productionEnv({ ASAAS_API_URL: "https://API.asaas.com/v3" }), "ASAAS_API_URL_INVALID"],
    ["look-alike host", productionEnv({ ASAAS_API_URL: "https://api.asaas.com.evil.example/v3" }), "ASAAS_API_URL_INVALID"],
    ["look-alike sandbox host", sandboxEnv({ ASAAS_API_URL: "https://api-sandbox.asaas.com.evil.example/v3" }), "ASAAS_API_URL_INVALID"],
    ["http scheme", productionEnv({ ASAAS_API_URL: "http://api.asaas.com/v3" }), "ASAAS_API_URL_INVALID"],
    ["extra path", productionEnv({ ASAAS_API_URL: "https://api.asaas.com/v3/payments" }), "ASAAS_API_URL_INVALID"],
    ["query string", productionEnv({ ASAAS_API_URL: "https://api.asaas.com/v3?x=1" }), "ASAAS_API_URL_INVALID"],
    ["userinfo", productionEnv({ ASAAS_API_URL: "https://u:p@api.asaas.com/v3" }), "ASAAS_API_URL_INVALID"],
    ["checkout origin of the other environment", productionEnv({ ASAAS_CHECKOUT_BASE_URL: "https://sandbox.asaas.com" }), "ASAAS_CHECKOUT_ENVIRONMENT_MISMATCH"],
    ["missing key", productionEnv({ ASAAS_API_KEY: undefined }), "ASAAS_API_KEY_REQUIRED"],
  ] as Array<[string, E, string]>)("rejects %s", (_n, env, code) => {
    expect(() => resolveAsaasConfig(env)).toThrow(code);
    expect(classifyAsaasRuntime(env).consistent === false || classifyAsaasRuntime(env).issue !== null || code === "ASAAS_API_KEY_REQUIRED").toBe(true);
  });
  it("never puts a credential value into an error message", () => {
    for (const env of [productionEnv({ ASAAS_API_KEY: SBX }), sandboxEnv({ ASAAS_API_KEY: PRD }), sandboxEnv({ ASAAS_SANDBOX_API_KEY: SBX })]) {
      try { resolveAsaasConfig(env); throw new Error("must reject"); } catch (e) { const m = String((e as Error).message); expect(m).not.toContain(SBX); expect(m).not.toContain(PRD); expect(m).toMatch(/^[A-Z0-9_]+$/); }
    }
  });
  it("sends NO request when the combination is crossed (cross-environment charge is refused before fetch)", async () => {
    const fetchSpy = vi.fn(); vi.stubGlobal("fetch", fetchSpy);
    for (const [env, key] of [["production", SBX], ["sandbox", PRD]] as const) {
      vi.stubEnv("ASAAS_ENV", env); vi.stubEnv("ASAAS_API_URL", env === "production" ? PRD_URL : SBX_URL); vi.stubEnv("ASAAS_API_KEY", key); vi.stubEnv("ASAAS_CHECKOUT_BASE_URL", "");
      await expect(createAsaasChargeForOrder({ orderId: 999902, method: "PIX", value: 10, customer: { name: "Synthetic fixture", cpfCnpj: "11144477735" }, description: "SYNTHETIC" })).rejects.toThrow();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("keeps Coming Soon / closed checkout as the default public posture", async () => {
    const { isPublicCheckoutEnabled } = await import("../_core/publicStore");
    expect(isPublicCheckoutEnabled({} as never)).toBe(false);
    expect(isPublicCheckoutEnabled({ PUBLIC_SITE_MODE: "coming-soon", PUBLIC_CHECKOUT_ENABLED: "true" } as never)).toBe(false);
    expect(isPublicCheckoutEnabled({ PUBLIC_SITE_MODE: "store", PUBLIC_CHECKOUT_ENABLED: "false" } as never)).toBe(false);
  });
});

// ---- P2.2: the Railway IDENTITY (not labels) decides the Asaas environment. Reproduces the cases demonstrated by the independent audit. ----
describe("P2.2 Railway identity binding", () => {
  const prodHmlgEnv = (o: E = {}): E => ({ ...prodIdentity, NODE_ENV: "production", ASAAS_ENV: "sandbox", ASAAS_API_URL: SBX_URL, ASAAS_API_KEY: SBX, ...o });
  it("accepts only the approved combinations", () => {
    expect(resolveAsaasConfig(productionEnv({ NODE_ENV: "production" }))).toMatchObject({ apiUrl: PRD_URL, apiKey: PRD });
    for (const id of [HOMID, STGID]) expect(resolveAsaasConfig({ ...idOf(id), NODE_ENV: "production", APP_ENV: "staging", ASAAS_ENV: "sandbox", ASAAS_API_URL: SBX_URL, ASAAS_API_KEY: SBX })).toMatchObject({ apiUrl: SBX_URL, apiKey: SBX });
    expect(resolveAsaasConfig(sandboxEnv())).toMatchObject({ apiUrl: SBX_URL }); // local, non-production process with no Railway identity
  });
  it.each([
    ["ASAAS_ENV=sandbox + sandbox endpoint + sandbox key under the PRODUCTION identity (the audit case)", prodHmlgEnv(), "ASAAS_PRODUCTION_IDENTITY_REQUIRES_PRODUCTION"],
    ["same with ASAAS_ENV unset", prodHmlgEnv({ ASAAS_ENV: undefined }), "ASAAS_PRODUCTION_IDENTITY_REQUIRES_PRODUCTION"],
    ["sandbox slot key under the production identity", prodHmlgEnv({ ASAAS_API_KEY: undefined, ASAAS_SANDBOX_API_KEY: SBX }), "ASAAS_PRODUCTION_IDENTITY_REQUIRES_PRODUCTION"],
    ["APP_ENV=staging label + sandbox under the production identity", prodHmlgEnv({ APP_ENV: "staging" }), "ASAAS_PRODUCTION_IDENTITY_REQUIRES_PRODUCTION"],
    ["EMAIL_ENV=staging label + sandbox under the production identity", prodHmlgEnv({ EMAIL_ENV: "staging" }), "ASAAS_PRODUCTION_IDENTITY_REQUIRES_PRODUCTION"],
    ["production project id only (partial) + sandbox", { RAILWAY_PROJECT_ID: PRODID.projectId, NODE_ENV: "production", ASAAS_ENV: "sandbox", ASAAS_API_URL: SBX_URL, ASAAS_API_KEY: SBX }, "ASAAS_PRODUCTION_IDENTITY_INCOMPLETE"],
    ["production environment id only (partial) + sandbox", { RAILWAY_ENVIRONMENT_ID: PRODID.environmentId, NODE_ENV: "production", ASAAS_ENV: "sandbox", ASAAS_API_URL: SBX_URL, ASAAS_API_KEY: SBX }, "ASAAS_PRODUCTION_IDENTITY_INCOMPLETE"],
    ["APP_ENV=staging ALONE (no Railway identity, deployed runtime) + sandbox", { NODE_ENV: "production", APP_ENV: "staging", ASAAS_ENV: "sandbox", ASAAS_API_URL: SBX_URL, ASAAS_API_KEY: SBX }, "ASAAS_SANDBOX_IDENTITY_NOT_APPROVED"],
    ["EMAIL_ENV=staging ALONE (deployed runtime) + sandbox", { NODE_ENV: "production", EMAIL_ENV: "staging", ASAAS_ENV: "sandbox", ASAAS_API_URL: SBX_URL, ASAAS_API_KEY: SBX }, "ASAAS_SANDBOX_IDENTITY_NOT_APPROVED"],
    ["unknown Railway project + sandbox", { RAILWAY_PROJECT_ID: "00000000-0000-4000-8000-000000000000", RAILWAY_ENVIRONMENT_ID: "x", RAILWAY_SERVICE_ID: "y", NODE_ENV: "production", ASAAS_ENV: "sandbox", ASAAS_API_URL: SBX_URL, ASAAS_API_KEY: SBX }, "ASAAS_SANDBOX_IDENTITY_NOT_APPROVED"],
    ["production project + homologation environment (contradictory identity)", { ...prodIdentity, RAILWAY_ENVIRONMENT_ID: HOMID.environmentId, NODE_ENV: "production", ASAAS_ENV: "production", ASAAS_API_URL: PRD_URL, ASAAS_API_KEY: PRD }, "ASAAS_RAILWAY_IDENTITY_INVALID"],
    ["production project + legacy staging environment (contradictory identity)", { ...prodIdentity, RAILWAY_ENVIRONMENT_ID: STGID.environmentId, NODE_ENV: "production", ASAAS_ENV: "production", ASAAS_API_URL: PRD_URL, ASAAS_API_KEY: PRD }, "ASAAS_RAILWAY_IDENTITY_CONTRADICTION"],
    ["homologation project + production service (mixed approved identity)", { ...idOf(HOMID), RAILWAY_SERVICE_ID: PRODID.serviceId, NODE_ENV: "production", ASAAS_ENV: "sandbox", ASAAS_API_URL: SBX_URL, ASAAS_API_KEY: SBX }, "ASAAS_RAILWAY_IDENTITY_INVALID"],
    ["homologation identity + production endpoint/key", { ...idOf(HOMID), NODE_ENV: "production", ASAAS_ENV: "production", ASAAS_API_URL: PRD_URL, ASAAS_API_KEY: PRD }, "ASAAS_ENVIRONMENT_MISMATCH"],
    ["legacy staging identity + production endpoint/key", { ...idOf(STGID), NODE_ENV: "production", ASAAS_ENV: "production", ASAAS_API_URL: PRD_URL, ASAAS_API_KEY: PRD }, "ASAAS_ENVIRONMENT_MISMATCH"],
    ["production credential under the production identity but sandbox declared", productionEnv({ ASAAS_ENV: "sandbox" }), "ASAAS_PRODUCTION_IDENTITY_REQUIRES_PRODUCTION"],
    ["deployed runtime with production endpoint and NO identity", { NODE_ENV: "production", ASAAS_ENV: "production", ASAAS_API_URL: PRD_URL, ASAAS_API_KEY: PRD }, "ASAAS_PRODUCTION_REQUIRES_PRODUCTION_IDENTITY"],
  ] as Array<[string, E, string]>)("rejects %s", (_n, env, code) => {
    expect(() => resolveAsaasConfig(env)).toThrow(code);
    expect(classifyAsaasRuntime(env).consistent).toBe(false);
  });
  it("refuses before ANY HTTP call (charge creation never reaches fetch) for the audit cases", async () => {
    const fetchSpy = vi.fn(); vi.stubGlobal("fetch", fetchSpy);
    for (const env of [prodHmlgEnv(), prodHmlgEnv({ APP_ENV: "staging" }), { NODE_ENV: "production", APP_ENV: "staging", ASAAS_ENV: "sandbox", ASAAS_API_URL: SBX_URL, ASAAS_API_KEY: SBX }] as E[]) {
      vi.unstubAllEnvs(); for (const [k, v] of Object.entries(env)) if (v !== undefined) vi.stubEnv(k, v);
      await expect(createAsaasChargeForOrder({ orderId: 999903, method: "PIX", value: 10, customer: { name: "Synthetic fixture", cpfCnpj: "11144477735" }, description: "SYNTHETIC" })).rejects.toThrow();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("P2.3 production Asaas requires the COMPLETE exact Railway tuple (project + environment + backend service)", () => {
  const base = (o: E = {}): E => ({ RAILWAY_PROJECT_ID: PRODID.projectId, RAILWAY_ENVIRONMENT_ID: PRODID.environmentId, RAILWAY_SERVICE_ID: PRODID.serviceId, NODE_ENV: "production", ASAAS_ENV: "production", ASAAS_API_URL: PRD_URL, ASAAS_API_KEY: PRD, ...o });
  it("accepts exactly the approved production tuple", () => { expect(resolveAsaasConfig(base())).toMatchObject({ apiUrl: PRD_URL, apiKey: PRD }); });
  it.each([
    ["service id ABSENT (the Codex reproduction)", base({ RAILWAY_SERVICE_ID: undefined })],
    ["service id EMPTY", base({ RAILWAY_SERVICE_ID: "" })],
    ["service id DIVERGENT (the MySQL-W5FK service)", base({ RAILWAY_SERVICE_ID: "24fd928a-dfc3-4757-8a89-1e7e92b98a7d" })],
    ["service id DIVERGENT (the new MySQL c7 service)", base({ RAILWAY_SERVICE_ID: "98fbd4ec-b401-47f8-a519-ab1edfb9b193" })],
    ["service id DIVERGENT (arbitrary, no automatic substitute is accepted)", base({ RAILWAY_SERVICE_ID: "00000000-0000-4000-8000-000000000000" })],
    ["service id with different case/whitespace", base({ RAILWAY_SERVICE_ID: ` ${PRODID.serviceId.toUpperCase()} ` })],
    ["project ABSENT", base({ RAILWAY_PROJECT_ID: undefined })],
    ["environment ABSENT", base({ RAILWAY_ENVIRONMENT_ID: undefined })],
    ["project divergent", base({ RAILWAY_PROJECT_ID: HOMID.projectId })],
    ["environment divergent", base({ RAILWAY_ENVIRONMENT_ID: HOMID.environmentId })],
    ["only the production SERVICE id (project/env missing)", { RAILWAY_SERVICE_ID: PRODID.serviceId, NODE_ENV: "production", ASAAS_ENV: "production", ASAAS_API_URL: PRD_URL, ASAAS_API_KEY: PRD }],
    ["only project + environment, service missing, ASAAS_ENV unset", base({ RAILWAY_SERVICE_ID: undefined, ASAAS_ENV: undefined })],
  ] as Array<[string, E]>)("rejects %s", (_n, env) => {
    expect(() => resolveAsaasConfig(env)).toThrow();
    expect(classifyAsaasRuntime(env).consistent).toBe(false);
  });
  it("makes ZERO HTTP calls (customers/payments never reach fetch) for every incomplete or divergent tuple", async () => {
    const fetchSpy = vi.fn(); vi.stubGlobal("fetch", fetchSpy);
    const cases: E[] = [base({ RAILWAY_SERVICE_ID: undefined }), base({ RAILWAY_SERVICE_ID: "" }), base({ RAILWAY_SERVICE_ID: "24fd928a-dfc3-4757-8a89-1e7e92b98a7d" }), base({ RAILWAY_SERVICE_ID: "00000000-0000-4000-8000-000000000000" }), base({ RAILWAY_PROJECT_ID: undefined }), base({ RAILWAY_ENVIRONMENT_ID: undefined })];
    for (const env of cases) {
      vi.unstubAllEnvs(); for (const [k, v] of Object.entries(env)) if (v !== undefined) vi.stubEnv(k, v);
      await expect(createAsaasChargeForOrder({ orderId: 999904, method: "PIX", value: 10, customer: { name: "Synthetic fixture", cpfCnpj: "11144477735" }, description: "SYNTHETIC" })).rejects.toThrow();
    }
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });
  it("sandbox stays exclusive to the approved homologation/staging identities (never the production tuple, never a production service id)", () => {
    for (const id of [HOMID, STGID]) expect(resolveAsaasConfig({ ...idOf(id), NODE_ENV: "production", APP_ENV: "staging", ASAAS_ENV: "sandbox", ASAAS_API_URL: SBX_URL, ASAAS_API_KEY: SBX })).toMatchObject({ apiUrl: SBX_URL });
    expect(() => resolveAsaasConfig(base({ ASAAS_ENV: "sandbox", ASAAS_API_URL: SBX_URL, ASAAS_API_KEY: SBX }))).toThrow("ASAAS_PRODUCTION_IDENTITY_REQUIRES_PRODUCTION");
    expect(() => resolveAsaasConfig({ ...idOf(HOMID), RAILWAY_SERVICE_ID: PRODID.serviceId, NODE_ENV: "production", ASAAS_ENV: "sandbox", ASAAS_API_URL: SBX_URL, ASAAS_API_KEY: SBX })).toThrow();
  });
});
