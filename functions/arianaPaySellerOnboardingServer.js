import dotenv from 'dotenv';
dotenv.config();

import crypto from 'crypto';
import express from 'express';
import axios from 'axios';
import { assertArianaPaySandboxSafe } from './services/arianaPay/arianaPaySandboxGuardService.js';
import { createMarketplaceOAuthAuthorization } from './services/arianaPay/mercadoPagoMarketplaceSplitService.js';

const app=express();
app.disable('x-powered-by');
app.use(express.json({limit:'128kb'}));

const DEFAULT_FINANCIAL_LINK_TTL_MS=7*24*60*60*1000;
const MAX_FINANCIAL_LINK_TTL_MS=30*24*60*60*1000;

function clean(value=''){
  return String(value??'').trim();
}

function flag(value){
  return clean(value).toLowerCase()==='true';
}

function safeEqual(a='',b=''){
  const left=Buffer.from(clean(a),'utf8');
  const right=Buffer.from(clean(b),'utf8');
  return left.length>0&&left.length===right.length&&crypto.timingSafeEqual(left,right);
}

function oauthStartReady(){
  return Boolean(
    clean(process.env.ARIANA_PAY_MP_CLIENT_ID||process.env.MP_CLIENT_ID||process.env.MERCADOPAGO_CLIENT_ID)&&
    clean(process.env.ARIANA_PAY_MP_OAUTH_REDIRECT_URI||process.env.MP_OAUTH_REDIRECT_URI||process.env.MERCADOPAGO_OAUTH_REDIRECT_URI)&&
    clean(process.env.ARIANA_PAY_MP_OAUTH_STATE_SECRET)
  );
}

function allowedOrigins(){
  const defaults=[
    'https://arianamoveis.com.br',
    'https://www.arianamoveis.com.br',
    'https://ariana-moveis-oficial.onrender.com',
    'https://ariana-pay-app-shadow.onrender.com'
  ];
  const extra=clean(process.env.ARIANA_PAY_MARKETPLACE_ALLOWED_ORIGINS)
    .split(',').map(clean).filter(Boolean);
  return new Set([...defaults,...extra]);
}

app.use((req,res,next)=>{
  const origin=clean(req.headers.origin);
  if(origin&&allowedOrigins().has(origin)){
    res.setHeader('Access-Control-Allow-Origin',origin);
    res.setHeader('Vary','Origin');
    res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  }
  if(req.method==='OPTIONS') return res.status(204).end();
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Cache-Control','no-store');
  next();
});

function sellerBackendBase(){
  return clean(process.env.ARIANA_PAY_SELLER_BACKEND_BASE)||'https://ariana-backend.onrender.com/api';
}

function marketplaceInternalBase(){
  return clean(process.env.ARIANA_PAY_MARKETPLACE_INTERNAL_URL)||'https://ariana-pay-marketplace-shadow.onrender.com';
}

function appBase(){
  return clean(process.env.ARIANA_PAY_APP_BASE_URL)||'https://ariana-pay-app-shadow.onrender.com';
}

function sellerBearer(req){
  return clean(req.headers.authorization).replace(/^Bearer\s+/i,'');
}

function marketplaceInternalToken(){
  return clean(process.env.ARIANA_PAY_MARKETPLACE_API_TOKEN);
}

function onboardingInternalToken(){
  return clean(process.env.ARIANA_PAY_ONBOARDING_INTERNAL_TOKEN);
}

function financialLinkSecret(){
  return clean(process.env.ARIANA_PAY_FINANCIAL_LINK_SECRET);
}

function internalRequired(req,res,next){
  const configured=onboardingInternalToken();
  const bearer=clean(req.headers.authorization).replace(/^Bearer\s+/i,'');
  if(!configured){
    return res.status(503).json({ok:false,code:'ARIANA_PAY_ONBOARDING_INTERNAL_TOKEN_MISSING',error:'Canal interno de autorização financeira não configurado.'});
  }
  if(!safeEqual(configured,bearer)){
    return res.status(401).json({ok:false,code:'ARIANA_PAY_ONBOARDING_INTERNAL_UNAUTHORIZED',error:'Acesso não autorizado.'});
  }
  return next();
}

