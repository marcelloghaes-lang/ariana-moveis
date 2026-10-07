import dotenv from 'dotenv';
dotenv.config();

import crypto from 'crypto';
import express from 'express';
import axios from 'axios';
import { assertArianaPaySandboxSafe } from './services/arianaPay/arianaPaySandboxGuardService.js';
import {
  buildMarketplaceSplit,
  createMarketplaceOAuthAuthorization,
  exchangeMarketplaceAuthorizationCode,
  refreshMarketplaceCredential,
  createMarketplaceSplitPayment,
  inspectMarketplaceCredentialCapsule,
  mercadoPagoMarketplaceCapabilities
} from './services/arianaPay/mercadoPagoMarketplaceSplitService.js';

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

const pendingConnections=new Map();
const CONNECTION_TTL_MS=30*60*1000;
const SANDBOX_MANUFACTURER_ID='homologacao-ariana';

function clean(value=''){
  return String(value??'').trim();
}

function safeEqual(a='',b=''){
  const left=Buffer.from(clean(a),'utf8');
  const right=Buffer.from(clean(b),'utf8');
  return left.length>0&&left.length===right.length&&crypto.timingSafeEqual(left,right);
}

function apiRequired(req,res,next){
  const configured=clean(process.env.ARIANA_PAY_MARKETPLACE_API_TOKEN||process.env.ARIANA_PAY_DIRECT_SALE_API_TOKEN);
  const bearer=clean(req.headers.authorization).replace(/^Bearer\s+/i,'');
  const header=clean(req.headers['x-ariana-pay-marketplace-token']);
  if(!configured){
    return res.status(503).json({ok:false,code:'ARIANA_PAY_MARKETPLACE_TOKEN_MISSING',error:'Token da API marketplace não configurado.'});
  }
  if(!safeEqual(configured,bearer||header)){
    return res.status(401).json({ok:false,code:'ARIANA_PAY_MARKETPLACE_UNAUTHORIZED',error:'Acesso não autorizado.'});
  }
  next();
}

function safeStatus(error={}){
  const n=Number(error?.statusCode||500);
  return n>=400&&n<600?n:500;
}

function cleanupConnections(){
  const now=Date.now();
  for(const [key,value] of pendingConnections.entries()){
    if(Number(value?.expiresAtMs||0)<=now) pendingConnections.delete(key);
  }
}

function assertSandboxConnectAllowed(){
  const capabilities=mercadoPagoMarketplaceCapabilities(process.env);
  if(!capabilities.oauth.configured){
    const error=new Error('OAuth Mercado Pago ainda não configurado.');
    error.statusCode=503;
    error.code='MP_MARKETPLACE_OAUTH_NOT_CONFIGURED';
    throw error;
  }
  if(capabilities.oauth.testToken!==true||capabilities.split.executionEnabled===true){
    const error=new Error('Rota de homologação disponível somente em sandbox com execução financeira desligada.');
    error.statusCode=404;
    error.code='MP_MARKETPLACE_SANDBOX_CONNECT_DISABLED';
    throw error;
  }
  return capabilities;
}

export function runMarketplaceStartupSelfCheck(){
  const split=buildMarketplaceSplit({
    grossAmount:1000,
    merchandiseAmount:900,
    shippingAmount:100,
    commissionBps:1200
  });
  if(split.applicationFee!==108||split.sellerGrossBeforeMercadoPagoFee!==892||split.invariantOk!==true){
    throw new Error('Ariana Pay marketplace self-check falhou no split 12% sobre mercadorias.');
  }
  const splitNoShipping=buildMarketplaceSplit({grossAmount:1000,merchandiseAmount:1000,shippingAmount:0,commissionBps:1200});
  if(splitNoShipping.applicationFee!==120||splitNoShipping.sellerGrossBeforeMercadoPagoFee!==880){
    throw new Error('Ariana Pay marketplace self-check falhou no split 12/88.');
  }
  return {
    ok:true,
    provider:'mercadopago',
    model:'split_1_1',
    commissionPercent:12,
    commissionBase:'merchandise_only',
    shippingExcludedFromCommission:true,
    applicationFee:true,
    oauth:true,
    pkce:true
  };
}

