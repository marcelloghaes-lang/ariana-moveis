import dotenv from 'dotenv';
dotenv.config();

import crypto from 'crypto';
import express from 'express';

import { assertArianaPaySandboxSafe } from './services/arianaPay/arianaPaySandboxGuardService.js';
import {
  getSettlementPolicyCapabilities,
  chooseSettlementMode,
  assertMarketplaceNativeSplitReleaseSafe,
  mercadoPagoReadiness
} from './services/arianaPay/arianaPaySettlementPolicyService.js';

const app=express();
app.disable('x-powered-by');
app.use(express.json({limit:'256kb'}));
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

function withSplitMode(manufacturer={}){
  return {
    ...manufacturer,
    settlement:{
      ...(manufacturer.settlement||{}),
      mode:'mercadopago_native_split'
    }
  };
}

function arianaPayAppUrl(){
  return clean(process.env.ARIANA_PAY_APP_URL)||'https://ariana-pay-app-shadow.onrender.com';
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
  if(directSplit.ok!==true||directSplit.mode!=='mercadopago_native_split'||directSplit.pixFallback!==false){
    throw new Error('Settlement gateway self-check falhou no Split MP para fabricante direto.');
  }

  const noOAuth=chooseSettlementMode({
    relationshipType:'direct_supplier',
    manufacturer:{settlement:{acceptsMercadoPagoFixedRelease:true}},
    env:{ARIANA_PAY_DIRECT_SUPPLIER_MP_SPLIT_ALLOWED:'true'}
  });
  if(noOAuth.ok!==false||noOAuth.mode!=='blocked'||!noOAuth.blockers.includes('mercadopago_oauth_required')){
    throw new Error('Settlement gateway self-check falhou no bloqueio de fabricante sem OAuth.');
  }

  const forbiddenDeferred=chooseSettlementMode({
    relationshipType:'direct_supplier',
    manufacturer:{settlement:{mode:'deferred_supplier_payout'}},
    env:{ARIANA_PAY_DIRECT_SUPPLIER_MP_SPLIT_ALLOWED:'true'}
  });
  if(forbiddenDeferred.ok!==false||!forbiddenDeferred.blockers.includes('deferred_payout_disabled_by_split_only_policy')){
    throw new Error('Settlement gateway self-check falhou no bloqueio de repasse fora do Split MP.');
  }

  return {
    ok:true,
    policy:'mercadopago_split_only',
    directSupplierMercadoPagoSplit:true,
    marketplaceSellerMercadoPagoSplit:true,
    deferredPayout:false,
    pixFallback:false,
    efiFallback:false,
    moneyOutFallback:false,
    technicianNeedsMercadoPagoCredentials:false,
    financialAuthorizationInsideArianaPay:true
  };
}

app.get('/health',(_req,res)=>{
  const policy=getSettlementPolicyCapabilities(process.env);
  return res.json({
    ok:true,
    service:'ariana-pay-settlement-gateway',
    mode:'isolated_settlement_control',
    policy:'mercadopago_split_only',
    realMoneyEnabled:policy.modes.mercadoPagoNativeSplit.executionEnabled,
    directSupplierMercadoPagoSplitAllowed:policy.modes.mercadoPagoNativeSplit.directSupplierAllowed,
    nativeSplitExecutionEnabled:policy.modes.mercadoPagoNativeSplit.executionEnabled,
    deferredPayoutExecutionEnabled:false,
    pixFallback:false,
    selfCheck:runSettlementGatewaySelfCheck(),
    policyDetails:policy,
    checkoutChanged:false,
    erpChanged:false,
    gustavoChanged:false
  });
});

app.get('/api/v1/settlement/capabilities',apiRequired,(_req,res)=>{
  return res.json({
    ok:true,
    selfCheck:runSettlementGatewaySelfCheck(),
    policy:getSettlementPolicyCapabilities(process.env)
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
    splitOnly:true,
    pixFallback:false,
    checkoutChanged:false,
    erpChanged:false,
    gustavoChanged:false
  });
});

