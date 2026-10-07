import dotenv from 'dotenv';
dotenv.config();

import crypto from 'crypto';
import express from 'express';
import axios from 'axios';

import { assertArianaPaySandboxSafe } from './services/arianaPay/arianaPaySandboxGuardService.js';
import {
  getSettlementPolicyCapabilities,
  chooseSettlementMode,
  assertMarketplaceNativeSplitReleaseSafe
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

export function runSettlementGatewaySelfCheck(){
  const unverified=chooseSettlementMode({
    relationshipType:'marketplace',
    env:{
      ARIANA_PAY_MP_SELLER_RELEASE_POLICY_VERIFIED:'false'
    }
  });
  if(unverified.productionAllowed!==false||unverified.mode!=='blocked'){
    throw new Error('Settlement gateway self-check falhou no bloqueio do split nativo sem política 15d.');
  }

  const direct=chooseSettlementMode({relationshipType:'direct_supplier',env:{}});
  if(direct.productionAllowed!==true||direct.mode!=='deferred_supplier_payout'||direct.holdDays!==15){
    throw new Error('Settlement gateway self-check falhou na rota de fornecedor direto com retenção 15d.');
  }

  const verified=chooseSettlementMode({
    relationshipType:'marketplace',
    env:{
      ARIANA_PAY_MP_SELLER_RELEASE_POLICY_VERIFIED:'true',
      ARIANA_PAY_MP_SELLER_RELEASE_POLICY_REFERENCE:'MP-COMMERCIAL-SELF-CHECK',
      ARIANA_PAY_MP_SELLER_RELEASE_POLICY_TRIGGER:'delivery_confirmed',
      ARIANA_PAY_MP_SELLER_RELEASE_POLICY_DAYS:'15'
    }
  });
  if(verified.productionAllowed!==true||verified.mode!=='mercadopago_native_split'){
    throw new Error('Settlement gateway self-check falhou na liberação controlada do split nativo verificado.');
  }

  return {
    ok:true,
    holdDays:15,
    trigger:'delivery_confirmed',
    nativeSplitFailsClosed:true,
    directSupplierDeferredPayout:true,
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
    realMoneyEnabled:false,
    nativeMarketplaceSplitProductionAllowed:policy.mercadoPagoNativeSplit.productionAllowed,
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

app.get('/api/v1/settlement/marketplace/native-split/readiness',apiRequired,(_req,res)=>{
  try{
    const readiness=assertMarketplaceNativeSplitReleaseSafe({env:process.env});
    return res.json({ok:true,productionAllowed:true,readiness});
  }catch(error){
    return res.status(safeStatus(error)).json({
      ok:false,
      productionAllowed:false,
      code:error?.code||'ARIANA_PAY_MP_15D_RELEASE_POLICY_UNVERIFIED',
      error:error?.message||'Split nativo ainda não liberado para produção.',
      policy:getSettlementPolicyCapabilities(process.env)
    });
  }
});

app.post('/api/v1/settlement/direct-supplier/payout-plan',apiRequired,(req,res)=>{
  try{
    const body=req.body||{};
    const decision=chooseSettlementMode({
      relationshipType:body.relationshipType||'direct_supplier',
      manufacturer:body.manufacturer||{},
      env:process.env
    });
    if(decision.mode!=='deferred_supplier_payout'){
      return res.status(409).json({ok:false,code:'ARIANA_PAY_SETTLEMENT_MODE_NOT_DEFERRED',decision});
    }
    const plan=buildDirectSalePayoutPlan({
      manufacturer:body.manufacturer||{},
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
    const decision=chooseSettlementMode({
      relationshipType:body.relationshipType||'direct_supplier',
      manufacturer:body.manufacturer||{},
      env:process.env
    });
    if(decision.mode!=='deferred_supplier_payout'){
      return res.status(409).json({ok:false,code:'ARIANA_PAY_SETTLEMENT_MODE_NOT_DEFERRED',decision});
    }
    const result=await executeDirectSalePayout({
      axios,
      env:process.env,
      manufacturer:body.manufacturer||{},
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
    console.log(`[ariana-pay-settlement] self_check=${selfCheck.ok?'ok':'failed'} hold=15d trigger=delivery_confirmed fail_closed=true`);
    console.log(`[ariana-pay-settlement] mp_native_production_allowed=${policy.mercadoPagoNativeSplit.productionAllowed} deferred_execution=${bool(process.env.ARIANA_PAY_SETTLEMENT_DEFERRED_EXECUTION_ENABLED)}`);
    console.log('[ariana-pay-settlement] checkout_changed=false erp_changed=false gustavo_changed=false');
  });
}

if(process.argv[1]&&new URL(import.meta.url).pathname.endsWith(process.argv[1].replace(/\\/g,'/'))){
  startArianaPaySettlementGateway();
}

export {app};
export default app;