app.get('/health',(_req,res)=>{
  const capabilities=mercadoPagoMarketplaceCapabilities(process.env);
  return res.json({
    ok:true,
    service:'ariana-pay-marketplace',
    mode:'isolated_marketplace_shadow',
    checkoutChanged:false,
    erpChanged:false,
    gustavoChanged:false,
    apiTokenConfigured:Boolean(clean(process.env.ARIANA_PAY_MARKETPLACE_API_TOKEN||process.env.ARIANA_PAY_DIRECT_SALE_API_TOKEN)),
    readyForOAuth:capabilities.oauth.configured,
    readyForSplitExecution:capabilities.oauth.configured&&capabilities.split.executionEnabled,
    selfCheck:runMarketplaceStartupSelfCheck(),
    capabilities
  });
});

app.get('/homologacao/mercadopago/conectar',(req,res)=>{
  try{
    assertSandboxConnectAllowed();
    const result=createMarketplaceOAuthAuthorization({manufacturerId:SANDBOX_MANUFACTURER_ID,env:process.env});
    return res.redirect(302,result.authorizationUrl);
  }catch(error){
    return res.status(safeStatus(error)).send('Homologação Mercado Pago indisponível neste momento.');
  }
});

app.get('/homologacao/mercadopago/status',(_req,res)=>{
  try{
    assertSandboxConnectAllowed();
    cleanupConnections();
    const connection=pendingConnections.get(SANDBOX_MANUFACTURER_ID);
    return res.json({
      ok:true,
      sandbox:true,
      connected:Boolean(connection),
      manufacturerId:SANDBOX_MANUFACTURER_ID,
      userId:connection?.userId||null,
      connectedAt:connection?.connectedAt||null,
      expiresAt:connection?.expiresAt||null,
      credentialStoredInMemoryOnly:Boolean(connection),
      splitExecutionEnabled:false
    });
  }catch(error){
    return res.status(safeStatus(error)).json({ok:false,error:error?.message||'Homologação indisponível.'});
  }
});

app.post('/homologacao/mercadopago/testar-split',async(_req,res)=>{
  try{
    const capabilities=assertSandboxConnectAllowed();
    cleanupConnections();
    const connection=pendingConnections.get(SANDBOX_MANUFACTURER_ID);
    if(!connection?.credentialCapsule){
      return res.status(409).json({ok:false,code:'MP_SANDBOX_SELLER_NOT_CONNECTED',error:'Conecte novamente a conta de teste do vendedor antes de executar o split.'});
    }
    const credential=inspectMarketplaceCredentialCapsule(connection.credentialCapsule,{env:process.env});
    if(credential.testToken!==true){
      return res.status(409).json({ok:false,code:'MP_SANDBOX_TOKEN_REQUIRED',error:'A credencial conectada não é de teste.'});
    }

    const testHeaders={
      Authorization:`Bearer ${credential.accessToken}`,
      'Content-Type':'application/json',
      'x-test-token':'true'
    };
    const cardTokenResponse=await axios.post('https://api.mercadopago.com/v1/card_tokens',{
      card_number:'5480832801033311',
      security_code:'123',
      expiration_month:11,
      expiration_year:2030,
      cardholder:{
        name:'APRO',
        identification:{type:'CPF',number:'12345678909'}
      }
    },{headers:testHeaders,timeout:30000,validateStatus:()=>true});

    if(Number(cardTokenResponse?.status||0)<200||Number(cardTokenResponse?.status||0)>=300||!clean(cardTokenResponse?.data?.id)){
      return res.status(502).json({
        ok:false,
        code:'MP_SANDBOX_CARD_TOKEN_FAILED',
        providerStatus:Number(cardTokenResponse?.status||0),
        error:cardTokenResponse?.data?.message||cardTokenResponse?.data?.error||'Mercado Pago não gerou o token do cartão de teste.'
      });
    }

    const split=buildMarketplaceSplit({grossAmount:10,merchandiseAmount:10,shippingAmount:0,commissionBps:1200});
    const idempotencyKey=crypto.createHash('sha256').update(`ariana-pay-split-homolog:${connection.userId}:${connection.connectedAt}`).digest('hex');
    const paymentResponse=await axios.post('https://api.mercadopago.com/v1/payments',{
      description:'Ariana Pay - homologação split 1:1',
      installments:1,
      token:cardTokenResponse.data.id,
      payer:{email:'test@testuser.com'},
      payment_method_id:'master',
      transaction_amount:split.grossAmount,
      application_fee:split.applicationFee,
      external_reference:`ARIANA-PAY-HOMOLOG-${connection.userId}`
    },{
      headers:{...testHeaders,'X-Idempotency-Key':idempotencyKey},
      timeout:30000,
      validateStatus:()=>true
    });

    const providerStatus=Number(paymentResponse?.status||0);
    const payment=paymentResponse?.data||{};
    if(providerStatus<200||providerStatus>=300){
      return res.status(502).json({
        ok:false,
        code:'MP_SANDBOX_SPLIT_PAYMENT_FAILED',
        providerStatus,
        error:payment?.message||payment?.cause?.[0]?.description||payment?.error||'Falha no pagamento de homologação.',
        split
      });
    }

    return res.status(201).json({
      ok:true,
      sandbox:true,
      realMoney:false,
      provider:'mercadopago',
      model:'split_1_1',
      sellerUserId:connection.userId,
      payment:{
        id:clean(payment?.id),
        status:clean(payment?.status),
        statusDetail:clean(payment?.status_detail),
        liveMode:payment?.live_mode===true,
        collectorId:clean(payment?.collector_id),
        externalReference:clean(payment?.external_reference)
      },
      split,
      applicationFeeSent:split.applicationFee,
      globalSplitExecutionEnabled:capabilities.split.executionEnabled,
      checkoutChanged:false,
      erpChanged:false,
      gustavoChanged:false
    });
  }catch(error){
    console.error('[ariana-pay-marketplace] sandbox_split_probe_error',error?.code||'',error?.message||error);
    return res.status(safeStatus(error)).json({ok:false,code:error?.code||'MP_SANDBOX_SPLIT_PROBE_ERROR',error:error?.message||'Falha na homologação do split.'});
  }
});

