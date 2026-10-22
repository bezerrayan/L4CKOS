import type { Connection } from 'mysql2/promise';
import { rows } from '../schema/fingerprint';
import { fail } from './policy';

/** Explicit operator action, never inferred from HTTP maintenance. Inventory is
 * durably preserved before the global change; no scheduled events are accepted. */
export async function suspendScheduler(c:Connection,approved:boolean,preserve:(state:{previous:'ON'|'OFF'})=>Promise<void>) {
  if(!approved)fail('SCHEDULER_APPROVAL_REQUIRED');
  const previous=String((await rows(c,'SELECT @@GLOBAL.event_scheduler scheduler'))[0].scheduler);
  if(!['ON','OFF'].includes(previous))fail('SCHEDULER_MODE_UNSUPPORTED');
  if(Number((await rows(c,'SELECT COUNT(*) n FROM information_schema.EVENTS'))[0].n))fail('SCHEDULED_EVENTS_REQUIRE_REVIEW');
  const state={previous:previous as 'ON'|'OFF'};
  await preserve(state);
  if(previous==='ON')await c.query('SET GLOBAL event_scheduler=OFF');
  if((await rows(c,'SELECT @@GLOBAL.event_scheduler scheduler'))[0].scheduler!=='OFF')fail('SCHEDULER_SUSPENSION_FAILED');
  return state;
}
export async function restoreScheduler(c:Connection,state:{previous:'ON'|'OFF'},approved:boolean) {
  if(!approved||!['ON','OFF'].includes(state.previous))fail('SCHEDULER_RESTORE_APPROVAL_REQUIRED');
  if(Number((await rows(c,'SELECT @@GLOBAL.read_only ro'))[0].ro)!==0)fail('BARRIER_STILL_HELD');
  if((await rows(c,'SELECT @@GLOBAL.event_scheduler scheduler'))[0].scheduler!=='OFF')fail('SCHEDULER_STATE_CHANGED');
  if(Number((await rows(c,'SELECT COUNT(*) n FROM information_schema.EVENTS'))[0].n))fail('SCHEDULED_EVENTS_REQUIRE_REVIEW');
  await c.query(state.previous==='ON'?'SET GLOBAL event_scheduler=ON':'SET GLOBAL event_scheduler=OFF');
  if((await rows(c,'SELECT @@GLOBAL.event_scheduler scheduler'))[0].scheduler!==state.previous)fail('SCHEDULER_RESTORE_FAILED');
}
