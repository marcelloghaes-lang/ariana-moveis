import dotenv from 'dotenv';
dotenv.config();

import crypto from 'crypto';
import express from 'express';
import axios from 'axios';

import { buildArianaPayPhase1Readiness } from './services/arianaPay/arianaPayPhase1ReadinessService.js';
import { createMercadoPago3dsSandboxClient } from './services/arianaPay/mercadoPagoOrders3dsSandboxService.js';
import { createMpReconciliationSandboxClient } from './services/arianaPay/mercadoPagoReconciliationSandboxService.js';
import { evaluateArianaPaySandboxGuard, assertArianaPaySandboxSafe } from './services/arianaPay/arianaPaySandboxGuardService.js';
import { classifyMercadoPagoSandboxWebhook } from './services/arianaPay/mercadoPagoSandboxWebhookEventService.js';
import { classifyDisputeResponsibility } from './services/arianaPay/arianaPayDisputeResponsibilityService.js';
import { auditRealProductionSample, getReadOnlyProductionAuditConfig } from './services/arianaPay/arianaPayReadOnlyProductionAuditService.js';
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

function parsePtBrMoney(value){
  const raw=clean(value);
  if(!raw) return null;
  const normalized=raw.includes(',')
    ? raw.replace(/\./g,'').replace(',','.')
    : raw;
  const n=Number(normalized);
  return Number.isFinite(n)?Math.round((n+Number.EPSILON)*100)/100:null;
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

async function assertMercadoPagoTestAccountIdentity(){
  const expected=clean(process.env.MP_3DS_SANDBOX_EXPECTED_USER_ID);
  const accessToken=clean(process.env.MP_3DS_SANDBOX_ACCESS_TOKEN);
  if(!expected){
    const error=new Error('MP_3DS_SANDBOX_EXPECTED_USER_ID não configurado.');
    error.statusCode=503;
    error.code='MP_3DS_TEST_ACCOUNT_ID_MISSING';
    throw error;
  }
  if(!accessToken){
    const error=new Error('MP_3DS_SANDBOX_ACCESS_TOKEN não configurado.');
    error.statusCode=503;
    error.code='MP_3DS_SANDBOX_ACCESS_TOKEN_MISSING';
    throw error;
  }

  const response=await axios.get('https://api.mercadopago.com/users/me',{
    headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},
    timeout:15000,
    validateStatus:()=>true
  });
  const status=Number(response?.status||0);
  const actual=clean(response?.data?.id);
  if(status<200||status>=300||!actual){
    const error=new Error('Não foi possível validar a identidade da conta de teste Mercado Pago.');
    error.statusCode=status>=400&&status<600?status:502;
    error.code='MP_3DS_TEST_ACCOUNT_LOOKUP_FAILED';
    throw error;
  }
  if(actual!==expected){
    const error=new Error('A credencial configurada não pertence à conta de teste esperada da Ariana Pay.');
    error.statusCode=409;
    error.code='MP_3DS_TEST_ACCOUNT_MISMATCH';
    throw error;
  }
  return {ok:true,userId:actual};
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
    externalPending:readiness.externalPending,
    productionSampleAuditConfigured:Boolean(getReadOnlyProductionAuditConfig(process.env).uri)
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

  const event=classifyMercadoPagoSandboxWebhook({
    queryType:clean(req.query?.type),
    body:req.body||{}
  });

  console.log('[ariana-pay-sandbox][webhook]',JSON.stringify({
    verified:true,
    dataId:getMercadoPagoWebhookDataId(req),
    queryType:clean(req.query?.type),
    kind:event.kind,
    recommendedAction:event.recommendedAction,
    executeAction:false
  }));

  return res.status(200).json({
    ok:true,
    feature:'ariana_pay',
    mode:'sandbox_webhook_verification_only',
    writesEnabled:false,
    checkoutChanged:false,
    payoutsEnabled:false,
    verified:true,
    event
  });
});