app.get('/api/v1/marketplace/capabilities',apiRequired,(_req,res)=>{
  return res.json({ok:true,selfCheck:runMarketplaceStartupSelfCheck(),...mercadoPagoMarketplaceCapabilities(process.env)});
});

app.post('/api/v1/marketplace/split/quote',apiRequired,(req,res)=>{
  try{
    const body=req.body||{};
    const capabilities=mercadoPagoMarketplaceCapabilities(process.env);
    const split=buildMarketplaceSplit({
      grossAmount:body.grossAmount,
      merchandiseAmount:body.merchandiseAmount,
      shippingAmount:body.shippingAmount||0,
      commissionBps:Math.round(capabilities.commissionPercent*100)
    });
    return res.json({ok:true,provider:'mercadopago',model:'split_1_1',split});
  }catch(error){
    return res.status(422).json({ok:false,code:'ARIANA_PAY_MP_SPLIT_QUOTE_ERROR',error:error?.message||'Falha ao calcular split.'});
  }
});

app.get('/api/v1/marketplace/mp/oauth/url',apiRequired,(req,res)=>{
  try{
    const manufacturerId=clean(req.query?.manufacturerId||req.query?.sellerId);
    const result=createMarketplaceOAuthAuthorization({manufacturerId,env:process.env});
    return res.json({ok:true,...result});
  }catch(error){
    return res.status(safeStatus(error)).json({ok:false,code:error?.code||'MP_MARKETPLACE_OAUTH_URL_ERROR',error:error?.message||'Falha ao iniciar OAuth.'});
  }
});

