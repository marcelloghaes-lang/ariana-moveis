import dotenv from 'dotenv';
dotenv.config();

import crypto from 'crypto';
import express from 'express';
import axios from 'axios';

import { assertArianaPaySandboxSafe } from './services/arianaPay/arianaPaySandboxGuardService.js';
import {
  getSettlementPolicyCapabilities,
  chooseSettlementMode,
  assertMarketplaceNativeSplitReleaseSafe,
  mercadoPagoReadiness
} from './services/arianaPay/arianaPaySettlementPolicyService.js';
import {
  buildDirectSalePayoutPlan,
  directSalePayoutCapabilities,
  executeDirectSalePayout
} from './services/arianaPay/arianaPayDirectSalePayoutService.js';

const app=express();
app.disable('x-powered-by');
app.use(express.json({limit:'512kb'}));
app.use((_req,res,next)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Cache-Control','no-store');
  next();
});

function clean(value=''){
  return String(value??'').trim();
}

function safeEqual(a='',b=''){
  const left=Buffer.from(clean(a),'utf8');
  const right=Buffer.from(clean(b),'utf8');
  return left.length>0&&left.length===right.length&&crypto.timingSafeEqual(left,right);
}

function bool(value){
  return clean(value).toLowerCase()==='true';
}

function apiRequired(req,res,next){
  const configured=clean(process.env.ARIANA_PAY_SETTLEMENT_API_TOKEN);
  const bearer=clean(req.headers.authorization).replace(/^Bearer\s+/i,'');
  const header=clean(req.headers['x-ariana-pay-settlement-token']);
  if(!configured){
    return res.status(503).json({ok:false,code:'ARIANA_PAY_SETTLEMENT_TOKEN_MISSING',error:'Token do gateway de liquidação não configurado.'});
  }
  if(!safeEqual(configured,bearer||header)){
    return res.status(401).json({ok:false,code:'ARIANA_PAY_SETTLEMENT_UNAUTHORIZED',error:'Acesso não autorizado.'});
  }
  next();
}

function safeStatus(error={}){
  const value=Number(error?.statusCode||500);
  return value>=400&&value<600?value:500;
}

function commissionBps(){
  const n=Number(process.env.ARIANA_PAY_DIRECT_SALE_COMMISSION_BPS||1200);
  return Number.isInteger(n)&&n>=0&&n<=10000?n:1200;
}

function withSettlementMode(manufacturer={},mode=''){
  return {
    ...manufacturer,
    settlement:{
      ...(manufacturer.settlement||{}),
      mode
    }
  };
}

function oauthServiceUrl(){
  return clean(process.env.ARIANA_PAY_MP_OAUTH_SERVICE_URL)||'https://ariana-pay-marketplace-shadow.onrender.com';
}

export function runSettlementGatewaySelfCheck(){
  const directSplit=chooseSettlementMode({
    relationshipType:'direct_supplier',
    manufacturer:{
      mercadoPago:{userId:'SELF-MP-SELLER',oauthConnected:true,kyc6Verified:true},
      settlement:{mode:'mercadopago_native_split',acceptsMercadoPagoFixedRelease:true}
    },
    env:{
      ARIANA_PAY_DIRECT_SUPPLIER_MP_SPLIT_ALLOWED:'true',
      ARIANA_PAY_MP_SPLIT_EXECUTION_ENABLED:'false'
    }
  });
  if(directSplit.ok!==true||directSplit.mode!=='mercadopago_native_split'||directSplit.deliveryPlus15Guaranteed!==false){
    throw new Error('Settlement gateway self-check falhou no Split MP para fabricante direto.');
  }

  const deferred=chooseSettlementMode({
    relationshipType:'direct_supplier',
    manufacturer:{settlement:{mode:'deferred_supplier_payout'}},
    env:{}
  });
  if(deferred.ok!==true||deferred.mode!=='deferred_supplier_payout'||deferred.holdDays!==15||deferred.deliveryPlus15Guaranteed!==true){
    throw new Error('Settlement gateway self-check falhou na retenção entrega + 15 dias.');
  }

  const blocked=chooseSettlementMode({
    relationshipType:'direct_supplier',
    manufacturer:{settlement:{mode:'mercadopago_native_split',acceptsMercadoPagoFixedRelease:true}},
    env:{ARIANA_PAY_DIRECT_SUPPLIER_MP_SPLIT_ALLOWED:'true'}
  });
  if(blocked.ok!==false||blocked.mode!=='blocked'||!blocked.blockers.includes('mercadopago_oauth_required')){
    throw new Error('Settlement gateway self-check falhou no bloqueio de fabricante sem OAuth.');
  }

  return {
    ok:true,
    directSupplierMercadoPagoSplit:true,
    directSupplierDeferredPayout:true,
    deliveryPlus15OnlyOnDeferredMode:true,
    nativeSplitUsesSellerFixedReleaseTerms:true,
    chargebackGuardDelegatedToPayoutEngine:true
  };
}