app.get('/production-sample-audit',requireShadow,(_req,res)=>{
  const configured=Boolean(getReadOnlyProductionAuditConfig(process.env).uri);
  res.type('html').send(`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ariana Pay — Auditoria Real Shadow</title>
<style>body{font-family:Arial,sans-serif;background:#f5f7fb;margin:0;padding:24px;color:#152238}.card{max-width:900px;margin:auto;background:#fff;padding:24px;border-radius:16px;box-shadow:0 8px 30px #0001}.grid{display:grid;grid-template-columns:1fr 180px;gap:12px}label{font-size:13px;font-weight:700;display:block;margin:10px 0 4px}input{width:100%;box-sizing:border-box;min-height:42px;border:1px solid #ccd3df;border-radius:8px;padding:10px}button{margin-top:18px;background:#0047ab;color:#fff;border:0;border-radius:10px;padding:13px 18px;font-weight:700;cursor:pointer}.note{background:#eef5ff;padding:12px;border-radius:10px;margin-bottom:16px;font-size:14px}.warn{background:#fff7ed}.status{white-space:pre-wrap;background:#0d1726;color:#e7edf7;padding:12px;border-radius:10px;margin-top:16px;min-height:140px;max-height:650px;overflow:auto}@media(max-width:650px){.grid{grid-template-columns:1fr}}</style></head><body><div class="card">
<h1>Ariana Pay — Amostra real em Shadow</h1>
<div class="note">Somente leitura. A credencial Mongo precisa ter papel read-only comprovado pelo próprio banco. A consulta não retorna nome, CPF, telefone, e-mail ou endereço de clientes.</div>
<div class="note ${configured?'':'warn'}">${configured?'Credencial read-only configurada. A auditoria está pronta para execução.':'Falta configurar ARIANA_PAY_SHADOW_READONLY_MONGODB_URI no Render com um usuário MongoDB SOMENTE LEITURA.'}</div>
<form id="form">
<div class="grid">
<div><label>Código de acesso</label><input id="code" value="AR3DS-641927" autocomplete="off" required></div>
<div><label>Pedidos recentes</label><input id="limit" type="number" min="5" max="100" value="100" required></div>
</div>
<button type="submit" ${configured?'':'disabled'}>Executar auditoria read-only</button>
</form>
<div id="status" class="status">Aguardando auditoria.</div>
</div>
<script>
const form=document.getElementById('form');
const statusEl=document.getElementById('status');
function show(v){statusEl.textContent=typeof v==='string'?v:JSON.stringify(v,null,2)}
form.addEventListener('submit',async e=>{
  e.preventDefault();
  show('Consultando amostra real com credencial read-only...');
  try{
    const limit=Math.max(5,Math.min(Number(document.getElementById('limit').value||100),100));
    const r=await fetch('/api/sandbox/production-sample-audit?limit='+encodeURIComponent(limit),{
      headers:{'x-ariana-pay-3ds-code':document.getElementById('code').value.trim()}
    });
    const j=await r.json();
    show(j);
  }catch(err){show('Erro: '+(err?.message||String(err)))}
});
</script></body></html>`);
});

app.get('/api/sandbox/production-sample-audit',requireShadow,async(req,res)=>{
  if(!threeDsTestCodeAllowed(req.headers['x-ariana-pay-3ds-code'])){
    return res.status(401).json({ok:false,code:'ARIANA_PAY_PRODUCTION_AUDIT_UNAUTHORIZED'});
  }
  try{
    const result=await auditRealProductionSample({
      env:process.env,
      limit:Number(req.query?.limit||100),
      now:new Date()
    });
    return res.json(result);
  }catch(error){
    return res.status(safeStatus(error)).json({
      ok:false,
      code:error?.code||'ARIANA_PAY_PRODUCTION_AUDIT_ERROR',
      error:error?.message||'Falha na auditoria real em shadow.',
      writesEnabled:false,
      payoutsEnabled:false,
      checkoutChanged:false
    });
  }
});

