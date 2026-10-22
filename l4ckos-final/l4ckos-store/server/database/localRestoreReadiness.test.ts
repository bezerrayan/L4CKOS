import {it,expect,vi} from 'vitest';
import {waitForLocalRestore,withLocalRestoreCleanup,type ReadyState} from '../../database/financialWindow/localRestoreSandbox';
const socket='/tmp/l4ckos-test/mysqld.sock';
function fixture(stream='stderr'){
 let clock=0;
 const state:ReadyState={running:true,owned:true,socketPresent:true,socketOwned:true,identity:'owned-process',stdoutReady:stream==='stdout'?2:0,stderrReady:stream==='stderr'?2:0};
 const c={config:{socketPath:socket},query:vi.fn(async()=>[[{n:1,version:'8.4.11',socket:'/proof/mysqld.sock',account:'root@localhost',uuidHash:'local-uuid',id:9}]]),destroy:vi.fn()};
 const io={inspect:vi.fn(()=>state),connect:vi.fn(async()=>c as any),pause:async()=>{clock+=500},now:()=>clock};return {io,state,c};
}
it.each(['stderr','stdout'])('requires authenticated readiness with hints on %s',async stream=>{const f=fixture(stream);const r=await waitForLocalRestore(f.io,socket);expect(r.proof.selectOne).toBe(true);expect(f.io.connect).toHaveBeenCalledTimes(1);expect(f.io.inspect).toHaveBeenCalledTimes(2);});
it('rejects process exit before readiness',async()=>{const f=fixture();f.state.running=false;await expect(waitForLocalRestore(f.io,socket)).rejects.toThrow('LOCAL_RESTORE_PROCESS_EXITED');expect(f.io.connect).not.toHaveBeenCalled();});
it('times out without usable readiness',async()=>{const f=fixture('none');await expect(waitForLocalRestore(f.io,socket,1000)).rejects.toThrow('LOCAL_RESTORE_STARTUP_TIMEOUT');expect(f.io.connect).not.toHaveBeenCalled();});
it('fails closed on authentication error without retry',async()=>{const f=fixture();f.io.connect.mockRejectedValueOnce(Object.assign(Error('sensitive message'),{code:'ER_ACCESS_DENIED_ERROR'}));await expect(waitForLocalRestore(f.io,socket)).rejects.toThrow(/^LOCAL_RESTORE_AUTHENTICATION$/);expect(f.io.connect).toHaveBeenCalledTimes(1);});
it('rejects endpoint not owned before opening a connection',async()=>{const f=fixture();f.state.socketOwned=false;await expect(waitForLocalRestore(f.io,socket)).rejects.toThrow('LOCAL_RESTORE_UNEXPECTED_ENDPOINT');expect(f.io.connect).not.toHaveBeenCalled();});
it('rejects a connector returning an unexpected socket',async()=>{const f=fixture();f.c.config.socketPath='/tmp/foreign.sock';await expect(waitForLocalRestore(f.io,socket)).rejects.toThrow('LOCAL_RESTORE_UNEXPECTED_ENDPOINT');expect(f.c.destroy).toHaveBeenCalled();});
it('rejects process replacement after authentication',async()=>{const f=fixture();f.io.inspect.mockReturnValueOnce({...f.state}).mockReturnValueOnce({...f.state,identity:'replacement'});await expect(waitForLocalRestore(f.io,socket)).rejects.toThrow('LOCAL_RESTORE_UNEXPECTED_ENDPOINT');});
it('does not accept text when SELECT 1/version identity is wrong',async()=>{const f=fixture();f.c.query.mockResolvedValueOnce([[{n:0,version:'8.0',socket:'/proof/mysqld.sock',account:'root@localhost',uuidHash:'local-uuid',id:9}]]);await expect(waitForLocalRestore(f.io,socket)).rejects.toThrow('LOCAL_RESTORE_SQL_IDENTITY');});
it('cleans resources after success',async()=>{const cleanup=vi.fn(async()=>{});expect(await withLocalRestoreCleanup(async()=>42,cleanup)).toBe(42);expect(cleanup).toHaveBeenCalledTimes(1);});
it('cleans after failure and preserves primary separately from cleanup',async()=>{const primary=Error('WINDOW_SYNTHETIC_PRIMARY'),cleanup=vi.fn(async()=>{throw Error('WINDOW_SYNTHETIC_CLEANUP')});try{await withLocalRestoreCleanup(async()=>{throw primary},cleanup);expect.fail()}catch(e){expect((e as any).primaryError).toBe(primary);expect((e as any).cleanupErrors).toHaveLength(1)}expect(cleanup).toHaveBeenCalledTimes(1);});
