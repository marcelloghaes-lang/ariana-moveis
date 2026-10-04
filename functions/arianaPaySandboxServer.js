import dotenv from 'dotenv';
dotenv.config();

import crypto from 'crypto';
import express from 'express';
import axios from 'axios';

import { buildArianaPayPhase1Readiness } from './services/arianaPay/arianaPayPhase1ReadinessService.js';
import { createMercadoPago3dsSandboxClient } from './services/arianaPay/mercadoPagoOrders3dsSandboxService.js';
import { createMpReconciliationSandboxClient } from './services/arianaPay/mercadoPagoReconciliationSandboxService.js';
import {
  verifyMercadoPagoWebhookSignature,
  getMercadoPagoWebhookDataId
} from './services/arianaPay/mercadoPagoWebhookSecurityService.js';

const app=express();
app.disable('x-powered-by');
app.use(express.json({limit:'1mb'}));

function clean(value=''){
  return String(value||'').trim();
}

function safeEqual(a='',b=''){
  const left=Buffer.from(clean(a),'utf8');
  const right=Buffer.from(clean(b),'utf8');
  return left.length>0&&left.length===right.length&&crypto.timingSafeEqual(left,right);
}

function adminRequired(req,res,next){
  const configured=clean(process.env.ARIANA_PAY_SANDBOX_ADMIN_TOKEN);
  const bearer=clean(req.headers.authorization).replace(/^Bearer\s+/i,'');
  const header=clean(req.headers['x-ariana-pay-admin-token']);
  const received=bearer||header;

  if(!configured){
    return res.status(503).json({
      ok:false,
      code:'ARIANA_PAY_SANDBOX_ADMIN_TOKEN_MISSING',
      error:'Acesso administrativo do sandbox Ariana Pay ainda não foi configurado.'
    });
  }
  if(!safeEqual(configured,received)){
    return res.status(401).json({
      ok:false,
      code:'ARIANA_PAY_SANDBOX_UNAUTHORIZED',
      error:'Acesso não autorizado.'
    });
  }
  return next();
}

function shadowEnabled(){
  return clean(process.env.ARIANA_PAY_SHADOW_ENABLED).toLowerCase()==='true';
}

function requireShadow(req,res,next){
  if(!shadowEnabled()){
    return res.status(404).json({
      ok:false,
      code:'ARIANA_PAY_SHADOW_DISABLED',
      error:'Ariana Pay shadow não está habilitado neste ambiente.'
    });
  }
  return next();
}

function safeStatus(error={}){
  const status=Number(error?.statusCode||500);
  return status>=400&&status<600?status:500;
}

app.get('/health',(_req,res)=>{
  const readiness=buildArianaPayPhase1Readiness({env:process.env});
  return res.json({
    ok:true,
    service:'ariana-pay-sandbox',
    mode:'isolated_shadow',
    readyForRealMoney:false,
    shadowFeatureEnabled:readiness.gates.shadowFeatureEnabled,
    safetyViolations:readiness.safetyViolations,
    externalPending:readiness.externalPending
  });
});

app.get('/api/admin/ariana-pay/readiness',adminRequired,(_req,res)=>{
  return res.json({
    ok:true,
    feature:'ariana_pay',
    service:'isolated_sandbox',
    ...buildArianaPayPhase1Readiness({env:process.env})
  });
});

app.post('/api/admin/ariana-pay/3ds-sandbox/orders',adminRequired,requireShadow,async(req,res)=>{
  try{
    const body=req.body||{};
    const client=createMercadoPago3dsSandboxClient({axios});
    const result=await client.createOrder({
      orderId:clean(body.orderId||body.reference),
      amount:Number(body.amount||0),
      email:clean(body.email),
      paymentMethodId:clean(body.paymentMethodId||body.payment_method_id),
      cardToken:clean(body.cardToken||body.token),
      installmentCount:Number(body.installmentCount||body.installments||1),
      idempotencyKey:clean(body.idempotencyKey)
    });

    return res.status(result.statusCode||201).json({
      ok:result.ok,
      feature:'ariana_pay',
      mode:'sandbox_3ds',
      writesEnabled:false,
      checkoutChanged:false,
      payoutsEnabled:false,
      providerStatus:result.statusCode,
      idempotencyKey:result.idempotencyKey,
      request:result.request,
      result:result.result
    });
  }catch(error){
    return res.status(safeStatus(error)).json({
      ok:false,
      feature:'ariana_pay',
      mode:'sandbox_3ds',
      code:error?.code||'MP_3DS_SANDBOX_ERROR',
      error:error?.message||'Falha no sandbox 3DS.'
    });
  }
});