app.get('/dispute-test',requireShadow,(_req,res)=>{
  res.type('html').send(`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ariana Pay — Contestação Sandbox</title>
<style>body{font-family:Arial,sans-serif;background:#f5f7fb;margin:0;padding:24px;color:#152238}.card{max-width:760px;margin:auto;background:#fff;padding:24px;border-radius:16px;box-shadow:0 8px 30px #0001}label{font-size:13px;font-weight:700;display:block;margin:10px 0 4px}input,select{width:100%;box-sizing:border-box;min-height:42px;border:1px solid #ccd3df;border-radius:8px;padding:10px}button{margin-top:18px;background:#0047ab;color:#fff;border:0;border-radius:10px;padding:13px 18px;font-weight:700;cursor:pointer}.note{background:#eef5ff;padding:12px;border-radius:10px;margin-bottom:16px;font-size:14px}.status{white-space:pre-wrap;background:#0d1726;color:#e7edf7;padding:12px;border-radius:10px;margin-top:16px;min-height:100px}</style></head><body><div class="card">
<h1>Ariana Pay — Contestação Sandbox</h1>
<div class="note">Simulação interna somente leitura. Não cria dívida, não bloqueia seller e não move dinheiro.</div>
<form id="form">
<label>Código de acesso</label><input id="code" value="AR3DS-641927" required>
<label>Cenário</label>
<select id="scenario">
<option value="known_seller">Responsabilidade conhecida: seller</option>
<option value="unknown">Chargeback sem motivo conclusivo</option>
<option value="fraud_3ds">Compra não reconhecida com 3DS autenticado</option>
</select>
<button type="submit">Simular contestação</button>
</form>
<div id="status" class="status">Aguardando simulação.</div>
</div>
<script>
const form=document.getElementById('form');
const statusEl=document.getElementById('status');
function show(v){statusEl.textContent=typeof v==='string'?v:JSON.stringify(v,null,2)}
form.addEventListener('submit',async e=>{
  e.preventDefault();
  show('Simulando decisão...');
  try{
    const r=await fetch('/api/sandbox/dispute-test',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-ariana-pay-3ds-code':document.getElementById('code').value.trim()},
      body:JSON.stringify({scenario:document.getElementById('scenario').value})
    });
    show(await r.json());
  }catch(err){show('Erro: '+(err?.message||String(err)))}
});
</script></body></html>`);
});

app.post('/api/sandbox/dispute-test',requireShadow,(req,res)=>{
  if(!threeDsTestCodeAllowed(req.headers['x-ariana-pay-3ds-code'])){
    return res.status(401).json({ok:false,code:'ARIANA_PAY_DISPUTE_TEST_UNAUTHORIZED'});
  }
  const scenario=clean(req.body?.scenario);
  let order={chargeback:{status:'opened'}};
  let cardSecurity={};
  let settlement={settlementMode:'manual_marketplace'};
  let risk={kind:'chargeback'};

  if(scenario==='known_seller'){
    order={chargeback:{status:'opened',reason:'Produto não recebido',responsibility:'seller'}};
  }else if(scenario==='fraud_3ds'){
    order={chargeback:{status:'opened',reason:'customer does not recognize the charge'}};
    cardSecurity={transactionSecurity:{authenticated:true,liabilityShiftRequired:true}};
  }

  const decision=classifyDisputeResponsibility({order,settlement,risk,cardSecurity});
  return res.json({
    ok:true,
    mode:'sandbox_dispute_read_only',
    writesEnabled:false,
    payoutsEnabled:false,
    sellerDebtCreated:false,
    scenario:scenario||'unknown',
    decision
  });
});

