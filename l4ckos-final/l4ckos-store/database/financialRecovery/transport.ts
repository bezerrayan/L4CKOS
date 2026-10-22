import { readFile, writeFile } from 'node:fs/promises';
import { sha256 } from '../schema/fingerprint';
import { TARGET, requestSchema, assertApproval, stop } from './policy';
// Emits a launcher file locally. It does not spawn Railway/node or touch remote
// files. Future SSH execution requires approval for temp artifact placement too.
export async function prepareTransport(artifact: string, input: unknown, output: string, expectedHash: string) {
  if(!/^\/tmp\/l4ckos-financial-operator-[A-Za-z0-9_-]+\/operator\.cjs$/.test(artifact) ||
    !/^\/tmp\/l4ckos-financial-operator-[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.launcher\.cjs$/.test(output))
    stop('RECOVERY_PRIVATE_PACKAGE_PATH_REQUIRED');
  const request=requestSchema.parse(input),bytes=await readFile(artifact);
  if(sha256(bytes)!==expectedHash) stop('RECOVERY_ARTIFACT_HASH_MISMATCH');
  assertApproval(request,expectedHash);
  const requestBytes=JSON.stringify(request);
  if(Buffer.byteLength(requestBytes)>128*1024) stop('RECOVERY_INPUT_TOO_LARGE');
  // Base64 and JSON strings prevent shell/code interpolation of approval text.
  const launcher=`'use strict';\nconst fs=require('node:fs'),crypto=require('node:crypto'),cp=require('node:child_process');
const expected=${JSON.stringify({RAILWAY_PROJECT_ID:TARGET.projectId,RAILWAY_ENVIRONMENT_ID:TARGET.environmentId,RAILWAY_SERVICE_ID:TARGET.serviceId,RAILWAY_DEPLOYMENT_ID:TARGET.deploymentId})};
for(const [k,v] of Object.entries(expected))if(process.env[k]!==v){console.error(JSON.stringify({status:'STOPPED',code:'RECOVERY_ENVIRONMENT_MISMATCH'}));process.exit(1);}
const bytes=Buffer.from(${JSON.stringify(bytes.toString('base64'))},'base64');
if(crypto.createHash('sha256').update(bytes).digest('hex')!==${JSON.stringify(expectedHash)})process.exit(1);
const dir=fs.mkdtempSync('/tmp/l4ckos-financial-recovery-');fs.chmodSync(dir,0o700);
const file=dir+'/operator.cjs';fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});
const r=cp.spawnSync(process.execPath,[file],{input:${JSON.stringify(requestBytes)},encoding:'utf8',env:{...process.env,NODE_PATH:'/app/node_modules'},maxBuffer:256*1024});
if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);
if(r.error){console.error(JSON.stringify({status:'STOPPED',code:'RECOVERY_TRANSPORT_FAILED',action:'STOP_AND_READ_INDEPENDENTLY_NO_AUTOMATIC_RETRY'}));process.exit(1);}process.exit(r.status??1);\n`;
  await writeFile(output,launcher,{flag:'wx',mode:0o600});
  return {artifactHash:expectedHash,launcherHash:sha256(launcher),operation:request.operation,mode:request.mode,remoteExecuted:false};
}
