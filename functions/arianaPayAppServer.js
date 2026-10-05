import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import axios from 'axios';

const app=express();
const port=Number(process.env.PORT||10000);
const shadowBase=String(process.env.ARIANA_PAY_SHADOW_BASE_URL||'https://ariana-pay-shadow.onrender.com').replace(/\/$/,'');

app.disable('x-powered-by');
app.use((req,res,next)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Content-Security-Policy',"default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'");
  next();
});

const iconSvg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<rect width="512" height="512" rx="112" fill="#0047AB"/>
<path d="M114 327 215 129c17-33 65-33 82 0l101 198h-79l-20-43H211l-20 43h-77Zm124-100h35l-18-39-17 39Z" fill="#F4C542"/>
<rect x="116" y="350" width="280" height="38" rx="19" fill="#fff" opacity=".96"/>
</svg>`;

const icon192Base64='iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAYAAABS3GwHAAAEQUlEQVR42u3dMXYTMRSF4ZGOO9hXSg6FF8EmKNgEi0iRQ+l9QR0qGg7E8czYo6f7/SVQeKT33yvZiWnLaDw9vy6Yl8u5jfRymmFHshTN0CNZhmbwkSxCM/hIFqEZfCSL0Aw+kkXohh+l2HnGmsFHcht0w4/kNuiGH8kSdMOPZAm64UeyBN3wI1mCbviRLEE3/EiWoBt+JEvQDT+SJehWCcl06Y/kFuiGH8kSOALBEUj6I7UFNAA0gPRHagtoAGgA6Y/UFtAA0ADSH6ktoAGgAYBsARx/EHoM0gCI5mQJHs/Pr9//+ecfv32xOATIG/y//54ILsFxw7/232IbzQV4rOF3JNIAhl8TEAAkIIDhJQEBAALEH120AAEAAiRfXLUAAQACJKa/FiAAQIDk9NcCBAAIkJz+WoAA8cNPAgIABEhOfy1AAIAA0lcLEAAgQHbqagECAARITlstQACAAMkpqwUIED9cJCBAGXz7GwGkqtdLgOT01wIEkKZeNwGSz/5agABS1OsnQGL6awECxKTntSG/hwRagAAAAUZPfy1AABdHz0WApIvvI1sABIhPSS1AgOHTXwsQQDp6TgIkp78WIIBU9LwESE5/LUCAsmm499D6cIwAAAES018LEMBF0DoQIOni60JMAKlnPQgg/bUAAaSddSGA9NcCBJBy1ocA6emvBQgwTLodPYQ+HCMAsJq2PD2/Sn+kHrG64UfyujkCwSVYiiF1/TQANID0Quo6agBoAKmF1PXUANAA0gqp66oBoAGkFFLXt9scJK/zyXa+zQw/ECYYAhrAJltvdwDpP/VzEED6W3cCSE3PQwDpb/0JIC09V7QAM37LQ0UJKreABoAGkP5ZRwQtUFwAF1/74ggk/T1vogDS3/5oAGnouRMFkP72SQNIQc+fKID01wIaQPpZh0QBfOhVU4IKLeBdILgDSH+ktsCpyqa4BBPqHpT7L5K2iiD9rXGpBtAIEl8D7JRW0t+6lm8AjSDxNcCK5JL+1nLKBtAIEl8DXEkx6W/9YgUA3sKPQoAAAAEAAgBZTPE26K8fn+3kAXz49KIBDH8uM6x92bdBDb420ABAogDS377ECmD47Y0jEEAAgAAAAQACAAkCzPDx+6xU3JtuoZG8J45AiKb8r0T6YEzyRzeA45C139YAy7L4xXhEcjk3dwBEQwAQACAAECvA5dwsBdIuwBoAGsASgACOQQg8/mgAaID/mQHMnv4aABrgmiHArOmvAaAB3msKMFv6awBogFuNAWZJ/+sNQAJMPPyOQHAE2moQUDX9398AJMCEw3/bEYgEmGz4b78DkAATDf+6SzAJMMnwrxOABJhk+NcLQAJMMPzbBCABig//dgFIgMLDvyx/vht0L3zHKIoM/n4NoA1QdPj3bwBtgCKDf38BiIACp4rHHVmIgAGP048/sxMBA90jj720kgEHDP04ApDCsB/Mb3ep+3Gog3fDAAAAAElFTkSuQmCC';
const icon512Base64='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';

const manifest={
  id:'ariana-pay-shadow',
  name:'Ariana Pay',
  short_name:'Ariana Pay',
  description:'Aplicativo instalável do Ariana Pay em ambiente shadow seguro.',
  start_url:'/',
  scope:'/',
  display:'standalone',
  background_color:'#f4f7fb',
  theme_color:'#0047AB',
  orientation:'portrait-primary',
  categories:['business','finance'],
  icons:[
    {src:'/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any maskable'},
    {src:'/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any maskable'},
    {src:'/icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any maskable'}
  ]
};

app.get('/manifest.webmanifest',(_req,res)=>{
  res.setHeader('Cache-Control','public, max-age=3600');
  res.type('application/manifest+json').send(JSON.stringify(manifest));
});

app.get('/icon.svg',(_req,res)=>{
  res.setHeader('Cache-Control','public, max-age=86400');
  res.type('image/svg+xml').send(iconSvg);
});

function sendPng(res,base64){
  res.setHeader('Cache-Control','public, max-age=86400');
  res.type('image/png').send(Buffer.from(base64,'base64'));
}
app.get('/icon-192.png',(_req,res)=>sendPng(res,icon192Base64));
app.get('/icon-512.png',(_req,res)=>sendPng(res,icon512Base64));

app.get('/sw.js',(_req,res)=>{
  res.setHeader('Cache-Control','no-cache, no-store, must-revalidate');
  res.type('application/javascript').send(`
