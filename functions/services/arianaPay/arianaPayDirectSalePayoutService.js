// Ariana Pay — split e repasse de venda direta para fabricantes.
// Mantem a politica comercial em centavos, libera 15 dias apos entrega confirmada
// e usa Pix Efí como trilho de repasse. Nenhuma transferencia ocorre sem a flag
// explicita ARIANA_PAY_PAYOUT_EXECUTION_ENABLED=true.

import crypto from 'crypto';
import https from 'https';
import { buildReleaseSchedule } from './arianaPayReleaseScheduleService.js';
import { getSellerPayoutDestinationReadiness } from './arianaPayPayoutPlannerService.js';
import { detectFinancialRisk, applyRiskToRelease } from './arianaPayRiskService.js';
import { assessCardSecurity, applyCardSecurityToRelease } from './arianaPayCardSecurityService.js';

export const ARIANA_PAY_DIRECT_SALE_COMMISSION_BPS = 1200;

function clean(value=''){
  return String(value ?? '').trim();
}

function digits(value=''){
  return clean(value).replace(/\D/g,'');
}

function bool(value){
  return clean(value).toLowerCase()==='true';
}

function cents(value){
  const n=Number(value);
  if(!Number.isFinite(n)) return null;
  return Math.round((n+Number.EPSILON)*100);
}

function moneyFromCents(value){
  return Math.round(Number(value||0))/100;
}

function normalizeBps(value, fallback=ARIANA_PAY_DIRECT_SALE_COMMISSION_BPS){
  const n=Number(value);
  if(!Number.isInteger(n)||n<0||n>10000) return fallback;
  return n;
}

function manufacturerId(manufacturer={}){
  return clean(
    manufacturer.manufacturerId||
    manufacturer.sellerId||
    manufacturer.id||
    manufacturer._id||
    manufacturer.externalId
  );
}

function normalizeManufacturer(manufacturer={}){
  const id=manufacturerId(manufacturer);
  const status=clean(manufacturer.status||manufacturer.metadata?.status||'approved').toLowerCase();
  const payout=manufacturer.payout&&typeof manufacturer.payout==='object'?manufacturer.payout:{};
  const bankAccount=manufacturer.bankAccount&&typeof manufacturer.bankAccount==='object'
    ?manufacturer.bankAccount
    :payout.bankAccount&&typeof payout.bankAccount==='object'
      ?payout.bankAccount
      :{};
  const pixKey=clean(payout.pixKey||bankAccount.pixKey||manufacturer.pixKey||manufacturer.metadata?.pixKey);
  const holderName=clean(
    payout.holderName||
    bankAccount.holderName||
    manufacturer.holderName||
    manufacturer.legalName||
    manufacturer.name
  );
  const holderDocument=digits(
    payout.holderDocument||
    bankAccount.holderDocument||
    manufacturer.holderDocument||
    manufacturer.cnpj||
    manufacturer.cpfCnpj||
    manufacturer.document
  );

  return {
    ...manufacturer,
    sellerId:id,
    status,
    metadata:{
      ...(manufacturer.metadata||{}),
      bankAccount:{
        ...(manufacturer.metadata?.bankAccount||{}),
        pixKey,
        holderName,
        holderDocument
      }
    },
    _directSale:{
      manufacturerId:id,
      pixKey,
      holderName,
      holderDocument
    }
  };
}

export function maskPixKey(value=''){
  const raw=clean(value);
  if(!raw) return '';
  if(raw.includes('@')){
    const [name,domain='']=raw.split('@');
    const shown=name.slice(0,2);
    return `${shown}${'*'.repeat(Math.max(3,name.length-shown.length))}@${domain}`;
  }
  const onlyDigits=digits(raw);
  if(onlyDigits.length>=8){
    return `${onlyDigits.slice(0,3)}${'*'.repeat(Math.max(4,onlyDigits.length-7))}${onlyDigits.slice(-4)}`;
  }
  if(raw.length<=4) return '*'.repeat(raw.length);
  return `${raw.slice(0,2)}${'*'.repeat(Math.max(3,raw.length-4))}${raw.slice(-2)}`;
}

export function buildDirectSaleSplit({grossAmount,commissionBps=ARIANA_PAY_DIRECT_SALE_COMMISSION_BPS}={}){
  const grossCents=cents(grossAmount);
  if(grossCents===null||grossCents<=0){
    const error=new Error('Valor bruto da venda direta inválido.');
    error.code='ARIANA_PAY_DIRECT_SALE_AMOUNT_INVALID';
    error.statusCode=400;
    throw error;
  }

  const bps=normalizeBps(commissionBps);
  const platformCommissionCents=Math.round(grossCents*bps/10000);
  const manufacturerNetCents=grossCents-platformCommissionCents;

  return {
    currency:'BRL',
    grossAmount:moneyFromCents(grossCents),
    commissionBps:bps,
    commissionPercent:bps/100,
    platformCommission:moneyFromCents(platformCommissionCents),
    manufacturerNet:moneyFromCents(manufacturerNetCents),
    invariantOk:grossCents===platformCommissionCents+manufacturerNetCents
  };
}

