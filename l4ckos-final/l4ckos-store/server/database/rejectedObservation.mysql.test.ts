import {beforeAll,beforeEach,afterAll,describe,it,expect,vi} from 'vitest';
import {createConnection,createPool} from 'mysql2/promise';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {canonical} from '../../database/schema/fingerprint';
const injected=vi.hoisted(()=>({orm:null as any}));
vi.mock('../db',()=>({getDb:async()=>injected.orm,isDuplicateKeyError:(e:any)=>e?.code==='ER_DUP_ENTRY'||e?.cause?.code==='ER_DUP_ENTRY'}));
vi.mock('../services/emailService.js',()=>({}));
vi.mock('../_core/security',()=>({securityLog:vi.fn()}));
import {financialEnvelope,receiveWebhook,processStoredWebhook} from '../payments/webhookInbox';
import {deliverPaymentNotifications} from '../payments/paymentNotificationOutbox';
import {asaasWebhookHandler} from '../controllers/paymentController';
const socket=process.env.L4CKOS_LOCAL_MYSQL_SOCKET??'';
const database='l4ckos_test_redelivery_'+randomUUID().replaceAll('-','').slice(0,12);
let root:any,c:any,pool:any;
const query=async(q:string,args:unknown[]=[]) => (await c.query(q,args))[0];
const payload=(event='PAYMENT_CREATED')=>({id:'evt_synthetic',event,payment:{id:'pay_synthetic',externalReference:'901',status:event==='PAYMENT_RECEIVED'?'RECEIVED':'PENDING',value:99,currency:'BRL'}});
async function seed(event=payload(),state='rejected'){
 const minimal=financialEnvelope(event),content={...minimal} as any;delete content.sourcePayloadHash;
 await query('INSERT INTO asaasWebhookInbox(eventId,payload,payloadHash,state,attempts,errorCode,completedAt) VALUES(?,?,?,?,3,?,NOW())',
 [minimal.id,JSON.stringify(minimal),createHash('sha256').update(canonical(content)).digest('hex'),state,'WEBHOOK_VALIDATION_REJECTED']);
}
async function send(body:any,token:unknown='synthetic-token'){
 let status=0,data:any;
 const res={status(code:number){status=code;return this;},json(value:any){data=value;return this;}};
 await asaasWebhookHandler({body,headers:token===undefined?{}:{'asaas-access-token':token},ip:'offline'} as any,res as any);
 return {status,data};
}
describe.skipIf(!socket)('rejected observation redelivery on isolated local MySQL',()=>{
beforeAll(async()=>{
 if(!/^\/tmp\/l4ckos-[a-z0-9-]+\/mysqld.sock$/.test(socket))throw Error('LOCAL_SOCKET_REQUIRED');
 root=await createConnection({socketPath:socket,user:'root'});await root.query('CREATE DATABASE '+database);
 c=await createConnection({socketPath:socket,user:'root',database,dateStrings:true});
 await query('CREATE TABLE orders(id INT PRIMARY KEY,totalPrice INT,paymentStatus VARCHAR(30)) ENGINE=InnoDB');
 await query('CREATE TABLE payments(orderId INT PRIMARY KEY,providerPaymentId VARCHAR(191),externalReference VARCHAR(191),amount INT,status VARCHAR(30)) ENGINE=InnoDB');
 await query("CREATE TABLE notificationOutbox(id INT AUTO_INCREMENT PRIMARY KEY,dedupeKey VARCHAR(191),type VARCHAR(80),orderId INT,payload TEXT,status VARCHAR(30) DEFAULT 'pending',attempts INT DEFAULT 0,lastError TEXT,nextAttemptAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,lockedAt TIMESTAMP NULL,leaseExpiresAt TIMESTAMP NULL,lockedBy VARCHAR(191),sentAt TIMESTAMP NULL) ENGINE=InnoDB");
 await query(readFileSync('database/migrations/0023_asaas_webhook_inbox.sql','utf8'));
 await query(readFileSync('database/bootstrap/v1/auditLogs.sql','utf8'));
 pool=createPool({socketPath:socket,user:'root',database,connectionLimit:4});
 const {drizzle}=await import('drizzle-orm/mysql2');injected.orm=drizzle(pool);
 vi.stubEnv('ASAAS_WEBHOOK_TOKEN','synthetic-token');
});
beforeEach(async()=>{
 await query('DROP TRIGGER IF EXISTS reject_audit');
 for(const table of ['asaasWebhookInbox','auditLogs','notificationOutbox','payments','orders'])await query('DELETE FROM '+table);
 await query("INSERT INTO orders VALUES(901,9900,'unconfirmed')");
});
afterAll(async()=>{vi.unstubAllEnvs();await pool?.end();await c?.end();if(root){await root.query('DROP DATABASE '+database);await root.end();}});
it('unauthenticated deliveries never persist or acknowledge',async()=>{
 expect((await send(payload(),'wrong')).status).toBe(401);
 expect((await send(payload(),['synthetic-token'])).status).toBe(401);
 expect((await query('SELECT COUNT(*) n FROM asaasWebhookInbox'))[0].n).toBe(0);
});
for(const event of ['PAYMENT_CREATED','PAYMENT_UPDATED','PAYMENT_RESTORED'])it(`safe rejected ${event} is audited once and original rejection remains immutable`,async()=>{
 const body=payload(event);await seed(body);
 const before=await query('SELECT * FROM asaasWebhookInbox');
 expect((await send(body)).status).toBe(200);expect((await send(body)).status).toBe(200);
 expect(await query('SELECT * FROM asaasWebhookInbox')).toEqual(before);
 const audits=await query('SELECT action,metadata FROM auditLogs');expect(audits).toHaveLength(1);
 expect(JSON.parse(audits[0].metadata)).toMatchObject({originalState:'rejected',reconciliationRequired:true,financialMutation:false,reservationMutation:false,notificationMutation:false});
 expect((await query('SELECT paymentStatus FROM orders'))[0].paymentStatus).toBe('unconfirmed');
 expect(await query('SELECT * FROM payments')).toHaveLength(0);
});
it('preserves an ampersand event ID and audits historical PENDING without payment effects',async()=>{
 const body={...payload(),id:'evt_05b708f961d739ea7eba7e4db318f621&21683762'};
 await seed(body);const before=await query('SELECT * FROM asaasWebhookInbox');
 expect(financialEnvelope(body).id).toBe(body.id);
 expect((await send(body,'wrong')).status).toBe(401);
 expect((await send(body)).status).toBe(200);expect((await send(body)).status).toBe(200);
 expect(await query('SELECT * FROM asaasWebhookInbox')).toEqual(before);
 const audits=await query('SELECT entityId,metadata FROM auditLogs');expect(audits).toHaveLength(1);
 expect(audits[0].entityId).toBe(createHash('sha256').update(body.id).digest('hex'));
 expect(JSON.parse(audits[0].metadata)).toMatchObject({eventId:body.id,reason:'HISTORICAL_PAYMENT_BINDING_REQUIRES_REVIEW',reconciliationRequired:true,financialMutation:false});
 expect(await query('SELECT * FROM payments')).toHaveLength(0);
 expect(await query('SELECT * FROM notificationOutbox')).toHaveLength(0);
 expect((await query('SELECT paymentStatus FROM orders'))[0].paymentStatus).toBe('unconfirmed');
 expect((await send({...body,payment:{...body.payment,status:'RECEIVED'}})).status).toBe(409);
 expect(await query('SELECT * FROM asaasWebhookInbox')).toEqual(before);
});
it('already processed duplicate never invokes processor',async()=>{
 const body=payload('PAYMENT_RECEIVED');await seed(body,'processed');const processor=vi.fn();
 expect((await receiveWebhook(body,processor)).status).toBe(200);expect(processor).not.toHaveBeenCalled();
});
it.each(['PAYMENT_RECEIVED','PAYMENT_UNKNOWN'])('terminal %s remains 422 without processor replay',async event=>{
 await seed(payload(event));const processor=vi.fn();expect((await processStoredWebhook('evt_synthetic',processor)).status).toBe(422);
 expect(processor).not.toHaveBeenCalled();expect(await query('SELECT * FROM auditLogs')).toHaveLength(0);
});
it('conflicting content is 409 before acknowledgement',async()=>{
 await seed();expect((await send({...payload(),payment:{...payload().payment,value:100}})).status).toBe(409);
 expect(await query('SELECT * FROM auditLogs')).toHaveLength(0);
});
it('amount or binding mismatch never becomes 200',async()=>{
 await seed();await query('UPDATE orders SET totalPrice=10000');expect((await send(payload())).status).toBe(422);
 await query('UPDATE orders SET totalPrice=9900');await query("INSERT INTO payments VALUES(901,'different','901',9900,'pending')");
 expect((await send(payload())).status).toBe(422);expect(await query('SELECT * FROM auditLogs')).toHaveLength(0);
});
it('audit failure is 503 and never acknowledges a non-durable decision',async()=>{
 await seed();await query("CREATE TRIGGER reject_audit BEFORE INSERT ON auditLogs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic audit failure'");
 expect((await send(payload())).status).toBe(503);expect(await query('SELECT * FROM auditLogs')).toHaveLength(0);
 expect((await query('SELECT state FROM asaasWebhookInbox'))[0].state).toBe('rejected');
});
it('concurrent redelivery serializes audit and permits retry after busy',async()=>{
 await seed();const results=await Promise.all([send(payload()),send(payload())]);
 expect(results.some(r=>r.status===200)).toBe(true);expect(results.every(r=>[200,503].includes(r.status))).toBe(true);
 expect((await send(payload())).status).toBe(200);expect(await query('SELECT * FROM auditLogs')).toHaveLength(1);
});

it('new worker leaves both legacy payment-approved notifications untouched',async()=>{
 await query("INSERT INTO notificationOutbox(dedupeKey,type,orderId,status) VALUES('legacy-1','payment-approved',901,'pending'),('legacy-2','payment-approved',901,'pending')");
 const before=await query('SELECT * FROM notificationOutbox ORDER BY id');
 expect(await deliverPaymentNotifications()).toMatchObject({sent:0,blocked:false});
 expect(await query('SELECT * FROM notificationOutbox ORDER BY id')).toEqual(before);
});

it('unrecognized rejection reason never receives an automatic acknowledgement',async()=>{
 await seed();await query("UPDATE asaasWebhookInbox SET errorCode='MANUAL_REVIEW_HOLD'");
 expect((await send(payload())).status).toBe(422);expect(await query('SELECT * FROM auditLogs')).toHaveLength(0);
});

});
