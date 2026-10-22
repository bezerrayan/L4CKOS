import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({
  observation:vi.fn(async()=>{}),paid:vi.fn(),trusted:vi.fn(),binding:vi.fn(),enqueue:vi.fn(),deliver:vi.fn(),
  once:vi.fn(async(_input:unknown,execute:()=>Promise<unknown>)=>({duplicate:false,result:await execute()})),
}));
vi.mock('../db',()=>({
  getOrderById:vi.fn(async()=>({id:901,status:'pending',totalPrice:9900})),
  runAsaasWebhookOnce:mocks.once,recordPaymentException:mocks.observation,markOrderPaid:mocks.paid,
}));
vi.mock('../payments/paymentRecord',()=>({validatePaymentBinding:mocks.binding,validatePaymentObservationBinding:vi.fn(async()=>{}),recordTrustedPaymentReceipt:mocks.trusted}));
vi.mock('../payments/paymentNotificationOutbox',()=>({enqueuePaymentApproved:mocks.enqueue,deliverPaymentNotifications:mocks.deliver}));
vi.mock('../payments/webhookInbox',()=>({receiveWebhook:vi.fn()}));
vi.mock('../database/webhookTransaction',()=>({afterWebhookCommit:vi.fn(),webhookDb:()=>({})}));
vi.mock('../payments/webhookRecovery',()=>({assertNoRecoveryHold:vi.fn(async()=>{})}));
vi.mock('../services/asaasService',()=>({getAsaasPayment:vi.fn(()=>{throw Error('NO_PROVIDER_CALL');})}));
vi.mock('../services/emailService.js',()=>({}));
vi.mock('../_core/security',()=>({securityLog:vi.fn()}));
import {processWebhookEnvelope} from './paymentController';
beforeEach(()=>vi.clearAllMocks());
for(const event of ['PAYMENT_UPDATED','PAYMENT_RESTORED'])it(`${event} records reconciliation without financial, stock or mail effects`,async()=>{
  const result=await processWebhookEnvelope({id:'evt_synthetic',event,payment:{id:'pay_synthetic',externalReference:'901',status:'PENDING',value:99}});
  expect(result.status).toBe(200);
  expect(mocks.once).toHaveBeenCalledOnce();
  expect(mocks.observation).toHaveBeenCalledWith(expect.objectContaining({orderId:901,event,paymentId:'pay_synthetic'}));
  for(const effect of [mocks.paid,mocks.trusted,mocks.binding,mocks.enqueue,mocks.deliver])expect(effect).not.toHaveBeenCalled();
});
it('unknown event still rejects without entering financial ledger callback',async()=>{
  const result=await processWebhookEnvelope({id:'evt_synthetic',event:'PAYMENT_UNKNOWN',payment:{id:'pay_synthetic',externalReference:'901'}});
  expect(result.status).toBe(422);expect(mocks.once).not.toHaveBeenCalled();expect(mocks.observation).not.toHaveBeenCalled();
});