function orderId(order={}){
  return clean(order.orderId||order.id||order._id||order.reference||order.externalId);
}

function deterministicIdEnvio({order={},manufacturer={},amount=0}={}){
  const raw=[
    orderId(order),
    manufacturerId(manufacturer),
    Number(amount||0).toFixed(2)
  ].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0,32);
}

function payoutDestination(normalized={}){
  const readiness=getSellerPayoutDestinationReadiness(normalized);
  return {
    ...readiness,
    pixKeyMasked:maskPixKey(normalized?._directSale?.pixKey||'')
  };
}

function scheduleState(release={}, now=new Date()){
  if(release.state==='blocked') return 'blocked';
  const at=release.availableAt?new Date(release.availableAt):null;
  if(!at||Number.isNaN(at.getTime())) return 'blocked';
  return at.getTime()<=now.getTime()?'ready':'scheduled';
}

export function validateDirectSaleManufacturer(manufacturer={}){
  const normalized=normalizeManufacturer(manufacturer);
  const destination=payoutDestination(normalized);
  const id=manufacturerId(normalized);
  const status=clean(normalized.status).toLowerCase();
  const approved=['approved','aprovado','active','ativo'].includes(status);
  const blockers=[];

  if(!id) blockers.push('missing_manufacturer_id');
  if(!approved) blockers.push('manufacturer_not_approved');
  if(!destination.ready) blockers.push(...destination.missing);
  if(destination.method!=='pix') blockers.push('pix_payout_required');

  return {
    ok:blockers.length===0,
    manufacturerId:id,
    status,
    payout:{
      provider:'efi',
      rail:'pix_send',
      method:destination.method,
      destinationReady:destination.ready,
      pixKeyMasked:destination.pixKeyMasked
    },
    blockers:[...new Set(blockers)]
  };
}

export function buildDirectSalePayoutPlan({
  manufacturer={},
  order={},
  grossAmount,
  commissionBps=ARIANA_PAY_DIRECT_SALE_COMMISSION_BPS,
  now=new Date()
}={}){
  const validation=validateDirectSaleManufacturer(manufacturer);
  const normalized=normalizeManufacturer(manufacturer);
  const split=buildDirectSaleSplit({grossAmount,commissionBps});
  const baseRelease=buildReleaseSchedule({
    order,
    seller:normalized,
    sellerId:validation.manufacturerId
  });
  const risk=detectFinancialRisk(order);
  const cardSecurity=assessCardSecurity(order);
  const riskRelease=applyRiskToRelease(baseRelease,risk);
  const release=applyCardSecurityToRelease(riskRelease,cardSecurity);
  const blockers=[...validation.blockers];

  if(!orderId(order)) blockers.push('missing_order_id');
  if(release.state==='blocked') blockers.push(release.reason||'release_blocked');
  const state=blockers.length?'blocked':scheduleState(release,now);

  return {
    ok:true,
    mode:'direct_sale_deferred_payout',
    orderId:orderId(order),
    manufacturerId:validation.manufacturerId,
    state,
    ready:state==='ready',
    split,
    release:{
      state:release.state,
      reason:clean(release.reason),
      transferDeadlineDays:Number(release.transferDeadlineDays||15),
      availableAt:release.availableAt||null,
      delivery:release.delivery||null
    },
    risk:{
      active:risk?.active===true,
      kind:clean(risk?.kind),
      severity:clean(risk?.severity),
      cardSecurityLevel:clean(cardSecurity?.level)
    },
    payout:{
      provider:'efi',
      rail:'pix_send',
      amount:split.manufacturerNet,
      currency:'BRL',
      idEnvio:deterministicIdEnvio({order,manufacturer:normalized,amount:split.manufacturerNet}),
      destination:validation.payout
    },
    blockers:[...new Set(blockers)]
  };
}