app.get('/api/admin/ariana-pay/3ds-sandbox/orders/:providerOrderId',adminRequired,requireShadow,async(req,res)=>{
  try{
    const client=createMercadoPago3dsSandboxClient({axios});
    const lookup=await client.getOrder(clean(req.params?.providerOrderId));
    return res.json({
      ok:true,
      feature:'ariana_pay',
      mode:'sandbox_3ds_read_only',
      writesEnabled:false,
      checkoutChanged:false,
      payoutsEnabled:false,
      providerStatus:lookup.statusCode,
      result:lookup.result
    });
  }catch(error){
    return res.status(safeStatus(error)).json({
      ok:false,
      code:error?.code||'MP_3DS_SANDBOX_LOOKUP_ERROR',
      error:error?.message||'Falha ao consultar order 3DS sandbox.'
    });
  }
});

app.get('/api/admin/ariana-pay/reconcile-sandbox/payment/:paymentId',adminRequired,requireShadow,async(req,res)=>{
  try{
    const client=createMpReconciliationSandboxClient({axios});
    const lookup=await client.fetchPayment(clean(req.params?.paymentId));
    return res.json({
      ok:true,
      feature:'ariana_pay',
      mode:'sandbox_reconciliation_read_only',
      writesEnabled:false,
      payoutsEnabled:false,
      providerStatus:lookup.statusCode,
      providerRecord:lookup.providerRecord
    });
  }catch(error){
    return res.status(safeStatus(error)).json({
      ok:false,
      code:error?.code||'MP_RECON_SANDBOX_ERROR',
      error:error?.message||'Falha na conciliação sandbox.'
    });
  }
});

app.post('/api/webhooks/ariana-pay/mercadopago-sandbox',requireShadow,(req,res)=>{
  const enforce=clean(process.env.MP_WEBHOOK_SIGNATURE_ENFORCE).toLowerCase()==='true';
  const secret=clean(process.env.MP_WEBHOOK_SECRET);

  if(!enforce){
    return res.status(409).json({
      ok:false,
      code:'MP_WEBHOOK_SIGNATURE_ENFORCEMENT_DISABLED',
      error:'Validação de assinatura do webhook sandbox não está habilitada.'
    });
  }

  const verification=verifyMercadoPagoWebhookSignature({
    signatureHeader:clean(req.headers['x-signature']),
    requestId:clean(req.headers['x-request-id']),
    dataId:getMercadoPagoWebhookDataId(req),
    secret
  });

  if(!verification.ok){
    return res.status(verification.reason==='secret_not_configured'?503:401).json({
      ok:false,
      code:verification.reason==='secret_not_configured'
        ? 'MP_WEBHOOK_SECRET_MISSING'
        : 'MP_WEBHOOK_SIGNATURE_INVALID',
      error:'Webhook Mercado Pago sandbox não autenticado.'
    });
  }

  return res.status(200).json({
    ok:true,
    feature:'ariana_pay',
    mode:'sandbox_webhook_verification_only',
    writesEnabled:false,
    checkoutChanged:false,
    payoutsEnabled:false,
    verified:true
  });
});

app.use((_req,res)=>{
  return res.status(404).json({ok:false,error:'Rota não encontrada.'});
});

const port=Number(process.env.PORT||8099);

export function startArianaPaySandboxServer(){
  return app.listen(port,()=>{
    console.log(`[ariana-pay-sandbox] listening on port ${port}`);
    console.log('[ariana-pay-sandbox] isolated shadow only; checkout and payouts disabled');
  });
}

if(process.argv[1]&&new URL(import.meta.url).pathname.endsWith(process.argv[1].replace(/\\/g,'/'))){
  startArianaPaySandboxServer();
}

export { app };
export default app;
