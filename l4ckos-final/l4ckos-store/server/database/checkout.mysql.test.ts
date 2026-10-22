import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import currentContract from "../../database/schema/contract-v6.json";
import { randomUUID } from "node:crypto";
import type { Connection } from "mysql2/promise";
import { checkout, checkoutItemSchema, orderTotal, type CheckoutInput } from "./checkout";
import { openBackupConnection, backupDatabase, restoreDatabase, assertLocalRestoreTarget } from "./backupRestore";
import { bootstrapArtifacts } from "../../database/schema/artifacts";
import { readStructuralSchema, structuralHash } from "../../database/schema/fingerprint";
import { createVariantOptionKey } from "./productVariantIdentity";
const socketPath=process.env.L4CKOS_LOCAL_MYSQL_SOCKET ?? "/tmp/l4ckos-reconciliation-socket/mysqld.sock";
const url=(name:string)=>`mysql://root@localhost/${name}`;
let root:Connection;const connections:Connection[]=[];const names:string[]=[];
async function database(seed=true){
 const name='l4ckos_test_checkout_'+randomUUID().replaceAll('-','').slice(0,12);
 assertLocalRestoreTarget(url(name),socketPath);
 await root.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);names.push(name);
 const c=await openBackupConnection(url(name),socketPath);connections.push(c);
 for(const s of (await bootstrapArtifacts()).statements)await c.query(s.sql);
 for(const s of (await readFile(new URL("../../database/migrations/0021_preorder_production_batches.sql",import.meta.url),"utf8")).split(/^-- l4ckos:statement-breakpoint\s*$/m).map(s=>s.trim()).filter(Boolean)) await c.query(s);
 for(const s of (await readFile(new URL("../../database/migrations/0022_preorder_manufacturing_schedule.sql",import.meta.url),"utf8")).split(/^-- l4ckos:statement-breakpoint\s*$/m).map(s=>s.trim()).filter(Boolean)) await c.query(s);
 for(const migration of ["0023_asaas_webhook_inbox.sql","0024_home_highlight_settings.sql","0025_product_variant_identity.sql"])
  for(const s of (await readFile(new URL(`../../database/migrations/${migration}`,import.meta.url),"utf8")).split(/^-- l4ckos:statement-breakpoint\s*$/m).map(s=>s.trim()).filter(Boolean)) await c.query(s);
 if(seed){
 await c.query("INSERT INTO users (id,openId,name) VALUES (1,'synthetic-checkout','Synthetic')");
 await c.query("INSERT INTO products (id,name,category,price,stock,imageUrl) VALUES (1,'Frozen A','fixture',8000,20,'/fixture-a.png'),(2,'Frozen B','fixture',3000,40,'/fixture-b.png')");
 await c.query("INSERT INTO productVariants (id,productId,name,sku,price,stock,size,color,optionKey,isActive) VALUES (1,2,'Frozen blue M','SYNTHETIC-SKU',5000,20,'M','Blue',?,1),(2,2,'Frozen red L','SYNTHETIC-SKU-2',6000,20,'L','Red',?,1)",[createVariantOptionKey("Blue","M"),createVariantOptionKey("Red","L")]);
 }
 return c;
}
function input(items:CheckoutInput['items']=[{productId:1,quantity:3}]):CheckoutInput {return{userId:1,checkoutAttemptId:randomUUID(),items,method:'PIX',shipping:{cep:'70000000',optionId:'local'},shippingAddress:{recipient:'Synthetic',zipCode:'70000000',street:'Fixture',number:'1',neighborhood:'Fixture',city:'Brasilia',state:'DF'},customer:{name:'Synthetic',cpfCnpj:'11144477735'}};}
const payment={method:'PIX' as const,customerId:'synthetic-customer',paymentId:'synthetic-payment',invoiceUrl:'https://sandbox.asaas.com/fixture',pixQrCode:null,pixCopyPaste:'synthetic-pix',bankSlipUrl:null,digitableLine:null,nossoNumero:null,billingType:'PIX'};
function adapters(){return{quote:vi.fn(async()=>({options:[{id:'local',label:'Local',price:0}]})),charge:vi.fn(async()=>({...payment,paymentId:`synthetic-payment-${randomUUID()}`}))};}
async function rows(c:Connection,sql:string,values:any[]=[]){return(await c.query<any[]>(sql,values))[0].map(row=>Object.hasOwn(row,'n')?{...row,n:Number(row.n)}:row);}
function mysqlSafeInteger(value:unknown,column:string):number{
 const parsed=typeof value==='number'?value:typeof value==='string'&&/^-?\d+$/.test(value)?Number(value):NaN;
 if(!Number.isSafeInteger(parsed))throw new Error(`UNSAFE_MYSQL_INTEGER:${column}`);
 return parsed;
}
async function empty(c:Connection){for(const table of ['orders','orderItems','payments','stockReservations','auditLogs','notificationOutbox'])expect(await rows(c,`SELECT COUNT(*) n FROM ${table}`)).toEqual([{n:0}]);}