app.get('/health',(_req,res)=>{
  const policy=getSettlementPolicyCapabilities(process.env);
  const payout=directSalePayoutCapabilities(process.env);
  return res.json({
    ok:true,
    service:'ariana-pay-settlement-gateway',
    mode:'isolated_settlement_control',
    realMoneyEnabled:policy.modes.mercadoPagoNativeSplit.executionEnabled||payout.payout.executionEnabled,
    directSupplierMercadoPagoSplitAllowed:policy.modes.mercadoPagoNativeSplit.directSupplierAllowed,
    nativeSplitExecutionEnabled:policy.modes.mercadoPagoNativeSplit.executionEnabled,
    deferredPayoutExecutionEnabled:payout.payout.executionEnabled,
    selfCheck:runSettlementGatewaySelfCheck(),
    policy,
    payout:{
      mode:payout.mode,
      releasePolicy:payout.releasePolicy,
      provider:payout.payout
    },
    checkoutChanged:false,
    erpChanged:false,
    gustavoChanged:false
  });
});

app.get('/api/v1/settlement/capabilities',apiRequired,(_req,res)=>{
  return res.json({
    ok:true,
    selfCheck:runSettlementGatewaySelfCheck(),
    policy:getSettlementPolicyCapabilities(process.env),
    directSupplier:directSalePayoutCapabilities(process.env)
  });
});

app.post('/api/v1/settlement/route',apiRequired,(req,res)=>{
  const body=req.body||{};
  const decision=chooseSettlementMode({
    relationshipType:body.relationshipType,
    manufacturer:body.manufacturer||{},
    env:process.env
  });
  return res.status(decision.ok?200:409).json({
    ok:decision.ok,
    decision,
    checkoutChanged:false,
    erpChanged:false,
    gustavoChanged:false
  });
});

app.post('/api/v1/settlement/direct-supplier/mp/readiness',apiRequired,(req,res)=>{
  try{
    const manufacturer=withSettlementMode(req.body?.manufacturer||{},'mercadopago_native_split');
    const readiness=assertMarketplaceNativeSplitReleaseSafe({
      manufacturer,
      relationshipType:'direct_supplier',
      env:process.env
    });
    return res.json({
      ok:true,
      routeReady:true,
      readiness,
      releaseNotice:'O prazo de liberação é o prazo fixo da conta Mercado Pago do fabricante; entrega + 15 dias não é garantido neste modo.'
    });
  }catch(error){
    return res.status(safeStatus(error)).json({
      ok:false,
      routeReady:false,
      code:error?.code||'ARIANA_PAY_MP_NATIVE_SPLIT_NOT_READY',
      error:error?.message||'Split Mercado Pago ainda não está pronto para este fabricante.',
      decision:error?.decision||null
    });
  }
});

app.post('/api/v1/settlement/direct-supplier/mp/onboarding-plan',apiRequired,(req,res)=>{
  const body=req.body||{};
  const manufacturer=withSettlementMode(body.manufacturer||{},'mercadopago_native_split');
  const manufacturerId=clean(
    body.manufacturerId||
    manufacturer.manufacturerId||
    manufacturer.sellerId||
    manufacturer.id||
    manufacturer._id
  );
  if(!manufacturerId){
    return res.status(422).json({ok:false,code:'ARIANA_PAY_MANUFACTURER_ID_REQUIRED',error:'manufacturerId é obrigatório.'});
  }

  const mp=mercadoPagoReadiness(manufacturer);
  const decision=chooseSettlementMode({relationshipType:'direct_supplier',manufacturer,env:process.env});
  const base=oauthServiceUrl();
  return res.status(decision.ok?200:202).json({
    ok:true,
    manufacturerId,
    relationshipType:'direct_supplier',
    requestedMode:'mercadopago_native_split',
    mercadoPago:mp,
    decision,
    oauth:{
      required:!mp.oauthConnected,
      service:base,
      backendEndpoint:`${base}/api/v1/marketplace/mp/oauth/url?manufacturerId=${encodeURIComponent(manufacturerId)}`,
      authorization:'Ariana backend chama o endpoint protegido, recebe a authorizationUrl e envia o link ao fabricante.',
      expectedResult:'OAuth retorna user_id do fabricante e access/refresh tokens criptografados para o Ariana Pay.'
    },
    requiredCommercialConfirmations:[
      'Conta Mercado Pago de vendedor ativa',
      'KYC nível 6 confirmado',
      'OAuth autorizado pelo fabricante',
      'Fabricante aceita o prazo fixo de liberação da própria conta Mercado Pago'
    ],
    releasePolicy:{
      type:'seller_account_fixed_terms',
      deliveryPlus15Guaranteed:false,
      note:'Se o contrato exigir entrega + 15 dias, selecionar deferred_supplier_payout em vez do Split 1:1.'
    },
    checkoutChanged:false,
    erpChanged:false,
    gustavoChanged:false
  });
});

