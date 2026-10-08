import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import axios from 'axios';

const app=express();
const port=Number(process.env.PORT||10000);
const shadowBase=String(process.env.ARIANA_PAY_SHADOW_BASE_URL||'https://ariana-pay-shadow.onrender.com').replace(/\/+$/,'');
const backendBase=String(process.env.ARIANA_PAY_BACKEND_BASE_URL||'https://ariana-backend.onrender.com/api').replace(/\/+$/,'');
const onboardingBase=String(process.env.ARIANA_PAY_ONBOARDING_BASE_URL||'https://ariana-pay-seller-onboarding-shadow.onrender.com').replace(/\/+$/,'');
const icon192Base64='iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAIAAADdvvtQAAADI0lEQVR42u3dvVkCQRRGYZiH0L60AJuwCQKboAgtwMLINdSHAPnfud99T0jG7NkzdxbE9er5YwVcyrAEIBAIBAKBQACBQCAQCAQCCAQCgUAgEEAgEAgEAoEAAoFAIBAIBAIBBAKBQCAQCCAQCAQCgUAAgUAgEAgEAggEAoFAIBAIBBDohuy3u7Ne78zaD40fseTp/e3Ii1Cgk2QSHgW6dvM6QIQUCARaKD82NQKBQMvlR4QIxAYC0Y5AAR5wiED/4JEPgS5PyCn2NI+QAokQge6fn+MOdY7QYA8I9IhtS4QI5HoTaNGpWYQIdJujO4cUyJGeQJPlp2eEFEiECPTw/JimOwrk6E6giTYmEeol0L1nZwXCjaPVJEItBFoqPx0cUiBHegJNPP3ER2h0tkeECDTFte88TScL5MkhgcpsPW0jFCuQJ4cEikpaaoQyBZozP5EOjW72ONITqPA1zotQmkCLX6FuEepVoMdc3VbTdJRAju4EcqQnkPwokNlZhGxhs+cnw6EEgaa9Eh32zfwCLXsV4zey8gKZnQnkSE8g+elK4X84l/Q4rq7rtjA3Q0uBfGGeQEi4JYa1hgKJEIHkR4HYc/2JvdwbjNrCPDkkUIvNKylCm7D8ZERov91VeSOj0JombV4xu61jvP26gUCRn7pnREiBTNPpAvnSD4Ec3WMjNIJXH90FarJ5lY6QIdqRPlSgVrOz70SjaYRGxfWKnJ2LvqnhbjNN99rCHN0JJD85ERpJ64vuAvnYq1yEHOMd6VMEkp+Kb3a4q0QofwtrODv7Ur38tJimh3sRtQUyO5eOkGM8KgskP9UjtJlhdQzRdafDiX6l9UAj+SmxOMP9JDwhBfp7t5GpyrIU/qFx2MJAIBAIIBAIBAKBQACBQCAQCPnM8kv131+vLsZZrF8+FYg95RdtWAgOFRaIPdUX0BANAoFAIBAIBBAIBAKBTmOS5/F1WXwBhyVgT/ktjEN1F80fFsIQDQKBQCAQQCAQCAQCgQACgUAgEAgEEAgEAoFAIIBAIBAIBAKBQACBQCAQCAQCCAQCgUAgEEAgEAgEAoGAX34ASs9QijQHmxMAAAAASUVORK5CYII=';
const icon512Base64='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';

app.disable('x-powered-by');
app.use(express.json({limit:'96kb'}));
app.use((req,res,next)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'");
  next();
});

function clean(value=''){
  return String(value??'').trim();
}

function bearer(req){
  return clean(req.headers.authorization).replace(/^Bearer\s+/i,'');
}

function onboardingInternalToken(){
  return clean(process.env.ARIANA_PAY_ONBOARDING_INTERNAL_TOKEN);
}

function safeStatus(status,fallback=502){
  const n=Number(status||0);
  return n>=400&&n<600?n:fallback;
}

async function backendRequest(path,options={}){
  return axios({
    url:backendBase+path,
    timeout:18000,
    validateStatus:()=>true,
    headers:{'Accept-Encoding':'identity',...(options.headers||{})},
    ...options
  });
}

