import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({
  observation:vi.fn(async()=>{}),paid:vi.fn(),trusted:vi.fn(),binding:vi.fn(),enqueue:vi.fn(),deliver:vi.fn(),
  once:vi.fn(async(_input:unknown,execute:()=>Promise<unknown>)=>({duplicate:false,result:await execute()})),
  audit:vi.fn(async()=>{}),alert:vi.fn(async()=>'recorded'),
  receive:vi.fn(async(payload:unknown,process:(payload:unknown)=>Promise<unknown>)=>process(payload)),
  signature:vi.fn(()=>true),attest:vi.fn(async()=>true),
}));
vi.mock('../db',()=>({
  getOrderById:vi.fn(async()=>({id:901,status:'pending',totalPrice:9900})),
  runAsaasWebhookOnce:mocks.once,recordPaymentException:mocks.observation,markOrderPaid:mocks.paid,
}));
vi.mock('../payments/paymentRecord',()=>({validatePaymentBinding:mocks.binding,validatePaymentObservationBinding:vi.fn(async()=>{}),recordTrustedPaymentReceipt:mocks.trusted}));
vi.mock('../payments/paymentNotificationOutbox',()=>({enqueuePaymentApproved:mocks.enqueue,deliverPaymentNotifications:mocks.deliver}));
vi.mock('../payments/stagingCheckoutAdmission',async()=>{
  const actual=await vi.importActual<typeof import('../payments/stagingCheckoutAdmission')>('../payments/stagingCheckoutAdmission');
  return {...actual,insertAdmissionAudit:mocks.audit};
});
vi.mock('../payments/reconciliationAlerts',async()=>{
  const actual=await vi.importActual<typeof import('../payments/reconciliationAlerts')>('../payments/reconciliationAlerts');
  return {...actual,recordReconciliationAlert:mocks.alert};
});
vi.mock('../payments/webhookInbox',()=>({receiveWebhook:mocks.receive}));
vi.mock('../payments/ingressProvenance',()=>({attestAuthenticatedIngress:mocks.attest,hasVerifiedIngressProvenance:vi.fn(async()=>false)}));
vi.mock('../database/webhookTransaction',()=>({afterWebhookCommit:vi.fn(),webhookDb:()=>({execute:vi.fn(async()=>[[],{affectedRows:1}])})}));
vi.mock('../payments/webhookRecovery',()=>({assertNoRecoveryHold:vi.fn(async()=>{})}));
vi.mock('../services/asaasService',()=>({
  getAsaasPayment:vi.fn(()=>{throw Error('NO_PROVIDER_CALL');}),
  validateAsaasWebhookSignature:mocks.signature,
}));
vi.mock('../services/emailService.js',()=>({}));
vi.mock('../_core/security',()=>({securityLog:vi.fn()}));
import {createAsaasWebhookHandler,processWebhookEnvelope} from './paymentController';
beforeEach(()=>{
  vi.clearAllMocks();
  mocks.audit.mockResolvedValue(undefined);
  mocks.alert.mockResolvedValue('recorded');
  mocks.signature.mockReturnValue(true);
  mocks.attest.mockResolvedValue(true);
});
for(const event of ['PAYMENT_UPDATED','PAYMENT_RESTORED'])it(`${event} records reconciliation without financial, stock or mail effects`,async()=>{
  const result=await processWebhookEnvelope({id:'evt_synthetic',event,payment:{id:'pay_synthetic',externalReference:'901',status:'PENDING',value:99}});
  expect(result.status).toBe(200);
  expect(mocks.once).toHaveBeenCalledOnce();
  expect(mocks.observation).toHaveBeenCalledWith(expect.objectContaining({orderId:901,event,paymentId:'pay_synthetic'}));
  expect(mocks.audit).toHaveBeenCalledWith(expect.anything(),'payment.webhook_reconciliation_required.v1','asaasWebhookInbox',expect.any(String),
    expect.objectContaining({eventId:'evt_synthetic',event,financialMutation:false,stockMutation:false}));
  expect(mocks.alert).toHaveBeenCalledOnce();
  for(const effect of [mocks.paid,mocks.trusted,mocks.binding,mocks.enqueue,mocks.deliver])expect(effect).not.toHaveBeenCalled();
});
it('quarantines an authenticated unknown event and waits for reconciliation writes before HTTP 200',async()=>{
  let releaseAudit!:()=>void;
  let signalAuditStarted!:()=>void;
  const auditStarted=new Promise<void>(resolve=>{signalAuditStarted=resolve;});
  const auditWrite=new Promise<void>(resolve=>{releaseAudit=resolve;});
  mocks.audit.mockImplementationOnce(async()=>{
    signalAuditStarted();
    await auditWrite;
  });
  const request=createAsaasWebhookHandler();
  const req={headers:{'asaas-access-token':'synthetic-token'},body:{id:'evt_unknown_synthetic',event:'PAYMENT_UNKNOWN',payment:{id:'pay_synthetic',externalReference:'901'}},ip:'127.0.0.1'} as any;
  const res={statusCode:0,body:undefined as unknown,status(code:number){this.statusCode=code;return this;},json(body:unknown){this.body=body;return this;}} as any;
  const response=request(req,res);
  await auditStarted;
  let settled=false;
  void response.then(()=>{settled=true;});
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(res.statusCode).toBe(0);
  releaseAudit();
  await response;
  expect(res.statusCode).toBe(200);
  expect(res.body).toMatchObject({reason:'event_quarantined',financialMutation:false,stockMutation:false});
  expect(mocks.signature).toHaveBeenCalledOnce();
  expect(mocks.attest).toHaveBeenCalledOnce();
  expect(mocks.audit).toHaveBeenCalledWith(expect.anything(),'payment.webhook_reconciliation_required.v1','asaasWebhookInbox',expect.any(String),
    expect.objectContaining({eventId:'evt_unknown_synthetic',event:'PAYMENT_UNKNOWN',financialMutation:false,stockMutation:false}));
  expect(mocks.alert).toHaveBeenCalledOnce();
  expect(mocks.once).not.toHaveBeenCalled();
  for(const effect of [mocks.paid,mocks.trusted,mocks.enqueue,mocks.deliver])expect(effect).not.toHaveBeenCalled();
});
it('returns a retryable server error when reconciliation persistence fails',async()=>{
  mocks.audit.mockRejectedValueOnce(new Error('SYNTHETIC_AUDIT_WRITE_FAILED'));
  const request=createAsaasWebhookHandler();
  const req={headers:{'asaas-access-token':'synthetic-token'},body:{id:'evt_audit_failure_synthetic',event:'PAYMENT_UNKNOWN'},ip:'127.0.0.1'} as any;
  const res={statusCode:0,body:undefined as unknown,status(code:number){this.statusCode=code;return this;},json(body:unknown){this.body=body;return this;}} as any;
  await request(req,res);
  expect(res.statusCode).toBeGreaterThanOrEqual(500);
  expect(res.statusCode).toBeLessThan(600);
  expect(mocks.audit).toHaveBeenCalledOnce();
  expect(mocks.alert).not.toHaveBeenCalled();
  for(const effect of [mocks.paid,mocks.trusted,mocks.enqueue,mocks.deliver])expect(effect).not.toHaveBeenCalled();
});