export function getEfiDirectSalePayoutConfig(env=process.env){
  const environment=clean(env.EFI_PIX_ENVIRONMENT||env.EFI_ENVIRONMENT||'homologation').toLowerCase();
  const production=environment==='production'||environment==='producao'||environment==='produção';
  const clientId=clean(env.EFI_PIX_CLIENT_ID||env.EFI_CLIENT_ID);
  const clientSecret=clean(env.EFI_PIX_CLIENT_SECRET||env.EFI_CLIENT_SECRET);
  const certificateBase64=clean(
    env.EFI_PIX_CERT_P12_BASE64||
    env.EFI_CERT_P12_BASE64||
    env.EFI_CERTIFICATE_BASE64
  );
  const certificatePassphrase=String(env.EFI_PIX_CERT_P12_PASSPHRASE||env.EFI_CERT_P12_PASSPHRASE||'');
  const payerPixKey=clean(env.EFI_PIX_PAYER_KEY||env.EFI_PAYER_PIX_KEY);
  const executionEnabled=bool(env.ARIANA_PAY_PAYOUT_EXECUTION_ENABLED);
  const configured=Boolean(clientId&&clientSecret&&certificateBase64&&payerPixKey);

  return {
    environment:production?'production':'homologation',
    baseUrl:production?'https://pix.api.efipay.com.br':'https://pix-h.api.efipay.com.br',
    executionEnabled,
    configured,
    clientId,
    clientSecret,
    certificateBase64,
    certificatePassphrase,
    payerPixKey
  };
}

function providerSafeConfig(config={}){
  return {
    environment:config.environment,
    provider:'efi',
    rail:'pix_send',
    configured:config.configured===true,
    executionEnabled:config.executionEnabled===true,
    requiredScopes:['pix.send','gn.pix.send.read']
  };
}

export function directSalePayoutCapabilities(env=process.env){
  const config=getEfiDirectSalePayoutConfig(env);
  return {
    mode:'direct_sale_deferred_payout',
    commissionBps:normalizeBps(env.ARIANA_PAY_DIRECT_SALE_COMMISSION_BPS,ARIANA_PAY_DIRECT_SALE_COMMISSION_BPS),
    commissionPercent:normalizeBps(env.ARIANA_PAY_DIRECT_SALE_COMMISSION_BPS,ARIANA_PAY_DIRECT_SALE_COMMISSION_BPS)/100,
    releasePolicy:{
      trigger:'delivery_confirmed',
      holdDays:15
    },
    payout:providerSafeConfig(config),
    safety:{
      checkoutChanged:false,
      erpChanged:false,
      gustavoChanged:false,
      executionFailsClosed:true
    }
  };
}