async function assertAdmin(req){
  const token=bearer(req);
  if(!token){
    const error=new Error('Sessão administrativa ausente.');
    error.statusCode=401;
    throw error;
  }
  const response=await backendRequest('/admin/enterprise/pro/overview',{
    method:'GET',
    headers:{Authorization:'Bearer '+token}
  });
  if(Number(response.status)!==200){
    const error=new Error('Sessão administrativa inválida ou expirada.');
    error.statusCode=Number(response.status)===403?403:401;
    throw error;
  }
  return token;
}

const manifest={
  name:'Ariana Pay',
  short_name:'Ariana Pay',
  description:'Central financeira segura da Ariana Móveis',
  start_url:'/',
  display:'standalone',
  background_color:'#f4f7fb',
  theme_color:'#0047AB',
  orientation:'portrait-primary',
  categories:['business','finance'],
  icons:[
    {src:'/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any maskable'},
    {src:'/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any maskable'}
  ]
};

app.get('/manifest.webmanifest',(_req,res)=>{
  res.setHeader('Cache-Control','public, max-age=3600');
  res.type('application/manifest+json').send(JSON.stringify(manifest));
});

function sendPng(res,base64){
  res.setHeader('Cache-Control','public, max-age=86400');
  res.type('image/png').send(Buffer.from(base64,'base64'));
}
app.get('/icon-192.png',(_req,res)=>sendPng(res,icon192Base64));
app.get('/icon-512.png',(_req,res)=>sendPng(res,icon512Base64));

app.get('/sw.js',(_req,res)=>{
  res.setHeader('Cache-Control','no-cache, no-store, must-revalidate');
  res.type('application/javascript').send("const CACHE='ariana-pay-shell-v3';const SHELL=['/','/manifest.webmanifest','/icon-192.png','/icon-512.png','/offline'];self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)));self.skipWaiting();});self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==self.location.origin)return;if(u.pathname.startsWith('/api/')){e.respondWith(fetch(e.request,{cache:'no-store'}));return;}if(e.request.mode==='navigate'){e.respondWith(fetch(e.request,{cache:'no-store'}).catch(()=>caches.match('/offline')));return;}e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request)));});");
});

app.get('/offline',(_req,res)=>{
  res.type('html').send('<!doctype html><html lang="pt-BR"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ariana Pay offline</title><style>body{font-family:Arial;background:#f4f7fb;color:#17223b;display:grid;place-items:center;min-height:100vh}.box{max-width:560px;background:#fff;border-radius:20px;padding:28px;box-shadow:0 12px 40px #001b4d1a}h1{color:#0047AB}</style><body><main class="box"><h1>Ariana Pay</h1><p>Sem conexão. Operações financeiras e autorizações permanecem indisponíveis offline.</p></main></body></html>');
});

app.post('/api/admin/login',async(req,res)=>{
  const email=clean(req.body?.email);
  const password=String(req.body?.password||'');
  if(!email||!password) return res.status(400).json({ok:false,error:'Informe e-mail e senha.'});
  try{
    const response=await backendRequest('/admin/login',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      data:{email,password}
    });
    const data=response.data&&typeof response.data==='object'?response.data:{};
    if(Number(response.status)<200||Number(response.status)>=300||!clean(data.token)){
      return res.status(safeStatus(response.status,401)).json({ok:false,error:data.error||data.message||'Login inválido.'});
    }
    return res.json({ok:true,token:data.token,name:data.name||data.user?.name||'Administrador',email:data.email||data.user?.email||email});
  }catch(_){
    return res.status(503).json({ok:false,error:'Backend administrativo indisponível.'});
  }
});