function b64urlJson(value={}){
  return Buffer.from(JSON.stringify(value),'utf8').toString('base64url');
}

function signFinancialPayload(encodedPayload=''){
  const secret=financialLinkSecret();
  if(!secret){
    const error=new Error('Segredo do link financeiro não configurado.');
    error.statusCode=503;
    error.code='ARIANA_PAY_FINANCIAL_LINK_SECRET_MISSING';
    throw error;
  }
  return crypto.createHmac('sha256',secret).update(encodedPayload,'utf8').digest('base64url');
}

export function createFinancialAuthorizationToken({manufacturerId,manufacturerName='',kind='direct_manufacturer',ttlMs=DEFAULT_FINANCIAL_LINK_TTL_MS,now=new Date(),env=process.env}={}){
  const previousSecret=process.env.ARIANA_PAY_FINANCIAL_LINK_SECRET;
  if(env!==process.env&&env?.ARIANA_PAY_FINANCIAL_LINK_SECRET!==undefined){
    process.env.ARIANA_PAY_FINANCIAL_LINK_SECRET=env.ARIANA_PAY_FINANCIAL_LINK_SECRET;
  }
  try{
    const id=clean(manufacturerId).slice(0,180);
    if(!id) throw new Error('manufacturerId é obrigatório.');
    const name=clean(manufacturerName).slice(0,180)||id;
    const normalizedKind=['seller','direct_manufacturer'].includes(clean(kind))?clean(kind):'direct_manufacturer';
    const safeTtl=Math.min(Math.max(Number(ttlMs)||DEFAULT_FINANCIAL_LINK_TTL_MS,5*60*1000),MAX_FINANCIAL_LINK_TTL_MS);
    const issuedAt=now.getTime();
    const payload={
      v:1,
      purpose:'mercadopago_financial_authorization',
      manufacturerId:id,
      manufacturerName:name,
      kind:normalizedKind,
      commissionPercent:12,
      payoutModel:'mercadopago_split_1_1',
      pixFallback:false,
      iat:issuedAt,
      exp:issuedAt+safeTtl,
      jti:crypto.randomBytes(16).toString('base64url')
    };
    const encoded=b64urlJson(payload);
    return {token:`${encoded}.${signFinancialPayload(encoded)}`,payload};
  }finally{
    if(env!==process.env&&env?.ARIANA_PAY_FINANCIAL_LINK_SECRET!==undefined){
      if(previousSecret===undefined) delete process.env.ARIANA_PAY_FINANCIAL_LINK_SECRET;
      else process.env.ARIANA_PAY_FINANCIAL_LINK_SECRET=previousSecret;
    }
  }
}

