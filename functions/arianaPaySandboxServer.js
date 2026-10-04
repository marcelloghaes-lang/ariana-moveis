import dotenv from 'dotenv';
dotenv.config();

import crypto from 'crypto';
import express from 'express';
import axios from 'axios';

import { buildArianaPayPhase1Readiness } from './services/arianaPay/arianaPayPhase1ReadinessService.js';
import { createMercadoPago3dsSandboxClient } from './services/arianaPay/mercadoPagoOrders3dsSandboxService.js';
import { createMpReconciliationSandboxClient } from './services/arianaPay/mercadoPagoReconciliationSandboxService.js';
import { evaluateArianaPaySandboxGuard, assertArianaPaySandboxSafe } from './services/arianaPay/arianaPaySandboxGuardService.js';
import {
  verifyMercadoPagoWebhookSignature,
  getMercadoPagoWebhookDataId
} from './services/arianaPay/mercadoPagoWebhookSecurityService.js';

const app=express();
app.disable('x-powered-by');

app.use((req,res,next)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Pragma','no-cache');
  next();
});

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

function threeDsTestCodeAllowed(value=''){
  const configured=clean(process.env.ARIANA_PAY_3DS_TEST_CODE);
  return configured&&safeEqual(configured,clean(value));
}

function safeStatus(error={}){
  const status=Number(error?.statusCode||500);
  return status>=400&&status<600?status:500;
}

function sandboxMaxAmount(){
  const configured=Number(process.env.ARIANA_PAY_SANDBOX_MAX_AMOUNT||100);
  if(!Number.isFinite(configured)||configured<=0) return 100;
  return Math.min(configured,1000);
}

function assertSandboxAmount(amount){
  const value=Number(amount);
  const max=sandboxMaxAmount();
  if(!Number.isFinite(value)||value<=0){
    const error=new Error('Valor de teste inválido.');
    error.statusCode=400;
    error.code='ARIANA_PAY_SANDBOX_AMOUNT_INVALID';
    throw error;
  }
  if(value>max){
    const error=new Error(`Valor de teste excede o limite seguro de R$ ${max.toFixed(2)}.`);
    error.statusCode=400;
    error.code='ARIANA_PAY_SANDBOX_AMOUNT_LIMIT';
    throw error;
  }
  return value;
}

app.get('/health',(_req,res)=>{
  const readiness=buildArianaPayPhase1Readiness({env:process.env});
  const guard=evaluateArianaPaySandboxGuard(process.env);
  return res.status(guard.ok?200:503).json({
    ok:guard.ok,
    service:'ariana-pay-sandbox',
    mode:'isolated_shadow',
    readyForRealMoney:false,
    shadowFeatureEnabled:readiness.gates.shadowFeatureEnabled,
    adminTokenConfigured:guard.adminTokenConfigured,
    sandboxMaxAmount:guard.maxAmount,
    safetyViolations:[...new Set([...(readiness.safetyViolations||[]),...(guard.violations||[])])],
    externalPending:readiness.externalPending
  });
});

app.get('/api/admin/ariana-pay/readiness',adminRequired,(_req,res)=>{
  return res.json({
    ok:true,
    feature:'ariana_pay',
    service:'isolated_sandbox',
    sandboxMaxAmount:sandboxMaxAmount(),
    ...buildArianaPayPhase1Readiness({env:process.env})
  });
});

