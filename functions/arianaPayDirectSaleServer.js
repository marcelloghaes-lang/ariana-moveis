import dotenv from 'dotenv';
dotenv.config();

import crypto from 'crypto';
import express from 'express';
import axios from 'axios';

import {
  buildDirectSalePayoutPlan,
  validateDirectSaleManufacturer,
  directSalePayoutCapabilities,
  createEfiDirectSalePayoutClient,
  executeDirectSalePayout
} from './services/arianaPay/arianaPayDirectSalePayoutService.js';
import { assertArianaPaySandboxSafe } from './services/arianaPay/arianaPaySandboxGuardService.js';

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

function apiRequired(req,res,next){
  const configured=clean(process.env.ARIANA_PAY_DIRECT_SALE_API_TOKEN);
  const bearer=clean(req.headers.authorization).replace(/^Bearer\s+/i,'');
  const header=clean(req.headers['x-ariana-pay-direct-sale-token']);
  if(!configured){
    return res.status(503).json({
      ok:false,
      code:'ARIANA_PAY_DIRECT_SALE_TOKEN_MISSING',
      error:'Token da integração de venda direta não configurado.'
    });
  }
  if(!safeEqual(configured,bearer||header)){
    return res.status(401).json({ok:false,code:'ARIANA_PAY_DIRECT_SALE_UNAUTHORIZED',error:'Acesso não autorizado.'});
  }
  next();
}

function safeStatus(error={}){
  const value=Number(error?.statusCode||500);
  return value>=400&&value<600?value:500;
}

function commissionBps(){
  const value=Number(process.env.ARIANA_PAY_DIRECT_SALE_COMMISSION_BPS||1200);
  return Number.isInteger(value)&&value>=0&&value<=10000?value:1200;
}

app.get('/health',(_req,res)=>{
  const capabilities=directSalePayoutCapabilities(process.env);
  return res.json({
    ok:true,
    service:'ariana-pay-direct-sale',
    mode:'isolated_direct_sale',
    apiTokenConfigured:Boolean(clean(process.env.ARIANA_PAY_DIRECT_SALE_API_TOKEN)),
    readyForManufacturerApi:Boolean(clean(process.env.ARIANA_PAY_DIRECT_SALE_API_TOKEN)),
    readyForRealMoney:capabilities.payout.configured&&capabilities.payout.executionEnabled,
    ...capabilities
  });
});

app.get('/api/v1/direct-sale/capabilities',apiRequired,(_req,res)=>{
  return res.json({ok:true,...directSalePayoutCapabilities(process.env)});
});

app.post('/api/v1/direct-sale/manufacturers/validate',apiRequired,(req,res)=>{
  const validation=validateDirectSaleManufacturer(req.body?.manufacturer||req.body||{});
  return res.status(validation.ok?200:422).json({
    ok:validation.ok,
    mode:'manufacturer_api_validation',
    validation
  });
});

app.post('/api/v1/direct-sale/payout-plan',apiRequired,(req,res)=>{
  try{
    const body=req.body||{};
    const plan=buildDirectSalePayoutPlan({
      manufacturer:body.manufacturer||{},
      order:body.order||{},
      grossAmount:body.grossAmount,
      commissionBps:commissionBps(),
      now:body.now?new Date(body.now):new Date()
    });
    return res.json({
      ok:true,
      executionPerformed:false,
      checkoutChanged:false,
      erpChanged:false,
      gustavoChanged:false,
      plan
    });
  }catch(error){
    return res.status(safeStatus(error)).json({
      ok:false,
      code:error?.code||'ARIANA_PAY_DIRECT_SALE_PLAN_ERROR',
      error:error?.message||'Falha ao montar plano de repasse.'
    });
  }
});

app.post('/api/v1/direct-sale/payouts/execute',apiRequired,async(req,res)=>{
  try{
    const body=req.body||{};
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
      mode:'direct_sale_payout_execution',
      checkoutChanged:false,
      erpChanged:false,
      gustavoChanged:false,
      ...result
    });
  }catch(error){
    return res.status(safeStatus(error)).json({
      ok:false,
      code:error?.code||'ARIANA_PAY_DIRECT_SALE_PAYOUT_ERROR',
      error:error?.message||'Falha no repasse.',
      providerStatus:error?.providerStatus||undefined,
      idEnvio:error?.idEnvio||undefined,
      plan:error?.plan||undefined
    });
  }
});

app.get('/api/v1/direct-sale/payouts/:idEnvio',apiRequired,async(req,res)=>{
  try{
    const client=createEfiDirectSalePayoutClient({axios,env:process.env});
    const result=await client.getPixStatus(clean(req.params?.idEnvio));
    return res.json({ok:true,result});
  }catch(error){
    return res.status(safeStatus(error)).json({
      ok:false,
      code:error?.code||'ARIANA_PAY_DIRECT_SALE_LOOKUP_ERROR',
      error:error?.message||'Falha ao consultar repasse.',
      providerStatus:error?.providerStatus||undefined
    });
  }
});

app.use((_req,res)=>res.status(404).json({ok:false,error:'Rota não encontrada.'}));

const port=Number(process.env.PORT||8100);

export function startArianaPayDirectSaleServer(){
  // Mantem as mesmas travas de isolamento usadas pela Fase 1 do Ariana Pay.
  assertArianaPaySandboxSafe(process.env);
  return app.listen(port,()=>{
    const capabilities=directSalePayoutCapabilities(process.env);
    console.log(`[ariana-pay-direct-sale] listening on port ${port}`);
    console.log(`[ariana-pay-direct-sale] commission=${capabilities.commissionPercent}% hold=${capabilities.releasePolicy.holdDays}d`);
    console.log(`[ariana-pay-direct-sale] efi_configured=${capabilities.payout.configured} payout_execution=${capabilities.payout.executionEnabled}`);
  });
}

if(process.argv[1]&&new URL(import.meta.url).pathname.endsWith(process.argv[1].replace(/\\/g,'/'))){
  startArianaPayDirectSaleServer();
}

export { app };
export default app;
