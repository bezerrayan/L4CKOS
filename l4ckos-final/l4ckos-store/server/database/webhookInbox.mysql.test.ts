import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { createServer } from 'node:http';
import express from 'express';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { createPool, type Pool, type Connection } from 'mysql2/promise';
import type * as mysqlOrm from 'drizzle-orm/mysql2';
import { openBackupConnection, backupDatabase, restoreDatabase } from './backupRestore';
import { inWebhookTransaction } from './webhookTransaction';
import { bootstrapReleaseDatabase } from '../../database/bootstrap/bootstrap';
import { readReleaseContract, ROOT } from '../../database/schema/artifacts';
import { readReleaseManifest, migrateDatabase } from '../../database/migrations/runner';
import { rows, quote, structuralHash, readStructuralSchema } from '../../database/schema/fingerprint';
import { persistWebhook, processStoredWebhook, receiveWebhook, recoverWebhooks, financialEnvelope, startWebhookRecovery } from '../payments/webhookInbox';
import { processWebhookEnvelope, asaasWebhookHandler } from '../controllers/paymentController';
import { createStagingMaintenanceMiddleware } from '../_core/stagingMaintenance';
import webhookRoutes from '../routes/webhookRoutes';
import { TARGET } from '../../database/staging0022/policy';
import { sql } from 'drizzle-orm';
const injected = vi.hoisted(() => ({ orm: null as unknown }));
vi.mock('drizzle-orm/mysql2', async original => ({ ...await original<typeof mysqlOrm>(), drizzle: () => injected.orm }));
vi.mock('../services/emailService.js', () => ({
  sendPaymentApprovedEmail: vi.fn(async()=>{}), sendInternalNewSaleAlertEmail: vi.fn(async()=>{}),
  sendInternalLowStockAlertEmail: vi.fn(async()=>{}), sendPaymentFailedEmail: vi.fn(async()=>{}), sendInternalPaymentFailedAlertEmail: vi.fn(async()=>{}),
}));
vi.mock('../services/asaasService', () => ({
  validateAsaasWebhookSignature: (headers: Record<string, unknown>) => headers['asaas-access-token'] === 'synthetic-token',
  getAsaasPayment: vi.fn(async()=> { throw Error('OFFLINE_PROVIDER'); }),
  createAsaasCheckout: vi.fn(()=> { throw Error('FORBIDDEN_EXTERNAL_CHARGE'); }),
  createAsaasCustomer: vi.fn(()=> { throw Error('FORBIDDEN_EXTERNAL_CUSTOMER'); }),
}));
const socketPath = process.env.L4CKOS_LOCAL_MYSQL_SOCKET ?? '/tmp/l4ckos-0022-socket/mysqld.sock';
const name = 'l4ckos_test_inbox_' + randomUUID().replaceAll('-', '').slice(0,12);
let root: Connection, c: Connection, pool: Pool;
const event = (id = randomUUID(), type = 'PAYMENT_RECEIVED') => ({ id, event: type,
  payment: { id: 'synthetic-payment', externalReference: '901', status: type === 'PAYMENT_DELETED' ? 'DELETED' : type === 'PAYMENT_REFUNDED' ? 'REFUNDED' : 'RECEIVED', value: 100, currency: 'BRL' } });
