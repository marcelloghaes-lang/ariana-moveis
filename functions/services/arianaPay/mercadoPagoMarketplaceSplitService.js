import crypto from 'crypto';

const MP_API_BASE='https://api.mercadopago.com';
const MP_AUTH_BASE='https://auth.mercadopago.com.br/authorization';
const DEFAULT_COMMISSION_BPS=1200;
const OAUTH_STATE_TTL_MS=10*60*1000;

function clean(value=''){
  return String(value??'').trim();
}

function flag(value){
  return clean(value).toLowerCase()==='true';
}

function money(value=0,label='valor'){
  const n=Number(value);
  if(!Number.isFinite(n)||n<=0) throw new Error(`${label} inválido.`);
  return Math.round((n+Number.EPSILON)*100)/100;
}

function cents(value=0){
  return Math.round(Number(value||0)*100);
}

function fromCents(value=0){
  return Math.round(Number(value||0))/100;
}

function b64url(buffer){
  return Buffer.from(buffer).toString('base64url');
}

function key32(secret=''){
  const value=clean(secret);
  if(!value) throw new Error('Segredo criptográfico do Ariana Pay não configurado.');
  return crypto.createHash('sha256').update(value,'utf8').digest();
}

function sealJson(value,secret){
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv('aes-256-gcm',key32(secret),iv);
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  const tag=cipher.getAuthTag();
  return `${b64url(iv)}.${b64url(tag)}.${b64url(encrypted)}`;
}