describe('checkout input and cents safety',()=>{
 it('rejects client price/total, variants without valid ID and invalid quantity',()=>{
  for(const extra of [{price:1},{unitPrice:1},{totalPrice:1},{variantId:-1}])expect(checkoutItemSchema.safeParse({productId:1,quantity:3,...extra}).success).toBe(false);
  for(const quantity of [0,-1,1.5,100])expect(checkoutItemSchema.safeParse({productId:1,quantity}).success).toBe(false);
 });
 it('preserves total equation and caps coupons without float monetary calculations',()=>{
  expect(orderTotal(13000,500,{type:'percent',value:10})).toEqual({totalPrice:12150,discountCents:1350});
  expect(orderTotal(13000,500,{type:'fixed',value:30})).toEqual({totalPrice:10500,discountCents:3000});
  expect(()=>orderTotal(2147483647,1)).toThrow();
 });
});

describe.skipIf(process.env.L4CKOS_MYSQL_TEST!=='1')('real MySQL atomic checkout snapshots',()=>{
 beforeAll(async()=>{vi.stubEnv('PUBLIC_SITE_MODE','store');vi.stubEnv('PUBLIC_CHECKOUT_ENABLED','true');process.env.L4CKOS_LOCAL_RESTORE='1';root=await openBackupConnection('mysql://root@localhost/mysql',socketPath);expect((await rows(root,'SELECT VERSION() v'))[0].v).toMatch(/^8\.4\./);});
 afterAll(async()=>{for(const c of connections)await c.end();for(const name of names)await root.query(`DROP DATABASE \`${name}\``);await root?.end();vi.unstubAllEnvs();});
 it.each([1,3])('persists quantity %i, cents and item/reservation FK before provider IO',async(quantity)=>{
  const c=await database();const a=adapters();a.charge.mockImplementation(async()=>{
   const observer=await openBackupConnection(url(c.config.database!),socketPath);
   try {
    expect(await rows(observer,'SELECT quantity,unitPrice,totalPrice FROM orderItems')).toEqual([{quantity,unitPrice:8000,totalPrice:8000*quantity}]);
    await observer.beginTransaction();await observer.query('SELECT id FROM products WHERE id=1 FOR UPDATE NOWAIT');await observer.rollback();
   }finally{await observer.end();}
   expect(await rows(c,'SELECT quantity,unitPrice,totalPrice FROM orderItems')).toEqual([{quantity,unitPrice:8000,totalPrice:8000*quantity}]);
   return payment;
  });
  const r=await checkout(c,input([{productId:1,quantity}]),a);
  expect(r.totalPrice).toBe(8000*quantity);expect(a.charge).toHaveBeenCalledOnce();
  expect(await rows(c,'SELECT COUNT(*) n FROM stockReservations r JOIN orderItems i ON i.id=r.orderItemId AND i.orderId=r.orderId')).toEqual([{n:1}]);
  expect((await rows(c,'SELECT paymentStatus FROM orders'))[0].paymentStatus).toBe('unconfirmed');
 });
 it('freezes multiple products/variant metadata and price after catalog changes; exact backup round trip',async()=>{
  const c=await database();const request=input([{productId:1,quantity:2},{productId:2,variantId:1,quantity:1,size:'M',color:'Blue'}]);
  const a=adapters();const result=await checkout(c,request,a);expect(result.totalPrice).toBe(21000);
  const frozen=await rows(c,'SELECT * FROM orderItems ORDER BY id');expect(frozen[1]).toMatchObject({variantId:1,unitPrice:5000,totalPrice:5000,sku:'SYNTHETIC-SKU',size:'M',color:'Blue'});
  await c.query("UPDATE products SET price=1,name='Changed',imageUrl='/changed'");await c.query("UPDATE productVariants SET price=2,name='Changed variant',sku='Changed',size='S',color='Green'");
  expect(await rows(c,'SELECT * FROM orderItems ORDER BY id')).toEqual(frozen);
  const replay=await checkout(c,request,a);expect(replay.replayed).toBe(true);expect(replay.payment).toEqual(result.payment);expect(a.charge).toHaveBeenCalledOnce();
  const artifact=await backupDatabase(c),destination=await database(false);
  expect(artifact.tables.homeHighlightSettings.rowCount).toBe(1);
  const destinationContents=[];
  for(const name of Object.keys(artifact.tables)){
   const count=(await rows(destination,`SELECT COUNT(*) n FROM \`${name}\``))[0].n;
   if(count>0)destinationContents.push({table:name,count});
  }
  expect(destinationContents).toEqual([{table:'homeHighlightSettings',count:1}]);
  expect(await rows(destination,'SELECT id,displayMode,rotationIntervalSeconds FROM homeHighlightSettings')).toEqual([{id:1,displayMode:'single',rotationIntervalSeconds:8}]);
  const [clearedSingleton]=await destination.query<any>('DELETE FROM homeHighlightSettings WHERE id=1');
  expect(clearedSingleton.affectedRows).toBe(1);
  for(const name of Object.keys(artifact.tables))expect(await rows(destination,`SELECT COUNT(*) n FROM \`${name}\``)).toEqual([{n:0}]);
  await restoreDatabase(destination,artifact,{url:url(destination.config.database!),socketPath});
  const restored=await backupDatabase(destination);for(const name of Object.keys(artifact.tables))expect(restored.tables[name].checksum).toBe(artifact.tables[name].checksum);
  expect(structuralHash(await readStructuralSchema(destination))).toBe(currentContract.fingerprint);
 });
 it.each([
  [{productId:999,quantity:1}], [{productId:2,variantId:999,quantity:1}], [{productId:1,variantId:1,quantity:1}],
  [{productId:1,quantity:0}], [{productId:1,quantity:21}], [{productId:1,quantity:11},{productId:1,quantity:10}],
 ].map(items=>[items]))('fails locally before any partial order for invalid items %j',async(items)=>{const c=await database(),a=adapters();await expect(checkout(c,input(items),a)).rejects.toThrow();await empty(c);expect(a.charge).not.toHaveBeenCalled();});
 it.each(['orderItems','stockReservations'])('rolls back order, first item and reservations when second %s insert fails',async(table)=>{
  const c=await database(),a=adapters();
  await c.query(`CREATE TRIGGER synthetic_failure BEFORE INSERT ON ${table} FOR EACH ROW BEGIN IF NEW.productId=2 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='SYNTHETIC_INSERT_FAILURE'; END IF; END`);
  await expect(checkout(c,input([{productId:1,quantity:1},{productId:2,variantId:1,quantity:1,size:'M',color:'Blue'}]),a)).rejects.toThrow('SYNTHETIC_INSERT_FAILURE');await empty(c);expect(a.charge).not.toHaveBeenCalled();
  expect(await rows(c,'SELECT id,stock FROM products ORDER BY id')).toEqual([{id:1,stock:20},{id:2,stock:40}]);
  expect(await rows(c,'SELECT id,stock FROM productVariants ORDER BY id')).toEqual([{id:1,stock:20},{id:2,stock:20}]);
 });
 it('rejects catalog changes between quote and commit, and overflow',async()=>{
  const c=await database(),a=adapters();a.quote.mockImplementation(async()=>{await c.query('UPDATE products SET price=9000 WHERE id=1');return{options:[{id:'local',label:'Local',price:0}]};});
  await expect(checkout(c,input(),a)).rejects.toThrow('CHECKOUT_CATALOG_CHANGED');await empty(c);
  await c.query('UPDATE products SET price=2147483647 WHERE id=1');await expect(checkout(c,input(),adapters())).rejects.toThrow();await empty(c);
 });
 it('replays concurrently exactly once and rejects changed attempt contents',async()=>{
  const c=await database(),other=await openBackupConnection(url(c.config.database!),socketPath);connections.push(other);const request=input(),a=adapters();
  const results=await Promise.all([checkout(c,request,a),checkout(other,request,a)]);expect(results.filter(r=>r.replayed)).toHaveLength(1);expect(a.charge).toHaveBeenCalledOnce();
  expect(await rows(c,'SELECT COUNT(*) n FROM orders')).toEqual([{n:1}]);expect(await rows(c,'SELECT COUNT(*) n FROM stockReservations')).toEqual([{n:1}]);
  await expect(checkout(c,{...request,items:[{productId:1,quantity:1}]},a)).rejects.toThrow('CHECKOUT_ATTEMPT_CHANGED');
 });
 it('serializes competing stock reservations across different attempts',async()=>{
  const c=await database(),other=await openBackupConnection(url(c.config.database!),socketPath);connections.push(other);await c.query('UPDATE products SET stock=3 WHERE id=1');const a=adapters();
  const results=await Promise.allSettled([checkout(c,input(),a),checkout(other,input(),a)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(a.charge).toHaveBeenCalledOnce();
  expect(await rows(c,'SELECT COUNT(*) n FROM orders')).toEqual([{n:1}]);
 });
 it('uses variant stock without product stock and serializes two claims for the last variant unit',async()=>{
  const c=await database(),other=await openBackupConnection(url(c.config.database!),socketPath);connections.push(other);
  await c.query('UPDATE products SET stock=0 WHERE id=2');await c.query('UPDATE productVariants SET stock=1 WHERE id=1');
  const request=()=>input([{productId:2,variantId:1,quantity:1,size:'M',color:'Blue'}]),a=adapters();
  const results=await Promise.allSettled([checkout(c,request(),a),checkout(other,request(),a)]);
  expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
  expect(results.filter(result=>result.status==='rejected')).toHaveLength(1);
  expect(a.charge).toHaveBeenCalledOnce();
  expect(await rows(c,'SELECT COUNT(*) n FROM orders')).toEqual([{n:1}]);
  expect(await rows(c,'SELECT variantId,quantity FROM stockReservations')).toEqual([{variantId:1,quantity:1}]);
 });
 it('blocks v6 preorder checkout before creating orders, reservations or charges',async()=>{
  const c=await database();
  await c.query("UPDATE products SET salesMode='PREORDER',stock=0 WHERE id=2");
  await c.query("INSERT INTO productionBatches (id,name,status,maximumQuantity) VALUES (1,'Synthetic preorder','OPEN',50)");
  await c.query('INSERT INTO productionBatchProducts (productionBatchId,productId) VALUES (1,2)');
  const a=adapters();
  await expect(checkout(c,input([{productId:2,variantId:2,quantity:3,size:'L',color:'Red'}]),a)).rejects.toMatchObject({code:'CHECKOUT_PREORDER_DISABLED'});
  expect(a.charge).not.toHaveBeenCalled();
  expect(await rows(c,'SELECT COUNT(*) n FROM orders')).toEqual([{n:0}]);
  expect(await rows(c,'SELECT COUNT(*) n FROM stockReservations')).toEqual([{n:0}]);
  expect(await rows(c,'SELECT COUNT(*) n FROM payments')).toEqual([{n:0}]);
  expect(await rows(c,'SELECT stock FROM productVariants WHERE id=2')).toEqual([{stock:20}]);
  expect(await rows(c,'SELECT stock FROM products WHERE id=2')).toEqual([{stock:0}]);
 });
 it('prices the variant from the current server catalog after a cart price becomes stale',async()=>{
  const c=await database();await c.query('UPDATE productVariants SET price=7100 WHERE id=1');
  const result=await checkout(c,input([{productId:2,variantId:1,quantity:2,size:'M',color:'Blue'}]),adapters());
  expect(result.items[0]).toMatchObject({variantId:1,unitPrice:7100,totalPrice:14200});
  expect(result.totalPrice).toBe(14200);
  expect(await rows(c,'SELECT unitPrice,totalPrice FROM orderItems')).toEqual([{unitPrice:7100,totalPrice:14200}]);
 });
 it('enforces the reservation FK and coupon/shipping total; rolls back coupon use on local failure',async()=>{
  const c=await database(),a=adapters();await c.query("INSERT INTO coupons (code,type,value,maxUses) VALUES ('SYNTHETIC','percent',10,1)");
  a.quote.mockResolvedValue({options:[{id:'local',label:'Local',price:5}]});
  const request={...input([{productId:2,variantId:1,quantity:2,size:'M',color:'Blue'},{productId:2,variantId:2,quantity:1,size:'L',color:'Red'}]),couponCode:'SYNTHETIC'};
  const r=await checkout(c,request,a);expect(r.totalPrice).toBe(14850);
  await expect(c.query("UPDATE stockReservations SET orderItemId=999999")).rejects.toMatchObject({code:'ER_NO_REFERENCED_ROW_2'});
  await expect(checkout(c,{...request,checkoutAttemptId:randomUUID()},a)).rejects.toThrow('CHECKOUT_COUPON_INVALID');
  expect(await rows(c,'SELECT COUNT(*) n FROM orders')).toEqual([{n:1}]);
  expect((await rows(c,"SELECT usedCount FROM coupons"))[0].usedCount).toBe(1);
 });
 it('does not retry provider after successful charge but failed result persistence',async()=>{
  const c=await database(),a=adapters(),request=input(),query=c.query.bind(c);
  c.query=(async(...args:any[])=>{if(String(args[0]).includes("'checkout.charge_created'"))throw Error('SYNTHETIC_AUDIT_FAILURE');return (query as any)(...args);})as any;
  await expect(checkout(c,request,a)).rejects.toThrow('CHECKOUT_RECOVERY_REQUIRED');c.query=query;
  await expect(checkout(c,request,a)).rejects.toThrow('CHECKOUT_RECOVERY_REQUIRED');expect(a.charge).toHaveBeenCalledOnce();
  expect(await rows(c,'SELECT COUNT(*) n FROM orderItems')).toEqual([{n:1}]);
 });
 it('resolves storefront options to trusted variants, freezes base options and rejects forged options',async()=>{
  const c=await database(),a=adapters();
  await expect(checkout(c,input([{productId:2,quantity:1,size:'M',color:'Blue'}]),adapters())).rejects.toThrow('CHECKOUT_VARIANT_REQUIRED');
  const r=await checkout(c,input([{productId:2,variantId:1,quantity:1,size:'M',color:'Blue'}]),a);
  expect(r.items[0]).toMatchObject({variantId:1,unitPrice:5000,sku:'SYNTHETIC-SKU'});
  expect(a.charge).toHaveBeenCalledOnce();
  const base=await checkout(c,input([{productId:1,quantity:1,size:'M',color:'Azul'}]),a);
  expect(base.items[0]).toMatchObject({variantId:null,unitPrice:8000,size:'M',color:'Azul'});
  await expect(checkout(c,input([{productId:1,quantity:1,color:'Forged option'}]),a)).rejects.toThrow('CHECKOUT_OPTION_INVALID');
 });
 it('validates coupon UTC dates independently of the Node local timezone',async()=>{
  const c=await database();await c.query("INSERT INTO coupons (code,type,value,startsAt,expiresAt) VALUES ('UTC_FIXTURE','percent',10,DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 HOUR),DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))");
  const previous=process.env.TZ;process.env.TZ='America/Sao_Paulo';
  try{expect((await checkout(c,{...input(),couponCode:'UTC_FIXTURE'},adapters())).totalPrice).toBe(21600);}
  finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
 });
 it('consumes variant/product stock once and reads historical prices through ORM after catalog mutation',async()=>{
  const c=await database(),r=await checkout(c,input([{productId:2,variantId:1,quantity:2,size:'M',color:'Blue'}]),adapters());
  const dbState=async()=>({
   product:(await rows(c,'SELECT stock FROM products WHERE id=2'))[0].stock,
   variants:await rows(c,'SELECT id,stock FROM productVariants WHERE productId=2 ORDER BY id'),
   reservations:(await rows(c,'SELECT status,variantId,SUM(quantity) quantity FROM stockReservations GROUP BY status,variantId ORDER BY status,variantId')).map(reservation=>({...reservation,quantity:mysqlSafeInteger(reservation.quantity,'stockReservations.quantity')})),
  });
  expect(await dbState()).toEqual({product:40,variants:[{id:1,stock:20},{id:2,stock:20}],reservations:[{status:'active',variantId:1,quantity:2}]});
  const previous=process.env.DATABASE_URL;
  process.env.DATABASE_URL=url(c.config.database!)+'?socketPath='+encodeURIComponent(socketPath);
  const db=await import('../db');
  try {
   await c.query("UPDATE products SET price=1,name='Changed',imageUrl='/changed' WHERE id=2");
   expect((await db.getOrderReservationItems(r.orderId))[0]).toMatchObject({productName:'Frozen B',productPrice:5000,productImage:'/fixture-b.png'});
   expect(await db.markOrderPaid(r.orderId,{source:'manual',actorUserId:1})).toMatchObject({updated:true});
   const afterFirstConfirmation=await dbState();
   expect(afterFirstConfirmation).toEqual({product:38,variants:[{id:1,stock:18},{id:2,stock:20}],reservations:[{status:'consumed',variantId:1,quantity:2}]});
   expect(await db.markOrderPaid(r.orderId,{source:'manual',actorUserId:1})).toMatchObject({updated:false});
   expect(await dbState()).toEqual(afterFirstConfirmation);
   const expired=await checkout(c,input(),adapters());
   await c.query('UPDATE stockReservations SET expiresAt=DATE_SUB(NOW(),INTERVAL 1 MINUTE) WHERE orderId=?',[expired.orderId]);
   const expiredConfirmation=await db.markOrderPaid(expired.orderId,{source:'manual',actorUserId:1});
   expect(expiredConfirmation).toMatchObject({updated:false,invalidTransition:true});
   expect((await rows(c,'SELECT status FROM stockReservations WHERE orderId=?',[expired.orderId]))[0].status).toBe('expired');
   expect((await rows(c,'SELECT stock FROM products WHERE id=1'))[0].stock).toBe(20);
   const cancelled=await checkout(c,input(),adapters());
   await db.updateOrderAndReserveDeliveredEmailEvents(cancelled.orderId,{status:'cancelled'},1);
   expect((await rows(c,'SELECT status FROM stockReservations WHERE orderId=?',[cancelled.orderId]))[0].status).toBe('released');
   expect((await rows(c,'SELECT stock FROM products WHERE id=1'))[0].stock).toBe(20);
  }finally{
   const orm=await db.getDb();await (orm as any).$client.promise().end();
   if(previous===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previous;
  }
 });
 it('blocks provider retries after uncertain external outcome, retaining coherent pending snapshot',async()=>{
  const c=await database(),a=adapters(),request=input();a.charge.mockRejectedValue(Error('SYNTHETIC_PROVIDER_TIMEOUT'));
  await expect(checkout(c,request,a)).rejects.toThrow('CHECKOUT_RECOVERY_REQUIRED');await expect(checkout(c,request,a)).rejects.toThrow('CHECKOUT_RECOVERY_REQUIRED');expect(a.charge).toHaveBeenCalledOnce();
  expect(await rows(c,'SELECT COUNT(*) n FROM orderItems')).toEqual([{n:1}]);expect((await rows(c,'SELECT paymentStatus FROM orders'))[0].paymentStatus).toBe('unconfirmed');
 });
});
