import { beforeEach, describe, it, expect, vi } from "vitest";
vi.mock("mysql2/promise",async original=>({...await original<typeof import("mysql2/promise")>(),createConnection:vi.fn(()=>{throw Error("UNEXPECTED_DATABASE_CONNECTION");})}));
import { createConnection } from "mysql2/promise";
import { ordersRouter } from "../routers/orders";
const request={checkoutAttemptId:'a20485ea-35f8-4ea3-85dd-4084f593e695',method:'PIX',items:[{productId:1,quantity:3}],shipping:{cep:'70000000',optionId:'local',expectedPriceCents:0},shippingAddress:{recipient:'Synthetic',zipCode:'70000000',street:'Fixture',number:'1',neighborhood:'Fixture',city:'Brasilia',state:'DF'},customer:{name:'Synthetic',cpfCnpj:'11144477735'}};
describe('checkout API validation before database/provider IO',()=>{
 beforeEach(()=>{vi.stubEnv('NODE_ENV','test');vi.stubEnv('PUBLIC_SITE_MODE','store');});
 const caller=ordersRouter.createCaller({user:{id:1,role:'user'},req:{},res:{}} as any);
 it.each([{price:1},{unitPrice:1},{totalPrice:1},{paymentStatus:'confirmed'},{creditCard:{number:'forbidden',ccv:'forbidden'}},{cardNumber:'forbidden'},{cvv:'forbidden'},{creditCardToken:'forbidden'}])('rejects top level client authority %j',async extra=>{
  await expect(caller.createAsaasCharge({...request,...extra} as any)).rejects.toMatchObject({code:'BAD_REQUEST'});expect(createConnection).not.toHaveBeenCalled();
 });

 it.each(["BOLETO","UNDEFINED"])("rejects direct %s before opening any database connection",async method=>{
  await expect(caller.createAsaasCharge({...request,method} as any)).rejects.toMatchObject({code:"BAD_REQUEST",...(method==="BOLETO"?{message:"Forma de pagamento indisponível. Escolha PIX ou cartão de crédito."}:{})});
  expect(createConnection).not.toHaveBeenCalled();
 });
 it('rejects item pricing and missing attempt identity before local persistence',async()=>{
  await expect(caller.createAsaasCharge({...request,items:[{productId:1,quantity:3,price:1}]} as any)).rejects.toMatchObject({code:'BAD_REQUEST'});
  const {checkoutAttemptId:_,...legacy}=request;await expect(caller.createAsaasCharge(legacy as any)).rejects.toMatchObject({code:'BAD_REQUEST'});expect(createConnection).not.toHaveBeenCalled();
 });

 it("fails checkout before database or provider IO when Railway TLS trust is unconfigured", async () => {
  vi.stubEnv("DATABASE_URL", "mysql://fixture:fixture@mysql.railway.internal:3306/l4ckos_staging");
  vi.stubEnv("PUBLIC_CHECKOUT_ENABLED", "true");
  vi.stubEnv("RAILWAY_PROJECT_ID", "2bb90c8e-eb65-43ee-826b-f93750f0499c");
  vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "15545eee-bc02-4b70-afc4-19a5db9e6f46");
  vi.stubEnv("RAILWAY_SERVICE_ID", "9f1c7705-f2f9-48cf-b957-8f63a6bba4db");
  vi.stubEnv("RAILWAY_DEPLOYMENT_ID", "a75f3a82-3b4e-4c25-bf2d-de5cc358eaf6");
  await expect(caller.createAsaasCharge(request as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(createConnection).not.toHaveBeenCalled();
 });
});