const CACHE='ariana-pay-shell-v2';
const SHELL=['/','/manifest.webmanifest','/icon.svg','/icon-192.png','/icon-512.png','/offline'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)));self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))));self.clients.claim();});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin) return;
  if(url.pathname.startsWith('/api/')){event.respondWith(fetch(event.request,{cache:'no-store'}));return;}
  if(event.request.mode==='navigate'){
    event.respondWith(fetch(event.request,{cache:'no-store'}).catch(()=>caches.match('/offline')));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{
    if(response.ok&&['/manifest.webmanifest','/icon.svg','/icon-192.png','/icon-512.png'].includes(url.pathname)){
      const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));
    }
    return response;
  })));
});
`);
});

app.get('/offline',(_req,res)=>{
  res.setHeader('Cache-Control','public, max-age=3600');
  res.type('html').send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0047AB"><title>Ariana Pay — Offline</title><style>body{font-family:Arial,sans-serif;background:#f4f7fb;color:#17223b;display:grid;place-items:center;min-height:100vh;margin:0}.box{max-width:560px;margin:20px;background:#fff;border-radius:22px;padding:28px;box-shadow:0 12px 40px #001b4d1a}.tag{display:inline-block;background:#fff4c2;color:#684d00;padding:7px 10px;border-radius:999px;font-weight:800;font-size:12px}h1{color:#0047AB}</style></head><body><main class="box"><span class="tag">MODO OFFLINE</span><h1>Ariana Pay</h1><p>O aplicativo está sem conexão.</p><p>Por segurança, consultas financeiras, conciliação, pagamentos e qualquer operação sensível ficam indisponíveis offline.</p></main></body></html>`);
});

app.get('/api/app/status',async(_req,res)=>{
  res.setHeader('Cache-Control','no-store');
  try{
    const response=await axios.get(`${shadowBase}/health`,{timeout:12000,validateStatus:()=>true});
    const data=response?.data&&typeof response.data==='object'?response.data:{};
    return res.status(response.status>=200&&response.status<500?200:503).json({
      ok:response.status>=200&&response.status<300&&data.ok===true,
      app:'ariana-pay-pwa',
      mode:'isolated_shadow',
      readyForRealMoney:false,
      shadowOnline:response.status>=200&&response.status<500,
      shadowReady:data.ok===true,
      safetyViolations:Array.isArray(data.safetyViolations)?data.safetyViolations:[],
      productionSampleAuditConfigured:data.productionSampleAuditConfigured===true
    });
  }catch(error){
    return res.status(503).json({
      ok:false,
      app:'ariana-pay-pwa',
      mode:'isolated_shadow',
      readyForRealMoney:false,
      shadowOnline:false,
      error:'Ariana Pay shadow indisponível no momento.'
    });
  }
});

app.get('/health',(_req,res)=>res.json({ok:true,service:'ariana-pay-app',mode:'isolated_shadow',readyForRealMoney:false}));

