import { checkpoint, validateContinuation } from "./checkpoint";
import { randomUUID } from "node:crypto";
import { createInterface } from 'node:readline';
import { writeFile } from "node:fs/promises";
import { openBackupConnection } from "../../server/database/backupRestore";
import { capture, validatePrior } from "./evidence";
import { activateBarrier, adoptBarrier, assertBarrier, allowApplicationReads, releaseBarrier, type BarrierState } from "./barrier";
import { inspect0022Recovery, recoverPartial0022 } from './recovery';
import { execute0023, inspect0023Recovery, recover0023 } from './inboxMigration';
import { suspendScheduler, restoreScheduler } from './scheduler';
import { rows, sha256 } from "../schema/fingerprint";
import { verifyCapability, type Capability } from "./capability";
import type { Connection } from "mysql2/promise";
import {
  remoteCapability,
  assertRemoteEnvironment,
  assertPrivateUrl,
  verifyRemoteIdentity,
  type RemoteIdentity,
} from "./capability";
import { execute0022, verifyMigrationScope } from "./runner";
import { assertPlan, digest, fail, APPLICATION_RC, PRE, SQL_SHA, SQL_SHA23, type WindowPlan } from "./policy";

/** Retired single-shot entry point. Contained restoration requires the sequence. */
export async function runWindow(p: WindowPlan, approval: string) {
  // Legacy single-shot application cannot satisfy the contained restore gate.
  fail("PRE_DDL_CHECKPOINT_REQUIRED");
}

/** One privileged session and exclusive window lock across BOTH migrations and
 * local v3 restore. No administrative account is reopened between phases. EOF,
 * malformed input or transport loss closes the operator but preserves quarantine.
 * Control messages arrive over private stdin; credentials are never output. */