export function createEfiDirectSalePayoutClient({axios,env=process.env}={}){
  if(!axios) throw new TypeError('axios é obrigatório.');
  const config=getEfiDirectSalePayoutConfig(env);

  function assertConfigured(){
    if(!config.configured){
      const error=new Error('Credenciais/certificado/chave pagadora Efí ainda não estão completos neste serviço.');
      error.code='ARIANA_PAY_EFI_PAYOUT_NOT_CONFIGURED';
      error.statusCode=503;
      throw error;
    }
  }

  function httpsAgent(){
    assertConfigured();
    let pfx;
    try{
      pfx=Buffer.from(config.certificateBase64.replace(/\s/g,''),'base64');
    }catch{
      pfx=Buffer.alloc(0);
    }
    if(!pfx.length){
      const error=new Error('Certificado P12 Efí inválido.');
      error.code='ARIANA_PAY_EFI_CERT_INVALID';
      error.statusCode=503;
      throw error;
    }
    return new https.Agent({
      pfx,
      passphrase:config.certificatePassphrase,
      rejectUnauthorized:true,
      keepAlive:true
    });
  }

  async function accessToken(){
    const response=await axios.post(
      `${config.baseUrl}/oauth/token`,
      {grant_type:'client_credentials'},
      {
        auth:{username:config.clientId,password:config.clientSecret},
        httpsAgent:httpsAgent(),
        headers:{'Content-Type':'application/json','Accept-Encoding':'identity'},
        timeout:20000,
        validateStatus:()=>true
      }
    );
    if(Number(response.status)<200||Number(response.status)>=300||!clean(response.data?.access_token)){
      const error=new Error('Efí recusou a autorização OAuth do repasse.');
      error.code='ARIANA_PAY_EFI_OAUTH_FAILED';
      error.statusCode=502;
      error.providerStatus=Number(response.status||0);
      throw error;
    }
    return clean(response.data.access_token);
  }

  async function sendPix({idEnvio,amount,pixKey,infoPagador}={}){
    if(!config.executionEnabled){
      const error=new Error('Execução de repasse real permanece travada por segurança.');
      error.code='ARIANA_PAY_PAYOUT_EXECUTION_DISABLED';
      error.statusCode=409;
      throw error;
    }
    assertConfigured();
    const valueCents=cents(amount);
    if(valueCents===null||valueCents<=0){
      const error=new Error('Valor de repasse inválido.');
      error.code='ARIANA_PAY_PAYOUT_AMOUNT_INVALID';
      error.statusCode=400;
      throw error;
    }
    const destination=clean(pixKey);
    if(!destination){
      const error=new Error('Chave Pix do fabricante ausente.');
      error.code='ARIANA_PAY_PAYOUT_PIX_KEY_MISSING';
      error.statusCode=400;
      throw error;
    }
    const token=await accessToken();
    const response=await axios.put(
      `${config.baseUrl}/v3/gn/pix/${encodeURIComponent(clean(idEnvio))}`,
      {
        valor:moneyFromCents(valueCents).toFixed(2),
        pagador:{
          chave:config.payerPixKey,
          infoPagador:clean(infoPagador).slice(0,140)||'Repasse Ariana Pay'
        },
        favorecido:{chave:destination}
      },
      {
        httpsAgent:httpsAgent(),
        headers:{
          Authorization:`Bearer ${token}`,
          'Content-Type':'application/json',
          'Accept-Encoding':'identity'
        },
        timeout:25000,
        validateStatus:()=>true
      }
    );

    const status=Number(response.status||0);
    const serverUncertain=status>=500;
    if(status<200||status>=300){
      const error=new Error(serverUncertain
        ?'Efí retornou erro 5xx; o estado do Pix deve ser consultado pelo mesmo idEnvio antes de qualquer nova tentativa.'
        :'Efí recusou o envio do Pix.');
      error.code=serverUncertain?'ARIANA_PAY_EFI_PAYOUT_STATE_UNCERTAIN':'ARIANA_PAY_EFI_PAYOUT_REJECTED';
      error.statusCode=serverUncertain?502:400;
      error.providerStatus=status;
      error.idEnvio=clean(idEnvio);
      throw error;
    }

    return {
      ok:true,
      provider:'efi',
      rail:'pix_send',
      providerStatus:status,
      idEnvio:clean(response.data?.idEnvio||idEnvio),
      e2eId:clean(response.data?.e2eId||response.data?.endToEndId),
      status:clean(response.data?.status),
      amount:moneyFromCents(valueCents)
    };
  }

  async function getPixStatus(idEnvio){
    assertConfigured();
    const token=await accessToken();
    const response=await axios.get(
      `${config.baseUrl}/v2/gn/pix/enviados/id-envio/${encodeURIComponent(clean(idEnvio))}`,
      {
        httpsAgent:httpsAgent(),
        headers:{Authorization:`Bearer ${token}`,'Accept-Encoding':'identity'},
        timeout:20000,
        validateStatus:()=>true
      }
    );
    const status=Number(response.status||0);
    if(status<200||status>=300){
      const error=new Error('Não foi possível consultar o Pix de repasse na Efí.');
      error.code='ARIANA_PAY_EFI_PAYOUT_LOOKUP_FAILED';
      error.statusCode=status===404?404:502;
      error.providerStatus=status;
      throw error;
    }
    return {
      ok:true,
      provider:'efi',
      idEnvio:clean(response.data?.idEnvio||idEnvio),
      e2eId:clean(response.data?.endToEndId||response.data?.e2eId),
      status:clean(response.data?.status),
      amount:Number(response.data?.valor||0),
      settledAt:response.data?.horario?.liquidacao||null
    };
  }

  return {
    config:providerSafeConfig(config),
    sendPix,
    getPixStatus
  };
}

export async function executeDirectSalePayout({
  axios,
  env=process.env,
  manufacturer={},
  order={},
  grossAmount,
  commissionBps,
  now=new Date()
}={}){
  const bps=normalizeBps(
    commissionBps,
    normalizeBps(env.ARIANA_PAY_DIRECT_SALE_COMMISSION_BPS,ARIANA_PAY_DIRECT_SALE_COMMISSION_BPS)
  );
  const plan=buildDirectSalePayoutPlan({manufacturer,order,grossAmount,commissionBps:bps,now});
  if(!plan.ready){
    const error=new Error('Repasse ainda não está liberado pelas regras da Ariana Pay.');
    error.code='ARIANA_PAY_PAYOUT_NOT_READY';
    error.statusCode=409;
    error.plan=plan;
    throw error;
  }

  const normalized=normalizeManufacturer(manufacturer);
  const pixKey=normalized?._directSale?.pixKey;
  const client=createEfiDirectSalePayoutClient({axios,env});
  const result=await client.sendPix({
    idEnvio:plan.payout.idEnvio,
    amount:plan.payout.amount,
    pixKey,
    infoPagador:`Repasse Ariana Pay pedido ${plan.orderId}`
  });

  return {plan,result};
}

export const __test={
  cents,
  moneyFromCents,
  normalizeBps,
  normalizeManufacturer,
  deterministicIdEnvio,
  scheduleState
};

export default {
  buildDirectSaleSplit,
  validateDirectSaleManufacturer,
  buildDirectSalePayoutPlan,
  getEfiDirectSalePayoutConfig,
  directSalePayoutCapabilities,
  createEfiDirectSalePayoutClient,
  executeDirectSalePayout,
  maskPixKey
};
