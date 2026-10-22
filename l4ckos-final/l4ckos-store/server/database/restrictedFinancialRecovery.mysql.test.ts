import { afterEach, afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createConnection, type Connection } from "mysql2/promise";
import { captureSnapshot, query as readRows } from "../../database/financialRecovery/evidence";
import { runRecovery, RecoveryIncident, type Runtime, readDatabaseIdentity } from "../../database/financialRecovery/operator";
import { TARGET, digest, assertEnvironment, assertDatabaseIdentity, type RecoveryRequest, type Checkpoint, type FinancialReceipt } from "../../database/financialRecovery/policy";
import { structuralHash, readStructuralSchema } from "../../database/schema/fingerprint";

const socketPath=process.env.L4CKOS_LOCAL_MYSQL_SOCKET??"/tmp/l4ckos-0022-socket/mysqld.sock";
const database="l4ckos_test_recovery_"+randomUUID().replaceAll("-","").slice(0,12);
let root:Connection,connection:Connection,runtime:Runtime;
const query=async(sql:string,values:unknown[]=[])=>readRows(connection,sql,values);
const artifactHash="a".repeat(64);
const env=()=>({RAILWAY_PROJECT_ID:TARGET.projectId,RAILWAY_ENVIRONMENT_ID:TARGET.environmentId,
  RAILWAY_SERVICE_ID:TARGET.serviceId,RAILWAY_DEPLOYMENT_ID:TARGET.deploymentId,
  RAILWAY_ENVIRONMENT_NAME:'production',RAILWAY_PUBLIC_DOMAIN:'isolated-staging.up.railway.app',
  ASAAS_API_URL:'https://api-sandbox.asaas.com/v3',ASAAS_CHECKOUT_BASE_URL:'https://sandbox.asaas.com',
  ASAAS_API_KEY:'$aact_hmlg_synthetic',DATABASE_URL:'mysql://fixture:synthetic@mysql.railway.internal:3306/l4ckos_staging'});
const provider=()=>({id:TARGET.paymentId,externalReference:'13',status:'RECEIVED',billingType:'PIX',value:99,netValue:98.01,deleted:false,
  confirmedDate:'2026-10-11',paymentDate:'2026-10-11',clientPaymentDate:'2026-10-11'});
let providerBody:Record<string,any>,refundsBody:Record<string,any>;
async function openLocal() {
  if(!/^\/tmp\/l4ckos-[a-z0-9-]+\/mysqld\.sock$/.test(socketPath) || !/^l4ckos_test_recovery_[a-f0-9]{12}$/.test(database)) throw Error('LOCAL_FIXTURE_REQUIRED');
  const c=await createConnection({user:'root',socketPath,database,dateStrings:true,timezone:'Z',multipleStatements:false});
  await c.query("SET SESSION time_zone='+00:00'");await c.query('SET SESSION innodb_lock_wait_timeout=2');return c;
}
const run=(r:unknown)=>runRecovery(r,runtime);
async function dry(operation:'financial-b'|'created'='financial-b',financialReceipt?:FinancialReceipt) {
  const v=await run({operation,financialReceipt});if(v.status!=='dry-run')throw Error('DRY_RUN_REQUIRED');return v.checkpoint;
}
function execute(checkpoint:Checkpoint,financialReceipt?:FinancialReceipt):RecoveryRequest {
  return {operation:checkpoint.operation,mode:'execute',checkpoint,financialReceipt,approval:{operation:checkpoint.operation,
    projectId:TARGET.projectId,environmentId:TARGET.environmentId,serviceId:TARGET.serviceId,deploymentId:TARGET.deploymentId,
    artifactHash,checkpointHash:digest(checkpoint),reference:checkpoint.operation==='financial-b'?'LOCAL_APPROVAL_FIN13':'LOCAL_APPROVAL_CRT13',
    actorUserId:14,justification:'Synthetic supervised exception: expired reservation and unknown receipt time',
    validFrom:new Date(Date.now()-1000).toISOString(),validUntil:new Date(Date.now()+60000).toISOString(),
    confirmation:'AUTHORIZE_ONE_STAGING_OPERATION_ONLY',expiredReservationException:checkpoint.operation==='financial-b',unknownFinancialReceiptTime:checkpoint.operation==='financial-b',
    createdRetryMayAck:checkpoint.operation==='created',pendingNotificationIntent:checkpoint.operation==='financial-b'?'create-one-order13':'preserve-all',
    notificationDispatch:false,queueResume:false,writersQuiesced:true,dispatchersQuiesced:true,backupRestoreReference:'LOCAL_RESTORE_PROVEN',
    financialReceiptHash:financialReceipt?digest(financialReceipt):null}};
}
async function completeB() {const checkpoint=await dry();const request=execute(checkpoint);const value=await run(request);
  if(!value.financialReceipt)throw Error('FINANCIAL_RECEIPT_REQUIRED');return {checkpoint,request,value,receipt:value.financialReceipt};}