export type SavedSequence = {identity:WindowPlan,planDigest:string,phase23?:WindowPlan,scheduler:{previous:'ON'|'OFF'},barrier:BarrierState};
export type SocketRuntime = {mysqlDeployment:string,httpApproval:string};
export async function resumeWindowSequence(saved:SavedSequence,approval:string,runtime?:SocketRuntime) {
  if(approval!==digest(saved)||saved.planDigest!==digest(saved.identity)||!saved.barrier||!saved.scheduler)fail('SEQUENCE_RECOVERY_APPROVAL_REQUIRED');
  if(saved.phase23) {
    assertPlan(saved.phase23);
    if(saved.phase23.sqlChecksum!==SQL_SHA23||['target','deploymentId','serverUuid','endpointHash','applicationCommit'].some(k=>digest((saved.phase23 as any)[k])!==digest((saved.identity as any)[k])))fail('SEQUENCE_PLAN_MISMATCH');
  }
  return runWindowSequence(saved.identity,digest(saved.identity),digest({plan:digest(saved.identity),action:'suspend-scheduler'}),{saved,approval},runtime);
}
export async function runSocketWindowSequence(p:WindowPlan,approval:string,schedulerApproval:string,runtime:SocketRuntime) {
  return runWindowSequence(p,approval,schedulerApproval,undefined,runtime);
}
export async function runWindowSequence(p:WindowPlan,approval:string,schedulerApproval:string,resume?:{saved:SavedSequence,approval:string},runtime?:SocketRuntime) {
  assertRemoteEnvironment(p,runtime?.mysqlDeployment);assertPlan(p);
  if(p.sqlChecksum!==SQL_SHA||p.applicationCommit!==APPLICATION_RC||approval!==digest(p)||
     schedulerApproval!==digest({plan:digest(p),action:'suspend-scheduler'}))fail('SEQUENCE_APPROVAL_REQUIRED');
  if(runtime ? runtime.httpApproval!==digest({plan:digest(p),action:'http-maintenance-confirmed',apiDeploymentId:p.deploymentId}) : process.env.STAGING_MAINTENANCE_MODE!=='true')fail('HTTP_MAINTENANCE_REQUIRED');
  if(runtime&&!process.env.MYSQL_ROOT_PASSWORD)fail('SOCKET_RECOVERY_CREDENTIAL_REQUIRED');
  const c=runtime
    ? await openBackupConnection('mysql://root:'+encodeURIComponent(process.env.MYSQL_ROOT_PASSWORD!)+'@localhost/'+p.target.database,'/var/run/mysqld/mysqld.sock')
    : await openBackupConnection(assertPrivateUrl(process.env.L4CKOS_OPERATOR_DATABASE_URL||'',p).href);
  const lock=`l4ckos_window_${sha256(c.config.database!).slice(0,32)}`;
  const input=createInterface({input:process.stdin,crlfDelay:Infinity});
  // Attach the iterator before any DDL await: commands already written by the
  // operator must remain queued while the migration/backup handshake runs.
  const commands=input[Symbol.asyncIterator]();
  let state:BarrierState|undefined,released=false;
  let phase23:WindowPlan|undefined=resume?.saved.phase23;
  const privateFile=`/tmp/l4ckos-window-recovery-${randomUUID()}.json`;
  const preserved:{scheduler?:{previous:'ON'|'OFF'},barrier?:BarrierState}={};
  const save=async()=>writeFile(privateFile,JSON.stringify({identity:p,planDigest:digest(p),phase23,...preserved}),{mode:0o600});
  const emit=(value:unknown)=>console.log(JSON.stringify(value));
  const confirmInventory=async(abort?:Promise<never>)=>{
    const inventory={identity:p,planDigest:digest(p),phase23,...preserved};
    const approval=digest({action:'preserve-recovery-inventory',inventory});
    emit({status:'PRESERVE_RECOVERY_INVENTORY',inventory,approval});
    const next=abort?await Promise.race([commands.next(),abort]):await commands.next();
    if(next.done)fail('RECOVERY_INVENTORY_NOT_CONFIRMED');
    const command=JSON.parse(next.value);
    if(command.type!=='confirm-recovery-inventory'||command.approval!==approval)fail('RECOVERY_INVENTORY_NOT_CONFIRMED');
    assertPlan(phase23??p);
  };
  try {
    let cap=await remoteCapability(c,p,runtime?.mysqlDeployment);
    if(Number((await rows(c,'SELECT GET_LOCK(?,0) acquired',[lock]))[0].acquired)!==1)fail('WINDOW_EXECUTOR_BUSY');
    if(resume) {
      if(resume.approval!==digest(resume.saved)||resume.saved.planDigest!==digest(p)||!['ON','OFF'].includes(resume.saved.scheduler.previous))fail('SEQUENCE_RECOVERY_APPROVAL_REQUIRED');
      preserved.scheduler=resume.saved.scheduler;
      state=await adoptBarrier(c,p,cap,resume.saved.barrier,true);
      preserved.barrier=state;
      await writeFile(privateFile,JSON.stringify({identity:p,planDigest:digest(p),phase23,...preserved}),{mode:0o600,flag:'wx'});
    }else{
      preserved.scheduler=await suspendScheduler(c,true,async s=>{preserved.scheduler=s;await writeFile(privateFile,JSON.stringify({identity:p,planDigest:digest(p),...preserved}),{mode:0o600,flag:'wx'});await confirmInventory();});
      await validatePrior(c);
      await verifyMigrationScope();
      await activateBarrier(c,p,cap,async s=>{preserved.barrier=s;await save();await confirmInventory();});
      state=preserved.barrier!;
      // Saved pre-mutation inventory becomes ready only after successful activation.
      state.ready=true;
    }
    await save();
    const held = await capture(c);
    if (held.fingerprint === PRE) {
      const admission = p, point = checkpoint(admission, held);
      // Named lock and privileged connection remain alive throughout export/restore.
      // Account locks/read_only persist on EOF; a new process gets a NEW challenge.
      let stopped: unknown, checking = false;
      const guard = async () => {
        const r = (await rows(c, 'SELECT CONNECTION_ID() owner, IS_USED_LOCK(?) holder, @@read_only ro, @@event_scheduler scheduler', [lock]))[0];
        if (Number(r.owner) !== Number(r.holder) || Number(r.ro) !== 1 || r.scheduler !== 'OFF') fail('PRE_DDL_CONTAINMENT_LOST');
        const accounts = await rows(c, "SELECT User user, Host host FROM mysql.user WHERE account_locked='N' AND NOT(User='root' AND Host='localhost')");
        if (accounts.length) fail('PRE_DDL_CONTAINMENT_LOST');
        if (Number((await rows(c, 'SELECT COUNT(*) n FROM information_schema.EVENTS'))[0].n)) fail('PRE_DDL_CONTAINMENT_LOST');
      };
      let rejectLoss!: (error: unknown) => void;
      const loss = new Promise<never>((_, reject) => { rejectLoss = reject; });
      void loss.catch(() => {});
      const timer = setInterval(() => {
        if (checking || stopped) return;
        checking = true;
        void guard().catch(error => { stopped = error; rejectLoss(error); }).finally(() => { checking = false; });
      }, 250);
      timer.unref();
      try {
        await assertBarrier(c); await guard();
        emit({status:'V2_BACKUP_REQUIRED',checkpoint:point,barrierState:state,recoveryFile:privateFile});
        let continued = false;
        while (!continued) {
          const line = await Promise.race([commands.next(), loss]);
          if (line.done) fail('PRE_DDL_CONTINUATION_REQUIRED');
          if (line.value.length > 8*1024*1024) fail('CONTROL_MESSAGE_TOO_LARGE');
          const command = JSON.parse(line.value);
          if (command.type === 'snapshot') {
            await assertBarrier(c); await guard();
            emit({status:'SNAPSHOT_HELD',snapshot:await capture(c)}); continue;
          }
          if (command.type !== 'continue0022') fail('PRE_DDL_CONTINUATION_REQUIRED');
          await guard(); await assertBarrier(c); await validatePrior(c);
          const next = command.plan as WindowPlan;
          validateContinuation(point, admission, next, command.approval, await capture(c));
          const nextCap = await remoteCapability(c,next,runtime?.mysqlDeployment);
          if (stopped) throw stopped;
          await guard();
          // Preserve the exact approved fresh proof BEFORE the first ledger/DDL write.
          p = next; cap = nextCap; await save(); await confirmInventory(loss);
          await guard(); await assertBarrier(c);
          validateContinuation(point,admission,p,command.approval,await capture(c));
          if (stopped) throw stopped;
          clearInterval(timer);
          await execute0022(c,p,cap);
          continued = true;
        }
      } finally { clearInterval(timer); }
      emit({status:'V3_HELD',snapshot:await capture(c),barrierState:state,recoveryFile:privateFile});
    } else emit({status:'RECOVERY_HELD',snapshot:held,barrierState:state,recoveryFile:privateFile});
    for await(const line of commands) {
      if(line.length>8*1024*1024)fail('CONTROL_MESSAGE_TOO_LARGE');
      const command=JSON.parse(line);
      if(command.type==='snapshot') {
        await assertBarrier(c);emit({status:'SNAPSHOT_HELD',snapshot:await capture(c)});
      }else if(command.type==='inspect0022Recovery') {
        if(phase23||released)fail('SEQUENCE_PHASE_INVALID');
        emit({proposal:await inspect0022Recovery(c,p,cap)});
      }else if(command.type==='recover0022') {
        if(phase23||released)fail('SEQUENCE_PHASE_INVALID');
        emit(await recoverPartial0022(c,p,cap,command.approval));
      }else if(command.type==='apply0023') {
        if(phase23||released)fail('SEQUENCE_PHASE_INVALID');
        const next=command.plan as WindowPlan;
        assertPlan(next);
        if(next.sqlChecksum!==SQL_SHA23||command.approval!==digest(next)||
           ['target','deploymentId','serverUuid','endpointHash','applicationCommit'].some(k=>digest((next as any)[k])!==digest((p as any)[k])))fail('SEQUENCE_PLAN_MISMATCH');
        phase23=next;
        const cap23=await remoteCapability(c,next,runtime?.mysqlDeployment);
        preserved.barrier=state;await save();await confirmInventory();
        try { await execute0023(c,next,cap23); }
        catch { emit({status:'STOPPED_0023',barrier:'DO_NOT_RELEASE',recoveryFile:privateFile});continue; }
        emit({status:'V4_HELD',snapshot:await capture(c),recoveryFile:privateFile});
      }else if(command.type==='inspect0023Recovery') {
        if(!phase23)fail('SEQUENCE_PHASE_INVALID');
        emit({proposal:await inspect0023Recovery(c,phase23,await remoteCapability(c,phase23,runtime?.mysqlDeployment))});
      }else if(command.type==='recover0023') {
        if(!phase23)fail('SEQUENCE_PHASE_INVALID');
        emit(await recover0023(c,phase23,await remoteCapability(c,phase23,runtime?.mysqlDeployment),command.approval));
      }else if(command.type==='admit-read' || command.type==='release') {
        if(!phase23||!state||released)fail('SEQUENCE_PHASE_INVALID');
        if(runtime&&!/^[a-f0-9-]{36}$/.test(command.apiDeploymentId??''))fail('RC2_DEPLOYMENT_EVIDENCE_REQUIRED');
        const proposal={action:command.type,account:command.type==='admit-read'?command.account:null,applicationCommit:APPLICATION_RC,state,approver:command.approver,...(runtime?{apiDeploymentId:command.apiDeploymentId}:{})};
        if(command.approver!==p.approver||command.approval!==digest(proposal))fail('SEPARATE_BARRIER_APPROVAL_REQUIRED');
        if(command.type==='admit-read')state=await allowApplicationReads(c,state,command.account,true,true);
        else{await releaseBarrier(c,state,true,true);released=true;}
        preserved.barrier=state;await save();emit({status:released?'RELEASED':'READ_ONLY_ADMISSION',proposal,barrierState:state});
      }else if(command.type==='restore-scheduler') {
        if(!released||command.approver!==p.approver||command.approval!==digest({action:'restore-scheduler',state:preserved.scheduler,approver:command.approver,applicationCommit:APPLICATION_RC}))fail('SCHEDULER_RESTORE_APPROVAL_REQUIRED');
        await restoreScheduler(c,preserved.scheduler!,true);emit({status:'SCHEDULER_RESTORED'});break;
      }else fail('UNKNOWN_SEQUENCE_COMMAND');
    }
    return {status:released?'RELEASED':'STOPPED',barrier:released?'RELEASED':'DO_NOT_RELEASE',recoveryFile:privateFile};
  }finally{input.close();try{await c.query('SELECT RELEASE_LOCK(?)',[lock]);}finally{await c.end();}}
}

