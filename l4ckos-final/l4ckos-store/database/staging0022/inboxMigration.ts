import type { Connection } from 'mysql2/promise';
import { performance } from 'node:perf_hooks';
import { readArtifact } from '../schema/artifacts';
import { loadLineage, validateHistory } from '../migrations/runner';
import { execution, completeExecution, insertLedger, validateGovernance } from '../schema/governance';
import { rows, canonical, sha256 } from '../schema/fingerprint';
import { assertBarrier } from './barrier';
import { verifyCapability, type Capability } from './capability';
import { capture, validatePrior, foreignKeys } from './evidence';
import { assertPlan, digest, NAME23, SQL_SHA23, POST, POST23, APPLICATION_RC, fail, snapshotDigest, type WindowPlan } from './policy';

export async function verifyInboxScope() {
  const lineage = await loadLineage(JSON.parse((await readArtifact('database/migrations/manifest-v4.json','database/migrations')).toString()));
  const entry = lineage.entries[2];
  if (lineage.entries.length !== 3 || entry?.name !== NAME23 || entry.checksum !== SQL_SHA23 || entry.expectedPreFingerprint !== POST || entry.expectedPostFingerprint !== POST23 || entry.statements.length !== 1)
    fail('0023_SCOPE_INVALID');
  return { lineage, entry };
}
async function check(c: Connection, p: WindowPlan, cap: Capability) {
  assertPlan(p);
  if (p.sqlChecksum !== SQL_SHA23) fail('0023_PLAN_REQUIRED');
  await verifyCapability(c,p,cap); await assertBarrier(c);
}
async function postcondition(c: Connection,p: WindowPlan) {
  const after = await capture(c,p.backup.sourceAfter,true);
  if (after.fingerprint !== POST23 || after.tables.asaasWebhookInbox?.count !== 0) fail('0023_POST_SCHEMA_OR_INBOX_INVALID');
  for (const [name,t] of Object.entries(p.backup.sourceAfter.tables))
    if (!name.startsWith('_l4ckos_') && canonical(after.tables[name]) !== canonical(t)) fail('0023_EXISTING_DATA_CHANGED');
  await foreignKeys(c);
}
async function locked<T>(c:Connection, action:()=>Promise<T>) {
  const lock = `l4ckos_schema_v2_${sha256(c.config.database!).slice(0,32)}`;
  if(Number((await rows(c,'SELECT GET_LOCK(?,0) acquired',[lock]))[0].acquired)!==1) fail('SCHEMA_LOCK_UNAVAILABLE');
  try { return await action(); }
  finally { if(Number((await rows(c,'SELECT RELEASE_LOCK(?) released',[lock]))[0].released)!==1) fail('SCHEMA_LOCK_RELEASE_FAILED'); }
}
export async function execute0023(c:Connection,p:WindowPlan,cap:Capability) {
  return locked(c,async()=>{
    await check(c,p,cap);
    const {lineage,entry}=await verifyInboxScope();
    const history=await validateHistory(c,lineage);
    if(history.at(-1)?.name===NAME23) {
      const current=await capture(c);
      if(current.fingerprint!==POST23 || history.at(-1)?.applicationCommit!==APPLICATION_RC)fail('0023_REPLAY_INCOMPATIBLE');
      return {status:'UP_TO_DATE',fingerprint:POST23,barrier:'HELD'};
    }
    await validatePrior(c,true);
    if(snapshotDigest(await capture(c))!==snapshotDigest(p.backup.sourceAfter))fail('BACKUP_NO_LONGER_CURRENT');
    const startedAt=performance.now(), context={applicationCommit:p.applicationCommit,approvedFingerprint:POST23};
    await execution(c,context,{name:NAME23,checksum:SQL_SHA23,preFingerprint:POST},async(checkpoint,id)=>{
      await check(c,p,cap);
      await c.query('SET SESSION lock_wait_timeout=5');
      const timer=setTimeout(()=>c.destroy(),45000);
      try{await c.query(entry.statements[0]);}finally{clearTimeout(timer);}
      await checkpoint();await check(c,p,cap);await postcondition(c,p);
      await c.beginTransaction();
      try{await insertLedger(c,context,{...entry,preFingerprint:POST,postFingerprint:POST23,manifestVersion:2,startedAt});await completeExecution(c,id,POST23);await c.commit();}
      catch(error){await c.rollback();throw error;}
    });
    await validateHistory(c,lineage);await assertBarrier(c);
    return {status:'APPLIED',fingerprint:POST23,barrier:'HELD'};
  });
}
/** A CREATE TABLE may commit before checkpoint or connection loss. Never recreate
 * an existing table or erase failure history; approve this exact observed proposal. */
