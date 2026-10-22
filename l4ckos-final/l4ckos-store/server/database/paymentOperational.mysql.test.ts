import * as checkoutPolicy from "../../shared/checkoutMethods";
import {getAsaasPayment} from '../services/asaasService';
import {beforeAll,beforeEach,afterAll,it,expect,describe,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createPool,type Pool,type Connection} from 'mysql2/promise';
import type * as mysqlOrm from 'drizzle-orm/mysql2';
import {checkout,type CheckoutInput} from './checkout';
import {openBackupConnection} from './backupRestore';
import {bootstrapReleaseDatabase} from '../../database/bootstrap/bootstrap';
import {readReleaseContract} from '../../database/schema/artifacts';
import {receiveWebhook,persistWebhook,recoverWebhooks} from '../payments/webhookInbox';
import {processWebhookEnvelope,asaasWebhookHandler} from '../controllers/paymentController';
import {deliverPaymentNotifications} from '../payments/paymentNotificationOutbox';
const injected=vi.hoisted(()=>({orm:null as unknown,mail:vi.fn(async(_p:any)=>({id:'synthetic-mail'}))}));
vi.mock('drizzle-orm/mysql2',async original=>({...await original<typeof mysqlOrm>(),drizzle:()=>injected.orm}));
vi.mock('../services/emailService.js',()=>({sendPaymentApprovedEmail:injected.mail,sendOrderCreatedEmail:vi.fn(async()=>({id:"synthetic-created"})),sendPaymentPendingEmail:vi.fn(async()=>({id:"synthetic-pending"})),sendInternalNewSaleAlertEmail:vi.fn(async()=>{}),sendInternalLowStockAlertEmail:vi.fn(async()=>{}),sendPaymentFailedEmail:vi.fn(async()=>{}),sendInternalPaymentFailedAlertEmail:vi.fn(async()=>{})}));
vi.mock('../services/asaasService',()=>({validateAsaasWebhookSignature:(h:any)=>h['asaas-access-token']==='synthetic-token',getAsaasPayment:vi.fn(async()=>{throw Error('NO_EXTERNAL_PROVIDER');}),createAsaasCheckout:vi.fn(),createAsaasCustomer:vi.fn()}));
const socketPath=process.env.L4CKOS_LOCAL_MYSQL_SOCKET??'';
const name='l4ckos_test_operational_'+randomUUID().replaceAll('-','').slice(0,10);
let root:Connection,c:Connection,pool:Pool;
const query=async(s:string,values:unknown[]=[])=>((await c.query<any[]>(s,values))[0]);
function input(method:CheckoutInput['method']='PIX'):CheckoutInput{return{userId:999901,checkoutAttemptId:randomUUID(),items:[{productId:999901,quantity:1}],method,shipping:{cep:'70000000',optionId:'synthetic'},shippingAddress:{recipient:'Synthetic',zipCode:'70000000',street:'Synthetic',number:'1',neighborhood:'Synthetic',city:'Brasilia',state:'DF'},customer:{name:'Synthetic',cpfCnpj:'11144477735',email:'synthetic@example.invalid'}};}
async function buy(method:CheckoutInput['method']='PIX'){
 const charge=vi.fn(async()=>({method,customerId:'cus_synthetic',paymentId:'pay_synthetic',invoiceUrl:'https://sandbox.asaas.com/i/synthetic',pixQrCode:null,pixCopyPaste:method==='PIX'?'synthetic-pix':null,bankSlipUrl:method==='BOLETO'?'https://sandbox.asaas.com/b/synthetic':null,digitableLine:null,nossoNumero:null,billingType:method==='CARD'?'CREDIT_CARD':method}));
 const request=input(method);const adapters={charge,quote:vi.fn(async()=>({options:[{id:'synthetic',label:'Synthetic transport',price:0}]}))};
 // Preserve tests of historical boleto behavior with a local-only fixture override.
 const legacy=method==='BOLETO'?vi.spyOn(checkoutPolicy,'assertCheckoutMethodEnabled').mockImplementationOnce(()=>{}):null;
 let result:Awaited<ReturnType<typeof checkout>>;
 try{result=await checkout(c,request,adapters);}finally{legacy?.mockRestore();}await deliverPaymentNotifications(3,result.orderId);return{result,request,adapters};
}
const event=(orderId:number,event='PAYMENT_RECEIVED',id=randomUUID())=>({id,event,payment:{id:'pay_synthetic',externalReference:String(orderId),value:99,currency:'BRL',status:event==='PAYMENT_CREATED'?'PENDING':event==='PAYMENT_OVERDUE'?'OVERDUE':event==='PAYMENT_REFUNDED'?'REFUNDED':event==='PAYMENT_DELETED'?'OVERDUE':'RECEIVED',...(event==='PAYMENT_DELETED'?{deleted:true}:{})}});
describe.skipIf(process.env.L4CKOS_MYSQL_TEST!=='1')('operational checkout/inbox/payment email outbox on local MySQL',()=>{
 beforeAll(async()=>{
  process.env.L4CKOS_LOCAL_SCHEMA='1';process.env.L4CKOS_LOCAL_RESTORE='1';
  expect(socketPath).toMatch(/^\/tmp\/l4ckos-[a-z0-9-]+\/mysqld\.sock$/);
  root=await openBackupConnection('mysql://root@localhost/mysql',socketPath);
  expect((await root.query<any[]>('SELECT @@version version'))[0][0].version).toBe('8.4.11');
  await root.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  c=await openBackupConnection(`mysql://root@localhost/${name}`,socketPath);
  await bootstrapReleaseDatabase(c,{url:`mysql://root@localhost/${name}`,socketPath,applicationCommit:'a'.repeat(40),approvedFingerprint:(await readReleaseContract()).fingerprint});
  const actual=await vi.importActual<typeof mysqlOrm>('drizzle-orm/mysql2');pool=createPool({user:'root',socketPath,database:name,connectionLimit:8});injected.orm=actual.drizzle(pool);
 },30000);
 beforeEach(async()=>{
  vi.unstubAllEnvs();vi.stubEnv('DATABASE_URL','synthetic-present');injected.mail.mockReset();injected.mail.mockResolvedValue({id:'synthetic-mail'});
  for(const table of ['notificationOutbox','asaasWebhookInbox','asaasWebhookEvents','paymentEvents','payments','auditLogs','stockReservations','orderItems','orders','products','users'])await query('DELETE FROM `'+table+'`');
  await query("INSERT INTO users(id,openId,name,email) VALUES(999901,'synthetic-local','Synthetic','synthetic@example.invalid')");
  await query("INSERT INTO products(id,name,category,price,stock) VALUES(999901,'SYNTHETIC CHECKOUT','fixture',9900,10)");
 });
 afterAll(async()=>{vi.unstubAllEnvs();await pool?.end();await c?.end();if(root){await root.query(`DROP DATABASE \`${name}\``);await root.end();}});
 it.each(['PIX','CARD','BOLETO'] as const)('%s checkout → reservation → durable webhook → paid/stock → ledger/outbox/email once',async method=>{
  const {result,request,adapters}=await buy(method);const id=result.orderId;
  expect((await query('SELECT status FROM stockReservations WHERE orderId=?',[id]))[0].status).toBe('active');
  const created=event(id,'PAYMENT_CREATED');expect((await receiveWebhook(created,processWebhookEnvelope)).status).toBe(200);
  const received=event(id);expect((await receiveWebhook(received,processWebhookEnvelope)).status).toBe(200);
  expect((await query('SELECT status,paymentStatus FROM orders WHERE id=?',[id]))[0]).toMatchObject({status:'paid',paymentStatus:'confirmed'});
  expect((await query('SELECT stock FROM products'))[0].stock).toBe(9);
  expect((await query('SELECT status FROM stockReservations WHERE orderId=?',[id]))[0].status).toBe('consumed');
  expect((await query('SELECT status,creationStatus,paidAmount,receivedAt FROM payments WHERE orderId=?',[id]))[0]).toMatchObject({status:'received',creationStatus:'created',paidAmount:9900,receivedAt:null});
  expect((await query('SELECT status FROM notificationOutbox WHERE type=\'payment-approved-email-v1\''))[0].status).toBe('sent');expect(injected.mail).toHaveBeenCalledTimes(1);
  const notices=await query('SELECT type,status FROM notificationOutbox');expect(notices).toHaveLength(3);expect(notices.every(row=>row.status==='sent')).toBe(true);
  expect(injected.mail.mock.calls[0][0].idempotencyKey).toMatch(/^payment-approved-email-v1\/[0-9a-f]{64}$/);
  await receiveWebhook(received,processWebhookEnvelope);await receiveWebhook(event(id,'PAYMENT_CONFIRMED'),processWebhookEnvelope);
  expect(injected.mail).toHaveBeenCalledTimes(1);expect((await query('SELECT stock FROM products'))[0].stock).toBe(9);
  if(method==='BOLETO')await expect(checkout(c,request,adapters)).rejects.toMatchObject({code:'CHECKOUT_PAYMENT_METHOD_DISABLED'});
  else expect((await checkout(c,request,adapters)).replayed).toBe(true);
  expect(adapters.charge).toHaveBeenCalledTimes(1);
 });
 it('preserves a receipt racing the charge response and suppresses a stale pending email',async()=>{
  const request=input();
  const result=await checkout(c,request,{quote:async()=>({options:[{id:'synthetic',label:'Synthetic transport',price:0}]}),charge:async({orderId})=>{
   expect((await receiveWebhook(event(orderId),processWebhookEnvelope)).status).toBe(200);
   return{method:'PIX',customerId:'cus_synthetic',paymentId:'pay_synthetic',invoiceUrl:'https://sandbox.asaas.com/i/synthetic',pixQrCode:null,pixCopyPaste:'synthetic-pix',bankSlipUrl:null,digitableLine:null,nossoNumero:null,billingType:'PIX'};
  }});
  await deliverPaymentNotifications(5,result.orderId);
  expect((await query('SELECT status,receivedAt FROM payments'))[0]).toMatchObject({status:'received',receivedAt:null});
  expect((await query("SELECT status,lastError FROM notificationOutbox WHERE type='payment-pending-email-v1'"))[0]).toMatchObject({status:'dead',lastError:'SUPPRESSED_AFTER_PAYMENT_CONFIRMATION'});
  expect((await query('SELECT stock FROM products'))[0].stock).toBe(9);expect(injected.mail).toHaveBeenCalledTimes(1);
 });
 it('commits notification intent before provider failure and recovers exactly once after worker restart',async()=>{
  const {result}=await buy();injected.mail.mockRejectedValueOnce(Error('synthetic uncertain result'));
  expect((await receiveWebhook(event(result.orderId),processWebhookEnvelope)).status).toBe(200);
  expect((await query('SELECT status FROM notificationOutbox WHERE type=\'payment-approved-email-v1\''))[0].status).toBe('failed');
  await query("UPDATE notificationOutbox SET nextAttemptAt=NOW() WHERE type='payment-approved-email-v1'");
  expect((await deliverPaymentNotifications()).sent).toBe(1);expect((await deliverPaymentNotifications()).sent).toBe(0);
  expect(injected.mail.mock.calls[0][0].idempotencyKey).toBe(injected.mail.mock.calls[1][0].idempotencyKey);
  expect((await query('SELECT stock FROM products'))[0].stock).toBe(9);
 });
 it('two workers claim once, expired ownership cannot finalize and old ambiguous claims dead-letter',async()=>{
  const {result}=await buy();injected.mail.mockRejectedValueOnce(Error('synthetic failure'));await receiveWebhook(event(result.orderId),processWebhookEnvelope);
  await query("UPDATE notificationOutbox SET nextAttemptAt=NOW() WHERE type='payment-approved-email-v1'");
  const r=await Promise.all([deliverPaymentNotifications(),deliverPaymentNotifications()]);expect(r.reduce((n,x)=>n+x.sent,0)).toBe(1);
  expect(injected.mail).toHaveBeenCalledTimes(2);
  await query("UPDATE notificationOutbox SET status='processing',leaseExpiresAt=DATE_SUB(NOW(),INTERVAL 1 SECOND),lockedAt=DATE_SUB(NOW(),INTERVAL 24 HOUR) WHERE type='payment-approved-email-v1'");
  await deliverPaymentNotifications();expect((await query('SELECT status FROM notificationOutbox WHERE type=\'payment-approved-email-v1\''))[0].status).toBe('dead');expect(injected.mail).toHaveBeenCalledTimes(2);
 });
 it('outbox lease fencing preserves a replacement owner after provider acceptance',async()=>{
  const {result}=await buy();injected.mail.mockRejectedValueOnce(Error('synthetic failure'));await receiveWebhook(event(result.orderId),processWebhookEnvelope);
  await query("UPDATE notificationOutbox SET nextAttemptAt=NOW() WHERE type='payment-approved-email-v1'");
  injected.mail.mockImplementationOnce(async()=>{await query("UPDATE notificationOutbox SET lockedBy='synthetic-replacement',leaseExpiresAt=DATE_ADD(NOW(),INTERVAL 1 MINUTE) WHERE type='payment-approved-email-v1'");return{id:'synthetic-late-acceptance'};});
  expect((await deliverPaymentNotifications()).sent).toBe(0);
  expect((await query('SELECT status,lockedBy FROM notificationOutbox WHERE type=\'payment-approved-email-v1\''))[0]).toMatchObject({status:'processing',lockedBy:'synthetic-replacement'});
 });
 it('recipient policy blocks dispatch without consuming a claim and malformed own payload dead-letters',async()=>{
  const {result}=await buy();injected.mail.mockRejectedValueOnce(Error('synthetic failure'));await receiveWebhook(event(result.orderId),processWebhookEnvelope);
  await query("UPDATE notificationOutbox SET nextAttemptAt=NOW() WHERE type='payment-approved-email-v1'");
  vi.stubEnv('APP_ENV','staging');vi.stubEnv('EMAIL_MODE','restricted');vi.stubEnv('STAGING_EMAIL_ALLOWLIST','another@example.invalid');
  expect((await deliverPaymentNotifications()).blocked).toBe(true);expect((await query('SELECT attempts FROM notificationOutbox WHERE type=\'payment-approved-email-v1\''))[0].attempts).toBe(1);
  await query("UPDATE notificationOutbox SET payload='malformed' WHERE type='payment-approved-email-v1'");await deliverPaymentNotifications();expect((await query('SELECT status FROM notificationOutbox WHERE type=\'payment-approved-email-v1\''))[0].status).toBe('dead');
 });
 it('concurrent webhook deliveries preserve one confirmation, payment and notification',async()=>{
  const {result}=await buy();const e=event(result.orderId);const replies=await Promise.all([receiveWebhook(e,processWebhookEnvelope),receiveWebhook(e,processWebhookEnvelope)]);
  expect(replies.some(r=>r.status===200)).toBe(true);expect(replies.every(r=>[200,503].includes(r.status))).toBe(true);
  await receiveWebhook(e,processWebhookEnvelope);expect((await query('SELECT stock FROM products'))[0].stock).toBe(9);
  expect(await query('SELECT * FROM notificationOutbox WHERE type=\'payment-approved-email-v1\'')).toHaveLength(1);expect(injected.mail).toHaveBeenCalledTimes(1);
 });
 it('normal checkout payment binding rejects a different provider payment without consuming stock',async()=>{
  const {result}=await buy();const e=event(result.orderId);e.payment.id='pay_wrong';expect((await receiveWebhook(e,processWebhookEnvelope)).status).not.toBe(200);
  expect((await query('SELECT stock FROM products'))[0].stock).toBe(10);expect(injected.mail).not.toHaveBeenCalled();
 });
 it('notification persistence failure rolls back stock, order and ledger; inbox can recover',async()=>{
  const {result}=await buy();await query("CREATE TRIGGER fixture_outbox_failure BEFORE INSERT ON notificationOutbox FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic'");
  const e=event(result.orderId);try{expect((await receiveWebhook(e,processWebhookEnvelope)).status).not.toBe(200);}finally{await query('DROP TRIGGER fixture_outbox_failure');}
  expect((await query('SELECT stock FROM products'))[0].stock).toBe(10);expect(await query('SELECT * FROM asaasWebhookEvents')).toHaveLength(0);
  expect((await receiveWebhook(e,processWebhookEnvelope)).status).toBe(200);
 });
 it('expired reservation, cancellation, refund and out-of-order notifications do not silently change finances',async()=>{
  const {result}=await buy();await query('UPDATE stockReservations SET expiresAt=DATE_SUB(NOW(),INTERVAL 1 MINUTE)');
  expect((await receiveWebhook(event(result.orderId),processWebhookEnvelope)).status).toBe(200);
  expect((await query('SELECT paymentStatus FROM orders'))[0].paymentStatus).toBe('unconfirmed');expect((await query('SELECT stock FROM products'))[0].stock).toBe(10);
  vi.mocked(getAsaasPayment).mockResolvedValueOnce({id:'pay_synthetic',externalReference:String(result.orderId),deleted:true,status:'OVERDUE',value:99});
  for(const type of ['PAYMENT_OVERDUE','PAYMENT_DELETED','PAYMENT_REFUNDED'])expect((await receiveWebhook(event(result.orderId,type),processWebhookEnvelope)).status).toBe(200);
  expect((await query('SELECT stock FROM products'))[0].stock).toBe(10);expect(injected.mail).not.toHaveBeenCalled();
 });
 it('known viewing events are durably observed; unknown events remain rejected',async()=>{
  const {result}=await buy();for(const type of ['PAYMENT_BANK_SLIP_VIEWED','PAYMENT_CHECKOUT_VIEWED'])expect((await receiveWebhook(event(result.orderId,type),processWebhookEnvelope)).status).toBe(200);
  expect((await receiveWebhook(event(result.orderId,'UNSUPPORTED_SYNTHETIC'),processWebhookEnvelope)).status).toBe(422);
  expect((await query('SELECT stock FROM products'))[0].stock).toBe(10);expect(injected.mail).not.toHaveBeenCalled();
 });
 it('recovers a persisted webhook without a new HTTP delivery and rejects unauthorized HTTP before persistence',async()=>{
  const {result}=await buy();await persistWebhook(event(result.orderId));expect((await recoverWebhooks(processWebhookEnvelope)).completed).toBe(1);
  const response:any={status:vi.fn(function(this:any){return this;}),json:vi.fn()};
  await asaasWebhookHandler({body:event(result.orderId),headers:{},ip:'synthetic'} as any,response);
  expect(response.status).toHaveBeenCalledWith(401);expect(await query('SELECT * FROM asaasWebhookInbox')).toHaveLength(1);
 });
});