export async function inspectWindow(p: RemoteIdentity) {
  assertRemoteEnvironment(p);
  const url = assertPrivateUrl(process.env.DATABASE_URL || "", p);
  const c = await openBackupConnection(url.href);
  try {
    await verifyRemoteIdentity(c, p);
    await validatePrior(c);
    return await capture(c);
  } finally {
    await c.end();
  }
}

/** Arbitration begins BEFORE account/global writes. A losing full executor cannot
 * quarantine or kill the winning executor's session.
 */
export async function applyGovernedWindow(c: Connection, plan: WindowPlan, cap: Capability,
  preserve: (state: BarrierState) => Promise<void>, log: (event: string) => void = () => {}) {
  // Retained for strictly-local fault rehearsals; no remote entry may use it.
  if (process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_ENVIRONMENT_ID || process.env.RAILWAY_SERVICE_ID)
    fail('PRE_DDL_CHECKPOINT_REQUIRED');
  await verifyCapability(c, plan, cap);
  const lock = `l4ckos_window_${sha256(c.config.database!).slice(0,32)}`;
  if (Number((await rows(c, 'SELECT GET_LOCK(?,0) acquired', [lock]))[0].acquired) !== 1)
    fail('WINDOW_EXECUTOR_BUSY');
  try {
    await validatePrior(c);
    await activateBarrier(c, plan, cap, preserve);
    log('barrier_active');
    return await execute0022(c, plan, cap, log);
  } finally {
    if (Number((await rows(c, 'SELECT RELEASE_LOCK(?) released', [lock]))[0].released) !== 1)
      fail('WINDOW_LOCK_RELEASE_FAILED');
  }
}