app.get('/api/v1/marketplace/mp/oauth/callback',async(req,res)=>{
  try{
    const result=await exchangeMarketplaceAuthorizationCode({
      axios,
      code:req.query?.code,
      state:req.query?.state,
      env:process.env
    });
    cleanupConnections();
    pendingConnections.set(result.manufacturerId,{
      ...result,
      connectedAt:new Date().toISOString(),
      expiresAtMs:Date.now()+CONNECTION_TTL_MS
    });
    return res.status(200).send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ariana Pay</title><style>body{font-family:Arial,sans-serif;background:#07152e;color:white;min-height:100vh;display:flex;align-items:center;justify-content:center;margin:0;padding:24px}.card{max-width:560px;background:#0d2349;border-radius:20px;padding:28px;border:1px solid rgba(255,255,255,.12)}h1{color:#f4c542}p{line-height:1.5}</style></head><body><div class="card"><h1>Mercado Pago conectado</h1><p>A conta foi autorizada com sucesso para o marketplace Ariana.</p><p>Você pode fechar esta janela.</p></div></body></html>`);
  }catch(error){
    console.error('[ariana-pay-marketplace] oauth_callback_error',error?.code||'',error?.providerStatus||'',error?.message||error);
    return res.status(safeStatus(error)).send('Não foi possível concluir a autorização do Mercado Pago.');
  }
});

app.get('/api/v1/marketplace/mp/connections/:manufacturerId',apiRequired,(req,res)=>{
  cleanupConnections();
  const manufacturerId=clean(req.params?.manufacturerId);
  const connection=pendingConnections.get(manufacturerId);
  if(!connection){
    return res.status(404).json({ok:false,connected:false,code:'MP_MARKETPLACE_CONNECTION_NOT_FOUND',error:'Vínculo Mercado Pago não encontrado ou expirado.'});
  }
  return res.json({
    ok:true,
    connected:true,
    manufacturerId:connection.manufacturerId,
    userId:connection.userId,
    expiresAt:connection.expiresAt,
    connectedAt:connection.connectedAt,
    credentialCapsule:connection.credentialCapsule
  });
});

app.post('/api/v1/marketplace/mp/credentials/refresh',apiRequired,async(req,res)=>{
  try{
    const result=await refreshMarketplaceCredential({
      axios,
      credentialCapsule:req.body?.credentialCapsule,
      env:process.env,
      force:req.body?.force===true
    });
    return res.json({
      ok:true,
      refreshed:result.refreshed,
      manufacturerId:result.credential.manufacturerId,
      userId:result.credential.userId,
      expiresAt:result.credential.expiresAt,
      credentialCapsule:result.credentialCapsule
    });
  }catch(error){
    return res.status(safeStatus(error)).json({ok:false,code:error?.code||'MP_MARKETPLACE_REFRESH_ERROR',error:error?.message||'Falha ao renovar credencial Mercado Pago.'});
  }
});

app.post('/api/v1/marketplace/mp/payments',apiRequired,async(req,res)=>{
  try{
    const body=req.body||{};
    const result=await createMarketplaceSplitPayment({
      axios,
      credentialCapsule:body.credentialCapsule,
      grossAmount:body.grossAmount,
      merchandiseAmount:body.merchandiseAmount,
      shippingAmount:body.shippingAmount||0,
      payment:body.payment||{},
      idempotencyKey:body.idempotencyKey||'',
      env:process.env
    });
    return res.status(result.executed?201:200).json({
      ok:true,
      checkoutChanged:false,
      erpChanged:false,
      gustavoChanged:false,
      ...result
    });
  }catch(error){
    return res.status(safeStatus(error)).json({
      ok:false,
      code:error?.code||'MP_MARKETPLACE_SPLIT_PAYMENT_ERROR',
      error:error?.message||'Falha ao processar split Mercado Pago.',
      providerStatus:error?.providerStatus||undefined
    });
  }
});

app.use((_req,res)=>res.status(404).json({ok:false,error:'Rota não encontrada.'}));

const port=Number(process.env.PORT||8110);

export function startArianaPayMarketplaceServer(){
  assertArianaPaySandboxSafe(process.env);
  const selfCheck=runMarketplaceStartupSelfCheck();
  return app.listen(port,()=>{
    const capabilities=mercadoPagoMarketplaceCapabilities(process.env);
    console.log(`[ariana-pay-marketplace] listening on port ${port}`);
    console.log(`[ariana-pay-marketplace] self_check=${selfCheck.ok?'ok':'failed'} split=12% application_fee=true oauth_pkce=true`);
    console.log(`[ariana-pay-marketplace] oauth_configured=${capabilities.oauth.configured} oauth_test_token=${capabilities.oauth.testToken} split_execution=${capabilities.split.executionEnabled}`);
    console.log('[ariana-pay-marketplace] checkout_changed=false erp_changed=false gustavo_changed=false');
  });
}

if(process.argv[1]&&new URL(import.meta.url).pathname.endsWith(process.argv[1].replace(/\\/g,'/'))){
  startArianaPayMarketplaceServer();
}

export {app};
export default app;