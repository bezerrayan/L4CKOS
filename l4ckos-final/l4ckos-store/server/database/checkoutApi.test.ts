import { beforeEach, describe, it, expect, vi } from "vitest";
vi.mock("mysql2/promise",async original=>({...await original<typeof import("mysql2/promise")>(),createConnection:vi.fn(()=>{throw Error("UNEXPECTED_DATABASE_CONNECTION");})}));
import { createConnection } from "mysql2/promise";
import { ordersRouter } from "../routers/orders";
const request={checkoutAttemptId:'a20485ea-35f8-4ea3-85dd-4084f593e695',method:'PIX',items:[{productId:1,quantity:3}],shipping:{cep:'70000000',optionId:'local'},shippingAddress:{recipient:'Synthetic',zipCode:'70000000',street:'Fixture',number:'1',neighborhood:'Fixture',city:'Brasilia',state:'DF'},customer:{name:'Synthetic',cpfCnpj:'11144477735'}};
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
});
