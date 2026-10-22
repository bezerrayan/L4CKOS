import { createHash } from "node:crypto";
export function verifiedLoader(
  bytes: Buffer,
  args: string[],
  input = "",
  expectedHash = createHash("sha256").update(bytes).digest("hex")
) {
  const read =
    args.length === 1 &&
    ["preflight", "dry-run", "backup", "verify-outcome"].includes(args[0]);
  const commit =
    args.length === 2 &&
    args[0] === "--commit-order13-once" &&
    /^[a-f0-9]{64}$/.test(args[1]);
  if (!read && !commit) throw Error("EXPLICIT_ENTRYPOINT_REQUIRED");
  if (!/^[a-f0-9]{64}$/.test(expectedHash))
    throw Error("ARTIFACT_HASH_REQUIRED");
  const runtimeGate = commit
    ? `const authorization=process.argv.slice(2);if(authorization.length!==2||authorization[0]!=='--authorize-order13-at-runtime'||authorization[1]!==${JSON.stringify(args[1])}){console.error(JSON.stringify({status:'BLOCKED',code:'RUNTIME_COMMIT_AUTHORIZATION_REQUIRED',commitState:'not_started',remoteFinancialMutations:0}));process.exit(64);}`
    : "";
  return `try {
${runtimeGate}
const crypto=require('node:crypto'),Module=require('node:module');
const bytes=Buffer.from(${JSON.stringify(bytes.toString("base64"))},'base64');
const hash=crypto.createHash('sha256').update(bytes).digest('hex');
if(hash!==${JSON.stringify(expectedHash)})throw Error('ARTIFACT_HASH_MISMATCH');
Object.defineProperty(globalThis,'__order13ArtifactHash',{value:hash,writable:false});
Object.defineProperty(globalThis,'__order13Input',{value:Buffer.from(${JSON.stringify(Buffer.from(input).toString("base64"))},'base64').toString('utf8'),writable:false});
process.argv=[process.execPath,'/app/order13-prepared.cjs',...${JSON.stringify(args)}];
const m=new Module('/app/order13-prepared.cjs',module);m.filename='/app/order13-prepared.cjs';m.paths=Module._nodeModulePaths('/app');m._compile(bytes.toString('utf8'),m.filename);
} catch {console.error(JSON.stringify({status:'STOP',code:'ORDER13_LOADER_FAILED',commitState:'unknown',action:'READ_INDEPENDENTLY_NO_AUTOMATIC_RETRY'}));process.exit(1);}
`;
}

export const blockedCommitLoader = `console.error(JSON.stringify({status:'BLOCKED',code:'COMMIT_APPROVAL_NOT_SUPPLIED',commitState:'not_started',remoteFinancialMutations:0}));process.exit(78);
`;
