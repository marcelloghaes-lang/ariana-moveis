import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import axios from 'axios';
import { assertArianaPaySandboxSafe } from './services/arianaPay/arianaPaySandboxGuardService.js';
import { createMarketplaceOAuthAuthorization, mercadoPagoMarketplaceCapabilities } from './services/arianaPay/mercadoPagoMarketplaceSplitService.js';

const app=express();
app.disable('x-powered-by');
app.use(express.json({limit:'128kb'}));

function clean(value=''){
  return String(value??'').trim();
}

function allowedOrigins(){
  const defaults=[
    'https://arianamoveis.com.br',
    'https://www.arianamoveis.com.br',
    'https://ariana-moveis-oficial.onrender.com'
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

function sellerBearer(req){
  return clean(req.headers.authorization).replace(/^Bearer\s+/i,'');
}

function internalToken(){
  return clean(process.env.ARIANA_PAY_MARKETPLACE_API_TOKEN);
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

export function runSellerOnboardingSelfCheck(){
  const capabilities=mercadoPagoMarketplaceCapabilities(process.env);
  return {
    ok:true,
    provider:'mercadopago',
    model:'split_1_1',
    commissionPercent:12,
    passwordRequested:false,
    sellerLoginHandledByMercadoPago:true,
    oauthPkce:true,
    sandbox:capabilities.oauth.testToken===true,
    realMoney:false
  };
}

app.get('/health',(_req,res)=>{
  const capabilities=mercadoPagoMarketplaceCapabilities(process.env);
  return res.json({
    ok:true,
    service:'ariana-pay-seller-onboarding',
    mode:'isolated_onboarding_bridge',
    readyForOAuth:capabilities.oauth.configured,
    internalStatusConfigured:Boolean(internalToken()),
    selfCheck:runSellerOnboardingSelfCheck(),
    checkoutChanged:false,
    erpChanged:false,
    gustavoChanged:false
  });
});

app.post('/api/v1/onboarding/mercadopago/session',async(req,res)=>{
  try{
    const seller=await resolveSeller(req);
    const capabilities=mercadoPagoMarketplaceCapabilities(process.env);
    if(!capabilities.oauth.configured){
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
      sandbox:capabilities.oauth.testToken===true,
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
    const token=internalToken();
    if(!token){
      return res.status(503).json({ok:false,code:'ARIANA_PAY_MARKETPLACE_INTERNAL_TOKEN_MISSING',error:'Consulta de conexão temporariamente indisponível.'});
    }
    const response=await axios.get(`${marketplaceInternalBase().replace(/\/+$/,'')}/api/v1/marketplace/mp/connections/${encodeURIComponent(seller.sellerId)}`,{
      headers:{Authorization:`Bearer ${token}`,'Accept-Encoding':'identity'},
      timeout:15000,
      validateStatus:()=>true
    });
    if(Number(response.status)===404){
      return res.json({ok:true,connected:false,provider:'mercadopago',sellerId:seller.sellerId,commissionPercent:12,realMoney:false});
    }
    if(Number(response.status)<200||Number(response.status)>=300){
      return res.status(502).json({ok:false,code:'ARIANA_PAY_MARKETPLACE_STATUS_FAILED',error:'Não foi possível consultar o vínculo Mercado Pago.'});
    }
    const data=response.data||{};
    return res.json({
      ok:true,
      connected:data.connected===true,
      provider:'mercadopago',
      sellerId:seller.sellerId,
      mercadoPagoUserId:clean(data.userId),
      connectedAt:data.connectedAt||null,
      tokenExpiresAt:data.expiresAt||null,
      commissionPercent:12,
      sandbox:mercadoPagoMarketplaceCapabilities(process.env).oauth.testToken===true,
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
    const capabilities=mercadoPagoMarketplaceCapabilities(process.env);
    console.log(`[ariana-pay-onboarding] listening on port ${port}`);
    console.log(`[ariana-pay-onboarding] self_check=${selfCheck.ok?'ok':'failed'} one_click_oauth=true password_requested=false`);
    console.log(`[ariana-pay-onboarding] oauth_configured=${capabilities.oauth.configured} oauth_test_token=${capabilities.oauth.testToken} split_execution=${capabilities.split.executionEnabled}`);
    console.log('[ariana-pay-onboarding] checkout_changed=false erp_changed=false gustavo_changed=false');
  });
}

if(process.argv[1]&&new URL(import.meta.url).pathname.endsWith(process.argv[1].replace(/\\/g,'/'))){
  startArianaPaySellerOnboardingServer();
}

export {app};
export default app;
