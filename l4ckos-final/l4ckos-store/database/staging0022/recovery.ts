import type { Connection } from 'mysql2/promise';
import { performance } from 'node:perf_hooks';
import { readArtifact, readCurrentContract } from '../schema/artifacts';
import { canonical, rows, sha256, structuralHash } from '../schema/fingerprint';
import { execution, completeExecution, insertLedger, validateGovernance } from '../schema/governance';
import { validateHistory } from '../migrations/runner';
import { assertBarrier } from './barrier';
import { verifyCapability, type Capability } from './capability';
import { capture, foreignKeys } from './evidence';
import { verifyMigrationScope } from './runner';
import { digest, assertPlan, PRE, POST, NAME, SQL_SHA, fail, type WindowPlan } from './policy';

async function partialFingerprints() {
  const base = JSON.parse((await readArtifact('database/schema/contract-v2.json','database/schema')).toString());
  const post = await readCurrentContract();
  const fingerprints = [PRE];
  for (let step=1;step<=3;step++) {
    const schema = structuredClone(base.schema);
    for (const name of ['productionBatches', ...(step===3?['orderItems']:[])]) {
      const table = schema.tables.find((t: {name:string}) => t.name===name)!;
      const approved = post.schema.tables.find(t=>t.name===name)!;
      table.columns = structuredClone(approved.columns);
      if (name==='productionBatches' && step===1)
        table.columns.find((c:{name:string})=>c.name==='manufacturingScheduleRequired').defaultValue='0';
    }
    fingerprints.push(structuralHash(schema));
  }
  if(fingerprints[3]!==POST) fail('RECOVERY_CONTRACT_INVALID');
  return fingerprints;
}
/** Read-only recovery proposal: binds exact interrupted execution and real DDL
 * state. Approval of the original migration does not approve this continuation.
 */
export async function inspect0022Recovery(c: Connection, plan: WindowPlan, cap: Capability) {
  await verifyCapability(c,plan,cap); await assertBarrier(c); await validateGovernance(c);
  await verifyMigrationScope();
  const pending = await rows(c,"SELECT * FROM _l4ckos_schema_executions WHERE state<>'COMPLETED'");
  if(pending.length!==1) fail('RECOVERY_SINGLE_EXECUTION_REQUIRED');
  const original=pending[0];
  if(original.operation!==NAME || original.checksum!==SQL_SHA || original.applicationCommit!==plan.applicationCommit || original.preFingerprint!==PRE)
    fail('RECOVERY_EXECUTION_MISMATCH');
  const current=await capture(c,plan.backup.sourceAfter);
  const step=(await partialFingerprints()).indexOf(current.fingerprint);
  const checkpoint=Number(original.completedStatements);
  if(step<0 || !Number.isInteger(checkpoint) || checkpoint<0 || checkpoint>3 || step<checkpoint || step>checkpoint+1)
    fail('RECOVERY_PARTIAL_SCHEMA_UNRECOGNIZED');
  if(current.ledgerHash!==plan.backup.sourceAfter.ledgerHash) fail('RECOVERY_LEDGER_CHANGED');
  for(const [name,table] of Object.entries(plan.backup.sourceAfter.tables))
    if(!name.startsWith('_l4ckos_') && canonical(current.tables[name])!==canonical(table)) fail('RECOVERY_EXISTING_DATA_CHANGED');
  return { planDigest:digest(plan), executionId:Number(original.id), previousState:String(original.state),
    checkpoint, actualStep:step, fingerprint:current.fingerprint };
}
/** Forward-only continuation of EXACT remaining 0022 DDL. Never auto-invoked.
 * The original failure evidence/error remains; actual completion and ledger are
 * committed atomically, with a separate recovery execution audit.
 */
export async function recoverPartial0022(c: Connection, plan: WindowPlan, cap: Capability, approval: string) {
  const lock=`l4ckos_schema_v2_${sha256(c.config.database!).slice(0,32)}`;
  if(Number((await rows(c,'SELECT GET_LOCK(?,0) acquired',[lock]))[0].acquired)!==1) fail('SCHEMA_LOCK_UNAVAILABLE');
  try {
    const proposal=await inspect0022Recovery(c,plan,cap);
    if(approval!==digest(proposal)) fail('RECOVERY_CONTINUATION_APPROVAL_REQUIRED');
    const {entry,lineage}=await verifyMigrationScope();
    const context={applicationCommit:plan.applicationCommit,approvedFingerprint:POST}, startedAt=performance.now();
    await execution(c,context,{name:`recovery-${NAME}-${proposal.executionId}`,checksum:SQL_SHA,preFingerprint:proposal.fingerprint},async(checkpoint,recoveryId)=>{
      let step=proposal.actualStep;
      for(const statement of entry.statements.slice(step)) {
        await verifyCapability(c,plan,cap);await assertBarrier(c);assertPlan(plan);
        if((await capture(c,plan.backup.sourceAfter)).fingerprint!==(await partialFingerprints())[step]) fail('RECOVERY_SCHEMA_CHANGED');
        const timer=setTimeout(()=>c.destroy(),45000);
        try { await c.query(statement); } finally { clearTimeout(timer); }
        step++;await checkpoint();
      }
      const after=await capture(c,plan.backup.sourceAfter);
      if(after.fingerprint!==POST)fail('0022_POST_SCHEMA_MISMATCH');
      for(const [name,table] of Object.entries(plan.backup.sourceAfter.tables))
        if(!name.startsWith('_l4ckos_')&&canonical(after.tables[name])!==canonical(table))fail('RECOVERY_EXISTING_DATA_CHANGED');
      if(Number((await rows(c,'SELECT COUNT(*) n FROM productionBatches WHERE estimatedManufacturingStart IS NOT NULL OR estimatedManufacturingEnd IS NOT NULL OR manufacturingScheduleRequired<>0'))[0].n)||
        Number((await rows(c,'SELECT COUNT(*) n FROM orderItems WHERE estimatedManufacturingStartAtPurchase IS NOT NULL OR estimatedManufacturingEndAtPurchase IS NOT NULL'))[0].n))fail('0022_LEGACY_DEFAULTS_INVALID');
      await foreignKeys(c);
      await c.beginTransaction();
      try {
        await insertLedger(c,context,{...entry,preFingerprint:PRE,postFingerprint:POST,manifestVersion:2,startedAt});
        await c.query("UPDATE _l4ckos_schema_executions SET state='STARTED',completedStatements=3 WHERE id=? AND state=?",[proposal.executionId,proposal.previousState]);
        await completeExecution(c,proposal.executionId,POST);await completeExecution(c,recoveryId,POST);await c.commit();
      } catch(error){await c.rollback();throw error;}
    });
    await validateHistory(c,lineage);await assertBarrier(c);
    return {status:'RECOVERED_FORWARD',fingerprint:POST,barrier:'HELD',proposal};
  }finally{
    if(Number((await rows(c,'SELECT RELEASE_LOCK(?) released',[lock]))[0].released)!==1)fail('SCHEMA_LOCK_RELEASE_FAILED');
  }
}
