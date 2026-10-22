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