export function parseFinancialAuthorizationToken(token,{now=new Date(),env=process.env}={}){
  const value=clean(token);
  const parts=value.split('.');
  if(parts.length!==2){
    const error=new Error('Link de autorização inválido.');
    error.statusCode=400;
    error.code='ARIANA_PAY_FINANCIAL_LINK_INVALID';
    throw error;
  }
  const [encoded,signature]=parts;
  const previousSecret=process.env.ARIANA_PAY_FINANCIAL_LINK_SECRET;
  if(env!==process.env&&env?.ARIANA_PAY_FINANCIAL_LINK_SECRET!==undefined){
    process.env.ARIANA_PAY_FINANCIAL_LINK_SECRET=env.ARIANA_PAY_FINANCIAL_LINK_SECRET;
  }
  try{
    const expected=signFinancialPayload(encoded);
    if(!safeEqual(expected,signature)){
      const error=new Error('Assinatura do link de autorização inválida.');
      error.statusCode=400;
      error.code='ARIANA_PAY_FINANCIAL_LINK_INVALID';
      throw error;
    }
    let payload;
    try{ payload=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8')); }
    catch(_){
      const error=new Error('Link de autorização inválido.');
      error.statusCode=400;
      error.code='ARIANA_PAY_FINANCIAL_LINK_INVALID';
      throw error;
    }
    if(Number(payload?.v)!==1||payload?.purpose!=='mercadopago_financial_authorization'||!clean(payload?.manufacturerId)){
      const error=new Error('Link de autorização inválido.');
      error.statusCode=400;
      error.code='ARIANA_PAY_FINANCIAL_LINK_INVALID';
      throw error;
    }
    if(Number(payload.exp||0)<now.getTime()){
      const error=new Error('Este link de autorização expirou. Solicite um novo link no Ariana Pay.');
      error.statusCode=410;
      error.code='ARIANA_PAY_FINANCIAL_LINK_EXPIRED';
      throw error;
    }
    return payload;
  }finally{
    if(env!==process.env&&env?.ARIANA_PAY_FINANCIAL_LINK_SECRET!==undefined){
      if(previousSecret===undefined) delete process.env.ARIANA_PAY_FINANCIAL_LINK_SECRET;
      else process.env.ARIANA_PAY_FINANCIAL_LINK_SECRET=previousSecret;
    }
  }
}

async function resolveSeller(req){
  const token=sellerBearer(req);
  if(!token){
    const error=new Error('Sessão do seller ausente.');
    error.statusCode=401;
    error.code='SELLER_SESSION_MISSING';
    throw error;
  }
  const response=await axios.get(`${sellerBackendBase().replace(/\/+$/,'')}/seller/auth/me`,{
    headers:{Authorization:`Bearer ${token}`,'Accept-Encoding':'identity'},
    timeout:15000,
    validateStatus:()=>true
  });
  if(Number(response.status)!==200||response.data?.ok!==true){
    const error=new Error(response.data?.error||'Sessão do seller inválida.');
    error.statusCode=Number(response.status)>=400&&Number(response.status)<600?Number(response.status):401;
    error.code='SELLER_SESSION_INVALID';
    throw error;
  }
  const seller=response.data?.seller||{};
  const sellerId=clean(seller.sellerId||seller.id);
  if(!sellerId){
    const error=new Error('Seller sem identificador de marketplace.');
    error.statusCode=409;
    error.code='SELLER_ID_MISSING';
    throw error;
  }
  return {
    sellerId,
    name:clean(seller.factoryName||seller.storeName||seller.displayName||seller.name||'Seller'),
    seller
  };
}

function safeStatus(error={}){
  const value=Number(error?.statusCode||500);
  return value>=400&&value<600?value:500;
}

async function fetchMarketplaceConnection(manufacturerId=''){
  const token=marketplaceInternalToken();
  if(!token){
    const error=new Error('Consulta de conexão temporariamente indisponível.');
    error.statusCode=503;
    error.code='ARIANA_PAY_MARKETPLACE_INTERNAL_TOKEN_MISSING';
    throw error;
  }
  const response=await axios.get(`${marketplaceInternalBase().replace(/\/+$/,'')}/api/v1/marketplace/mp/connections/${encodeURIComponent(manufacturerId)}`,{
    headers:{Authorization:`Bearer ${token}`,'Accept-Encoding':'identity'},
    timeout:15000,
    validateStatus:()=>true
  });
  if(Number(response.status)===404) return {connected:false};
  if(Number(response.status)<200||Number(response.status)>=300){
    const error=new Error('Não foi possível consultar o vínculo Mercado Pago.');
    error.statusCode=502;
    error.code='ARIANA_PAY_MARKETPLACE_STATUS_FAILED';
    throw error;
  }
  const data=response.data||{};
  return {
    connected:data.connected===true,
    userId:clean(data.userId),
    connectedAt:data.connectedAt||null,
    expiresAt:data.expiresAt||null
  };
}

export function runSellerOnboardingSelfCheck(){
  return {
    ok:true,
    provider:'mercadopago',
    model:'split_1_1',
    commissionPercent:12,
    passwordRequested:false,
    sellerLoginHandledByMercadoPago:true,
    oauthPkce:true,
    oauthStartReady:oauthStartReady(),
    financialOwnerAuthorization:true,
    technicianNeedsMercadoPagoCredentials:false,
    splitOnly:true,
    pixFallback:false,
    sandbox:flag(process.env.ARIANA_PAY_MP_TEST_TOKEN),
    realMoney:false
  };
}

app.get('/health',(_req,res)=>{
  return res.json({
    ok:true,
    service:'ariana-pay-seller-onboarding',
    mode:'isolated_onboarding_bridge',
    readyForOAuth:oauthStartReady(),
    internalStatusConfigured:Boolean(marketplaceInternalToken()),
    financialOwnerLinkConfigured:Boolean(onboardingInternalToken()&&financialLinkSecret()),
    selfCheck:runSellerOnboardingSelfCheck(),
    checkoutChanged:false,
    erpChanged:false,
    gustavoChanged:false
  });
});

app.post('/api/v1/internal/financial-authorization-links',internalRequired,(req,res)=>{
  try{
    const body=req.body||{};
    const created=createFinancialAuthorizationToken({
      manufacturerId:body.manufacturerId,
      manufacturerName:body.manufacturerName,
      kind:body.kind||'direct_manufacturer',
      ttlMs:body.ttlMs
    });
    const base=appBase().replace(/\/+$/,'');
    return res.status(201).json({
      ok:true,
      provider:'mercadopago',
      model:'split_1_1',
      manufacturerId:created.payload.manufacturerId,
      manufacturerName:created.payload.manufacturerName,
      kind:created.payload.kind,
      authorizationPageUrl:`${base}/mercadopago/autorizar?token=${encodeURIComponent(created.token)}`,
      expiresAt:new Date(created.payload.exp).toISOString(),
      commissionPercent:12,
      pixFallback:false,
      realMoney:false
    });
  }catch(error){
    return res.status(safeStatus(error)).json({ok:false,code:error?.code||'ARIANA_PAY_FINANCIAL_LINK_CREATE_ERROR',error:error?.message||'Não foi possível gerar o link de autorização.'});
  }
});

app.get('/api/v1/public/financial-authorization/:token/status',async(req,res)=>{
  try{
    const payload=parseFinancialAuthorizationToken(req.params.token);
    const connection=await fetchMarketplaceConnection(payload.manufacturerId);
    return res.json({
      ok:true,
      provider:'mercadopago',
      model:'split_1_1',
      manufacturerId:payload.manufacturerId,
      manufacturerName:payload.manufacturerName,
      kind:payload.kind,
      connected:connection.connected===true,
      mercadoPagoUserId:connection.userId||null,
      connectedAt:connection.connectedAt||null,
      tokenExpiresAt:connection.expiresAt||null,
      linkExpiresAt:new Date(payload.exp).toISOString(),
      commissionPercent:12,
      pixFallback:false,
      realMoney:false
    });
  }catch(error){
    return res.status(safeStatus(error)).json({ok:false,code:error?.code||'ARIANA_PAY_FINANCIAL_STATUS_ERROR',error:error?.message||'Não foi possível consultar a autorização.'});
  }
});

app.post('/api/v1/public/financial-authorization/:token/start',(req,res)=>{
  try{
    const payload=parseFinancialAuthorizationToken(req.params.token);
    if(!oauthStartReady()){
      return res.status(503).json({ok:false,code:'MP_MARKETPLACE_OAUTH_NOT_CONFIGURED',error:'Conexão Mercado Pago temporariamente indisponível.'});
    }
    const auth=createMarketplaceOAuthAuthorization({manufacturerId:payload.manufacturerId,env:process.env});
    return res.json({
      ok:true,
      provider:'mercadopago',
      manufacturerId:payload.manufacturerId,
      manufacturerName:payload.manufacturerName,
      authorizationUrl:auth.authorizationUrl,
      expiresAt:auth.expiresAt,
      passwordRequested:false,
      realMoney:false
    });
  }catch(error){
    return res.status(safeStatus(error)).json({ok:false,code:error?.code||'ARIANA_PAY_FINANCIAL_START_ERROR',error:error?.message||'Não foi possível iniciar a autorização Mercado Pago.'});
  }
});

// Mantido para sellers já autenticados. A autorização financeira também pode ser
// enviada ao responsável financeiro pelo Ariana Pay, sem compartilhar senha do MP.
app.post('/api/v1/onboarding/mercadopago/session',async(req,res)=>{
  try{
    const seller=await resolveSeller(req);
    if(!oauthStartReady()){
      return res.status(503).json({ok:false,code:'MP_MARKETPLACE_OAUTH_NOT_CONFIGURED',error:'Conexão Mercado Pago temporariamente indisponível.'});
    }
    const auth=createMarketplaceOAuthAuthorization({manufacturerId:seller.sellerId,env:process.env});
    return res.json({
      ok:true,
      provider:'mercadopago',
      sellerId:seller.sellerId,
      sellerName:seller.name,
      authorizationUrl:auth.authorizationUrl,
      expiresAt:auth.expiresAt,
      sandbox:flag(process.env.ARIANA_PAY_MP_TEST_TOKEN),
      realMoney:false,
      passwordRequested:false
    });
  }catch(error){
    return res.status(safeStatus(error)).json({ok:false,code:error?.code||'ARIANA_PAY_ONBOARDING_SESSION_ERROR',error:error?.message||'Não foi possível iniciar a conexão Mercado Pago.'});
  }
});

app.get('/api/v1/onboarding/mercadopago/status',async(req,res)=>{
  try{
    const seller=await resolveSeller(req);
    const connection=await fetchMarketplaceConnection(seller.sellerId);
    return res.json({
      ok:true,
      connected:connection.connected===true,
      provider:'mercadopago',
      sellerId:seller.sellerId,
      mercadoPagoUserId:connection.userId||null,
      connectedAt:connection.connectedAt||null,
      tokenExpiresAt:connection.expiresAt||null,
      commissionPercent:12,
      sandbox:flag(process.env.ARIANA_PAY_MP_TEST_TOKEN),
      realMoney:false
    });
  }catch(error){
    return res.status(safeStatus(error)).json({ok:false,code:error?.code||'ARIANA_PAY_ONBOARDING_STATUS_ERROR',error:error?.message||'Não foi possível consultar o vínculo Mercado Pago.'});
  }
});

app.use((_req,res)=>res.status(404).json({ok:false,error:'Rota não encontrada.'}));

const port=Number(process.env.PORT||8130);

export function startArianaPaySellerOnboardingServer(){
  assertArianaPaySandboxSafe(process.env);
  const selfCheck=runSellerOnboardingSelfCheck();
  return app.listen(port,()=>{
    console.log(`[ariana-pay-onboarding] listening on port ${port}`);
    console.log(`[ariana-pay-onboarding] self_check=${selfCheck.ok?'ok':'failed'} one_click_oauth=true financial_owner_link=true password_requested=false`);
    console.log(`[ariana-pay-onboarding] technician_mp_credentials=false split_only=true pix_fallback=false`);
    console.log(`[ariana-pay-onboarding] oauth_start_ready=${oauthStartReady()} oauth_test_token=${flag(process.env.ARIANA_PAY_MP_TEST_TOKEN)} split_execution=${flag(process.env.ARIANA_PAY_MP_SPLIT_EXECUTION_ENABLED)}`);
    console.log('[ariana-pay-onboarding] checkout_changed=false erp_changed=false gustavo_changed=false');
  });
}

if(process.argv[1]&&new URL(import.meta.url).pathname.endsWith(process.argv[1].replace(/\\/g,'/'))){
  startArianaPaySellerOnboardingServer();
}

export {app};
export default app;