async function state(id: string) { return (await rows(c, 'SELECT * FROM asaasWebhookInbox WHERE eventId=?', [id]))[0]; }
async function paid() { return (await rows(c, 'SELECT status,paymentStatus FROM orders WHERE id=901'))[0]; }
async function stock() { return Number((await rows(c,'SELECT stock FROM products WHERE id=901'))[0].stock); }
const maintenance = () => {
  for(const [key,value] of Object.entries({ NODE_ENV:'production', STAGING_MAINTENANCE_MODE:'true', RAILWAY_PROJECT_ID:TARGET.projectId,
    RAILWAY_ENVIRONMENT_ID:TARGET.environmentId, RAILWAY_SERVICE_ID:TARGET.serviceId })) vi.stubEnv(key,value);
};
describe('financial inbox envelope', () => {
  it('strips customer/headers/secrets and requires the unique provider event ID', () => {
    const payload = { ...event(), customer:{email:'private@example.invalid'}, token:'private', payment:{...event().payment,customer:'private',creditCard:{number:'private'}} };
    const result = JSON.stringify(financialEnvelope(payload));
    expect(result).not.toContain('private'); expect(result).not.toContain('creditCard');
    expect(()=>financialEnvelope({event:'PAYMENT_RECEIVED',payment:{id:'same-payment'}})).toThrow('WEBHOOK_EVENT_ID_REQUIRED');
  });
  it.each(['NaN', '-1', 'Infinity', ''])('rejects invalid money %s before durable admission',value=> {
    expect(()=>financialEnvelope({...event(),payment:{...event().payment,value}})).toThrow();
  });
});
describe.skipIf(process.env.L4CKOS_MYSQL_TEST !== '1')('MySQL durable financial inbox 0023', () => {
  beforeAll(async()=>{
    process.env.L4CKOS_LOCAL_SCHEMA='1'; process.env.L4CKOS_LOCAL_RESTORE='1';
    root=await openBackupConnection('mysql://root@localhost/mysql',socketPath);
    await root.query(`CREATE DATABASE ${quote(name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    c=await openBackupConnection(`mysql://root@localhost/${name}`,socketPath);
    await bootstrapReleaseDatabase(c,{url:`mysql://root@localhost/${name}`,socketPath,applicationCommit:'a'.repeat(40),approvedFingerprint:(await readReleaseContract()).fingerprint});
    const actual=await vi.importActual<typeof mysqlOrm>('drizzle-orm/mysql2');
    pool=createPool({user:'root',socketPath,database:name,connectionLimit:5}); injected.orm=actual.drizzle(pool);
    vi.stubEnv('DATABASE_URL','synthetic-present');
  });
  beforeEach(async()=>{
    vi.unstubAllEnvs(); vi.stubEnv('DATABASE_URL','synthetic-present');
    for(const table of ['asaasWebhookInbox','asaasWebhookEvents','auditLogs','stockReservations','orderItems','orders','products','users'])await c.query(`DELETE FROM ${quote(table)}`);
    await c.query("INSERT INTO users (id,openId,name) VALUES (901,'inbox-synthetic','Synthetic')");
    await c.query("INSERT INTO products (id,name,category,price,stock) VALUES (901,'Synthetic','fixture',10000,5)");
    await c.query("INSERT INTO orders (id,userId,totalPrice) VALUES (901,901,10000)");
    await c.query("INSERT INTO orderItems (id,orderId,productId,productName,unitPrice,quantity,totalPrice) VALUES (901,901,901,'Synthetic',10000,1,10000)");
    await c.query("INSERT INTO stockReservations (userId,orderId,orderItemId,productId,quantity,status,expiresAt) VALUES (901,901,901,901,1,'active',DATE_ADD(NOW(),INTERVAL 1 HOUR))");
  });
  afterAll(async()=>{vi.unstubAllEnvs();await pool?.end();await c?.end();if(root){await root.query(`DROP DATABASE ${quote(name)}`);await root.end();}});
  it('migrates 0023 once with fingerprint, history and no replay DDL',async()=>{
    expect(structuralHash(await readStructuralSchema(c))).toBe((await readReleaseContract()).fingerprint);
    expect((await migrateDatabase(c,{url:`mysql://root@localhost/${name}`,socketPath,applicationCommit:'a'.repeat(40),approvedFingerprint:(await readReleaseContract()).fingerprint},await readReleaseManifest())).status).toBe('UP_TO_DATE');
  });
  it('acknowledges successful duplicates without financial or reservation replay',async()=>{
    const e=event();expect((await receiveWebhook(e,processWebhookEnvelope)).status).toBe(200);
    expect((await receiveWebhook(e,processWebhookEnvelope)).status).toBe(200);
    expect(await paid()).toMatchObject({status:'paid',paymentStatus:'confirmed'});expect(await stock()).toBe(4);
    expect((await state(e.id)).state).toBe('processed');expect(Number((await state(e.id)).attempts)).toBe(1);
  });
  it('recovers duplicate failed delivery instead of acknowledging a failed ledger marker',async()=>{
    const e=event();let calls=0;
    const process=async(p:unknown)=>{calls++;if(calls===1)throw Error('synthetic failure');return processWebhookEnvelope(p);};
    expect((await receiveWebhook(e,process)).status).toBe(503);expect((await state(e.id)).state).toBe('failed');
    expect((await receiveWebhook(e,process)).status).toBe(200);expect(calls).toBe(2);expect(await stock()).toBe(4);
  });
  it.each(['failed','processing'])('recovers historical %s ledger from authenticated redelivery',async status=>{
    const e=event();const hash=createHash('sha256').update(JSON.stringify(e)).digest('hex');
    await c.query('INSERT INTO asaasWebhookEvents (eventId,eventType,paymentId,orderId,payloadHash,status) VALUES (?,?,?,?,?,?)',[e.id,e.event,e.payment.id,901,hash,status]);
    expect((await recoverWebhooks(processWebhookEnvelope)).legacyNeedsPayload).toBe(1);
    expect((await receiveWebhook(e,processWebhookEnvelope)).status).toBe(200);expect(await stock()).toBe(4);
    expect((await rows(c,'SELECT status FROM asaasWebhookEvents WHERE eventId=?',[e.id]))[0].status).toBe('processed');
  });
  it('processes an orphan processing inbox after recovery',async()=>{
    const e=event();await persistWebhook(e);await c.query("UPDATE asaasWebhookInbox SET state='processing' WHERE eventId=?",[e.id]);
    expect((await recoverWebhooks(processWebhookEnvelope)).completed).toBe(1);expect(await stock()).toBe(4);
  });
  it('does not ACK when persistence fails',async()=>{
    await c.query("CREATE TRIGGER fixture_inbox_fail BEFORE INSERT ON asaasWebhookInbox FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic failure'");
    try{expect((await receiveWebhook(event(),processWebhookEnvelope)).status).toBe(503);expect(await stock()).toBe(5);}
    finally{await c.query('DROP TRIGGER fixture_inbox_fail');}
  });
  it('recovers persisted receipt after response/process interruption without any redelivery',async()=>{
    const e=event();await persistWebhook(e);expect((await state(e.id)).state).toBe('received');
    expect((await recoverWebhooks(processWebhookEnvelope)).completed).toBe(1);expect(await stock()).toBe(4);
  });
  it('rolls back partial business effects and ledger together, then recovers once',async()=>{
    const e=event();await persistWebhook(e);
    expect((await processStoredWebhook(e.id,async p=>{await processWebhookEnvelope(p);throw Error('after financial rule');})).status).toBe(503);
    expect(await stock()).toBe(5);expect(await paid()).toMatchObject({status:'pending',paymentStatus:'unconfirmed'});
    expect(Number((await rows(c,'SELECT COUNT(*) n FROM asaasWebhookEvents'))[0].n)).toBe(0);
    expect((await processStoredWebhook(e.id,processWebhookEnvelope)).status).toBe(200);expect(await stock()).toBe(4);
  });
  it('survives real process exit after a financial mutation and recovers pending payload',async()=>{
    const e=event();await persistWebhook(e);const dir=await mkdtemp('/tmp/l4ckos-inbox-crash-');const file=dir+'/crash.ts';
    await writeFile(file,`import mysql from ${JSON.stringify(ROOT+'node_modules/mysql2/promise.js')};\nimport {drizzle} from ${JSON.stringify(ROOT+'node_modules/drizzle-orm/mysql2/index.js')};\nimport {inWebhookTransaction} from ${JSON.stringify(ROOT+'server/database/webhookTransaction.ts')};\nimport {processStoredWebhook} from ${JSON.stringify(ROOT+'server/payments/webhookInbox.ts')};\nimport {markOrderPaid} from ${JSON.stringify(ROOT+'server/db.ts')};\n(async()=>{const pool=mysql.createPool(${JSON.stringify({user:'root',socketPath,database:name})});await inWebhookTransaction(drizzle(pool),()=>processStoredWebhook(${JSON.stringify(e.id)},async()=>{await markOrderPaid(901,{source:'asaas_webhook',reference:${JSON.stringify(e.id)}});process.exit(7);}),[]);})();`,{mode:0o600});
    const child=spawnSync(process.execPath,[ROOT+'node_modules/tsx/dist/cli.mjs',file],{env:{PATH:process.env.PATH,NODE_ENV:'test'},encoding:'utf8',timeout:15000});
    expect(child.status,child.stderr).toBe(7);expect(await stock()).toBe(5);
    expect((await recoverWebhooks(processWebhookEnvelope)).completed).toBe(1);expect(await stock()).toBe(4);
  });
  it('two concurrent deliveries serialize or return non-ACK busy; business executes once',async()=>{
    const e=event();let entered!:()=>void,release!:()=>void;
    const ready=new Promise<void>(r=>entered=r),hold=new Promise<void>(r=>release=r);let calls=0;
    const first=receiveWebhook(e,async p=>{calls++;entered();await hold;return processWebhookEnvelope(p);});await ready;
    const second=await receiveWebhook(e,async p=>{calls++;return processWebhookEnvelope(p);});expect(second.status).toBe(503);
    release();expect((await first).status).toBe(200);expect(calls).toBe(1);expect(await stock()).toBe(4);
  });
  it('same event ID with conflicting content is rejected without touching paid state',async()=>{
    const e=event();await receiveWebhook(e,processWebhookEnvelope);
    expect((await receiveWebhook({...e,payment:{...e.payment,value:1}},processWebhookEnvelope)).status).toBe(409);expect(await stock()).toBe(4);
  });
  it('payment racing cancellation cannot consume released reservations or reactivate order',async()=>{
    const e=event();await c.beginTransaction();await c.query('SELECT id FROM orders WHERE id=901 FOR UPDATE');
    const processing=receiveWebhook(e,processWebhookEnvelope);
    await c.query("UPDATE orders SET status='cancelled' WHERE id=901");await c.query("UPDATE stockReservations SET status='released' WHERE orderId=901");await c.commit();
    expect((await processing).status).toBe(200);expect((await paid()).status).toBe('cancelled');expect(await stock()).toBe(5);
    expect(Number((await rows(c,"SELECT COUNT(*) n FROM auditLogs WHERE action='payment.reconciliation_required'"))[0].n)).toBe(1);
  });
  it('out of order received/deleted/refunded only records reconciliation after payment',async()=>{
    await receiveWebhook(event(),processWebhookEnvelope);
    for(const type of ['PAYMENT_DELETED','PAYMENT_REFUNDED','PAYMENT_RECEIVED'])expect((await receiveWebhook(event(randomUUID(),type),processWebhookEnvelope)).status).toBe(200);
    expect(await stock()).toBe(4);expect(await paid()).toMatchObject({status:'paid',paymentStatus:'confirmed'});
  });
  it('permanent validation rejection is retained, non-ACK and excluded from retries',async()=>{
    const e=event();expect((await receiveWebhook({...e,payment:{...e.payment,value:1}},processWebhookEnvelope)).status).toBe(409);
    expect((await state(e.id)).state).toBe('rejected');expect((await recoverWebhooks(processWebhookEnvelope)).examined).toBe(0);expect(await stock()).toBe(5);
  });
  it('maintenance blocks both aliases without persistence and resumes pending receipts',async()=>{
    const e=event();await persistWebhook(e);maintenance();
    const app=express();app.use(express.json());app.use(createStagingMaintenanceMiddleware());app.post('/webhook/asaas',asaasWebhookHandler);app.use('/api/webhooks',webhookRoutes);
    const server=createServer(app);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
    try {const base=`http://127.0.0.1:${(server.address() as any).port}`;
      for(const alias of ['/webhook/asaas','/api/webhooks/asaas'])expect((await fetch(base+alias,{method:'POST',headers:{'content-type':'application/json','asaas-access-token':'synthetic-token'},body:JSON.stringify(event())})).status).toBe(503);
      expect((await recoverWebhooks(processWebhookEnvelope)).examined).toBe(0);expect(await stock()).toBe(5);
    }finally{await new Promise<void>(r=>server.close(()=>r()));vi.unstubAllEnvs();vi.stubEnv('DATABASE_URL','synthetic-present');}
    expect((await recoverWebhooks(processWebhookEnvelope)).completed).toBe(1);expect(await stock()).toBe(4);
  });
  it('both aliases require authentication and share durable idempotency',async()=>{
    const app=express();app.use(express.json());app.post('/webhook/asaas',asaasWebhookHandler);app.use('/api/webhooks',webhookRoutes);
    const server=createServer(app);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const e=event();
    try{const base=`http://127.0.0.1:${(server.address() as any).port}`;
      for(const alias of ['/webhook/asaas','/api/webhooks/asaas']) {
        expect((await fetch(base+alias,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(e)})).status).toBe(401);
        expect((await fetch(base+alias,{method:'POST',headers:{'content-type':'application/json','asaas-access-token':'synthetic-token'},body:JSON.stringify(e)})).status).toBe(200);
      }
      expect(await stock()).toBe(4);expect(Number((await rows(c,'SELECT COUNT(*) n FROM asaasWebhookInbox'))[0].n)).toBe(1);
    }finally{await new Promise<void>(r=>server.close(()=>r()));}
  });
  it('backup/restore preserves pending minimal envelope and independently resumes on restored DB',async()=>{
    const e=event();await persistWebhook(e);const artifact=await backupDatabase(c);
    expect(artifact.tables.asaasWebhookInbox.rowCount).toBe(1);
    const destination=name+'_restore';await root.query(`CREATE DATABASE ${quote(destination)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    const restored=await openBackupConnection(`mysql://root@localhost/${destination}`,socketPath);
    try {
      await bootstrapReleaseDatabase(restored,{url:`mysql://root@localhost/${destination}`,socketPath,applicationCommit:"a".repeat(40),approvedFingerprint:(await readReleaseContract()).fingerprint});
      await restoreDatabase(restored,artifact,{url:`mysql://root@localhost/${destination}`,socketPath});
      const actual=await vi.importActual<typeof mysqlOrm>('drizzle-orm/mysql2');
      expect((await inWebhookTransaction(actual.drizzle(restored),()=>recoverWebhooks(processWebhookEnvelope),[])).completed).toBe(1);
      expect((await rows(restored,'SELECT state FROM asaasWebhookInbox WHERE eventId=?',[e.id]))[0].state).toBe('processed');
      expect(Number((await rows(restored,'SELECT stock FROM products WHERE id=901'))[0].stock)).toBe(4);
      expect(await stock()).toBe(5);
    }finally{await restored.end();await root.query(`DROP DATABASE ${quote(destination)}`);}
  });
  it('startup recovery drains received without HTTP redelivery or provider calls',async()=>{
    const e=event();await persistWebhook(e);const stop=startWebhookRecovery(processWebhookEnvelope);
    try{await vi.waitFor(async()=>{expect((await state(e.id)).state).toBe('processed');});expect(await stock()).toBe(4);}
    finally{stop();}
    const service=await import('../services/asaasService');expect(service.createAsaasCheckout).not.toHaveBeenCalled();
    expect(service.createAsaasCustomer).not.toHaveBeenCalled();
  });
  it('legacy hash conflict is a durable rejection, never retried as a payment',async()=>{
    const e=event();await c.query("INSERT INTO asaasWebhookEvents (eventId,eventType,paymentId,orderId,payloadHash,status) VALUES (?,?,?,?,?,'failed')",[e.id,e.event,e.payment.id,901,'a'.repeat(64)]);
    expect((await receiveWebhook(e,processWebhookEnvelope)).status).toBe(409);expect((await state(e.id)).state).toBe('rejected');
    expect((await recoverWebhooks(processWebhookEnvelope)).examined).toBe(0);expect(await stock()).toBe(5);
  });
  it('legacy case-insensitive unique key never ACKs a different provider event ID',async()=>{
    const first=event('evt-case-synthetic'),other={...first,id:'EVT-CASE-SYNTHETIC'};
    expect((await receiveWebhook(first,processWebhookEnvelope)).status).toBe(200);
    expect((await receiveWebhook(other,processWebhookEnvelope)).status).toBe(409);
    expect((await state(other.id)).state).toBe('rejected');expect(await stock()).toBe(4);
  });
  it('retains failed envelopes indefinitely, erases terminal payload after 30 days and keeps replay identity',async()=>{
    const done=event(),pending=event();await receiveWebhook(done,processWebhookEnvelope);await persistWebhook(pending);
    await c.query("UPDATE asaasWebhookInbox SET completedAt=DATE_SUB(NOW(),INTERVAL 31 DAY) WHERE eventId=?",[done.id]);
    await c.query("UPDATE asaasWebhookInbox SET state='failed',createdAt=DATE_SUB(NOW(),INTERVAL 31 DAY),nextAttemptAt=DATE_ADD(NOW(),INTERVAL 1 DAY) WHERE eventId=?",[pending.id]);
    await recoverWebhooks(processWebhookEnvelope);expect((await state(done.id)).payload).toBe(null);expect((await state(pending.id)).payload).not.toBe(null);
    expect((await receiveWebhook(done,processWebhookEnvelope)).status).toBe(200);
  });
});