function openJson(token,secret){
  const parts=clean(token).split('.');
  if(parts.length!==3) throw new Error('Token criptográfico inválido.');
  const [ivRaw,tagRaw,dataRaw]=parts;
  const decipher=crypto.createDecipheriv('aes-256-gcm',key32(secret),Buffer.from(ivRaw,'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw,'base64url'));
  const plain=Buffer.concat([
    decipher.update(Buffer.from(dataRaw,'base64url')),
    decipher.final()
  ]).toString('utf8');
  return JSON.parse(plain);
}

function commissionBps(env=process.env){
  const n=Number(env.ARIANA_PAY_MP_COMMISSION_BPS||env.ARIANA_PAY_DIRECT_SALE_COMMISSION_BPS||DEFAULT_COMMISSION_BPS);
  return Number.isInteger(n)&&n>=0&&n<=10000?n:DEFAULT_COMMISSION_BPS;
}

export function getMercadoPagoMarketplaceConfig(env=process.env){
  const redirectUri=clean(env.ARIANA_PAY_MP_OAUTH_REDIRECT_URI||env.MP_OAUTH_REDIRECT_URI||env.MERCADOPAGO_OAUTH_REDIRECT_URI);
  const clientId=clean(env.ARIANA_PAY_MP_CLIENT_ID||env.MP_CLIENT_ID||env.MERCADOPAGO_CLIENT_ID);
  const clientSecret=clean(env.ARIANA_PAY_MP_CLIENT_SECRET||env.MP_CLIENT_SECRET||env.MERCADOPAGO_CLIENT_SECRET);
  const stateSecret=clean(env.ARIANA_PAY_MP_OAUTH_STATE_SECRET);
  const credentialSecret=clean(env.ARIANA_PAY_MP_CREDENTIALS_SECRET);
  return {
    apiBase:MP_API_BASE,
    authBase:MP_AUTH_BASE,
    clientId,
    clientSecret,
    redirectUri,
    stateSecret,
    credentialSecret,
    commissionBps:commissionBps(env),
    commissionPercent:commissionBps(env)/100,
    executionEnabled:flag(env.ARIANA_PAY_MP_SPLIT_EXECUTION_ENABLED),
    oauthConfigured:Boolean(clientId&&clientSecret&&redirectUri&&stateSecret&&credentialSecret)
  };
}

export function buildMarketplaceSplit({grossAmount,merchandiseAmount,shippingAmount=0,commissionBps:customBps}={}){
  const gross=money(grossAmount,'Valor total');
  const shipping=Math.max(0,Number(shippingAmount||0));
  const merchandise=merchandiseAmount===undefined||merchandiseAmount===null
    ? Math.max(0,gross-shipping)
    : money(merchandiseAmount,'Subtotal de mercadorias');
  if(cents(merchandise)+cents(shipping)>cents(gross)+1){
    throw new Error('Subtotal + frete não pode ultrapassar o total da venda.');
  }
  const bps=Number.isInteger(customBps)?customBps:DEFAULT_COMMISSION_BPS;
  if(bps<0||bps>10000) throw new Error('Comissão inválida.');
  const feeCents=Math.round(cents(merchandise)*bps/10000);
  const grossCents=cents(gross);
  return {
    currency:'BRL',
    grossAmount:fromCents(grossCents),
    merchandiseAmount:fromCents(cents(merchandise)),
    shippingAmount:fromCents(cents(shipping)),
    commissionBps:bps,
    commissionPercent:bps/100,
    applicationFee:fromCents(feeCents),
    sellerGrossBeforeMercadoPagoFee:fromCents(grossCents-feeCents),
    marketplaceFeeBase:'merchandise_only',
    invariantOk:feeCents>=0&&feeCents<=grossCents
  };
}

export function createMarketplaceOAuthAuthorization({manufacturerId,env=process.env,now=new Date()}={}){
  const config=getMercadoPagoMarketplaceConfig(env);
  if(!config.clientId||!config.redirectUri||!config.stateSecret){
    const error=new Error('OAuth Mercado Pago incompleto: client_id, redirect_uri ou state secret ausente.');
    error.code='MP_MARKETPLACE_OAUTH_NOT_CONFIGURED';
    error.statusCode=503;
    throw error;
  }
  const id=clean(manufacturerId);
  if(!id) throw new Error('manufacturerId é obrigatório.');
  const codeVerifier=b64url(crypto.randomBytes(48));
  const codeChallenge=b64url(crypto.createHash('sha256').update(codeVerifier).digest());
  const issuedAt=now.getTime();
  const state=sealJson({
    v:1,
    manufacturerId:id,
    codeVerifier,
    nonce:b64url(crypto.randomBytes(16)),
    iat:issuedAt,
    exp:issuedAt+OAUTH_STATE_TTL_MS
  },config.stateSecret);
  const url=new URL(config.authBase);
  url.searchParams.set('client_id',config.clientId);
  url.searchParams.set('response_type','code');
  url.searchParams.set('platform_id','mp');
  url.searchParams.set('redirect_uri',config.redirectUri);
  url.searchParams.set('state',state);
  url.searchParams.set('code_challenge',codeChallenge);
  url.searchParams.set('code_challenge_method','S256');
  return {
    manufacturerId:id,
    authorizationUrl:url.toString(),
    state,
    expiresAt:new Date(issuedAt+OAUTH_STATE_TTL_MS).toISOString(),
    pkce:true
  };
}

export function parseMarketplaceOAuthState(state,{env=process.env,now=new Date()}={}){
  const config=getMercadoPagoMarketplaceConfig(env);
  const data=openJson(state,config.stateSecret);
  if(Number(data?.v)!==1||!clean(data?.manufacturerId)||!clean(data?.codeVerifier)){
    const error=new Error('Estado OAuth inválido.');
    error.code='MP_MARKETPLACE_OAUTH_STATE_INVALID';
    error.statusCode=400;
    throw error;
  }
  if(Number(data.exp||0)<now.getTime()){
    const error=new Error('Autorização Mercado Pago expirada. Gere um novo vínculo.');
    error.code='MP_MARKETPLACE_OAUTH_STATE_EXPIRED';
    error.statusCode=400;
    throw error;
  }
  return data;
}

export async function exchangeMarketplaceAuthorizationCode({axios,code,state,env=process.env,now=new Date()}={}){
  if(!axios||typeof axios.post!=='function') throw new TypeError('Cliente HTTP obrigatório.');
  const config=getMercadoPagoMarketplaceConfig(env);
  if(!config.oauthConfigured){
    const error=new Error('OAuth Mercado Pago do Ariana Pay ainda não está completamente configurado.');
    error.code='MP_MARKETPLACE_OAUTH_NOT_CONFIGURED';
    error.statusCode=503;
    throw error;
  }
  const parsed=parseMarketplaceOAuthState(state,{env,now});
  const authCode=clean(code);
  if(!authCode) throw new Error('Authorization code do Mercado Pago ausente.');
  const response=await axios.post(`${config.apiBase}/oauth/token`,{
    client_id:config.clientId,
    client_secret:config.clientSecret,
    grant_type:'authorization_code',
    code:authCode,
    redirect_uri:config.redirectUri,
    code_verifier:parsed.codeVerifier
  },{headers:{'Content-Type':'application/json'},timeout:30000,validateStatus:()=>true});
  const status=Number(response?.status||0);
  if(status<200||status>=300){
    const error=new Error(response?.data?.message||response?.data?.error_description||`Mercado Pago OAuth retornou HTTP ${status}.`);
    error.code='MP_MARKETPLACE_OAUTH_EXCHANGE_FAILED';
    error.statusCode=status>=400&&status<600?status:502;
    error.providerStatus=status;
    throw error;
  }
  const token=response?.data||{};
  const accessToken=clean(token.access_token);
  const refreshToken=clean(token.refresh_token);
  if(!accessToken||!refreshToken){
    const error=new Error('Mercado Pago não retornou access_token/refresh_token válidos.');
    error.code='MP_MARKETPLACE_OAUTH_TOKEN_EMPTY';
    error.statusCode=502;
    throw error;
  }
  const expiresIn=Math.max(0,Number(token.expires_in||0));
  const credential={
    v:1,
    provider:'mercadopago',
    manufacturerId:parsed.manufacturerId,
    userId:clean(token.user_id),
    accessToken,
    refreshToken,
    publicKey:clean(token.public_key),
    scope:clean(token.scope),
    issuedAt:now.toISOString(),
    expiresAt:expiresIn?new Date(now.getTime()+expiresIn*1000).toISOString():''
  };
  return {
    manufacturerId:parsed.manufacturerId,
    userId:credential.userId,
    expiresAt:credential.expiresAt,
    credentialCapsule:sealJson(credential,config.credentialSecret)
  };
}

export function inspectMarketplaceCredentialCapsule(credentialCapsule,{env=process.env}={}){
  const config=getMercadoPagoMarketplaceConfig(env);
  const credential=openJson(credentialCapsule,config.credentialSecret);
  if(Number(credential?.v)!==1||credential?.provider!=='mercadopago'||!clean(credential?.accessToken)){
    const error=new Error('Credencial Mercado Pago inválida.');
    error.code='MP_MARKETPLACE_CREDENTIAL_INVALID';
    error.statusCode=400;
    throw error;
  }
  return credential;
}

export async function refreshMarketplaceCredential({axios,credentialCapsule,env=process.env,force=false,now=new Date()}={}){
  if(!axios||typeof axios.post!=='function') throw new TypeError('Cliente HTTP obrigatório.');
  const config=getMercadoPagoMarketplaceConfig(env);
  const credential=inspectMarketplaceCredentialCapsule(credentialCapsule,{env});
  const expiresAt=credential.expiresAt?Date.parse(credential.expiresAt):0;
  if(!force&&expiresAt&&expiresAt-now.getTime()>10*60*1000){
    return {credential,credentialCapsule,refreshed:false};
  }
  if(!config.clientId||!config.clientSecret||!clean(credential.refreshToken)){
    const error=new Error('Não foi possível renovar a credencial Mercado Pago.');
    error.code='MP_MARKETPLACE_REFRESH_NOT_CONFIGURED';
    error.statusCode=503;
    throw error;
  }
  const response=await axios.post(`${config.apiBase}/oauth/token`,{
    client_id:config.clientId,
    client_secret:config.clientSecret,
    grant_type:'refresh_token',
    refresh_token:credential.refreshToken
  },{headers:{'Content-Type':'application/json'},timeout:30000,validateStatus:()=>true});
  const status=Number(response?.status||0);
  if(status<200||status>=300){
    const error=new Error(response?.data?.message||response?.data?.error_description||`Mercado Pago refresh retornou HTTP ${status}.`);
    error.code='MP_MARKETPLACE_REFRESH_FAILED';
    error.statusCode=status>=400&&status<600?status:502;
    throw error;
  }
  const token=response?.data||{};
  const expiresIn=Math.max(0,Number(token.expires_in||0));
  const next={
    ...credential,
    accessToken:clean(token.access_token)||credential.accessToken,
    refreshToken:clean(token.refresh_token)||credential.refreshToken,
    userId:clean(token.user_id)||credential.userId,
    publicKey:clean(token.public_key)||credential.publicKey,
    scope:clean(token.scope)||credential.scope,
    issuedAt:now.toISOString(),
    expiresAt:expiresIn?new Date(now.getTime()+expiresIn*1000).toISOString():credential.expiresAt
  };
  return {credential:next,credentialCapsule:sealJson(next,config.credentialSecret),refreshed:true};
}

function safePaymentInput(payment={}){
  const allowed={};
  const keys=['description','payment_method_id','token','installments','issuer_id','payer','notification_url','external_reference','metadata','additional_info','binary_mode','date_of_expiration'];
  for(const key of keys){
    if(payment[key]!==undefined) allowed[key]=payment[key];
  }
  return allowed;
}

export async function createMarketplaceSplitPayment({axios,credentialCapsule,grossAmount,merchandiseAmount,shippingAmount=0,payment={},idempotencyKey='',env=process.env,now=new Date()}={}){
  if(!axios||typeof axios.post!=='function') throw new TypeError('Cliente HTTP obrigatório.');
  const config=getMercadoPagoMarketplaceConfig(env);
  const split=buildMarketplaceSplit({grossAmount,merchandiseAmount,shippingAmount,commissionBps:config.commissionBps});
  const refreshed=await refreshMarketplaceCredential({axios,credentialCapsule,env,now});
  const body={
    ...safePaymentInput(payment),
    transaction_amount:split.grossAmount,
    application_fee:split.applicationFee
  };
  if(!clean(body.payment_method_id)) throw new Error('payment_method_id é obrigatório.');
  if(!body.payer||!clean(body.payer.email)) throw new Error('payer.email é obrigatório.');
  const idem=clean(idempotencyKey)||crypto.createHash('sha256').update(`ariana-pay:mp:${clean(body.external_reference)}:${split.grossAmount}:${clean(body.payment_method_id)}`).digest('hex');

  if(!config.executionEnabled){
    return {
      executed:false,
      mode:'shadow',
      split,
      idempotencyKey:idem,
      credentialCapsule:refreshed.credentialCapsule,
      credentialRefreshed:refreshed.refreshed,
      request:{...body,token:body.token?'[REDACTED_CARD_TOKEN]':undefined},
      reason:'ARIANA_PAY_MP_SPLIT_EXECUTION_ENABLED=false'
    };
  }

  const response=await axios.post(`${config.apiBase}/v1/payments`,body,{
    headers:{
      Authorization:`Bearer ${refreshed.credential.accessToken}`,
      'Content-Type':'application/json',
      'X-Idempotency-Key':idem
    },
    timeout:30000,
    validateStatus:()=>true
  });
  const status=Number(response?.status||0);
  if(status<200||status>=300){
    const error=new Error(response?.data?.message||response?.data?.cause?.[0]?.description||`Mercado Pago retornou HTTP ${status}.`);
    error.code='MP_MARKETPLACE_SPLIT_PAYMENT_FAILED';
    error.statusCode=status>=400&&status<600?status:502;
    error.providerStatus=status;
    error.details=response?.data||null;
    throw error;
  }
  return {
    executed:true,
    mode:response?.data?.live_mode===true?'live':'test',
    split,
    idempotencyKey:idem,
    credentialCapsule:refreshed.credentialCapsule,
    credentialRefreshed:refreshed.refreshed,
    payment:{
      id:clean(response?.data?.id),
      status:clean(response?.data?.status),
      statusDetail:clean(response?.data?.status_detail),
      liveMode:response?.data?.live_mode===true,
      externalReference:clean(response?.data?.external_reference)
    },
    raw:response?.data||{}
  };
}

export function mercadoPagoMarketplaceCapabilities(env=process.env){
  const config=getMercadoPagoMarketplaceConfig(env);
  return {
    provider:'mercadopago',
    model:'split_1_1',
    commissionPercent:config.commissionPercent,
    commissionBase:'merchandise_only',
    oauth:{
      configured:config.oauthConfigured,
      pkce:true,
      clientIdConfigured:Boolean(config.clientId),
      clientSecretConfigured:Boolean(config.clientSecret),
      redirectUriConfigured:Boolean(config.redirectUri),
      stateSecretConfigured:Boolean(config.stateSecret),
      credentialSecretConfigured:Boolean(config.credentialSecret),
      redirectUri:config.redirectUri||null
    },
    split:{
      executionEnabled:config.executionEnabled,
      parameter:'application_fee',
      sellerAuthorization:'oauth_access_token'
    }
  };
}

export default {
  getMercadoPagoMarketplaceConfig,
  buildMarketplaceSplit,
  createMarketplaceOAuthAuthorization,
  parseMarketplaceOAuthState,
  exchangeMarketplaceAuthorizationCode,
  inspectMarketplaceCredentialCapsule,
  refreshMarketplaceCredential,
  createMarketplaceSplitPayment,
  mercadoPagoMarketplaceCapabilities
};
