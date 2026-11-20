import {afterEach,describe,it,expect,vi} from "vitest";
import {assertCheckoutMethodEnabled, assertEnabledBillingTypes, ENABLED_CHECKOUT_METHODS, DEFAULT_CHECKOUT_METHOD, CHECKOUT_METHOD_POLICY} from "../../shared/checkoutMethods";
import {checkout} from "../database/checkout";
import {createAsaasChargeForOrder} from "./asaas";
import {createAsaasCheckout} from "./asaasService";
import {createCheckoutHandler} from "../controllers/paymentController";
import * as db from "../db";
const ax=vi.hoisted(()=>({post:vi.fn(),get:vi.fn()}));
vi.mock("axios",()=>({default:{create:()=>ax,isAxiosError:()=>false}}));
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();vi.clearAllMocks();});
describe("commercial purchase methods, independent of provider/webhook observation",()=>{
 it("enables only PIX and CARD by default and cannot reactivate from environment",()=>{
  vi.stubEnv("CHECKOUT_ENABLED_METHODS","PIX,CARD,BOLETO");vi.stubEnv("BOLETO_ENABLED","true");
  expect(ENABLED_CHECKOUT_METHODS).toEqual(["PIX","CARD"]);expect(DEFAULT_CHECKOUT_METHOD).toBe("PIX");
  expect(CHECKOUT_METHOD_POLICY.BOLETO).toBe(false);expect(Object.isFrozen(CHECKOUT_METHOD_POLICY)).toBe(true);
  expect(()=>assertCheckoutMethodEnabled("PIX")).not.toThrow();expect(()=>assertCheckoutMethodEnabled("CARD")).not.toThrow();
  expect(()=>assertEnabledBillingTypes(["PIX","CREDIT_CARD"])).not.toThrow();
 });
 it.each(["BOLETO","UNDEFINED",undefined,"", "__proto__"])("rejects direct %s checkout before database, quote or charge",async method=>{
  const connection={query:vi.fn(),execute:vi.fn()},quote=vi.fn(),charge=vi.fn();
  await expect(checkout(connection as any,{method} as any,{quote,charge})).rejects.toMatchObject({code:"CHECKOUT_PAYMENT_METHOD_DISABLED"});
  expect(connection.query).not.toHaveBeenCalled();expect(connection.execute).not.toHaveBeenCalled();expect(quote).not.toHaveBeenCalled();expect(charge).not.toHaveBeenCalled();
 });
 it.each(["BOLETO","UNDEFINED",undefined])("rejects %s at charge adapter before creating customer or making any request",async method=>{
  const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
  await expect(createAsaasChargeForOrder({method} as any)).rejects.toMatchObject({code:"CHECKOUT_PAYMENT_METHOD_DISABLED"});
  expect(fetch).not.toHaveBeenCalled();
 });
 it.each([
  {label:"legacy PREORDER",items:[{salesModeAtPurchase:"PREORDER",productName:"Synthetic batch item",sku:"SYN-1"}],status:409,code:"CHECKOUT_PREORDER_DISABLED"},
  {label:"restricted Clã 14 Bis",items:[{salesModeAtPurchase:"STOCK",productName:"Camiseta Clã 14 Bis",sku:"14B-TEST"}],status:403,code:"CHECKOUT_PRODUCT_REQUIRES_AUTHORIZATION"},
  {label:"unverifiable empty order",items:[],status:409,code:"CHECKOUT_ORDER_ITEMS_UNAVAILABLE"},
 ])("legacy REST checkout rejects $label before any provider side effect",async ({items,status,code})=>{
  vi.stubEnv("NODE_ENV","test");vi.stubEnv("PUBLIC_SITE_MODE","store");vi.stubEnv("PUBLIC_CHECKOUT_ENABLED","true");
  vi.stubEnv("APP_ENV","");vi.stubEnv("EMAIL_ENV","");
  vi.stubEnv("CORS_ORIGINS","https://staging.example.invalid");
  const order=vi.spyOn(db,"getOrderByIdAndUser").mockResolvedValue({id:901,userId:44,status:"pending",asaasCheckoutId:null,checkoutAttemptId:null,totalPrice:500} as any);
  const lines=vi.spyOn(db,"getOrderReservationItems").mockResolvedValue(items as any);
  const customer=vi.spyOn(db,"getUserById");const claim=vi.spyOn(db,"reserveExternalCheckoutCreation");
  const req={authUser:{id:44},body:{orderId:901,redirectUrl:"https://staging.example.invalid/return",billingTypes:["PIX"]},ip:"local"};
  let actualStatus=0,body:any;const res={status(n:number){actualStatus=n;return this;},json(v:unknown){body=v;return this;}};
  await createCheckoutHandler(req as any,res as any);
  expect(actualStatus).toBe(status);expect(body.error?.code??body.code).toBe(code);
  expect(order).toHaveBeenCalledOnce();expect(lines).toHaveBeenCalledWith(901);
  expect(customer).not.toHaveBeenCalled();expect(claim).not.toHaveBeenCalled();expect(ax.get).not.toHaveBeenCalled();expect(ax.post).not.toHaveBeenCalled();
 });
 describe("legacy REST checkout: whole-product exclusivity (every persisted SKU, active or not)",()=>{
  const prepare=()=>{
   vi.stubEnv("NODE_ENV","test");vi.stubEnv("PUBLIC_SITE_MODE","store");vi.stubEnv("PUBLIC_CHECKOUT_ENABLED","true");
   vi.stubEnv("APP_ENV","");vi.stubEnv("EMAIL_ENV","");vi.stubEnv("CORS_ORIGINS","https://staging.example.invalid");
   const spies={
    order:vi.spyOn(db,"getOrderByIdAndUser").mockResolvedValue({id:902,userId:44,status:"pending",asaasCheckoutId:null,checkoutAttemptId:null,totalPrice:500} as any),
    lines:vi.spyOn(db,"getOrderReservationItems").mockResolvedValue([{salesModeAtPurchase:"STOCK",productName:"Camiseta comum",sku:"CAM-PT-M"}] as any),
    user:vi.spyOn(db,"getUserById"),claim:vi.spyOn(db,"reserveExternalCheckoutCreation"),mark:vi.spyOn(db,"setOrderAsaasCheckoutId"),
   };
   const req={authUser:{id:44},body:{orderId:902,redirectUrl:"https://staging.example.invalid/return",billingTypes:["PIX"]},ip:"local"};
   let status=0,body:any;const res={status(n:number){status=n;return this;},json(v:unknown){body=v;return this;}};
   return {spies,run:async()=>{await createCheckoutHandler(req as any,res as any);return {status,code:body?.error?.code??body?.code,body};}};
  };
  const noSideEffects=(s:ReturnType<typeof prepare>["spies"])=>{
   expect(s.user).not.toHaveBeenCalled();expect(s.claim).not.toHaveBeenCalled();expect(s.mark).not.toHaveBeenCalled();
   expect(ax.get).not.toHaveBeenCalled();expect(ax.post).not.toHaveBeenCalled();
  };
  it("a generic-name product that carries a restricted SKU is refused before customer, claim or charge",async ()=>{
   const {spies,run}=prepare();const policy=vi.spyOn(db,"isLegacyCheckoutOrderRestricted").mockResolvedValue(true);
   const result=await run();
   expect(policy).toHaveBeenCalledWith(902);
   expect(result.status).toBe(403);expect(result.code).toBe("CHECKOUT_PRODUCT_REQUIRES_AUTHORIZATION");
   expect(JSON.stringify(result.body)).not.toMatch(/14b|sku|variant/i);
   noSideEffects(spies);
  });
  it("fails closed when the policy cannot be verified: no provider call, no claim, no internal detail",async ()=>{
   const {spies,run}=prepare();vi.spyOn(db,"isLegacyCheckoutOrderRestricted").mockRejectedValue(new Error("db down: secret-detail"));
   const result=await run();
   expect(result.status).toBe(400);expect(result.code).toBe("CHECKOUT_CREATE_FAILED");
   expect(JSON.stringify(result.body)).not.toMatch(/secret-detail|db down/);
   noSideEffects(spies);
  });
  it("race: an exclusive SKU found by the locked claim is rejected before customer or Asaas IO",async ()=>{
   const {spies,run}=prepare();
   vi.spyOn(db,"isLegacyCheckoutOrderRestricted").mockResolvedValue(false); // initial read sees ordinary catalog
   spies.claim.mockRejectedValue(Object.assign(new Error("restricted under product/variant locks"),{code:"CHECKOUT_PRODUCT_REQUIRES_AUTHORIZATION"}));
   const result=await run();
   expect(result.status).toBe(403);expect(result.code).toBe("CHECKOUT_PRODUCT_REQUIRES_AUTHORIZATION");
   expect(spies.claim).toHaveBeenCalledOnce();
   expect(spies.user).not.toHaveBeenCalled();
   expect(ax.get).not.toHaveBeenCalled();expect(ax.post).not.toHaveBeenCalled();
  });
  it("keeps a durable claim after customer-provider failure and blocks blind retry for reconciliation",async ()=>{
   vi.stubEnv("ASAAS_API_KEY","$aact_hmlg_synthetic-local-key");vi.stubEnv("ASAAS_API_URL","https://api-sandbox.asaas.com/v3");vi.stubEnv("ASAAS_ENV","sandbox");
   const {spies,run}=prepare();
   vi.spyOn(db,"isLegacyCheckoutOrderRestricted").mockResolvedValue(false);
   let claimExists=false;
   spies.claim.mockImplementation(async()=>{
    if(claimExists)throw new Error("Checkout reconciliation required");
    claimExists=true;
    return {id:902} as any;
   });
   spies.user.mockResolvedValue({id:44,name:"Synthetic buyer",email:"synthetic@example.invalid",cpf:"52998224725",phone:"61999990000",asaasCustomerId:null} as any);
   ax.post.mockRejectedValueOnce(new Error("synthetic provider transport failure"));

   const first=await run();
   expect(first.code).toBe("CHECKOUT_CREATE_FAILED");
   expect(claimExists).toBe(true);
   expect(spies.claim).toHaveBeenCalledOnce();
   expect(ax.post).toHaveBeenCalledOnce();

   const second=await run();
   expect(second.code).toBe("CHECKOUT_CREATE_FAILED");
   expect(spies.claim).toHaveBeenCalledTimes(2);
   expect(spies.user).toHaveBeenCalledOnce();
   expect(ax.post).toHaveBeenCalledOnce(); // retry stops at durable claim; no duplicate provider call
   expect(ax.get).not.toHaveBeenCalled();
  });
  it("a restriction confirmed under the transaction locks maps to the same contract and never reaches the charge",async ()=>{
   const {spies,run}=prepare();vi.spyOn(db,"isLegacyCheckoutOrderRestricted").mockResolvedValue(false);
   spies.user.mockResolvedValue({id:44,asaasCustomerId:"cus_synthetic"} as any);
   const customer=await import("./asaasService");vi.spyOn(customer,"verifyAsaasCustomerNotifications").mockResolvedValue(undefined as any);
   spies.claim.mockRejectedValue(Object.assign(new Error("internal"),{code:"CHECKOUT_PRODUCT_REQUIRES_AUTHORIZATION"}));
   const result=await run();
   expect(result.status).toBe(403);expect(result.code).toBe("CHECKOUT_PRODUCT_REQUIRES_AUTHORIZATION");
   expect(JSON.stringify(result.body)).not.toMatch(/internal/);
   expect(spies.claim).toHaveBeenCalledOnce();expect(spies.mark).not.toHaveBeenCalled();expect(ax.post).not.toHaveBeenCalled();
  });
  it("an ordinary product proceeds past the policy (control)",async ()=>{
   const {spies,run}=prepare();vi.spyOn(db,"isLegacyCheckoutOrderRestricted").mockResolvedValue(false);
   spies.claim.mockResolvedValue({id:902} as any);
   spies.user.mockResolvedValue(undefined as any); // stops right after the policy, at customer lookup
   const result=await run();
   expect(result.code).not.toBe("CHECKOUT_PRODUCT_REQUIRES_AUTHORIZATION");expect(spies.user).toHaveBeenCalledOnce();
  });
 });
 it.each([["BOLETO"],["UNDEFINED"],["PIX","BOLETO"],["CREDIT_CARD","UNDEFINED"],[],undefined].map(billingTypes=>({billingTypes})))("rejects alternate billing types $billingTypes before customer GET or POST",async ({billingTypes})=>{
  await expect(createAsaasCheckout({billingTypes} as any)).rejects.toMatchObject({code:"CHECKOUT_PAYMENT_METHOD_DISABLED"});
  expect(ax.get).not.toHaveBeenCalled();expect(ax.post).not.toHaveBeenCalled();
 });
 it.each([["BOLETO"],["PIX","BOLETO"],["UNDEFINED"]].map(billingTypes=>({billingTypes})))("REST checkout rejects $billingTypes before customer creation, claim or order lookup",async ({billingTypes})=>{
  const lookup=vi.spyOn(db,"getUserById"),order=vi.spyOn(db,"getOrderByIdAndUser"),claim=vi.spyOn(db,"reserveExternalCheckoutCreation");
  const req={authUser:{id:999901},body:{orderId:999901,redirectUrl:"https://staging.l4ckos.com.br",billingTypes},ip:"local"};
  let status=0,body:any;const res={status(n:number){status=n;return this;},json(b:unknown){body=b;}};
  await createCheckoutHandler(req as any,res as any);
  expect(status).toBe(400);expect(body.error?.code??body.code).toBe(billingTypes.includes("UNDEFINED")?"INVALID_CHECKOUT_INPUT":"CHECKOUT_PAYMENT_METHOD_DISABLED");
  expect(lookup).not.toHaveBeenCalled();expect(order).not.toHaveBeenCalled();expect(claim).not.toHaveBeenCalled();expect(ax.post).not.toHaveBeenCalled();
 });
});
