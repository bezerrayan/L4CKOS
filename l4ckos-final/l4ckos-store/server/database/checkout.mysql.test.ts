import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Connection } from "mysql2/promise";
import { checkout, checkoutItemSchema, orderTotal, type CheckoutInput } from "./checkout";
import { openBackupConnection, backupDatabase, restoreDatabase, assertLocalRestoreTarget } from "./backupRestore";
import { bootstrapArtifacts } from "../../database/schema/artifacts";
import { readStructuralSchema, structuralHash } from "../../database/schema/fingerprint";
const socketPath="/tmp/l4ckos-reconciliation-socket/mysqld.sock";
const url=(name:string)=>`mysql://root@localhost/${name}`;
let root:Connection;const connections:Connection[]=[];const names:string[]=[];
async function database(seed=true){
 const name='l4ckos_test_checkout_'+randomUUID().replaceAll('-','').slice(0,12);
 assertLocalRestoreTarget(url(name),socketPath);
 await root.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);names.push(name);
 const c=await openBackupConnection(url(name),socketPath);connections.push(c);
 for(const s of (await bootstrapArtifacts()).statements)await c.query(s.sql);
 if(seed){
 await c.query("INSERT INTO users (id,openId,name) VALUES (1,'synthetic-checkout','Synthetic')");
 await c.query("INSERT INTO products (id,name,category,price,stock,imageUrl) VALUES (1,'Frozen A','fixture',8000,20,'/fixture-a.png'),(2,'Frozen B','fixture',3000,20,'/fixture-b.png')");
 await c.query("INSERT INTO productVariants (id,productId,name,sku,price,stock,size,color) VALUES (1,2,'Frozen variant','SYNTHETIC-SKU',5000,20,'M','Blue'),(2,1,'Other variant','OTHER',NULL,20,'L','Red')");
 }
 return c;
}
function input(items:CheckoutInput['items']=[{productId:1,quantity:3}]):CheckoutInput {return{userId:1,checkoutAttemptId:randomUUID(),items,method:'PIX',shipping:{cep:'70000000',optionId:'local'},shippingAddress:{recipient:'Synthetic',zipCode:'70000000',street:'Fixture',number:'1',neighborhood:'Fixture',city:'Brasilia',state:'DF'},customer:{name:'Synthetic',cpfCnpj:'11144477735'}};}
const payment={method:'PIX' as const,customerId:'synthetic-customer',paymentId:'synthetic-payment',invoiceUrl:'https://sandbox.asaas.com/fixture',pixQrCode:null,pixCopyPaste:'synthetic-pix',bankSlipUrl:null,digitableLine:null,nossoNumero:null,billingType:'PIX'};
function adapters(){return{quote:vi.fn(async()=>({options:[{id:'local',label:'Local',price:0}]})),charge:vi.fn(async()=>payment)};}
async function rows(c:Connection,sql:string){return(await c.query<any[]>(sql))[0].map(row=>Object.hasOwn(row,'n')?{...row,n:Number(row.n)}:row);}
async function empty(c:Connection){for(const table of ['orders','orderItems','stockReservations','auditLogs'])expect(await rows(c,`SELECT COUNT(*) n FROM ${table}`)).toEqual([{n:0}]);}

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
 beforeAll(async()=>{process.env.L4CKOS_LOCAL_RESTORE='1';root=await openBackupConnection('mysql://root@localhost/mysql',socketPath);expect((await rows(root,'SELECT VERSION() v'))[0].v).toMatch(/^8\.4\./);});
 afterAll(async()=>{for(const c of connections)await c.end();for(const name of names)await root.query(`DROP DATABASE \`${name}\``);await root?.end();});
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
  const c=await database();const request=input([{productId:1,quantity:2},{productId:2,variantId:1,quantity:1}]);
  const a=adapters();const result=await checkout(c,request,a);expect(result.totalPrice).toBe(21000);
  const frozen=await rows(c,'SELECT * FROM orderItems ORDER BY id');expect(frozen[1]).toMatchObject({variantId:1,unitPrice:5000,totalPrice:5000,sku:'SYNTHETIC-SKU',size:'M',color:'Blue'});
  await c.query("UPDATE products SET price=1,name='Changed',imageUrl='/changed'");await c.query("UPDATE productVariants SET price=2,name='Changed variant',sku='Changed',size='S',color='Green'");
  expect(await rows(c,'SELECT * FROM orderItems ORDER BY id')).toEqual(frozen);
  const replay=await checkout(c,request,a);expect(replay.replayed).toBe(true);expect(replay.payment).toEqual(payment);expect(a.charge).toHaveBeenCalledOnce();
  const artifact=await backupDatabase(c),destination=await database(false);
  await restoreDatabase(destination,artifact,{url:url(destination.config.database!),socketPath});
  const restored=await backupDatabase(destination);for(const name of Object.keys(artifact.tables))expect(restored.tables[name].checksum).toBe(artifact.tables[name].checksum);
  expect(structuralHash(await readStructuralSchema(destination))).toBe('f2baf7519cb425c955bfd0f697da10afa670ee57763e3f641b61a09ba75b7f8d');
 });
 it.each([
  [{productId:999,quantity:1}], [{productId:2,variantId:999,quantity:1}], [{productId:1,variantId:1,quantity:1}],
  [{productId:1,quantity:0}], [{productId:1,quantity:21}], [{productId:1,quantity:11},{productId:1,quantity:10}],
 ].map(items=>[items]))('fails locally before any partial order for invalid items %j',async(items)=>{const c=await database(),a=adapters();await expect(checkout(c,input(items),a)).rejects.toThrow();await empty(c);expect(a.charge).not.toHaveBeenCalled();});
 it.each(['orderItems','stockReservations'])('rolls back order, first item and reservations when second %s insert fails',async(table)=>{
  const c=await database(),a=adapters();
  await c.query(`CREATE TRIGGER synthetic_failure BEFORE INSERT ON ${table} FOR EACH ROW BEGIN IF NEW.productId=2 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='SYNTHETIC_INSERT_FAILURE'; END IF; END`);
  await expect(checkout(c,input([{productId:1,quantity:1},{productId:2,quantity:1}]),a)).rejects.toThrow('SYNTHETIC_INSERT_FAILURE');await empty(c);expect(a.charge).not.toHaveBeenCalled();
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
 it('enforces the reservation FK and coupon/shipping total; rolls back coupon use on local failure',async()=>{
  const c=await database(),a=adapters();await c.query("INSERT INTO coupons (code,type,value,maxUses) VALUES ('SYNTHETIC','percent',10,1)");
  a.quote.mockResolvedValue({options:[{id:'local',label:'Local',price:5}]});
  const request={...input([{productId:2,variantId:1,quantity:2},{productId:2,quantity:1}]),couponCode:'SYNTHETIC'};
  const r=await checkout(c,request,a);expect(r.totalPrice).toBe(12150);
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
  const r=await checkout(c,input([{productId:2,quantity:1,size:'M',color:'Blue'}]),a);
  expect(r.items[0]).toMatchObject({variantId:1,unitPrice:5000,sku:'SYNTHETIC-SKU'});
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
  const c=await database(),r=await checkout(c,input([{productId:2,variantId:1,quantity:2}]),adapters());
  const previous=process.env.DATABASE_URL;
  process.env.DATABASE_URL=url(c.config.database!)+'?socketPath='+encodeURIComponent(socketPath);
  const db=await import('../db');
  try {
   await c.query("UPDATE products SET price=1,name='Changed',imageUrl='/changed' WHERE id=2");
   expect((await db.getOrderReservationItems(r.orderId))[0]).toMatchObject({productName:'Frozen B',productPrice:5000,productImage:'/fixture-b.png'});
   await db.markOrderPaid(r.orderId,{source:'manual',actorUserId:1});
   await db.markOrderPaid(r.orderId,{source:'manual',actorUserId:1});
   expect((await rows(c,'SELECT stock FROM productVariants WHERE id=1'))[0].stock).toBe(18);
   expect((await rows(c,'SELECT stock FROM products WHERE id=2'))[0].stock).toBe(18);
   expect((await rows(c,'SELECT status FROM stockReservations'))[0].status).toBe('consumed');
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