app.post('/api/v1/settlement/direct-supplier/mp/readiness',apiRequired,(req,res)=>{
  try{
    const manufacturer=withSplitMode(req.body?.manufacturer||{});
    const readiness=assertMarketplaceNativeSplitReleaseSafe({
      manufacturer,
      relationshipType:'direct_supplier',
      env:process.env
    });
    return res.json({
      ok:true,
      routeReady:true,
      readiness,
      splitOnly:true,
      pixFallback:false,
      releaseNotice:'O prazo de liberação é o prazo fixo da conta Mercado Pago do fabricante; não existe repasse alternativo por Pix no marketplace.'
    });
  }catch(error){
    return res.status(safeStatus(error)).json({
      ok:false,
      routeReady:false,
      code:error?.code||'ARIANA_PAY_MP_NATIVE_SPLIT_NOT_READY',
      error:error?.message||'Split Mercado Pago ainda não está pronto para este fabricante.',
      decision:error?.decision||null,
      splitOnly:true,
      pixFallback:false
    });
  }
});

app.post('/api/v1/settlement/direct-supplier/mp/onboarding-plan',apiRequired,(req,res)=>{
  const body=req.body||{};
  const manufacturer=withSplitMode(body.manufacturer||{});
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
  return res.status(decision.ok?200:202).json({
    ok:true,
    manufacturerId,
    relationshipType:'direct_supplier',
    requestedMode:'mercadopago_native_split',
    mercadoPago:mp,
    decision,
    financialAuthorization:{
      required:!mp.oauthConnected,
      location:'ariana_pay_app',
      appUrl:arianaPayAppUrl(),
      flow:'Ariana gera link seguro no Ariana Pay; dono ou responsável financeiro abre o link e autoriza a conta diretamente no Mercado Pago.',
      technicianNeedsMercadoPagoCredentials:false,
      passwordSharedWithAriana:false
    },
    requiredCommercialConfirmations:[
      'Conta Mercado Pago de vendedor ativa',
      'KYC nível 6 confirmado',
      'OAuth autorizado pelo responsável financeiro',
      'Fabricante aceita o prazo fixo de liberação da própria conta Mercado Pago'
    ],
    releasePolicy:{
      type:'seller_account_fixed_terms',
      deliveryPlus15Guaranteed:false
    },
    splitOnly:true,
    pixFallback:false,
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
      splitOnly:true,
      pixFallback:false
    },
    note:'A prontidão final é por fabricante e exige OAuth, KYC 6 e aceite do prazo fixo do Mercado Pago.'
  });
});

function disabledPayoutResponse(res){
  return res.status(410).json({
    ok:false,
    code:'ARIANA_PAY_DEFERRED_PAYOUT_DISABLED',
    error:'Repasse por Pix/Efí/Money Out foi desativado. Ariana Marketplace opera exclusivamente com Mercado Pago Split 1:1.',
    splitOnly:true,
    pixFallback:false,
    executionPerformed:false
  });
}

app.post('/api/v1/settlement/direct-supplier/payout-plan',apiRequired,(_req,res)=>disabledPayoutResponse(res));
app.post('/api/v1/settlement/direct-supplier/payouts/execute',apiRequired,(_req,res)=>disabledPayoutResponse(res));

app.use((_req,res)=>res.status(404).json({ok:false,error:'Rota não encontrada.'}));

const port=Number(process.env.PORT||8120);

export function startArianaPaySettlementGatewayServer(){
  assertArianaPaySandboxSafe(process.env);
  const selfCheck=runSettlementGatewaySelfCheck();
  return app.listen(port,()=>{
    const policy=getSettlementPolicyCapabilities(process.env);
    console.log(`[ariana-pay-settlement] listening on port ${port}`);
    console.log(`[ariana-pay-settlement] self_check=${selfCheck.ok?'ok':'failed'} policy=mercadopago_split_only direct_supplier_mp_split=true pix_fallback=false`);
    console.log(`[ariana-pay-settlement] mp_split_execution=${policy.modes.mercadoPagoNativeSplit.executionEnabled} deferred_execution=false`);
    console.log('[ariana-pay-settlement] checkout_changed=false erp_changed=false gustavo_changed=false');
  });
}

if(process.argv[1]&&new URL(import.meta.url).pathname.endsWith(process.argv[1].replace(/\\/g,'/'))){
  startArianaPaySettlementGatewayServer();
}

export {app};
export default app;