app.get('/api/admin/manufacturers',async(req,res)=>{
  try{
    const token=await assertAdmin(req);
    const qs=new URLSearchParams({limit:'100'});
    const q=clean(req.query?.q);
    if(q) qs.set('q',q.slice(0,120));
    const response=await backendRequest('/admin/enterprise/pro/partners?'+qs.toString(),{
      method:'GET',headers:{Authorization:'Bearer '+token}
    });
    const data=response.data&&typeof response.data==='object'?response.data:{};
    if(Number(response.status)<200||Number(response.status)>=300){
      return res.status(safeStatus(response.status)).json({ok:false,error:data.error||'Não foi possível listar fabricantes.'});
    }
    const partners=Array.isArray(data.partners)?data.partners:[];
    return res.json({ok:true,items:partners.map(p=>({
      id:clean(p.id||p._id||p.requestId),
      requestId:clean(p.requestId),
      companyName:clean(p.companyName),
      tradeName:clean(p.tradeName),
      cnpj:clean(p.cnpj),
      status:clean(p.status),
      environment:clean(p.environment),
      sandboxActive:p.sandbox?.active===true,
      productionActive:p.production?.active===true
    })).filter(p=>p.id)});
  }catch(error){
    return res.status(Number(error.statusCode||500)).json({ok:false,error:error.message||'Não foi possível listar fabricantes.'});
  }
});

app.post('/api/admin/financial-authorization/link',async(req,res)=>{
  try{
    const token=await assertAdmin(req);
    const partnerId=clean(req.body?.partnerId);
    if(!partnerId) return res.status(422).json({ok:false,error:'Selecione um fabricante homologado.'});
    const partnerResponse=await backendRequest('/admin/enterprise/pro/partners/'+encodeURIComponent(partnerId),{
      method:'GET',headers:{Authorization:'Bearer '+token}
    });
    const partnerData=partnerResponse.data&&typeof partnerResponse.data==='object'?partnerResponse.data:{};
    if(Number(partnerResponse.status)<200||Number(partnerResponse.status)>=300){
      return res.status(safeStatus(partnerResponse.status)).json({ok:false,error:partnerData.error||'Fabricante não encontrado.'});
    }
    const p=partnerData.partner||{};
    const manufacturerId=clean(p.requestId||p.id||p._id||partnerId);
    const manufacturerName=clean(p.tradeName||p.companyName||manufacturerId);
    const internal=onboardingInternalToken();
    if(!internal) return res.status(503).json({ok:false,error:'Canal interno do Ariana Pay ainda não configurado.'});
    const response=await axios.post(onboardingBase+'/api/v1/internal/financial-authorization-links',{
      manufacturerId,manufacturerName,kind:'direct_manufacturer'
    },{
      headers:{Authorization:'Bearer '+internal,'Content-Type':'application/json','Accept-Encoding':'identity'},
      timeout:15000,validateStatus:()=>true
    });
    const data=response.data&&typeof response.data==='object'?response.data:{};
    if(Number(response.status)<200||Number(response.status)>=300){
      return res.status(safeStatus(response.status)).json({ok:false,error:data.error||'Não foi possível gerar o link.'});
    }
    return res.status(201).json({
      ok:true,manufacturerId:data.manufacturerId,manufacturerName:data.manufacturerName,
      authorizationPageUrl:data.authorizationPageUrl,expiresAt:data.expiresAt,
      provider:'mercadopago',model:'split_1_1',commissionPercent:12,pixFallback:false,realMoney:false
    });
  }catch(error){
    return res.status(Number(error.statusCode||500)).json({ok:false,error:error.message||'Não foi possível gerar o link de autorização.'});
  }
});

app.get('/api/financial-authorization/status',async(req,res)=>{
  const token=clean(req.query?.token);
  if(!token) return res.status(400).json({ok:false,error:'Link de autorização ausente.'});
  try{
    const response=await axios.get(onboardingBase+'/api/v1/public/financial-authorization/'+encodeURIComponent(token)+'/status',{
      timeout:15000,validateStatus:()=>true,headers:{'Accept-Encoding':'identity'}
    });
    return res.status(safeStatus(response.status,200)).json(response.data||{ok:false,error:'Resposta inválida.'});
  }catch(_){
    return res.status(503).json({ok:false,error:'Serviço de autorização indisponível.'});
  }
});

app.post('/api/financial-authorization/start',async(req,res)=>{
  const token=clean(req.body?.token);
  if(!token) return res.status(400).json({ok:false,error:'Link de autorização ausente.'});
  try{
    const response=await axios.post(onboardingBase+'/api/v1/public/financial-authorization/'+encodeURIComponent(token)+'/start',{}, {
      timeout:15000,validateStatus:()=>true,headers:{'Content-Type':'application/json','Accept-Encoding':'identity'}
    });
    return res.status(safeStatus(response.status,200)).json(response.data||{ok:false,error:'Resposta inválida.'});
  }catch(_){
    return res.status(503).json({ok:false,error:'Serviço de autorização indisponível.'});
  }
});

