// Diagnostic metadata only: never serialize messages, stacks, SQL or values.
export type ValidationIssue = {path:string[];code:string;expectedType:string;receivedType:string};
const validationIssues = new WeakMap<object,ValidationIssue[]>();
export function annotateValidation(error:object, issues:ValidationIssue[]) {validationIssues.set(error,issues);}
const stages = new WeakMap<object, string>();
const codes = new Map<string, string>([
  ['ER_ACCESS_DENIED_ERROR','mysql-authentication'], ['ER_DBACCESS_DENIED_ERROR','mysql-permission'],
  ['ER_TABLEACCESS_DENIED_ERROR','mysql-permission'], ['ER_SPECIFIC_ACCESS_DENIED_ERROR','mysql-permission'],
  ['ER_BAD_DB_ERROR','mysql-database'], ['ER_NO_SUCH_TABLE','mysql-schema'], ['ER_BAD_FIELD_ERROR','mysql-schema'],
  ['ER_PARSE_ERROR','mysql-query'], ['ER_LOCK_WAIT_TIMEOUT','mysql-concurrency'], ['ER_LOCK_DEADLOCK','mysql-concurrency'],
  ['ENOTFOUND','network'], ['ECONNREFUSED','network'], ['ETIMEDOUT','network'], ['ECONNRESET','network'],
  ['PROTOCOL_CONNECTION_LOST','mysql-connection'], ['ENOENT','filesystem'], ['EACCES','filesystem'],
  ['MODULE_NOT_FOUND','import'], ['ERR_MODULE_NOT_FOUND','import'],
]);
export async function diagnosticStage<T>(phase: string, action:()=>Promise<T>): Promise<T> {
  try { return await action(); }
  catch(error) {
    if(error && typeof error==='object' && !stages.has(error)) stages.set(error,phase);
    throw error; // Retain the original exception and all existing guard semantics.
  }
}
export function safeDiagnostic(error: unknown) {
  const phase=error && typeof error==='object'?stages.get(error):undefined;
  let current=error;
  for(let depth=0;depth<4 && current && typeof current==='object';depth++) {
    const e=current as {code?:unknown;name?:unknown;message?:unknown;cause?:unknown};
    if(typeof e.code==='string' && codes.has(e.code)) return {phase,category:codes.get(e.code),causeCode:e.code};
    if(e.name==='ZodError') return {phase,category:'validation',causeCode:'ZOD_VALIDATION_FAILED',...(validationIssues.has(current)?{issues:validationIssues.get(current)}:{})};
    if(e.name==='SyntaxError') return {phase,category:'parsing',causeCode:'SYNTAX_ERROR'};
    if(e.name==='TimeoutError' || e.name==='AbortError') return {phase,category:'timeout',causeCode:e.name==='TimeoutError'?'TIMEOUT':'ABORTED'};
    if(typeof e.message==='string' && /^RECOVERY_[A-Z_]+$/.test(e.message)) return {phase,category:'guard',causeCode:e.message};
    current=e.cause;
  }
  return {phase,category:'unknown',causeCode:'UNCLASSIFIED_ERROR'};
}