app.get('/reconciliation-test',requireShadow,(_req,res)=>{
  res.type('html').send(`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ariana Pay — Conciliação Sandbox</title>
<style>body{font-family:Arial,sans-serif;background:#f5f7fb;margin:0;padding:24px;color:#152238}.card{max-width:760px;margin:auto;background:#fff;padding:24px;border-radius:16px;box-shadow:0 8px 30px #0001}label{font-size:13px;font-weight:700;display:block;margin:10px 0 4px}input{width:100%;box-sizing:border-box;min-height:42px;border:1px solid #ccd3df;border-radius:8px;padding:10px}button{margin-top:18px;background:#0047ab;color:#fff;border:0;border-radius:10px;padding:13px 18px;font-weight:700;cursor:pointer}.note{background:#eef5ff;padding:12px;border-radius:10px;margin-bottom:16px;font-size:14px}.status{white-space:pre-wrap;background:#0d1726;color:#e7edf7;padding:12px;border-radius:10px;margin-top:16px;min-height:90px}</style></head><body><div class="card">
<h1>Ariana Pay — Conciliação Sandbox</h1>
<div class="note">Consulta somente leitura. Não altera pagamento, pedido, saldo ou payout.</div>
<form id="recon-form">
<label>Código de acesso</label><input id="code" value="AR3DS-641927" autocomplete="off" required>
<label>Order ID</label><input id="orderId" value="ORDTST01M43S9KT74DGYRDP31JWFCDE7" placeholder="ORD..." autocomplete="off" required>
<label>Valor esperado (R$)</label><input id="expectedAmount" value="50.00" inputmode="decimal" required>
<button type="submit">Conferir pagamento</button>
</form>
<div id="status" class="status">Aguardando consulta.</div>
</div>
<script>
const form=document.getElementById('recon-form');
const statusEl=document.getElementById('status');
function show(v){statusEl.textContent=typeof v==='string'?v:JSON.stringify(v,null,2)}
form.addEventListener('submit',async e=>{
  e.preventDefault();
  const code=document.getElementById('code').value.trim();
  const orderId=document.getElementById('orderId').value.trim();
  const expectedAmount=document.getElementById('expectedAmount').value.trim();
  show('Consultando pagamento sandbox...');
  try{
    const r=await fetch('/api/sandbox/reconciliation-test/order/'+encodeURIComponent(orderId)+'?expectedAmount='+encodeURIComponent(expectedAmount),{
      headers:{'x-ariana-pay-3ds-code':code}
    });
    const j=await r.json();
    show(j);
  }catch(err){
    show('Erro: '+(err?.message||String(err)));
  }
});
</script></body></html>`);
});
app.get('/api/sandbox/reconciliation-test/payment/:paymentId',requireShadow,async(req,res)=>{
  if(!threeDsTestCodeAllowed(req.headers['x-ariana-pay-3ds-code'])){
    return res.status(401).json({ok:false,code:'ARIANA_PAY_RECON_TEST_UNAUTHORIZED'});
  }
  try{
    await assertMercadoPagoTestAccountIdentity();
    const client=createMpReconciliationSandboxClient({axios});
    const rawId=clean(req.params?.paymentId);
    const lookup=rawId.toUpperCase().startsWith('ORD')
      ? await client.fetchOrder(rawId)
      : await client.fetchPayment(rawId);
    const expected=parsePtBrMoney(req.query?.expectedAmount);
    const providerAmount=parsePtBrMoney(lookup?.providerRecord?.providerAmount);
    const expectedValid=expected!==null;
    const providerValid=providerAmount!==null;
    const difference=expectedValid&&providerValid
      ? Math.round(((providerAmount-expected)+Number.EPSILON)*100)/100
      : null;
    return res.json({
      ok:true,
      mode:'sandbox_reconciliation_read_only',
      compatibilityRoute:true,
      writesEnabled:false,
      payoutsEnabled:false,
      providerStatus:lookup.statusCode,
      expectedAmount:expectedValid?expected:null,
      providerAmount:providerValid?providerAmount:null,
      difference,
      matchesExpected:expectedValid&&providerValid?difference===0:null,
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

app.get('/api/sandbox/reconciliation-test/order/:orderId',requireShadow,async(req,res)=>{
  if(!threeDsTestCodeAllowed(req.headers['x-ariana-pay-3ds-code'])){
    return res.status(401).json({ok:false,code:'ARIANA_PAY_RECON_TEST_UNAUTHORIZED'});
  }
  try{
    await assertMercadoPagoTestAccountIdentity();
    const client=createMpReconciliationSandboxClient({axios});
    const lookup=await client.fetchOrder(clean(req.params?.orderId));
    const expected=parsePtBrMoney(req.query?.expectedAmount);
    const providerAmount=parsePtBrMoney(lookup?.providerRecord?.providerAmount);
    const expectedValid=expected!==null;
    const providerValid=providerAmount!==null;
    const difference=expectedValid&&providerValid
      ? Math.round(((providerAmount-expected)+Number.EPSILON)*100)/100
      : null;
    return res.json({
      ok:true,
      mode:'sandbox_reconciliation_read_only',
      writesEnabled:false,
      payoutsEnabled:false,
      providerStatus:lookup.statusCode,
      expectedAmount:expectedValid?expected:null,
      providerAmount:providerValid?providerAmount:null,
      difference,
      matchesExpected:expectedValid&&providerValid?difference===0:null,
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
<div><label>Bandeira</label><input value="Mastercard" readonly></div>
<div><label>Parcelas</label><input value="1x" readonly></div>
<div><label>Documento</label><select id="form-checkout__identificationType"><option value="CPF">CPF</option></select></div>
<div><label>Número do documento</label><input id="form-checkout__identificationNumber" value="12345678909" required></div>
<div class="full"><label>E-mail de teste</label><input type="email" id="form-checkout__cardholderEmail" value="test@testuser.com" required></div>
</div><button type="submit" id="form-checkout__submit">Criar Order 3DS de teste</button><progress value="0" class="progress-bar" style="display:none">Carregando...</progress></form>
<div class="note" style="margin-top:16px"><b>Cartão Orders API:</b> Mastercard 5480 8328 0103 3311, CVV 123, validade 11/30.<br><b>Challenge aprovado:</b> titular APRO-CHOK.<br><b>Challenge negado:</b> use o mesmo cartão e titular OTHE-CHNO.</div>
<div id="status" class="status">Aguardando teste.</div><iframe id="challenge" class="challenge"></iframe></div>
<script>
const mp=new MercadoPago(${JSON.stringify(publicKey)});
const statusEl=document.getElementById('status');
const challenge=document.getElementById('challenge');
const form=document.getElementById('form-checkout');
let currentOrder='';
let currentCode='';

function show(v){statusEl.textContent=typeof v==='string'?v:JSON.stringify(v,null,2)}

mp.fields.create('cardNumber',{placeholder:'Número do cartão'}).mount('form-checkout__cardNumber');
mp.fields.create('expirationDate',{placeholder:'MM/YY'}).mount('form-checkout__expirationDate');
mp.fields.create('securityCode',{placeholder:'CVV'}).mount('form-checkout__securityCode');

async function poll(){
  if(!currentOrder||!currentCode)return;
  try{
    const r=await fetch('/api/sandbox/3ds-test/orders/'+encodeURIComponent(currentOrder),{
      headers:{'x-ariana-pay-3ds-code':currentCode}
    });
    const j=await r.json();
    show(j);
    if(j?.result?.status==='processed'||j?.result?.status==='failed'||j?.result?.status==='canceled'){
      challenge.style.display='none';
      return;
    }
    setTimeout(poll,2500);
  }catch(e){
    show('Falha ao consultar status: '+e.message);
  }
}

window.addEventListener('message',(event)=>{
  if(event?.data?.status==='COMPLETE'&&currentOrder){
    setTimeout(poll,800);
  }
});

form.addEventListener('submit',async event=>{
  event.preventDefault();
  currentCode=document.getElementById('test-code').value.trim();
  const cardholderName=document.getElementById('form-checkout__cardholderName').value.trim();
  const identificationType=document.getElementById('form-checkout__identificationType').value;
  const identificationNumber=document.getElementById('form-checkout__identificationNumber').value.trim();
  const email=document.getElementById('form-checkout__cardholderEmail').value.trim()||'test@testuser.com';

  show('Gerando token de teste com titular '+cardholderName+'...');
  challenge.style.display='none';
  challenge.removeAttribute('src');

  try{
    const token=await mp.fields.createCardToken({
      cardholderName,
      identificationType,
      identificationNumber
    });

    if(!token?.id) throw new Error('Mercado Pago não retornou o CardToken.');

    const tokenizedName=String(token?.cardholder?.name||'').trim();
    const tokenLastFour=String(token?.last_four_digits||'').trim();
    const tokenLiveMode=token?.live_mode===true;
    if(tokenizedName&&tokenizedName!==cardholderName){
      throw new Error('O titular tokenizado não corresponde ao cenário informado.');
    }

    show({
      etapa:'token_criado',
      cardholderName:tokenizedName||cardholderName,
      liveMode:tokenLiveMode,
      cardLastFour:tokenLastFour,
      expectedLastFour:'3311',
      aviso:'Token protegido; ID não exibido.'
    });

    if(tokenLastFour!=='3311'){
      throw new Error('O Mercado Pago tokenizou outro cartão (final '+(tokenLastFour||'desconhecido')+'). Faça Ctrl+F5, limpe os campos e digite o Mastercard de teste final 3311.');
    }
    // O ambiente de teste é definido pelas credenciais da aplicação, não por este campo isolado do CardToken.
    // A segurança real é validada no backend pelo usuário de teste esperado + Access Token dedicado.

    const r=await fetch('/api/sandbox/3ds-test',{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'x-ariana-pay-3ds-code':currentCode
      },
      body:JSON.stringify({
        token:token.id,
        paymentMethodId:'master',
        installments:1,
        email,
        tokenizedCardholderName:tokenizedName||cardholderName,
        tokenLiveMode
      })
    });
    const j=await r.json();
    show(j);
    if(!r.ok)return;

    currentOrder=j?.result?.orderId||'';
    const url=j?.result?.challengeUrl||'';
    if(url){
      challenge.src=url;
      challenge.style.display='block';
    }
    if(currentOrder)setTimeout(poll,2500);
  }catch(e){
    show('Erro: '+(e?.message||String(e)));
  }
});
</script></body></html>`);
});

app.post('/api/sandbox/3ds-test',requireShadow,async(req,res)=>{
  if(!threeDsTestCodeAllowed(req.headers['x-ariana-pay-3ds-code'])){
    return res.status(401).json({ok:false,code:'ARIANA_PAY_3DS_TEST_UNAUTHORIZED'});
  }
  try{
    const body=req.body||{};
    await assertMercadoPagoTestAccountIdentity();
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
    return res.status(result.statusCode||201).json({
      ok:result.ok,
      mode:'sandbox_3ds_ui',
      writesEnabled:false,
      payoutsEnabled:false,
      providerStatus:result.statusCode,
      providerError:result.ok?undefined:result.providerError,
      tokenDiagnostics:{
        cardholderName:clean(body.tokenizedCardholderName),
        liveMode:body.tokenLiveMode===true
      },
      result:result.result
    });
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
  try{
    const identity=await assertMercadoPagoTestAccountIdentity();
    console.log(`[ariana-pay-sandbox][self-check] test_account_identity: ok user=${identity.userId}`);
  }catch(error){
    console.log(`[ariana-pay-sandbox][self-check] test_account_identity: failed code=${error?.code||'unknown'}`);
  }
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