export async function inspect0023Recovery(c:Connection,p:WindowPlan,cap:Capability) {
  await check(c,p,cap);await validateGovernance(c);await verifyInboxScope();
  const pending=await rows(c,"SELECT * FROM _l4ckos_schema_executions WHERE state<>'COMPLETED'");
  if(pending.length!==1)fail('RECOVERY_SINGLE_EXECUTION_REQUIRED');
  const original=pending[0];
  if(original.operation!==NAME23||original.checksum!==SQL_SHA23||original.applicationCommit!==p.applicationCommit||original.preFingerprint!==POST)fail('RECOVERY_EXECUTION_MISMATCH');
  const current=await capture(c,p.backup.sourceAfter,true), actualStep=current.fingerprint===POST?0:current.fingerprint===POST23?1:-1;
  const checkpoint=Number(original.completedStatements);
  if(actualStep<0 || ![0,1].includes(checkpoint) || actualStep<checkpoint || actualStep>checkpoint+1)fail('RECOVERY_PARTIAL_SCHEMA_UNRECOGNIZED');
  if(current.ledgerHash!==p.backup.sourceAfter.ledgerHash)fail('RECOVERY_LEDGER_CHANGED');
  for(const[name,t]of Object.entries(p.backup.sourceAfter.tables))if(!name.startsWith('_l4ckos_')&&canonical(current.tables[name])!==canonical(t))fail('RECOVERY_EXISTING_DATA_CHANGED');
  if(actualStep===1)await postcondition(c,p);
  return {planDigest:digest(p),executionId:Number(original.id),previousState:String(original.state),checkpoint,actualStep,fingerprint:current.fingerprint};
}
export async function recover0023(c:Connection,p:WindowPlan,cap:Capability,approval:string) {
  return locked(c,async()=>{
    const proposal=await inspect0023Recovery(c,p,cap);
    if(approval!==digest(proposal))fail('RECOVERY_CONTINUATION_APPROVAL_REQUIRED');
    const {entry,lineage}=await verifyInboxScope(),startedAt=performance.now(),context={applicationCommit:p.applicationCommit,approvedFingerprint:POST23};
    await execution(c,context,{name:`recovery-${NAME23}-${proposal.executionId}`,checksum:SQL_SHA23,preFingerprint:proposal.fingerprint},async(checkpoint,id)=>{
      await check(c,p,cap);
      if(!proposal.actualStep){const timer=setTimeout(()=>c.destroy(),45000);try{await c.query(entry.statements[0]);}finally{clearTimeout(timer);}await checkpoint();}
      await check(c,p,cap);await postcondition(c,p);
      await c.beginTransaction();
      try {
        await insertLedger(c,context,{...entry,preFingerprint:POST,postFingerprint:POST23,manifestVersion:2,startedAt});
        await c.query("UPDATE _l4ckos_schema_executions SET state='STARTED',completedStatements=1 WHERE id=? AND state=?",[proposal.executionId,proposal.previousState]);
        await completeExecution(c,proposal.executionId,POST23);await completeExecution(c,id,POST23);await c.commit();
      }catch(error){await c.rollback();throw error;}
    });
    await validateHistory(c,lineage);await assertBarrier(c);
    return {status:'RECOVERED_FORWARD',fingerprint:POST23,barrier:'HELD'};
  });
}
