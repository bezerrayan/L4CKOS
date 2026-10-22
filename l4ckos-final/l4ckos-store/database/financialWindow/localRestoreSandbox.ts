import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {createConnection,type Connection} from 'mysql2/promise';
import {withBackupCleanup} from './backupCleanup';
export const LOCAL_RESTORE_STARTUP_MS=60_000;
export type ReadyState={running:boolean;owned:boolean;socketPresent:boolean;socketOwned:boolean;
  identity:string;stdoutReady:number;stderrReady:number};
export type ReadyIO={inspect:()=>ReadyState;connect:()=>Promise<Connection>;pause:()=>Promise<void>;now:()=>number};
/** Text is a hint; owned active endpoint, authenticated SQL and stable process identity are mandatory. */
export async function waitForLocalRestore(io:ReadyIO,socket:string,budget=LOCAL_RESTORE_STARTUP_MS){
 const started=io.now();
 while(io.now()-started<budget){
  const s=io.inspect();
  if(!s.owned)throw Error('LOCAL_RESTORE_UNEXPECTED_ENDPOINT');
  if(!s.running)throw Error('LOCAL_RESTORE_PROCESS_EXITED');
  if(s.socketPresent&&!s.socketOwned&&s.stdoutReady+s.stderrReady>=2)throw Error('LOCAL_RESTORE_UNEXPECTED_ENDPOINT');
  if(s.stdoutReady+s.stderrReady>=2 && s.socketOwned){
   let c:Connection;
   try{c=await io.connect();}catch(e){throw Error((e as {code?:string}).code==='ER_ACCESS_DENIED_ERROR'?'LOCAL_RESTORE_AUTHENTICATION':'LOCAL_RESTORE_CONNECTION');}
   try{
    if(c.config.socketPath!==socket)throw Error('LOCAL_RESTORE_UNEXPECTED_ENDPOINT');
    const [rows]=await c.query({sql:'SELECT 1 n,VERSION() version,@@socket socket,CURRENT_USER() account,SHA2(@@server_uuid,256) uuidHash,CONNECTION_ID() id',timeout:2000});
    const r=(rows as {n:number;version:string;socket:string;account:string;uuidHash:string;id:number}[])[0];
    if(Number(r?.n)!==1||r.version!=='8.4.11'||r.socket!=='/proof/mysqld.sock'||r.account!=='root@localhost')throw Error('LOCAL_RESTORE_SQL_IDENTITY');
    const after=io.inspect();
    if(io.now()-started>=budget)throw Error('LOCAL_RESTORE_STARTUP_TIMEOUT');
    if(!after.owned||!after.running||!after.socketOwned||after.identity!==s.identity)throw Error('LOCAL_RESTORE_UNEXPECTED_ENDPOINT');
    return {connection:c,proof:{authenticated:true,selectOne:true,version:r.version,uuidHash:r.uuidHash,
     processAndSocketOwned:true,processStable:true,stdoutReady:s.stdoutReady,stderrReady:s.stderrReady}};
   }catch(e){c.destroy();throw e;}
  }
  await io.pause();
 }
 throw Error('LOCAL_RESTORE_STARTUP_TIMEOUT');
}
export async function withLocalRestoreCleanup<T>(operation:()=>Promise<T>,cleanup:()=>Promise<void>){
 return withBackupCleanup(operation,[{name:'local-restore-sandbox',run:cleanup}]);
}
const endpointProof=`set -eu
server=''
for f in /proc/[0-9]*/comm; do
 [ -r "$f" ] || continue
 read -r comm < "$f" || continue
 if [ "$comm" = mysqld ]; then [ -z "$server" ] || exit 41; server=\${f#/proc/}; server=\${server%/comm}; fi
done
[ -n "$server" ] && [ -S /proof/mysqld.sock ] || exit 42
[ "$(stat -c %u /proc/$server)" = "$(id -u)" ] || exit 45
inode=$(awk '$8=="/proof/mysqld.sock" {print $7}' /proc/net/unix)
[[ "$inode" =~ ^[0-9]+$ ]] || exit 43
found=0
for f in /proc/"$server"/fd/*; do
 [ "$(readlink "$f" 2>/dev/null || true)" != "socket:[$inode]" ] || found=$((found+1))
done
[ "$found" = 1 ] || exit 44
printf '%s,%s,%s,%s' "$server" "$(awk '{print $22}' /proc/$server/stat)" "$inode" "$(stat -c %i /proof/mysqld.sock)"`;
export class LocalRestoreSandbox{
 readonly nonce=randomUUID();readonly name='l4ckos-restore-'+this.nonce;
 readonly dir='/tmp/'+this.name;readonly socket=this.dir+'/mysqld.sock';
 lastObservation?:ReadyState;
 private password=randomBytes(32).toString('base64url');
 private volumes:string[]=[];private created=false;private connection?:Connection;
 constructor(readonly ownerHash:string){if(!/^[a-f0-9]{64}$/.test(ownerHash))throw Error('LOCAL_RESTORE_OWNER');}
 private command(args:string[],env?:NodeJS.ProcessEnv){
  const r=spawnSync('docker',args,{encoding:'utf8',timeout:30000,maxBuffer:1024*1024,env:env??process.env});
  if(r.status!==0)throw Error('LOCAL_RESTORE_DOCKER_FAILED');return r;
 }
 private inspectContainer(){
  const c=JSON.parse(this.command(['inspect',this.name]).stdout)[0];
  if(c.Name!=='/'+this.name||c.Config.Labels?.['l4ckos.restore-nonce']!==this.nonce||
   c.Config.Labels?.['l4ckos.restore-source']!==this.ownerHash||c.HostConfig.NetworkMode!=='none'||
   Object.keys(c.HostConfig.PortBindings??{}).length||!c.Mounts.some((x:any)=>x.Type==='bind'&&x.Source===this.dir&&x.Destination==='/proof'))throw Error('LOCAL_RESTORE_UNEXPECTED_ENDPOINT');
  this.volumes=c.Mounts.filter((x:any)=>x.Type==='volume').map((x:any)=>String(x.Name));return c;
 }
 inspect():ReadyState{
  const c=this.inspectContainer();
  const logs=this.command(['logs',this.name]);
  const stat=fs.existsSync(this.socket)?fs.lstatSync(this.socket):undefined;
  let identity='',socketOwned=false;
  if(c.State.Running && stat?.isSocket()){
   const r=spawnSync('docker',['exec','--user',String(stat.uid),this.name,'bash','-c',endpointProof],{encoding:'utf8',timeout:5000});
   if(r.status===0 && /^[0-9]+,[0-9]+,[0-9]+,[0-9]+$/.test(r.stdout)){
    socketOwned=Number(r.stdout.split(',')[3])===stat.ino;identity=String(c.State.Pid)+','+r.stdout;
   }
  }
  const state={running:c.State.Running,owned:true,socketPresent:!!stat,socketOwned,identity,
   stdoutReady:(logs.stdout.match(/mysqld: ready for connections/g)??[]).length,
   stderrReady:(logs.stderr.match(/mysqld: ready for connections/g)??[]).length};
  this.lastObservation=state;return state;
 }
 async start(){
  fs.mkdirSync(this.dir,{mode:0o710});
  this.command(['run','--detach','--pull=never','--name',this.name,'--network','none','--memory','1g','--pids-limit','256',
   '--label','l4ckos.restore-nonce='+this.nonce,'--label','l4ckos.restore-source='+this.ownerHash,
   '--mount','type=bind,src='+this.dir+',dst=/proof','--env','MYSQL_ROOT_PASSWORD',
   'mysql:8.4','--socket=/proof/mysqld.sock','--skip-networking'],{...process.env,MYSQL_ROOT_PASSWORD:this.password});
  this.created=true;
  const ready=await waitForLocalRestore({inspect:()=>this.inspect(),connect:()=>createConnection({socketPath:this.socket,
   user:'root',password:this.password,dateStrings:true,jsonStrings:true,timezone:'Z',supportBigNumbers:true,bigNumberStrings:true,
   connectTimeout:2000,multipleStatements:false}),pause:()=>new Promise(r=>setTimeout(r,500)),now:()=>performance.now()},this.socket);
  this.connection=ready.connection;
  return ready;
 }
 async cleanup(){
  this.connection?.destroy();
  if(this.created){
   const c=this.inspectContainer();
   if(c.State.Running)this.command(['exec','--user','0',this.name,'chown',process.getuid!()+':'+process.getgid!(),'/proof']);
   else if(fs.statSync(this.dir).uid!==process.getuid!()){
    this.command(['run','--rm','--pull=never','--name','l4ckos-cleanup-'+this.nonce,'--network','none','--read-only',
     '--cap-drop=ALL','--cap-add=CHOWN','--user','0','--mount','type=bind,src='+this.dir+',dst=/proof',
     '--entrypoint','chown','mysql:8.4',process.getuid!()+':'+process.getgid!(),'/proof']);
   }
   this.command(['rm','--force','--volumes',this.name]);
   if(this.command(['ps','--all','--filter','name=^/'+this.name+'$','--format','{{.ID}}']).stdout.trim())throw Error('LOCAL_RESTORE_CLEANUP_CONTAINER');
   for(const volume of this.volumes){
    const names=this.command(['volume','ls','--filter','name='+volume,'--format','{{.Name}}']).stdout.trim().split('\n');
    if(names.includes(volume))throw Error('LOCAL_RESTORE_CLEANUP_VOLUME');
   }
  }
  if(fs.existsSync(this.dir)){
   if(fs.lstatSync(this.dir).isSymbolicLink()||fs.statSync(this.dir).uid!==process.getuid!())throw Error('LOCAL_RESTORE_CLEANUP_DIRECTORY');
   fs.rmSync(this.dir,{recursive:true,force:false});
  }
  this.password='';return {containerAbsent:true,volumesAbsent:true,directoryAbsent:!fs.existsSync(this.dir)};
 }
}
