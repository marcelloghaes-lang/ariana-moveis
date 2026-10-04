// Ariana Pay — Mercado Pago Orders + 3DS sandbox adapter.
// Nunca usa MP_ACCESS_TOKEN como fallback.
// A credencial dedicada precisa ser configurada em MP_3DS_SANDBOX_ACCESS_TOKEN.

function clean(value=''){
  return String(value||'').trim();
}

function money(value=0){
  const n=Number(value||0);
  if(!Number.isFinite(n)||n<=0) throw new Error('Valor inválido para order 3DS.');
  return Math.round((n+Number.EPSILON)*100)/100;
}

function installments(value=1){
  const n=Math.max(1,Math.min(Number(value||1)||1,24));
  return Math.trunc(n);
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

function isHttpsUrl(value=''){
  try{
    return new URL(clean(value)).protocol==='https:';
  }catch(_error){
    return false;
  }
}

function liveModeError(){
  const error=new Error('Ariana Pay sandbox recusou resposta Mercado Pago com live_mode=true.');
  error.statusCode=409;
  error.code='MP_3DS_LIVE_MODE_REJECTED';
  return error;
}

export function getMercadoPago3dsSandboxConfig(env=process.env){
  const accessToken=clean(env.MP_3DS_SANDBOX_ACCESS_TOKEN);
  const defaultAccessToken=clean(env.MP_ACCESS_TOKEN);
  return {
    enabled: clean(env.MP_3DS_SANDBOX_ENABLED).toLowerCase()==='true',
    baseUrl: clean(env.MP_3DS_SANDBOX_BASE_URL||'https://api.mercadopago.com').replace(/\/+$/,''),
    accessToken,
    notificationUrl: clean(env.MP_3DS_SANDBOX_NOTIFICATION_URL),
    reusesDefaultAccessToken:Boolean(accessToken&&defaultAccessToken&&accessToken===defaultAccessToken)
  };
}

export function assertMercadoPago3dsSandboxReady(config=getMercadoPago3dsSandboxConfig()){
  if(!config.enabled) throw new Error('Sandbox 3DS Mercado Pago desabilitado.');
  if(!config.accessToken) throw new Error('MP_3DS_SANDBOX_ACCESS_TOKEN não configurado.');
  if(config.reusesDefaultAccessToken){
    throw new Error('MP_3DS_SANDBOX_ACCESS_TOKEN não pode reutilizar MP_ACCESS_TOKEN.');
  }
  if(!isOfficialMercadoPagoApiBaseUrl(config.baseUrl)){
    throw new Error('MP_3DS_SANDBOX_BASE_URL deve apontar para https://api.mercadopago.com.');
  }
  if(config.notificationUrl&&!isHttpsUrl(config.notificationUrl)) throw new Error('MP_3DS_SANDBOX_NOTIFICATION_URL deve usar HTTPS.');
  return config;
}

export function buildMercadoPago3dsOrderPayload({
  orderId='',
  amount=0,
  email='',
  paymentMethodId='',
  cardToken='',
  installmentCount=1,
  notificationUrl=''
}={}){
  const oid=clean(orderId);
  const payerEmail=clean(email).toLowerCase();
  const method=clean(paymentMethodId).toLowerCase();
  const token=clean(cardToken);
  const total=money(amount);

  if(!oid) throw new Error('orderId é obrigatório.');
  if(!payerEmail||!payerEmail.includes('@')) throw new Error('E-mail do pagador inválido.');
  if(!method) throw new Error('paymentMethodId é obrigatório.');
  if(!token) throw new Error('Token de cartão de teste é obrigatório.');

  const payload={
    type:'online',
    external_reference:oid,
    processing_mode:'automatic',
    capture_mode:'automatic',
    total_amount:total.toFixed(2),
    config:{
      online:{
        transaction_security:{
          validation:'on_fraud_risk',
          liability_shift:'required'
        }
      }
    },
    payer:{email:payerEmail},
    transactions:{
      payments:[
        {
          amount:total.toFixed(2),
          payment_method:{
            id:method,
            type:'credit_card',
            token,
            installments:installments(installmentCount)
          }
        }
      ]
    }
  };

  // Orders API usa a configuração de Webhooks da aplicação no painel do Mercado Pago.
  // Não enviar notification_url aqui: a propriedade não pertence ao schema de criação de Orders.
  return payload;
}

export function redactMercadoPago3dsPayload(payload={}){
  const clone=JSON.parse(JSON.stringify(payload||{}));
  const payment=clone?.transactions?.payments?.[0]?.payment_method;
  if(payment?.token) payment.token='[REDACTED_CARD_TOKEN]';
  return clone;
}

export function summarizeMercadoPago3dsProviderError(data={}){
  const raw=data&&typeof data==='object'?data:{};
  const details=Array.isArray(raw.errors)
    ? raw.errors.slice(0,5).map(item=>({
        code:clean(item?.code||item?.error||item?.type),
        message:clean(item?.message||item?.description||item?.detail),
        field:clean(item?.field||item?.path)
      }))
    : Array.isArray(raw.cause)
      ? raw.cause.slice(0,5).map(item=>({
          code:clean(item?.code),
          message:clean(item?.description||item?.message),
          field:clean(item?.data||item?.field)
        }))
      : [];

  return {
    code:clean(raw.code||raw.error||raw.status),
    message:clean(raw.message||raw.error_description||raw.description),
    details
  };
}

export function normalizeMercadoPago3dsOrderResponse(data={}){
  const payment=Array.isArray(data?.transactions?.payments)
    ? data.transactions.payments[0]||{}
    : {};
  const security=
    payment?.payment_method?.transaction_security||
    payment?.transaction_security||
    data?.transaction_security||
    {};

  return {
    orderId:clean(data.id),
    externalReference:clean(data.external_reference),
    status:clean(data.status||payment.status),
    statusDetail:clean(payment.status_detail||data.status_detail),
    paymentId:clean(payment.id),
    liveMode:data?.live_mode===true,
    actionRequired:clean(payment.status)==='action_required'||clean(data.status)==='action_required',
    pendingChallenge:clean(payment.status_detail)==='pending_challenge'||clean(data.status_detail)==='pending_challenge',
    challengeUrl:clean(security.url),
    transactionSecurity:{
      id:clean(security.id),
      type:clean(security.type),
      status:clean(security.status),
      validation:clean(security.validation),
      liabilityShift:clean(security.liability_shift)
    },
    liabilityShiftRequired:clean(security.liability_shift)==='required',
    authenticated:['authenticated','approved','success','successful'].includes(clean(security.status).toLowerCase())
  };
}

export function createMercadoPago3dsSandboxClient({axios,env=process.env}={}){
  if(!axios) throw new TypeError('Cliente HTTP é obrigatório.');

  function authHeaders(config,extra={}){
    return {
      Authorization:`Bearer ${config.accessToken}`,
      'Content-Type':'application/json',
      ...extra
    };
  }

  async function createOrder(input={}){
    if(typeof axios.post!=='function') throw new TypeError('Cliente HTTP POST é obrigatório.');
    const config=assertMercadoPago3dsSandboxReady(getMercadoPago3dsSandboxConfig(env));
    const payload=buildMercadoPago3dsOrderPayload(input);
    const idempotencyKey=clean(input.idempotencyKey)||`ariana-pay-3ds-${clean(input.orderId)}`;

    const response=await axios.post(
      `${config.baseUrl}/v1/orders`,
      payload,
      {
        headers:authHeaders(config,{'X-Idempotency-Key':idempotencyKey}),
        timeout:30000,
        validateStatus:()=>true
      }
    );

    const result=normalizeMercadoPago3dsOrderResponse(response?.data||{});
    if(result.liveMode) throw liveModeError();

    return {
      statusCode:Number(response?.status||0),
      ok:Number(response?.status||0)>=200&&Number(response?.status||0)<300,
      idempotencyKey,
      request:redactMercadoPago3dsPayload(payload),
      result,
      providerError:summarizeMercadoPago3dsProviderError(response?.data||{}),
      raw:response?.data||{}
    };
  }

  async function getOrder(providerOrderId=''){
    if(typeof axios.get!=='function') throw new TypeError('Cliente HTTP GET é obrigatório.');
    const id=clean(providerOrderId);
    if(!id) throw new Error('providerOrderId é obrigatório.');
    const config=assertMercadoPago3dsSandboxReady(getMercadoPago3dsSandboxConfig(env));

    const response=await axios.get(
      `${config.baseUrl}/v1/orders/${encodeURIComponent(id)}`,
      {
        headers:authHeaders(config),
        timeout:30000,
        validateStatus:()=>true
      }
    );

    const statusCode=Number(response?.status||0);
    if(statusCode<200||statusCode>=300){
      const error=new Error(response?.data?.message||`Mercado Pago retornou HTTP ${statusCode} ao consultar a order 3DS sandbox.`);
      error.statusCode=statusCode||502;
      error.code='MP_3DS_SANDBOX_LOOKUP_FAILED';
      throw error;
    }

    const result=normalizeMercadoPago3dsOrderResponse(response?.data||{});
    if(result.liveMode) throw liveModeError();

    return {
      statusCode,
      ok:true,
      result
    };
  }

  return {createOrder,getOrder};
}

export default {
  getMercadoPago3dsSandboxConfig,
  assertMercadoPago3dsSandboxReady,
  buildMercadoPago3dsOrderPayload,
  redactMercadoPago3dsPayload,
  normalizeMercadoPago3dsOrderResponse,
  summarizeMercadoPago3dsProviderError,
  createMercadoPago3dsSandboxClient
};
