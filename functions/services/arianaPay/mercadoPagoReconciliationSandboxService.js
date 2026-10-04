// Ariana Pay — leitura de pagamento Mercado Pago para conciliação em sandbox.
// Nunca usa credencial de produção por fallback. Não grava nada.

function clean(value=''){
  return String(value||'').trim();
}

function money(value){
  if(value===null||value===undefined||String(value).trim()==='') return null;
  const n=Number(value);
  if(!Number.isFinite(n)) return null;
  return Math.round((n+Number.EPSILON)*100)/100;
}

function isOfficialMercadoPagoApiBaseUrl(value=''){
  const raw=clean(value).replace(/\/+$/,'');
  try{
    const parsed=new URL(raw);
    return parsed.protocol==='https:'&&parsed.hostname.toLowerCase()==='api.mercadopago.com';
  }catch(_error){
    return false;
  }
}

export function isMpReconciliationTestAccessToken(value=''){
  return /^TEST-/i.test(clean(value));
}

export function getMpReconciliationSandboxConfig(env=process.env){
  return {
    enabled:clean(env.ARIANA_PAY_RECON_SANDBOX_ENABLED).toLowerCase()==='true',
    baseUrl:clean(env.MP_RECON_SANDBOX_BASE_URL||'https://api.mercadopago.com').replace(/\/+$/,''),
    accessToken:clean(env.MP_RECON_SANDBOX_ACCESS_TOKEN)
  };
}

export function assertMpReconciliationSandboxReady(config=getMpReconciliationSandboxConfig()){
  if(!config.enabled) throw new Error('Conciliação sandbox Mercado Pago desabilitada.');
  if(!config.accessToken) throw new Error('MP_RECON_SANDBOX_ACCESS_TOKEN não configurado.');
  if(!isMpReconciliationTestAccessToken(config.accessToken)){
    throw new Error('MP_RECON_SANDBOX_ACCESS_TOKEN deve ser uma credencial de teste Mercado Pago (prefixo TEST-).');
  }
  if(!isOfficialMercadoPagoApiBaseUrl(config.baseUrl)){
    throw new Error('MP_RECON_SANDBOX_BASE_URL deve apontar para https://api.mercadopago.com.');
  }
  return config;
}

export function normalizeMpPaymentForReconciliation(data={}){
  return {
    provider:'mercadopago',
    paymentId:clean(data.id),
    providerAmount:money(
      data.transaction_amount ??
      data.total_amount ??
      data.amount ??
      null
    ),
    status:clean(data.status).toLowerCase(),
    currency:clean(data.currency_id||data.currency||'BRL').toUpperCase(),
    externalReference:clean(data.external_reference),
    liveMode:data.live_mode===true,
    dateApproved:data.date_approved||null,
    dateCreated:data.date_created||null
  };
}

export function createMpReconciliationSandboxClient({axios,env=process.env}={}){
  if(!axios?.get) throw new TypeError('Cliente HTTP é obrigatório.');

  async function fetchPayment(paymentId){
    const id=clean(paymentId);
    if(!id) throw new Error('paymentId é obrigatório.');
    const config=assertMpReconciliationSandboxReady(getMpReconciliationSandboxConfig(env));

    const response=await axios.get(
      `${config.baseUrl}/v1/payments/${encodeURIComponent(id)}`,
      {
        headers:{
          Authorization:`Bearer ${config.accessToken}`,
          'Content-Type':'application/json'
        },
        timeout:30000,
        validateStatus:()=>true
      }
    );

    const statusCode=Number(response?.status||0);
    if(statusCode<200||statusCode>=300){
      const error=new Error(response?.data?.message||`Mercado Pago retornou HTTP ${statusCode}.`);
      error.statusCode=statusCode||502;
      error.code='MP_RECON_SANDBOX_LOOKUP_FAILED';
      throw error;
    }

    const providerRecord=normalizeMpPaymentForReconciliation(response?.data||{});
    if(providerRecord.liveMode){
      const error=new Error('A conciliação sandbox recusou um registro live_mode=true.');
      error.statusCode=409;
      error.code='MP_RECON_LIVE_MODE_REJECTED';
      throw error;
    }

    return {
      statusCode,
      providerRecord
    };
  }

  return {fetchPayment};
}

export default {
  isMpReconciliationTestAccessToken,
  getMpReconciliationSandboxConfig,
  assertMpReconciliationSandboxReady,
  normalizeMpPaymentForReconciliation,
  createMpReconciliationSandboxClient
};
