import { annotateValidation, diagnosticStage } from './diagnostics';
import { z } from 'zod';
import type { FinancialRecoveryPlan } from '../../server/payments/supervisedFinancialRecoveryRehearsal';
import { TARGET, stop, type Environment } from './policy';

const paymentSchema = z.object({ id: z.literal(TARGET.paymentId), externalReference: z.literal('13'),
  status: z.literal('RECEIVED'), billingType: z.literal('PIX'), value: z.literal(99),
  netValue: z.number().finite().min(0).max(99), deleted: z.literal(false),
  refunds: z.array(z.unknown()).nullable().optional(), chargeback: z.unknown().optional(),
});
// Public payment-object docs show refunds:null. It never replaces the independent
// refunds GET nor relaxes any financial identity/status/value requirement.
const paymentTypes:Record<string,string>={id:'string',externalReference:'string',status:'string',billingType:'string',
  value:'number',netValue:'number',deleted:'boolean',refunds:'array|null|undefined',chargeback:'unknown'};
const valueType=(v:unknown)=>v===null?'null':Array.isArray(v)?'array':typeof v;
export function parsePaymentResponse(raw:unknown) {
  const result=paymentSchema.safeParse(raw);
  if(result.success)return result.data;
  annotateValidation(result.error,result.error.issues.map(issue=>{
    const field=issue.path[0];
    const known=typeof field==='string' && Object.hasOwn(paymentTypes,field);
    return {path:known?[field]:[],code:issue.code,
      expectedType:known?paymentTypes[field]:'object',
      receivedType:valueType(known && raw && typeof raw==='object'?(raw as Record<string,unknown>)[field]:raw)};
  }));
  throw result.error; // Never include literal expected/received values or messages.
}
const refundsSchema = z.object({ data: z.array(z.unknown()), hasMore: z.literal(false), totalCount: z.literal(0) });
// Defensive Sandbox-only compatibility, observed by the scoped diagnostic GET.
// No default for absent data or pagination: validate the complete null envelope
// before normalizing it. The original array schema and reversal gate stay intact.
const sandboxEmptyRefundsSchema = z.object({data:z.null(),hasMore:z.literal(false),totalCount:z.literal(0)});
export function parseRefundsResponse(raw:unknown) {
  if(raw!==null && typeof raw==='object' && Object.hasOwn(raw,'data') && (raw as Record<string,unknown>).data===null) {
    const empty=sandboxEmptyRefundsSchema.safeParse(raw);
    if(empty.success)return refundsSchema.parse({...empty.data,data:[]});
    // Continue to the unchanged schema for a fail-closed, sanitized diagnosis.
  }
  const result=refundsSchema.safeParse(raw);
  if(result.success)return result.data;
  const types:Record<string,string>={data:'array',hasMore:'boolean',totalCount:'number'};
  annotateValidation(result.error,result.error.issues.map(issue=>{
    const field=issue.path[0],known=typeof field==='string' && Object.hasOwn(types,field);
    return {path:known?[field]:[],code:issue.code,expectedType:known?types[field]:'object',
      receivedType:valueType(known && raw && typeof raw==='object'?(raw as Record<string,unknown>)[field]:raw)};
  }));
  throw result.error;
}

export type OfficialEvidence = FinancialRecoveryPlan['evidence'];
// Only fixed GETs. No caller-supplied URL, payment ID, credentials or timestamps.
export async function fetchOfficialEvidence(env: Environment, fetcher: typeof fetch = fetch): Promise<OfficialEvidence> {
  const base = env.ASAAS_API_URL?.trim().replace(/\/+$/, '');
  if (base !== 'https://api-sandbox.asaas.com/v3' || !env.ASAAS_API_KEY?.startsWith('$aact_hmlg_'))
    stop('RECOVERY_SANDBOX_CONFIGURATION_REQUIRED');
  const started = Date.now();
  async function get(suffix: string) {
    const response = await fetcher(base+'/payments/'+TARGET.paymentId+suffix, {
      method: 'GET', redirect: 'error', headers: { access_token: env.ASAAS_API_KEY! }, signal: AbortSignal.timeout(20_000),
    });
    if (response.status !== 200 || response.redirected || (response.url && response.url !== base+'/payments/'+TARGET.paymentId+suffix))
      stop('RECOVERY_PROVIDER_READ_FAILED');
    return response.json();
  }
  const raw = await diagnosticStage('provider-payment-get',()=>get(''));
  for(const key of ['paymentDate','confirmedDate','clientPaymentDate','creditDate'])
    if(raw && typeof raw==='object' && raw[key]!=null && (typeof raw[key]!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw[key])))
      stop('RECOVERY_FINANCIAL_TIMESTAMP_REQUIRES_REVIEW');
  const p = await diagnosticStage('provider-payment-validation',async()=>parsePaymentResponse(raw));
  const refundBody=await diagnosticStage('provider-refunds-get',()=>get('/refunds'));
  const refunds = await diagnosticStage('provider-refunds-validation',async()=>parseRefundsResponse(refundBody));
  if (refunds.data.length || p.refunds?.length || p.chargeback != null || Date.now()-started > 60_000)
    stop('RECOVERY_REVERSAL_OR_INCOMPLETE_EVIDENCE');
  const netAmountCents = Math.round(p.netValue*100);
  if (Math.abs(p.netValue*100-netAmountCents)>0.000001) stop('RECOVERY_PROVIDER_AMOUNT_INVALID');
  // This operator implements B with unknown receipt time only. Date-only values
  // from GET are deliberately never converted into a financial timestamp.
  return { source: 'official_sandbox_get', paymentId: TARGET.paymentId, externalReference: '13',
    status: 'RECEIVED', billingType: 'PIX', amountCents: 9900, netAmountCents,
    deleted: false, refundCount: 0, refundsHasMore: false, chargebackPresent: false,
    observedAt: new Date(started).toISOString(), financialReceivedAt: null,
    timestampMeaning: 'not_proven', timestampEvidenceReference: null };
}