app.get('/api/app/status',async(_req,res)=>{
  res.setHeader('Cache-Control','no-store');
  try{
    const response=await axios.get(shadowBase+'/health',{timeout:12000,validateStatus:()=>true,headers:{'Accept-Encoding':'identity'}});
    const data=response?.data&&typeof response.data==='object'?response.data:{};
    return res.status(response.status>=200&&response.status<500?200:503).json({
      ok:response.status>=200&&response.status<300&&data.ok===true,
      app:'ariana-pay-pwa',mode:'isolated_shadow',readyForRealMoney:false,
      shadowOnline:response.status>=200&&response.status<500,shadowReady:data.ok===true,
      financialOwnerFlow:true,technicianMercadoPagoCredentialsRequired:false,
      splitOnly:true,pixFallback:false
    });
  }catch(_){
    return res.status(503).json({ok:false,app:'ariana-pay-pwa',mode:'isolated_shadow',readyForRealMoney:false,shadowOnline:false,financialOwnerFlow:true});
  }
});

app.get('/health',(_req,res)=>res.json({
  ok:true,service:'ariana-pay-app',mode:'isolated_shadow',readyForRealMoney:false,
  financialOwnerFlow:true,technicianMercadoPagoCredentialsRequired:false,splitOnly:true,pixFallback:false,
  onboardingInternalConfigured:Boolean(onboardingInternalToken())
}));

function appStyles(){
  return ':root{font-family:Inter,Arial,sans-serif;color:#17223b;background:#f4f7fb}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:linear-gradient(180deg,#0047AB 0 190px,#f4f7fb 190px);padding:18px 16px 30px}.top{max-width:900px;margin:auto;color:#fff;display:flex;align-items:center;gap:14px;padding:8px 4px 28px}.logo{width:54px;height:54px;border-radius:15px}.top h1{margin:0;font-size:25px}.top p{margin:4px 0 0;opacity:.88}.wrap{max-width:900px;margin:auto}.card{background:#fff;border-radius:22px;padding:22px;box-shadow:0 12px 35px #001b4d18;margin-bottom:15px}.badge{display:inline-flex;align-items:center;gap:7px;background:#fff3bf;color:#674d00;border-radius:999px;padding:7px 11px;font-weight:800;font-size:12px}.status{display:flex;justify-content:space-between;gap:14px;align-items:center}.muted{color:#64748b;font-size:14px;line-height:1.5}.safe{background:#eef6ff;border-left:4px solid #0047AB}.greenbox{background:#ecfdf3;border-left:4px solid #16803d}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.field{margin:12px 0}.field label{display:block;font-weight:800;font-size:12px;margin-bottom:6px}.field input,.field select{width:100%;min-height:45px;border:1px solid #ccd7e7;border-radius:12px;padding:10px 12px;font:inherit;background:#fff}.btn{border:0;border-radius:13px;background:#0047AB;color:#fff;font-weight:800;padding:13px 16px;cursor:pointer;font-size:14px}.btn.secondary{background:#fff;color:#0047AB;border:1px solid #aac0db}.btn:disabled{opacity:.55;cursor:wait}.full{width:100%}.hidden{display:none!important}.ok{color:#087443}.bad{color:#b42318}.linkbox{word-break:break-all;background:#f8fafc;border:1px solid #dbe3ee;border-radius:12px;padding:12px;font-size:12px;margin-top:12px}.install{margin-top:12px}.tools a{display:block;border:1px solid #e3e8f1;border-radius:15px;padding:14px;text-decoration:none;color:#17223b}.tools b{display:block;color:#0047AB;margin-bottom:5px}.foot{text-align:center;color:#748094;font-size:12px;padding:10px}@media(max-width:650px){body{background:linear-gradient(180deg,#0047AB 0 170px,#f4f7fb 170px)}.grid{grid-template-columns:1fr}.card{padding:18px}.top h1{font-size:22px}.status{align-items:flex-start;flex-direction:column}}';
}