app.get('/',(_req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.type('html').send(`<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0047AB"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="default"><meta name="apple-mobile-web-app-title" content="Ariana Pay">
<link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/icon-192.png"><link rel="apple-touch-icon" href="/icon-192.png">
<title>Ariana Pay</title>
<style>
:root{font-family:Inter,Arial,sans-serif;color:#17223b;background:#f4f7fb}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:linear-gradient(180deg,#0047AB 0 190px,#f4f7fb 190px);padding:max(18px,env(safe-area-inset-top)) 16px 28px}.top{max-width:850px;margin:auto;color:#fff;display:flex;align-items:center;gap:14px;padding:10px 4px 26px}.logo{width:54px;height:54px;border-radius:15px;background:#fff;padding:6px}.top h1{margin:0;font-size:25px}.top p{margin:4px 0 0;opacity:.88}.wrap{max-width:850px;margin:auto}.card{background:#fff;border-radius:22px;padding:22px;box-shadow:0 12px 35px #001b4d18;margin-bottom:15px}.badge{display:inline-flex;align-items:center;gap:7px;background:#fff3bf;color:#674d00;border-radius:999px;padding:7px 11px;font-weight:800;font-size:12px}.dot{width:9px;height:9px;border-radius:50%;background:#b88600}.status{display:flex;justify-content:space-between;gap:14px;align-items:center}.status strong{font-size:18px}.muted{color:#64748b;font-size:14px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:16px}.tile{border:1px solid #e3e8f1;border-radius:16px;padding:15px;text-decoration:none;color:#17223b;background:#fff}.tile b{display:block;color:#0047AB;margin-bottom:5px}.safe{background:#eef6ff;border-left:4px solid #0047AB}.install{width:100%;border:0;border-radius:14px;background:#0047AB;color:#fff;font-weight:800;padding:14px 18px;font-size:15px;cursor:pointer;margin-top:14px}.install[hidden]{display:none}.refresh{border:1px solid #ccd7e7;background:#fff;border-radius:10px;padding:9px 12px;font-weight:700;cursor:pointer}.foot{text-align:center;color:#748094;font-size:12px;padding:10px}.ok{color:#087443}.bad{color:#b42318}@media(max-width:600px){body{background:linear-gradient(180deg,#0047AB 0 170px,#f4f7fb 170px)}.grid{grid-template-columns:1fr}.card{padding:18px}.top h1{font-size:22px}}
</style></head><body>
<header class="top"><img class="logo" src="/icon-192.png" alt="Ariana Pay"><div><h1>Ariana Pay</h1><p>Central segura de validação e operações financeiras</p></div></header>
<main class="wrap">
<section class="card"><span class="badge"><span class="dot"></span> SHADOW / HOMOLOGAÇÃO</span><h2>Aplicativo Ariana Pay</h2><p class="muted">Esta instalação ainda não movimenta dinheiro real. A ativação financeira de produção continua bloqueada até autorização específica.</p><button id="install" class="install" hidden>Instalar Ariana Pay neste aparelho</button><p id="iosHelp" class="muted" hidden>No iPhone/iPad: abra no Safari, toque em Compartilhar e depois em “Adicionar à Tela de Início”.</p></section>
<section class="card"><div class="status"><div><div class="muted">Estado do ambiente</div><strong id="state">Consultando...</strong></div><button class="refresh" id="refresh">Atualizar</button></div><div id="details" class="muted" style="margin-top:10px"></div></section>
<section class="card safe"><b>Proteção ativa</b><p class="muted">O app não armazena telas financeiras para uso offline. APIs, conciliação, pagamentos e auditorias usam rede obrigatória e não entram no cache do aplicativo.</p></section>
<section class="card"><h3>Ferramentas do Ariana Pay Shadow</h3><div class="grid">
<a class="tile" href="${shadowBase}/3ds-test" target="_blank" rel="noopener"><b>3DS Sandbox</b><span class="muted">Validar autenticação do cartão.</span></a>
<a class="tile" href="${shadowBase}/reconciliation-test" target="_blank" rel="noopener"><b>Conciliação</b><span class="muted">Comparar pagamento com provedor.</span></a>
<a class="tile" href="${shadowBase}/dispute-test" target="_blank" rel="noopener"><b>Contestações</b><span class="muted">Simular responsabilidade sem movimentar dinheiro.</span></a>
<a class="tile" href="${shadowBase}/production-sample-audit" target="_blank" rel="noopener"><b>Auditoria read-only</b><span class="muted">Analisar amostra real sem escrita no banco.</span></a>
</div></section>
<div class="foot">Ariana Pay · ambiente isolado · readyForRealMoney=false</div>
</main>
<script>
let deferredPrompt=null;
const installButton=document.getElementById('install');
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredPrompt=event;installButton.hidden=false;});
installButton.addEventListener('click',async()=>{if(!deferredPrompt)return;deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;installButton.hidden=true;});
window.addEventListener('appinstalled',()=>{installButton.hidden=true;});
const ua=navigator.userAgent||'';const isiOS=/iphone|ipad|ipod/i.test(ua);if(isiOS&&!window.matchMedia('(display-mode: standalone)').matches)document.getElementById('iosHelp').hidden=false;
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(()=>{}));
async function refresh(){const state=document.getElementById('state');const details=document.getElementById('details');state.textContent='Consultando...';state.className='';try{const r=await fetch('/api/app/status',{cache:'no-store'});const j=await r.json();if(j.ok){state.textContent='Shadow protegido e online';state.className='ok';details.textContent='Dinheiro real continua desabilitado. Auditoria read-only: '+(j.productionSampleAuditConfigured?'configurada':'não configurada')+'.';}else{state.textContent='Shadow requer atenção';state.className='bad';details.textContent='Nenhuma operação financeira foi liberada. readyForRealMoney=false.';}}catch(_){state.textContent='Sem conexão';state.className='bad';details.textContent='Operações financeiras indisponíveis offline.';}}
document.getElementById('refresh').addEventListener('click',refresh);refresh();
</script></body></html>`);
});

app.use((_req,res)=>res.status(404).json({ok:false,error:'Rota não encontrada.'}));

app.listen(port,()=>{
  console.log(`[ariana-pay-app] installable PWA shadow on port ${port}; readyForRealMoney=false`);
});