app.post('/api/admin/ariana-pay/3ds-sandbox/orders',adminRequired,requireShadow,async(req,res)=>{
  try{
    const body=req.body||{};
    const amount=assertSandboxAmount(body.amount);
    const client=createMercadoPago3dsSandboxClient({axios});
    const result=await client.createOrder({
      orderId:clean(body.orderId||body.reference),
      amount,
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
    secret,
    requireFreshTimestamp:true,
    toleranceSeconds:Number(process.env.MP_WEBHOOK_SIGNATURE_TOLERANCE_SECONDS||300)
  });

  if(!verification.ok){
    const missingSecret=verification.reason==='secret_not_configured';
    return res.status(missingSecret?503:401).json({
      ok:false,
      code:missingSecret
        ? 'MP_WEBHOOK_SECRET_MISSING'
        : verification.reason==='signature_too_old'
          ? 'MP_WEBHOOK_SIGNATURE_STALE'
          : verification.reason==='signature_from_future'
            ? 'MP_WEBHOOK_SIGNATURE_FUTURE'
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

app.get('/3ds-test',requireShadow,(_req,res)=>{
  const publicKey=clean(process.env.MP_3DS_SANDBOX_PUBLIC_KEY);
  if(!publicKey){
    return res.status(503).send('Public Key de teste ainda não configurada.');
  }
  res.type('html').send(`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ariana Pay — Teste 3DS</title>
<style>body{font-family:Arial,sans-serif;background:#f5f7fb;margin:0;padding:24px;color:#152238}.card{max-width:720px;margin:auto;background:#fff;padding:24px;border-radius:16px;box-shadow:0 8px 30px #0001}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.full{grid-column:1/-1}label{font-size:13px;font-weight:700;display:block;margin:8px 0 4px}.field,input,select{width:100%;box-sizing:border-box;min-height:42px;border:1px solid #ccd3df;border-radius:8px;padding:10px;background:#fff}.field{padding:11px}button{margin-top:18px;background:#0047ab;color:#fff;border:0;border-radius:10px;padding:13px 18px;font-weight:700;cursor:pointer}.note{background:#eef5ff;padding:12px;border-radius:10px;margin-bottom:16px;font-size:14px}.status{white-space:pre-wrap;background:#0d1726;color:#e7edf7;padding:12px;border-radius:10px;margin-top:16px;min-height:70px}.challenge{width:100%;height:560px;border:1px solid #ccd3df;border-radius:10px;margin-top:16px;display:none}@media(max-width:650px){.grid{grid-template-columns:1fr}}</style>
<script src="https://sdk.mercadopago.com/js/v2"></script></head><body><div class="card">
<h1>Ariana Pay — Homologação 3DS</h1><div class="note">Somente sandbox. Nenhum pagamento real é criado. Use apenas cartões de teste do Mercado Pago.</div>
<form id="form-checkout"><div class="grid">
<div class="full"><label>Código de acesso</label><input id="test-code" autocomplete="off" required></div>
<div class="full"><label>Número do cartão</label><div id="form-checkout__cardNumber" class="field"></div></div>
<div><label>Validade</label><div id="form-checkout__expirationDate" class="field"></div></div>
<div><label>CVV</label><div id="form-checkout__securityCode" class="field"></div></div>
<div class="full"><label>Titular / cenário 3DS</label><input id="form-checkout__cardholderName" value="APRO-CHOK" required></div>
<div><label>Emissor</label><select id="form-checkout__issuer"></select></div>
<div><label>Parcelas</label><select id="form-checkout__installments"></select></div>
<div><label>Documento</label><select id="form-checkout__identificationType"></select></div>
<div><label>Número do documento</label><input id="form-checkout__identificationNumber" value="12345678909" required></div>
<div class="full"><label>E-mail de teste</label><input type="email" id="form-checkout__cardholderEmail" value="test@testuser.com" required></div>
</div><button type="submit" id="form-checkout__submit">Criar Order 3DS de teste</button><progress value="0" class="progress-bar" style="display:none">Carregando...</progress></form>
<div class="note" style="margin-top:16px"><b>Challenge aprovado:</b> Mastercard 5483 9281 6457 4623, CVV 123, validade 11/30, titular APRO-CHOK.<br><b>Challenge negado:</b> Mastercard 5361 9568 0611 7557, CVV 123, validade 11/30, titular OTHE-CHNO.</div>
<div id="status" class="status">Aguardando teste.</div><iframe id="challenge" class="challenge"></iframe></div>
<script>
const mp=new MercadoPago(${JSON.stringify(publicKey)});
const statusEl=document.getElementById('status');
const challenge=document.getElementById('challenge');
let currentOrder='';
let currentCode='';
function show(v){statusEl.textContent=typeof v==='string'?v:JSON.stringify(v,null,2)}
async function poll(){if(!currentOrder||!currentCode)return;try{const r=await fetch('/api/sandbox/3ds-test/orders/'+encodeURIComponent(currentOrder),{headers:{'x-ariana-pay-3ds-code':currentCode}});const j=await r.json();show(j);if(j?.result?.status==='processed'||j?.result?.status==='failed'){challenge.style.display='none';return}setTimeout(poll,2500)}catch(e){show('Falha ao consultar status: '+e.message)}}
const cardForm=mp.cardForm({amount:'50.00',iframe:true,form:{id:'form-checkout',cardNumber:{id:'form-checkout__cardNumber',placeholder:'Número do cartão'},expirationDate:{id:'form-checkout__expirationDate',placeholder:'MM/YY'},securityCode:{id:'form-checkout__securityCode',placeholder:'CVV'},cardholderName:{id:'form-checkout__cardholderName',placeholder:'Titular'},issuer:{id:'form-checkout__issuer',placeholder:'Emissor'},installments:{id:'form-checkout__installments',placeholder:'Parcelas'},identificationType:{id:'form-checkout__identificationType',placeholder:'Documento'},identificationNumber:{id:'form-checkout__identificationNumber',placeholder:'CPF'},cardholderEmail:{id:'form-checkout__cardholderEmail',placeholder:'E-mail'}},callbacks:{onFormMounted:error=>{if(error)show('Erro ao montar formulário: '+error.message)},onSubmit:async event=>{event.preventDefault();const data=cardForm.getCardFormData();currentCode=document.getElementById('test-code').value.trim();show('Enviando Order 3DS sandbox...');try{const r=await fetch('/api/sandbox/3ds-test',{method:'POST',headers:{'Content-Type':'application/json','x-ariana-pay-3ds-code':currentCode},body:JSON.stringify({token:data.token,paymentMethodId:data.paymentMethodId||'master',installments:Number(data.installments||1),email:data.cardholderEmail||'test@testuser.com'})});const j=await r.json();show(j);if(!r.ok)return;currentOrder=j?.result?.orderId||'';const url=j?.result?.challengeUrl||'';if(url){challenge.src=url;challenge.style.display='block'}if(currentOrder)setTimeout(poll,2500)}catch(e){show('Erro: '+e.message)}}}});
</script></body></html>`);
});

app.post('/api/sandbox/3ds-test',requireShadow,async(req,res)=>{
  if(!threeDsTestCodeAllowed(req.headers['x-ariana-pay-3ds-code'])){
    return res.status(401).json({ok:false,code:'ARIANA_PAY_3DS_TEST_UNAUTHORIZED'});
  }
  try{
    const body=req.body||{};
    const client=createMercadoPago3dsSandboxClient({axios});
    const result=await client.createOrder({
      orderId:`ariana-pay-3ds-${Date.now()}`,
      amount:50,
      email:clean(body.email)||'test@testuser.com',
      paymentMethodId:clean(body.paymentMethodId)||'master',
      cardToken:clean(body.token),
      installmentCount:Number(body.installments||1)
    });
    if(!result.ok){
      console.log('[ariana-pay-sandbox][3ds-test] provider_rejected',JSON.stringify({status:result.statusCode,providerError:result.providerError}));
    }
    return res.status(result.statusCode||201).json({ok:result.ok,mode:'sandbox_3ds_ui',writesEnabled:false,payoutsEnabled:false,providerStatus:result.statusCode,providerError:result.ok?undefined:result.providerError,result:result.result});
  }catch(error){
    return res.status(safeStatus(error)).json({ok:false,code:error?.code||'ARIANA_PAY_3DS_TEST_ERROR',error:error?.message||'Falha no teste 3DS.'});
  }
});

app.get('/api/sandbox/3ds-test/orders/:providerOrderId',requireShadow,async(req,res)=>{
  if(!threeDsTestCodeAllowed(req.headers['x-ariana-pay-3ds-code'])){
    return res.status(401).json({ok:false,code:'ARIANA_PAY_3DS_TEST_UNAUTHORIZED'});
  }
  try{
    const client=createMercadoPago3dsSandboxClient({axios});
    const lookup=await client.getOrder(clean(req.params?.providerOrderId));
    return res.json({ok:true,mode:'sandbox_3ds_ui_read_only',result:lookup.result});
  }catch(error){
    return res.status(safeStatus(error)).json({ok:false,code:error?.code||'ARIANA_PAY_3DS_TEST_LOOKUP_ERROR',error:error?.message||'Falha ao consultar Order 3DS.'});
  }
});

app.use((_req,res)=>{
  return res.status(404).json({ok:false,error:'Rota não encontrada.'});
});

async function checkProviderCredential({label,token,path}){
  const accessToken=clean(token);
  if(!accessToken){
    console.log(`[ariana-pay-sandbox][self-check] ${label}: missing`);
    return {ok:false,status:0};
  }
  try{
    const response=await axios.get(`https://api.mercadopago.com${path}`,{
      headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},
      timeout:15000,
      validateStatus:()=>true
    });
    const status=Number(response?.status||0);
    const ok=status>0&&status!==401&&status!==403;
    console.log(`[ariana-pay-sandbox][self-check] ${label}: ${ok?'credential_accepted':'credential_rejected'} http=${status}`);
    return {ok,status};
  }catch(error){
    console.log(`[ariana-pay-sandbox][self-check] ${label}: network_error`);
    return {ok:false,status:0};
  }
}

async function runProviderCredentialSelfChecks(){
  if(!shadowEnabled()) return;
  await checkProviderCredential({
    label:'3ds_orders',
    token:process.env.MP_3DS_SANDBOX_ACCESS_TOKEN,
    path:'/v1/orders/ariana-pay-credential-check'
  });
  await checkProviderCredential({
    label:'reconciliation_payments',
    token:process.env.MP_RECON_SANDBOX_ACCESS_TOKEN,
    path:'/v1/payments/ariana-pay-credential-check'
  });
}

const port=Number(process.env.PORT||8099);

export function startArianaPaySandboxServer(){
  assertArianaPaySandboxSafe(process.env);
  return app.listen(port,()=>{
    console.log(`[ariana-pay-sandbox] listening on port ${port}`);
    console.log('[ariana-pay-sandbox] isolated shadow only; checkout and payouts disabled');
    void runProviderCredentialSelfChecks();
  });
}

if(process.argv[1]&&new URL(import.meta.url).pathname.endsWith(process.argv[1].replace(/\\/g,'/'))){
  startArianaPaySandboxServer();
}

export { app };
export default app;