app.get('/',(_req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.type('html').send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0047AB"><meta name="mobile-web-app-capable" content="yes"><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/icon-192.png"><link rel="apple-touch-icon" href="/icon-192.png"><title>Ariana Pay</title><style>${appStyles()}</style></head><body>
<header class="top"><img class="logo" src="/icon-192.png" alt="Ariana Pay"><div><h1>Ariana Pay</h1><p>Central financeira da Ariana Marketplace</p></div></header>
<main class="wrap">
<section class="card"><span class="badge">SHADOW / HOMOLOGAÇÃO</span><h2>Mercado Pago Split 1:1</h2><p class="muted">Recebimento do marketplace exclusivamente por Split Mercado Pago. O técnico da integração não precisa conhecer login ou senha da conta financeira da fábrica.</p><button id="install" class="btn install hidden">Instalar Ariana Pay neste aparelho</button></section>
<section class="card safe"><b>Fluxo separado por responsabilidade</b><p class="muted"><b>Técnico:</b> conclui a homologação da API e do catálogo. <b>Responsável financeiro:</b> recebe um link seguro do Ariana Pay e autoriza a conta Mercado Pago diretamente no ambiente oficial do provedor.</p></section>
<section id="loginCard" class="card"><h3>Área administrativa do Ariana Pay</h3><p class="muted">Entre com o mesmo acesso administrativo da Ariana. A senha não é armazenada neste aplicativo.</p><form id="loginForm"><div class="field"><label>E-mail</label><input id="email" type="email" autocomplete="username" required></div><div class="field"><label>Senha</label><input id="password" type="password" autocomplete="current-password" required></div><button class="btn full" id="loginBtn" type="submit">Entrar no Ariana Pay</button></form><p id="loginMsg" class="muted"></p></section>
<section id="manufacturerCard" class="card hidden"><div class="status"><div><h3 style="margin:0">Autorização financeira de fabricantes</h3><p class="muted" style="margin:6px 0 0">Gere o link somente depois que a fábrica estiver cadastrada/homologada tecnicamente.</p></div><button class="btn secondary" id="logoutBtn">Sair</button></div><div class="field"><label>Fabricante</label><select id="manufacturerSelect"><option value="">Carregando fabricantes...</option></select></div><button class="btn full" id="generateBtn">Gerar link para o responsável financeiro</button><div id="linkResult" class="hidden"><div class="greenbox card" style="box-shadow:none;margin-top:14px;margin-bottom:0"><b>Link pronto</b><p class="muted" id="linkMeta"></p><div id="linkValue" class="linkbox"></div><div class="grid" style="margin-top:12px"><button class="btn" id="copyBtn">Copiar link</button><button class="btn secondary" id="openBtn">Abrir para conferir</button></div></div></div><p id="manufacturerMsg" class="muted"></p></section>
<section class="card"><div class="status"><div><div class="muted">Estado do ambiente</div><strong id="state">Consultando...</strong></div><button class="btn secondary" id="refresh">Atualizar</button></div><div id="details" class="muted" style="margin-top:10px"></div></section>
<section class="card tools"><h3>Ferramentas Shadow</h3><div class="grid"><a href="${shadowBase}/3ds-test" target="_blank" rel="noopener"><b>3DS Sandbox</b><span class="muted">Autenticação de cartão.</span></a><a href="${shadowBase}/reconciliation-test" target="_blank" rel="noopener"><b>Conciliação</b><span class="muted">Conferência de pagamentos.</span></a></div></section>
<div class="foot">Ariana Pay · Split Mercado Pago · dinheiro real desabilitado</div></main>
<script>
if('serviceWorker' in navigator)window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(function(){});});
var deferredPrompt=null;var installButton=document.getElementById('install');window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();deferredPrompt=e;installButton.classList.remove('hidden');});installButton.addEventListener('click',async function(){if(!deferredPrompt)return;deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;installButton.classList.add('hidden');});
var adminToken=sessionStorage.getItem('ariana_pay_admin_token')||'';var generatedUrl='';
function showAdmin(){document.getElementById('loginCard').classList.toggle('hidden',!!adminToken);document.getElementById('manufacturerCard').classList.toggle('hidden',!adminToken);if(adminToken)loadManufacturers();}
async function api(path,opt){opt=opt||{};opt.headers=opt.headers||{};if(adminToken)opt.headers.Authorization='Bearer '+adminToken;var r=await fetch(path,opt);var j=await r.json().catch(function(){return{ok:false,error:'Resposta inválida.'};});if(!r.ok||j.ok===false)throw new Error(j.error||'Falha na operação.');return j;}
document.getElementById('loginForm').addEventListener('submit',async function(e){e.preventDefault();var btn=document.getElementById('loginBtn');btn.disabled=true;document.getElementById('loginMsg').textContent='Entrando...';try{var j=await api('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.getElementById('email').value,password:document.getElementById('password').value})});adminToken=j.token;sessionStorage.setItem('ariana_pay_admin_token',adminToken);document.getElementById('password').value='';document.getElementById('loginMsg').textContent='';showAdmin();}catch(err){document.getElementById('loginMsg').textContent=err.message;}finally{btn.disabled=false;}});
document.getElementById('logoutBtn').addEventListener('click',function(){adminToken='';sessionStorage.removeItem('ariana_pay_admin_token');showAdmin();});
async function loadManufacturers(){var s=document.getElementById('manufacturerSelect');var msg=document.getElementById('manufacturerMsg');try{var j=await api('/api/admin/manufacturers');s.innerHTML='<option value="">Selecione...</option>'+j.items.map(function(p){var n=p.tradeName||p.companyName||p.requestId||p.id;var status=p.status?' — '+p.status:'';return '<option value="'+escapeHtml(p.id)+'">'+escapeHtml(n+status)+'</option>';}).join('');msg.textContent=j.items.length?'':'Nenhum fabricante encontrado na homologação Enterprise.';}catch(err){if(/sessão|sessao/i.test(err.message)){adminToken='';sessionStorage.removeItem('ariana_pay_admin_token');showAdmin();return;}s.innerHTML='<option value="">Não foi possível carregar</option>';msg.textContent=err.message;}}
function escapeHtml(v){return String(v||'').replace(/[&<>"']/g,function(m){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m];});}
document.getElementById('generateBtn').addEventListener('click',async function(){var partnerId=document.getElementById('manufacturerSelect').value;var btn=this;var msg=document.getElementById('manufacturerMsg');if(!partnerId){msg.textContent='Selecione o fabricante.';return;}btn.disabled=true;msg.textContent='Gerando link seguro...';try{var j=await api('/api/admin/financial-authorization/link',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({partnerId:partnerId})});generatedUrl=j.authorizationPageUrl;document.getElementById('linkValue').textContent=generatedUrl;document.getElementById('linkMeta').textContent=(j.manufacturerName||j.manufacturerId)+' · válido até '+new Date(j.expiresAt).toLocaleString('pt-BR')+' · comissão Ariana 12%';document.getElementById('linkResult').classList.remove('hidden');msg.textContent='Envie este link ao dono ou responsável financeiro da fábrica.';}catch(err){msg.textContent=err.message;}finally{btn.disabled=false;}});
document.getElementById('copyBtn').addEventListener('click',async function(){if(!generatedUrl)return;try{await navigator.clipboard.writeText(generatedUrl);this.textContent='Copiado ✓';setTimeout(()=>this.textContent='Copiar link',1800);}catch(_){prompt('Copie o link:',generatedUrl);}});document.getElementById('openBtn').addEventListener('click',function(){if(generatedUrl)window.open(generatedUrl,'_blank','noopener');});
async function refresh(){var state=document.getElementById('state'),details=document.getElementById('details');state.textContent='Consultando...';try{var r=await fetch('/api/app/status',{cache:'no-store'}),j=await r.json();if(j.ok){state.textContent='Shadow protegido e online';state.className='ok';details.textContent='Autorização financeira separada do técnico: ativa. Split Mercado Pago: único fluxo. Pix alternativo: desativado. Dinheiro real: desativado.';}else{state.textContent='Shadow requer atenção';state.className='bad';details.textContent='Nenhuma operação financeira foi liberada.';}}catch(_){state.textContent='Sem conexão';state.className='bad';details.textContent='Operações financeiras indisponíveis offline.';}}
document.getElementById('refresh').addEventListener('click',refresh);showAdmin();refresh();
</script></body></html>`);
});

app.get('/mercadopago/autorizar',(_req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.type('html').send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0047AB"><title>Autorizar Mercado Pago · Ariana Pay</title><style>${appStyles()}</style></head><body><header class="top"><img class="logo" src="/icon-192.png" alt="Ariana Pay"><div><h1>Ariana Pay</h1><p>Autorização de recebimentos</p></div></header><main class="wrap"><section class="card"><span class="badge">AUTORIZAÇÃO FINANCEIRA</span><h2 id="title">Carregando fabricante...</h2><p class="muted">Esta etapa deve ser realizada pelo dono da conta ou responsável financeiro. A Ariana e o técnico da integração não terão acesso à sua senha do Mercado Pago.</p><div id="statusBox" class="safe card" style="box-shadow:none"><b id="statusTitle">Verificando...</b><p class="muted" id="statusText"></p></div><button class="btn full" id="connectBtn" disabled>Conectar Mercado Pago</button><button class="btn secondary full" id="verifyBtn" style="margin-top:10px">Já autorizei — verificar agora</button><p class="muted">Ao continuar, será aberta a tela oficial do Mercado Pago para login e consentimento. O recebimento será feito por Split Payments 1:1, com comissão Ariana de 12%.</p></section><section class="card safe"><b>Segurança</b><p class="muted">Não informe sua senha do Mercado Pago à Ariana, ao técnico ou a terceiros. Digite suas credenciais somente na página oficial aberta pelo Mercado Pago.</p></section><div class="foot">Ariana Pay · autorização segura do responsável financeiro</div></main><script>
var params=new URLSearchParams(location.search);var token=params.get('token')||'';var poll=null;var connectBtn=document.getElementById('connectBtn');var verifyBtn=document.getElementById('verifyBtn');
async function status(){if(!token){document.getElementById('statusTitle').textContent='Link inválido';document.getElementById('statusText').textContent='Solicite um novo link à Ariana.';return;}try{var r=await fetch('/api/financial-authorization/status?token='+encodeURIComponent(token),{cache:'no-store'}),j=await r.json();if(!r.ok||j.ok===false)throw new Error(j.error||'Não foi possível validar o link.');document.getElementById('title').textContent=j.manufacturerName||'Fabricante';if(j.connected){document.getElementById('statusBox').className='greenbox card';document.getElementById('statusTitle').textContent='Mercado Pago conectado ✓';document.getElementById('statusText').textContent='Conta autorizada com sucesso. Você pode fechar esta página.';connectBtn.disabled=true;connectBtn.textContent='Conectado';if(poll)clearInterval(poll);}else{document.getElementById('statusBox').className='safe card';document.getElementById('statusTitle').textContent='Autorização pendente';document.getElementById('statusText').textContent='Clique abaixo para entrar no Mercado Pago e autorizar a Ariana Marketplace.';connectBtn.disabled=false;}}catch(err){document.getElementById('statusBox').className='card';document.getElementById('statusTitle').textContent='Não foi possível validar';document.getElementById('statusText').textContent=err.message;connectBtn.disabled=true;}}
connectBtn.addEventListener('click',async function(){this.disabled=true;this.textContent='Abrindo Mercado Pago...';try{var r=await fetch('/api/financial-authorization/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:token})}),j=await r.json();if(!r.ok||j.ok===false)throw new Error(j.error||'Não foi possível iniciar.');var w=window.open(j.authorizationUrl,'mercadopago_oauth');if(!w)location.href=j.authorizationUrl;else{this.textContent='Aguardando autorização...';poll=setInterval(status,3000);}}catch(err){document.getElementById('statusText').textContent=err.message;this.disabled=false;this.textContent='Conectar Mercado Pago';}});verifyBtn.addEventListener('click',status);status();
</script></body></html>`);
});

app.use((_req,res)=>res.status(404).json({ok:false,error:'Rota não encontrada.'}));

app.listen(port,()=>{
  console.log(`[ariana-pay-app] installable PWA shadow on port ${port}; readyForRealMoney=false`);
  console.log('[ariana-pay-app] financial_owner_flow=true technician_mp_credentials=false split_only=true pix_fallback=false');
});