let historicalBefore:string;
async function historical(){return (await captureSnapshot(connection)).historicalHash;}
describe.skipIf(process.env.L4CKOS_MYSQL_TEST!=="1")('Restricted staging recovery operator with real isolated MySQL v4 and simulated Railway/provider',()=>{
  beforeAll(async()=>{
    // Local socket only; fresh schema fixtures, no migration runner or remote database.
    if (!/^\/tmp\/l4ckos-[a-z0-9-]+\/mysqld\.sock$/.test(socketPath)) throw Error("LOCAL_SOCKET_REQUIRED");
    root = await createConnection({ user: "root", socketPath });
    await root.query("CREATE DATABASE `" + database + "`");
    connection = await createConnection({ user: "root", socketPath, database, dateStrings: true });
    await connection.query("SET FOREIGN_KEY_CHECKS=0");
    for (const file of (await readdir(new URL("../../database/bootstrap/v2/", import.meta.url))).filter(f => f.endsWith(".sql"))) {
      const table = file.slice(0,-4);
      let definition = await readFile(new URL("../../database/bootstrap/v2/" + table + ".sql", import.meta.url), "utf8");
      // Include the nullable schedule columns in the fresh CREATE definitions.
      // This is fixture setup, not execution of existing ALTER/migration scripts.
      const scheduleColumns = table === "orderItems"
        ? "  `estimatedManufacturingStartAtPurchase` date DEFAULT NULL,\n  `estimatedManufacturingEndAtPurchase` date DEFAULT NULL,\n"
        : table === "productionBatches"
          ? "  `estimatedManufacturingStart` date DEFAULT NULL,\n  `estimatedManufacturingEnd` date DEFAULT NULL,\n  `manufacturingScheduleRequired` tinyint NOT NULL DEFAULT '1',\n"
          : "";
      definition = definition.replace("  PRIMARY KEY", scheduleColumns + "  PRIMARY KEY");
      await connection.query(definition);
    }
    await connection.query("SET FOREIGN_KEY_CHECKS=1");
    await connection.query(await readFile(new URL("../../database/migrations/0023_asaas_webhook_inbox.sql", import.meta.url), "utf8"));
    const contract = JSON.parse(await readFile(new URL("../../database/schema/contract-v4.json", import.meta.url), "utf8"));
    expect(structuralHash(await readStructuralSchema(connection))).toBe(contract.fingerprint);

    await connection.query("SET SESSION time_zone='+00:00'");
  });
  beforeEach(async()=>{
    for (const table of ["notificationOutbox", "orderEmailEvents", "paymentEvents", "payments", "asaasWebhookInbox", "asaasWebhookEvents", "auditLogs", "stockReservations", "orderItems", "orders", "products", "users"])
      await query("DELETE FROM `" + table + "`");
    await query("INSERT INTO users(id,openId,name,email,role) VALUES(14,'synthetic-admin','Fixture Admin','admin@example.invalid','admin')");
    await query("INSERT INTO users(id,openId,name,email) VALUES(594,'synthetic-created-customer','STAGING RC2 synthetic','synthetic@example.invalid')");
    await query("INSERT INTO products(id,name,category,price,stock) VALUES(1,'STAGING RC2 synthetic','fixture',9900,98)");
    await query("INSERT INTO orders(id,userId,totalPrice,createdAt) VALUES(13,594,9900,DATE_SUB(NOW(),INTERVAL 2 HOUR))");
    await query("INSERT INTO orderItems(id,orderId,productId,productName,unitPrice,quantity,totalPrice) VALUES(14,13,1,'STAGING RC2 synthetic',9900,1,9900)");
    await query("INSERT INTO stockReservations(id,userId,orderId,orderItemId,productId,quantity,status,expiresAt) VALUES(10,594,13,14,1,1,'active',DATE_SUB(NOW(),INTERVAL 1 HOUR))");
    await query("INSERT INTO auditLogs(id,actorUserId,actorType,action,entity,entityId,metadata) VALUES(72,594,'user','checkout.charge_created','order','13',?)",[JSON.stringify({payment:{paymentId:'pay_dog6ppexq4gyw3k6',method:'PIX'}})]);
    for (const id of [2,3,6,12]) await query("INSERT INTO orders(id,userId,totalPrice,status,paymentStatus) VALUES(?,594,9900,'paid','confirmed')",[id]);
    await query("UPDATE orders SET paymentStatus='unconfirmed',fulfillmentStatus='inventory_exception' WHERE id=2");
    await query("UPDATE orders SET paymentConfirmationSource='manual',paymentConfirmedBy=14,paymentConfirmedAt='2026-10-11 04:47:24',fulfillmentStatus='ready' WHERE id=3");
    await query("UPDATE orders SET status='delivered',paymentConfirmationSource='asaas_webhook',paymentConfirmedAt='2026-10-09 02:00:53',paymentConfirmationReference='synthetic-historical-12',fulfillmentStatus='awaiting_payment' WHERE id=12");
    await query("INSERT INTO auditLogs(id,actorUserId,actorType,action,entity,entityId,metadata) VALUES(69,14,'admin','order.payment_confirmed_manual','order','3','{}')");
    await query("INSERT INTO notificationOutbox(id,dedupeKey,type,orderId,status,attempts) VALUES(1,'fixture-historical-2','payment-approved',2,'pending',0),(2,'fixture-historical-3','payment-approved',3,'pending',0)");
    await query("INSERT INTO orderEmailEvents(orderId,eventType,status,idempotencyKey,attemptCount,processingAt) VALUES(6,'order_delivered_email','processing','fixture-delivered-6',1,'2026-09-27 01:43:32'),(6,'review_request_email','processing','fixture-review-6',1,'2026-09-27 01:43:32')");

    const payload={id:TARGET.eventId,event:'PAYMENT_CREATED',payment:{id:TARGET.paymentId,externalReference:'13',status:'PENDING',value:99,netValue:98.01},sourcePayloadHash:TARGET.sourcePayloadHash};
    const hashable={...payload} as any;delete hashable.sourcePayloadHash;expect(digest(hashable)).toBe(TARGET.payloadHash);
    await query("INSERT INTO asaasWebhookInbox(eventId,payload,payloadHash,state,attempts,errorCode,completedAt) VALUES(?,?,?,'rejected',1,'WEBHOOK_VALIDATION_REJECTED',NOW())",[TARGET.eventId,JSON.stringify(payload),TARGET.payloadHash]);
    providerBody=provider();refundsBody={data:[],hasMore:false,totalCount:0};
    runtime={environment:env(),artifactHash,open:vi.fn(openLocal),
      // ONLY this test replaces Railway metadata; all transaction/schema/data SQL
      // runs on the local socket/database guard above. No remote fallback exists.
      identity:vi.fn(async()=>({database:TARGET.database,uuidHash:TARGET.mysqlUuidHash})),
      bundleHash:vi.fn(async()=>TARGET.bundleHash),fetch:vi.fn(async(url:any,options:any)=>{
        expect(String(url).startsWith('https://api-sandbox.asaas.com/v3/payments/'+TARGET.paymentId)).toBe(true);
        expect(options.method).toBe('GET');expect(options.redirect).toBe('error');
        return new Response(JSON.stringify(String(url).endsWith('/refunds')?refundsBody:providerBody),{status:200});
      }) as any};
    historicalBefore=await historical();
  });
  afterEach(async()=>{expect(await historical()).toBe(historicalBefore);});
  afterAll(async()=>{await connection?.end();if(root){await root.query('DROP DATABASE `'+database+'`');await root.end();}});

  it('observed null refund envelope supports DRY-RUN without writes and one idempotent consumption locally',async()=>{
    refundsBody={data:null,hasMore:false,totalCount:0};const before=await captureSnapshot(connection);
    const checkpoint=await dry();expect((await captureSnapshot(connection)).tableHashes).toEqual(before.tableHashes);
    const request=execute(checkpoint);expect((await run(request)).status).toBe('completed');
    const committed=await captureSnapshot(connection);expect(committed.stock).toBe(97);
    expect((await run(request)).status).toBe('already_completed');expect((await captureSnapshot(connection)).tableHashes).toEqual(committed.tableHashes);
  });
  it('normalization does not bypass rollback on local injected write failure',async()=>{
    refundsBody={data:null,hasMore:false,totalCount:0};const request=execute(await dry()),before=await captureSnapshot(connection);
    runtime.open=vi.fn(async()=>{const c=await openLocal(),exec=c.query.bind(c);c.query=(async(sql:any,...args:any[])=>{
      if(/INSERT INTO payments/.test(typeof sql==='string'?sql:sql.sql))throw Error('LOCAL_INJECTED_FAILURE');
      return exec(sql,...args as [any]);}) as any;return c;});
    await expect(run(request)).rejects.toMatchObject({commitState:'rolled_back'});
    expect((await captureSnapshot(connection)).tableHashes).toEqual(before.tableHashes);
  });
  it('refund GET failure after local snapshot still leaves all 14 tables unchanged',async()=>{
    const before=await captureSnapshot(connection),fetcher=runtime.fetch;runtime.fetch=vi.fn(async(url:any,options:any)=>{
      if(String(url).endsWith('/refunds'))throw Error('LOCAL_REFUNDS_NETWORK_FAILURE');return fetcher(url,options);
    }) as any;
    await expect(dry()).rejects.toThrow('LOCAL_REFUNDS_NETWORK_FAILURE');
    expect((await captureSnapshot(connection)).tableHashes).toEqual(before.tableHashes);
  });
  it('default DRY-RUN leaves every row in all 14 tables unchanged',async()=>{
    const before=await captureSnapshot(connection),r=await run({operation:'financial-b'}),after=await captureSnapshot(connection);
    expect(r).toMatchObject({status:'dry-run',writes:false,commitState:'not_started'});expect(after.tableHashes).toEqual(before.tableHashes);
    expect(runtime.open).toHaveBeenCalledTimes(1);expect(runtime.fetch).toHaveBeenCalledTimes(2);
  });
  it.each(['RAILWAY_PROJECT_ID','RAILWAY_ENVIRONMENT_ID','RAILWAY_SERVICE_ID','RAILWAY_DEPLOYMENT_ID'])('wrong %s refuses before connection/provider',async(key)=>{
    runtime.environment[key]='00000000-0000-0000-0000-000000000000';
    await expect(run({operation:'financial-b'})).rejects.toThrow('RECOVERY_ENVIRONMENT_MISMATCH');
    expect(runtime.open).not.toHaveBeenCalled();expect(runtime.fetch).not.toHaveBeenCalled();
  });
  it('internal environment name production is accepted solely with all fixed UUIDs',async()=>{
    expect(runtime.environment.RAILWAY_ENVIRONMENT_NAME).toBe('production');expect((await run({operation:'financial-b'})).status).toBe('dry-run');
  });
  it.each(['mysql://fixture:synthetic@production.internal/l4ckos_staging','mysql://fixture:synthetic@mysql.railway.internal/l4ckos_production',
    'mysql://fixture:synthetic@mysql.railway.internal/l4ckos_staging?multipleStatements=true'])('refuses divergent DB URI %s before connection',async(uri)=>{
    runtime.environment.DATABASE_URL=uri;await expect(run({operation:'financial-b'})).rejects.toThrow('RECOVERY_DATABASE_TARGET_MISMATCH');expect(runtime.open).not.toHaveBeenCalled();
  });
  it.each(['ASAAS_API_URL','ASAAS_CHECKOUT_BASE_URL','ASAAS_API_KEY'])('refuses wrong Sandbox %s before connection',async(key)=>{
    runtime.environment[key]='wrong';await expect(run({operation:'financial-b'})).rejects.toThrow('RECOVERY_SANDBOX_CONFIGURATION_REQUIRED');expect(runtime.open).not.toHaveBeenCalled();
  });
  it.each(['database','uuidHash'])('refuses actual DB identity mismatch %s',async(key)=>{
    runtime.identity=async()=>({...{database:TARGET.database,uuidHash:TARGET.mysqlUuidHash},[key]:'wrong'});
    await expect(run({operation:'financial-b'})).rejects.toThrow('RECOVERY_DATABASE_IDENTITY_MISMATCH');expect(runtime.fetch).not.toHaveBeenCalled();
  });
  it('real local server identity is rejected by staging guard',async()=>{
    const identity=await readDatabaseIdentity(connection);expect(()=>assertDatabaseIdentity(identity)).toThrow('RECOVERY_DATABASE_IDENTITY_MISMATCH');
  });
  it('refuses bundle drift and schema drift before provider/write',async()=>{
    runtime.bundleHash=async()=>'b'.repeat(64);await expect(run({operation:'financial-b'})).rejects.toThrow('RECOVERY_BUNDLE_MISMATCH');
    runtime.bundleHash=async()=>TARGET.bundleHash;
    await query('CREATE TABLE unexpected_fixture(id int PRIMARY KEY)');
    try{await expect(run({operation:'financial-b'})).rejects.toThrow('RECOVERY_SCHEMA_MISMATCH');}finally{await query('DROP TABLE unexpected_fixture');}
  });
  it('execution without explicit approval is blocked before connection',async()=>{
    await expect(run({operation:'financial-b',mode:'execute'})).rejects.toThrow('RECOVERY_EXPLICIT_APPROVAL_REQUIRED');expect(runtime.open).not.toHaveBeenCalled();
  });
  it.each(['operation','artifact','checkpoint','expired','consent'])('rejects wrong authorization %s',async(kind)=>{
    const r=execute(await dry());
    if(kind==='operation')r.approval!.operation='created';if(kind==='artifact')r.approval!.artifactHash='b'.repeat(64);
    if(kind==='checkpoint')r.approval!.checkpointHash='b'.repeat(64);if(kind==='expired')r.approval!.validUntil=new Date(Date.now()-500).toISOString();
    if(kind==='consent')(r.approval as any).expiredReservationException=false;
    const before=await captureSnapshot(connection);await expect(run(r)).rejects.toThrow();expect((await captureSnapshot(connection)).tableHashes).toEqual(before.tableHashes);
  });
  it.each(['status','deleted','chargeback','refunds','netValue','externalReference'])('rejects provider divergence %s',async(key)=>{
    providerBody[key]={status:'REFUNDED',deleted:true,chargeback:{status:'REQUESTED'},refunds:[{}],netValue:99.999,externalReference:'12'}[key];
    await expect(run({operation:'financial-b'})).rejects.toThrow();expect((await query('SELECT stock FROM products WHERE id=1'))[0].stock).toBe(98);
  });
  it('new official timestamp requires review, never silently discarded into unknown-time B',async()=>{
    providerBody.paymentDate='2026-10-11T15:50:00Z';await expect(run({operation:'financial-b'})).rejects.toThrow('RECOVERY_FINANCIAL_TIMESTAMP_REQUIRES_REVIEW');
    expect(await query('SELECT * FROM payments')).toHaveLength(0);
  });
  it.each(['hasMore','count','list'])('rejects incomplete/reversed refunds %s',async(kind)=>{
    if(kind==='hasMore')refundsBody.hasMore=true;if(kind==='count')refundsBody.totalCount=1;if(kind==='list')refundsBody.data=[{}];
    await expect(run({operation:'financial-b'})).rejects.toThrow();
  });
  it.each(['inbox','ledger','payment-events'])('reversal observation in %s blocks B even if GET is still RECEIVED',async(table)=>{
    if(table==='inbox')await query("INSERT INTO asaasWebhookInbox(eventId,payload,payloadHash,state) VALUES('fixture-refund',?,?,'received')",
      [JSON.stringify({id:'fixture-refund',event:'PAYMENT_REFUNDED',payment:{id:TARGET.paymentId,externalReference:'13'}}),'b'.repeat(64)]);
    else if(table==='ledger') await query("INSERT INTO asaasWebhookEvents(eventId,eventType,paymentId,orderId,payloadHash,status) VALUES('fixture-refund','PAYMENT_REFUNDED',?,13,?,'processed')",[TARGET.paymentId,'b'.repeat(64)]);
    else await query("INSERT INTO paymentEvents(providerEventId,orderId,providerPaymentId,eventType) VALUES('fixture-refund',13,?,'PAYMENT_REFUNDED')",[TARGET.paymentId]);
    const before=await captureSnapshot(connection);
    try{await expect(run({operation:'financial-b'})).rejects.toThrow('RECOVERY_REVERSAL_OBSERVATION_REQUIRES_REVIEW');
      expect((await captureSnapshot(connection)).tableHashes).toEqual(before.tableHashes);
    }finally{await query('DELETE FROM '+(table==='inbox'?'asaasWebhookInbox':table==='ledger'?'asaasWebhookEvents':'paymentEvents')+" WHERE "+(table==='payment-events'?'providerEventId':'eventId')+"='fixture-refund'");}
  });
  it('B applies audit, one payment/consumption/pending intention, no financial timestamp/event',async()=>{
    const {checkpoint,value}=await completeB();expect(value).toMatchObject({status:'completed',commitState:'confirmed',independentlyVerified:true});
    expect(runtime.open).toHaveBeenCalledTimes(4); // separate dry, preflight, writer, postcommit-reader
    expect((await query('SELECT stock FROM products WHERE id=1'))[0].stock).toBe(97);
    expect((await query('SELECT status,expiresAt FROM stockReservations WHERE id=10'))[0]).toMatchObject({status:'consumed',expiresAt:checkpoint.snapshot.originalExpiresAt});
    expect((await query('SELECT * FROM payments WHERE orderId=13'))[0]).toMatchObject({receivedAt:null,confirmedAt:null,paidAmount:9900,refundedAmount:0});
    expect(await query('SELECT * FROM paymentEvents')).toHaveLength(0);
    expect((await query('SELECT state,attempts FROM asaasWebhookInbox'))[0]).toMatchObject({state:'rejected',attempts:1});
    const [a]=await query("SELECT * FROM auditLogs WHERE action='order.payment_recovery_completed'");
    expect(JSON.parse(a.metadata)).toMatchObject({path:'B',localRehearsal:false,supervisedStaging:true,artifactHash,notificationDispatch:false});
    expect((await query('SELECT * FROM notificationOutbox WHERE orderId=13'))[0]).toMatchObject({status:'pending',attempts:0,sentAt:null});
  });
  it.each(['round','truncate'])('B remains valid under %s TIMESTAMP(0) semantics',async(mode)=>{
    runtime.open=vi.fn(async()=>{const c=await openLocal();const [r]=await readRows(c,'SELECT @@session.sql_mode mode');
      const flags=String(r.mode).split(',').filter(v=>v && v!=='TIME_TRUNCATE_FRACTIONAL');
      if(mode==='truncate')flags.push('TIME_TRUNCATE_FRACTIONAL');await c.query('SET SESSION sql_mode=?',[flags.join(',')]);return c;});
    const {value}=await completeB();expect(value.status).toBe('completed');
    expect((await query('SELECT receivedAt,confirmedAt FROM payments WHERE orderId=13'))[0]).toEqual({receivedAt:null,confirmedAt:null});
  });
  it('reexecution proves same approved commit without any additional writes',async()=>{
    const {request}=await completeB(),before=await captureSnapshot(connection);expect((await run(request)).status).toBe('already_completed');
    expect((await captureSnapshot(connection)).tableHashes).toEqual(before.tableHashes);
  });
  it('concurrent executions have one consumption/audit/notification',async()=>{
    const request=execute(await dry());const results=await Promise.allSettled([run(request),run(request)]);
    expect(results.some(r=>r.status==='fulfilled'&&r.value.status==='completed')).toBe(true);
    expect((await query('SELECT stock FROM products WHERE id=1'))[0].stock).toBe(97);
    expect(await query("SELECT * FROM auditLogs WHERE action='order.payment_recovery_completed'")).toHaveLength(1);
    expect(await query('SELECT * FROM notificationOutbox WHERE orderId=13')).toHaveLength(1);
  });
  it('checkpoint drift and stale checkpoint abort without mutation',async()=>{
    const r=execute(await dry());await query('UPDATE products SET stock=97 WHERE id=1');
    await expect(run(r)).rejects.toThrow();expect(await query('SELECT * FROM payments')).toHaveLength(0);
    r.checkpoint!.snapshot.capturedAt=new Date(Date.now()-180000).toISOString();r.approval!.checkpointHash=digest(r.checkpoint);
    await expect(run(r)).rejects.toThrow('RECOVERY_EVIDENCE_STALE');
  });
  it('availability is rechecked under the product lock after concurrent checkout commitment',async()=>{
    const request=execute(await dry());
    const before=await captureSnapshot(connection);let opens=0;
    runtime.open=vi.fn(async()=>{
      const c=await openLocal();opens++;
      if(opens===2){await query("INSERT INTO stockReservations(userId,orderId,productId,quantity,status,expiresAt) VALUES(594,12,1,98,'active',DATE_ADD(NOW(),INTERVAL 1 HOUR))");}
      return c;
    });
    // This writer is intentionally outside the operator; remove its synthetic
    // commitment before checking historical preservation in afterEach.
    try{await expect(run(request)).rejects.toThrow();expect(await query('SELECT * FROM payments')).toHaveLength(0);
      expect((await query('SELECT stock FROM products WHERE id=1'))[0].stock).toBe(before.stock);
    }finally{await query('DELETE FROM stockReservations WHERE orderId=12 AND productId=1');}
  });
  it('no stock aborts with no hold audit or partial recovery',async()=>{
    await query('UPDATE products SET stock=0 WHERE id=1');const before=await captureSnapshot(connection);
    await expect(run({operation:'financial-b'})).rejects.toThrow('RECOVERY_STOCK_UNAVAILABLE');
    expect((await captureSnapshot(connection)).tableHashes).toEqual(before.tableHashes);
  });
  it('order lock conflict aborts before write with no retry',async()=>{
    const request=execute(await dry()),locker=await openLocal();
    try{await locker.beginTransaction();await locker.query('SELECT id FROM orders WHERE id=13 FOR UPDATE');
      await expect(run(request)).rejects.toThrow();expect(await query('SELECT * FROM payments')).toHaveLength(0);
    }finally{await locker.rollback();await locker.end();}
  });
  it.each(['products','stockReservations','payments','orders','auditLogs','notificationOutbox'])('rolls back before commit on injected %s write failure',async(table)=>{
    const request=execute(await dry()),before=await captureSnapshot(connection);
    runtime.open=vi.fn(async()=>{const c=await openLocal(),exec=c.query.bind(c);c.query=(async(sql:any,...args:any[])=>{
      if(new RegExp('(?:UPDATE|INSERT INTO) '+table+'(?: |\\()').test(typeof sql==='string'?sql:sql.sql))throw Error('LOCAL_INJECTED_FAILURE');
      return exec(sql,...args as [any]);}) as any;return c;});
    await expect(run(request)).rejects.toMatchObject({commitState:'rolled_back'});expect((await captureSnapshot(connection)).tableHashes).toEqual(before.tableHashes);
  });
  it('evidence expiring under locks aborts and rolls back before commit',async()=>{
    const request=execute(await dry()),before=await captureSnapshot(connection);let identities=0;let clock:ReturnType<typeof vi.spyOn>|undefined;
    const realNow=Date.now.bind(Date);runtime.identity=async()=>{if(++identities===4)clock=vi.spyOn(Date,'now').mockImplementation(()=>realNow()+180000);return {database:TARGET.database,uuidHash:TARGET.mysqlUuidHash};};
    try{await expect(run(request)).rejects.toThrow('RECOVERY_EVIDENCE_STALE');}finally{clock?.mockRestore();}
    expect((await captureSnapshot(connection)).tableHashes).toEqual(before.tableHashes);
  });
  it('CREATED cannot run without separate financial verification/authorization',async()=>{
    await expect(run({operation:'created'})).rejects.toThrow('RECOVERY_FINANCIAL_VERIFICATION_REQUIRED');
    const {receipt}=await completeB(),checkpoint=await dry('created',receipt),request=execute(checkpoint,receipt);
    request.approval!.financialReceiptHash=null;await expect(run(request)).rejects.toThrow('RECOVERY_FINANCIAL_VERIFICATION_REQUIRED');
    expect((await query('SELECT state FROM asaasWebhookInbox'))[0].state).toBe('rejected');
  });
  it('independent verify-financial creates a fresh receipt in READ ONLY with unchanged rows',async()=>{
    const {checkpoint}=await completeB(),before=await captureSnapshot(connection);
    const r=await run({operation:'verify-financial',baseline:checkpoint.snapshot,financialApprovalReference:'LOCAL_APPROVAL_FIN13'});
    expect(r.status).toBe('verified');expect(r.financialReceipt?.verified).toBe(true);
    expect((await captureSnapshot(connection)).tableHashes).toEqual(before.tableHashes);
  });
  it('CREATED dry-run/execute/reentry preserve financial effects and payload with one ledger/audit',async()=>{
    const {receipt}=await completeB(),checkpoint=await dry('created',receipt),before=await captureSnapshot(connection);
    expect(checkpoint.snapshot.tableHashes).toEqual(before.tableHashes);
    const request=execute(checkpoint,receipt),result=await run(request);expect(result).toMatchObject({status:'completed',independentlyVerified:true});
    expect((await captureSnapshot(connection)).financialHash).toBe(receipt.financialHash);
    expect((await query('SELECT state,attempts,payloadHash FROM asaasWebhookInbox'))[0]).toMatchObject({state:'processed',attempts:2,payloadHash:TARGET.payloadHash});
    expect(await query('SELECT * FROM asaasWebhookEvents')).toHaveLength(1);
    expect((await query('SELECT * FROM asaasWebhookEvents'))[0]).toMatchObject({eventType:'PAYMENT_CREATED',payloadHash:TARGET.sourcePayloadHash,status:'processed'});
    const after=await captureSnapshot(connection);expect((await run(request)).status).toBe('already_completed');expect((await captureSnapshot(connection)).tableHashes).toEqual(after.tableHashes);
    expect((await run({operation:'verify-created',baseline:checkpoint.snapshot,financialReceipt:receipt})).status).toBe('verified');
  });
  it.each(['payload','financial','receipt'])('CREATED blocks %s divergence',async(kind)=>{
    const {receipt}=await completeB(),checkpoint=await dry('created',receipt),request=execute(checkpoint,receipt);
    if(kind==='payload')await query("UPDATE asaasWebhookInbox SET payload='{}' WHERE eventId=?",[TARGET.eventId]);
    if(kind==='financial')await query('UPDATE products SET stock=96 WHERE id=1');
    if(kind==='receipt')receipt.verifiedAt=new Date(Date.now()-180000).toISOString();
    const before=await captureSnapshot(connection);await expect(run(request)).rejects.toThrow();expect((await captureSnapshot(connection)).tableHashes).toEqual(before.tableHashes);
  });
  it('CREATED ledger failure rolls back to rejected1 with no financial/notification change',async()=>{
    const {receipt}=await completeB(),checkpoint=await dry('created',receipt),before=await captureSnapshot(connection);
    runtime.open=vi.fn(async()=>{const c=await openLocal(),exec=c.execute.bind(c);c.execute=(async(sql:any,...args:any[])=>{
      if(String(sql).includes('INSERT INTO asaasWebhookEvents'))throw Error('LOCAL_CREATED_LEDGER_FAILURE');return exec(sql,...args as [any]);}) as any;return c;});
    await expect(run(execute(checkpoint,receipt))).rejects.toThrow();expect((await captureSnapshot(connection)).tableHashes).toEqual(before.tableHashes);
  });
  it('lost commit acknowledgement reports UNKNOWN without retry, independently recoverable by reading',async()=>{
    const request=execute(await dry());let opens=0;runtime.open=vi.fn(async()=>{const c=await openLocal();if(++opens===2){const commit=c.commit.bind(c);c.commit=async()=>{await commit();throw Error('LOST_ACK');};}return c;});
    await expect(run(request)).rejects.toMatchObject({commitState:'unknown',phase:'financial-b'});
    expect((await query('SELECT stock FROM products WHERE id=1'))[0].stock).toBe(97);expect(await query('SELECT * FROM payments')).toHaveLength(1);
    runtime.open=vi.fn(openLocal);
    expect((await run({operation:'verify-financial',baseline:request.checkpoint!.snapshot,financialApprovalReference:request.approval!.reference})).status).toBe('verified');
  });
  it('any drift after COMMIT is an incident even if semantic financial fields remain valid',async()=>{
    const request=execute(await dry());let opens=0;runtime.open=vi.fn(async()=>{const c=await openLocal();
      if(++opens===2){const commit=c.commit.bind(c);c.commit=async()=>{await commit();await query("UPDATE notificationOutbox SET updatedAt='2030-01-01 00:00:00' WHERE orderId=13");};}return c;});
    await expect(run(request)).rejects.toMatchObject({commitState:'confirmed',phase:'postcommit-independent-verification'});
    expect((await query('SELECT stock FROM products WHERE id=1'))[0].stock).toBe(97);expect(await query('SELECT * FROM payments')).toHaveLength(1);
  });
  it('postcommit verifier outage reports CONFIRMED incident, never silent partial success',async()=>{
    const request=execute(await dry());let opens=0;runtime.open=vi.fn(async()=>{if(++opens===3)throw Error('READER_UNAVAILABLE');return openLocal();});
    await expect(run(request)).rejects.toMatchObject({commitState:'confirmed',phase:'postcommit-independent-verification'});
    expect(await query('SELECT * FROM payments')).toHaveLength(1);expect((await query('SELECT stock FROM products WHERE id=1'))[0].stock).toBe(97);
  });
});