app.get('/api/v1/settlement/marketplace/native-split/readiness',apiRequired,(_req,res)=>{
  const policy=getSettlementPolicyCapabilities(process.env);
  return res.json({
    ok:true,
    globalConfiguration:{
      directSupplierAllowed:policy.modes.mercadoPagoNativeSplit.directSupplierAllowed,
      marketplaceSellerAllowed:policy.modes.mercadoPagoNativeSplit.marketplaceSellerAllowed,
      executionEnabled:policy.modes.mercadoPagoNativeSplit.executionEnabled,
      releasePolicy:policy.modes.mercadoPagoNativeSplit.releasePolicy,
      deliveryPlus15Guaranteed:false
    },
    note:'A prontidão final é por fabricante e exige OAuth, KYC 6 e aceite do prazo fixo do Mercado Pago.'
  });
});

app.post('/api/v1/settlement/direct-supplier/payout-plan',apiRequired,(req,res)=>{
  try{
    const body=req.body||{};
    const manufacturer=withSettlementMode(body.manufacturer||{},'deferred_supplier_payout');
    const decision=chooseSettlementMode({
      relationshipType:body.relationshipType||'direct_supplier',
      manufacturer,
      env:process.env
    });
    const plan=buildDirectSalePayoutPlan({
      manufacturer,
      order:body.order||{},
      grossAmount:body.grossAmount,
      commissionBps:commissionBps(),
      now:body.now?new Date(body.now):new Date()
    });
    return res.json({
      ok:true,
      decision,
      plan,
      executionPerformed:false,
      checkoutChanged:false,
      erpChanged:false,
      gustavoChanged:false
    });
  }catch(error){
    return res.status(safeStatus(error)).json({ok:false,code:error?.code||'ARIANA_PAY_SETTLEMENT_PLAN_ERROR',error:error?.message||'Falha ao montar plano de liquidação.'});
  }
});

app.post('/api/v1/settlement/direct-supplier/payouts/execute',apiRequired,async(req,res)=>{
  try{
    if(!bool(process.env.ARIANA_PAY_SETTLEMENT_DEFERRED_EXECUTION_ENABLED)){
      return res.status(409).json({
        ok:false,
        code:'ARIANA_PAY_SETTLEMENT_DEFERRED_EXECUTION_DISABLED',
        error:'Execução real de repasse diferido permanece desligada no gateway.'
      });
    }
    const body=req.body||{};
    const manufacturer=withSettlementMode(body.manufacturer||{},'deferred_supplier_payout');
    const decision=chooseSettlementMode({
      relationshipType:body.relationshipType||'direct_supplier',
      manufacturer,
      env:process.env
    });
    const result=await executeDirectSalePayout({
      axios,
      env:process.env,
      manufacturer,
      order:body.order||{},
      grossAmount:body.grossAmount,
      commissionBps:commissionBps(),
      now:new Date()
    });
    return res.status(201).json({
      ok:true,
      decision,
      ...result,
      checkoutChanged:false,
      erpChanged:false,
      gustavoChanged:false
    });
  }catch(error){
    return res.status(safeStatus(error)).json({
      ok:false,
      code:error?.code||'ARIANA_PAY_SETTLEMENT_PAYOUT_ERROR',
      error:error?.message||'Falha no repasse diferido.',
      providerStatus:error?.providerStatus||undefined,
      idEnvio:error?.idEnvio||undefined,
      plan:error?.plan||undefined
    });
  }
});

app.use((_req,res)=>res.status(404).json({ok:false,error:'Rota não encontrada.'}));

const port=Number(process.env.PORT||8120);

export function startArianaPaySettlementGateway(){
  assertArianaPaySandboxSafe(process.env);
  const selfCheck=runSettlementGatewaySelfCheck();
  return app.listen(port,()=>{
    const policy=getSettlementPolicyCapabilities(process.env);
    console.log(`[ariana-pay-settlement] listening on port ${port}`);
    console.log(`[ariana-pay-settlement] self_check=${selfCheck.ok?'ok':'failed'} direct_supplier_mp_split=true deferred_15d=true`);
    console.log(`[ariana-pay-settlement] mp_direct_supplier_allowed=${policy.modes.mercadoPagoNativeSplit.directSupplierAllowed} mp_split_execution=${policy.modes.mercadoPagoNativeSplit.executionEnabled} deferred_execution=${bool(process.env.ARIANA_PAY_SETTLEMENT_DEFERRED_EXECUTION_ENABLED)}`);
    console.log('[ariana-pay-settlement] checkout_changed=false erp_changed=false gustavo_changed=false');
  });
}

if(process.argv[1]&&new URL(import.meta.url).pathname.endsWith(process.argv[1].replace(/\\/g,'/'))){
  startArianaPaySettlementGateway();
}

export {app};
export default app;
