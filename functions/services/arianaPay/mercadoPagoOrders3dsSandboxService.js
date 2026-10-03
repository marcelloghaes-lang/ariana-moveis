// Ariana Pay — Mercado Pago Orders + 3DS sandbox adapter.
// Nunca usa MP_ACCESS_TOKEN de produção por fallback.
// Só pode ser chamado com MP_3DS_SANDBOX_ENABLED=true e credencial própria de teste.

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

export function getMercadoPago3dsSandboxConfig(env=process.env){
  return {
    enabled: clean(env.MP_3DS_SANDBOX_ENABLED).toLowerCase()==='true',
    baseUrl: clean(env.MP_3DS_SANDBOX_BASE_URL||'https://api.mercadopago.com').replace(/\/+$/,''),
    accessToken: clean(env.MP_3DS_SANDBOX_ACCESS_TOKEN),
    notificationUrl: clean(env.MP_3DS_SANDBOX_NOTIFICATION_URL)
  };
}

export function assertMercadoPago3dsSandboxReady(config=getMercadoPago3dsSandboxConfig()){
  if(!config.enabled) throw new Error('Sandbox 3DS Mercado Pago desabilitado.');
  if(!config.accessToken) throw new Error('MP_3DS_SANDBOX_ACCESS_TOKEN não configurado.');
  if(!/^https:\/\//i.test(config.baseUrl)) throw new Error('MP_3DS_SANDBOX_BASE_URL inválida.');
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

  const callback=clean(notificationUrl);
  if(callback) payload.notification_url=callback;
  return payload;
}

export function redactMercadoPago3dsPayload(payload={}){
  const clone=JSON.parse(JSON.stringify(payload||{}));
  const payment=clone?.transactions?.payments?.[0]?.payment_method;
  if(payment?.token) payment.token='[REDACTED_CARD_TOKEN]';
  return clone;
}

export function normalizeMercadoPago3dsOrderResponse(data={}){
  const payment=Array.isArray(data?.transactions?.payments)
    ? data.transactions.payments[0]||{}
    : {};
  const security=payment?.payment_method?.transaction_security||{};

  return {
    orderId:clean(data.id),
    externalReference:clean(data.external_reference),
    status:clean(data.status||payment.status),
    statusDetail:clean(payment.status_detail||data.status_detail),
    paymentId:clean(payment.id),
    actionRequired:clean(payment.status)==='action_required'||clean(data.status)==='action_required',
    pendingChallenge:clean(payment.status_detail)==='pending_challenge',
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
  if(!axios?.post) throw new TypeError('Cliente HTTP é obrigatório.');

  async function createOrder(input={}){
    const config=assertMercadoPago3dsSandboxReady(getMercadoPago3dsSandboxConfig(env));
    const payload=buildMercadoPago3dsOrderPayload({
      ...input,
      notificationUrl:input.notificationUrl||config.notificationUrl
    });
    const idempotencyKey=clean(input.idempotencyKey)||`ariana-pay-3ds-${clean(input.orderId)}`;

    const response=await axios.post(
      `${config.baseUrl}/v1/orders`,
      payload,
      {
        headers:{
          Authorization:`Bearer ${config.accessToken}`,
          'Content-Type':'application/json',
          'X-Idempotency-Key':idempotencyKey
        },
        timeout:30000,
        validateStatus:()=>true
      }
    );

    return {
      statusCode:Number(response?.status||0),
      ok:Number(response?.status||0)>=200&&Number(response?.status||0)<300,
      idempotencyKey,
      request:redactMercadoPago3dsPayload(payload),
      result:normalizeMercadoPago3dsOrderResponse(response?.data||{}),
      raw:response?.data||{}
    };
  }

  return {createOrder};
}

export default {
  getMercadoPago3dsSandboxConfig,
  assertMercadoPago3dsSandboxReady,
  buildMercadoPago3dsOrderPayload,
  redactMercadoPago3dsPayload,
  normalizeMercadoPago3dsOrderResponse,
  createMercadoPago3dsSandboxClient
};
