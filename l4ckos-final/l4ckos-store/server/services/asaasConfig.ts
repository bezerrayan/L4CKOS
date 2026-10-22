/** Shared fail-closed configuration. Never infer production from a missing URL. */
export function getAsaasConfig() {
  const apiKey=process.env.ASAAS_API_KEY?.trim();
  const raw=process.env.ASAAS_API_URL?.trim();
  if(!apiKey)throw Error('ASAAS_API_KEY_REQUIRED');
  if(!raw)throw Error('ASAAS_API_URL_REQUIRED');
  let url:URL;try{url=new URL(raw);}catch{throw Error('ASAAS_API_URL_INVALID');}
  const sandbox=url.origin==='https://api-sandbox.asaas.com';
  if(!['https://api-sandbox.asaas.com','https://api.asaas.com'].includes(url.origin)||
    url.pathname.replace(/\/+$/,'')!=='/v3'||url.search||url.hash||url.username||url.password)
    throw Error('ASAAS_API_URL_INVALID');
  const staging=process.env.APP_ENV==='staging'||process.env.EMAIL_ENV==='staging'||
    process.env.RAILWAY_PROJECT_ID==='2bb90c8e-eb65-43ee-826b-f93750f0499c'||
    process.env.RAILWAY_ENVIRONMENT_ID==='15545eee-bc02-4b70-afc4-19a5db9e6f46';
  if((staging||process.env.ASAAS_ENV==='sandbox')&&!sandbox)throw Error('ASAAS_ENVIRONMENT_MISMATCH');
  if(process.env.ASAAS_ENV==='production'&&sandbox)throw Error('ASAAS_ENVIRONMENT_MISMATCH');
  const checkoutBaseUrl=sandbox?'https://sandbox.asaas.com':'https://www.asaas.com';
  const configuredCheckout=process.env.ASAAS_CHECKOUT_BASE_URL?.trim().replace(/\/+$/,'');
  if(configuredCheckout&&configuredCheckout!==checkoutBaseUrl)throw Error('ASAAS_CHECKOUT_ENVIRONMENT_MISMATCH');
  return {apiKey,apiUrl:url.origin+'/v3',checkoutBaseUrl};
}
