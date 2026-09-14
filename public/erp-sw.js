const CACHE='ariana-erp-v5';
const SHELL=['/erp_ariana.html','/erp-app.webmanifest','/erp-icon.svg'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
function isHtml(response){return response&&response.ok&&String(response.headers.get('content-type')||'').includes('text/html')}
function shouldAddBack(url,response){return isHtml(response)&&((/^\/erp_.*\.html$/i).test(url.pathname)||url.pathname==='/crediario_ariana.html')&&!['/erp_ariana.html','/erp_login.html'].includes(url.pathname)}
function shouldFixDashboard(url,response){return isHtml(response)&&url.pathname==='/erp_ariana.html'}
function cleanHeaders(response){const h=new Headers(response.headers);h.delete('content-length');h.delete('content-encoding');return h}
async function decorate(response,url){
  let text=await response.text();
  if(shouldFixDashboard(url,response)){
    // Nova venda deve ficar disponível para qualquer usuário autenticado.
    text=text.replace(/data-module=["']sales\.write["']\s+(?=href=["']\/?erp_nova_venda\.html["'])/gi,'');
    text=text.replace(/(?<=href=["']\/?erp_nova_venda\.html["'])\s+data-module=["']sales\.write["']/gi,'');
    if(!text.includes('erp-dashboard-no-gap-v5')){
      const css=`<style id="erp-dashboard-no-gap-v5">
/* As duas áreas abaixo usam flex para que a altura da coluna direita nunca estique a coluna esquerda. */
.ops-grid{display:flex!important;align-items:flex-start!important;gap:11px!important}
.ops-grid>section.panel:first-child{flex:1.35 1 0!important;width:0!important;height:auto!important;min-height:0!important;align-self:flex-start!important}
.ops-grid>#calendar-panel{flex:.65 1 350px!important;width:auto!important;height:auto!important;min-height:0!important;align-self:flex-start!important}
.dashboard-main{display:flex!important;align-items:flex-start!important;gap:11px!important}
.dashboard-main>section.panel:first-child{flex:1.45 1 0!important;width:0!important;height:auto!important;min-height:0!important;align-self:flex-start!important}
.dashboard-main>section.panel:last-child{flex:.55 1 330px!important;width:auto!important;height:auto!important;min-height:0!important;max-height:none!important;overflow:visible!important;align-self:flex-start!important}
.dashboard-main>section.panel:last-child #ranking{max-height:none!important;overflow:visible!important}
/* Remove controles extras adicionados pelas versões anteriores, caso existam no DOM/cache. */
.erp-gap-toggle,.erp-toggle,.erp-collapse-btn{display:none!important}
@media(max-width:1150px){
  .ops-grid,.dashboard-main{flex-direction:column!important;align-items:stretch!important}
  .ops-grid>section.panel:first-child,.ops-grid>#calendar-panel,.dashboard-main>section.panel:first-child,.dashboard-main>section.panel:last-child{flex:none!important;width:100%!important;max-height:none!important}
}
</style>`;
      text=text.includes('</head>')?text.replace('</head>',css+'</head>'):css+text;
    }
  }
  if(shouldAddBack(url,response)&&!text.includes('erp-global-back')){
    const button='<button class="erp-global-back" type="button" aria-label="Voltar para a tela anterior" onclick="if(history.length>1){history.back()}else{location.href=\'erp_ariana.html\'}">← Voltar</button>';
    const css='<style>.erp-global-back{position:fixed;left:14px;bottom:14px;z-index:99999;border:0;border-radius:999px;padding:10px 15px;background:#2E6DA4;color:#fff;font:800 13px Inter,Segoe UI,Arial,sans-serif;box-shadow:0 8px 24px rgba(16,45,74,.24);cursor:pointer}.erp-global-back:hover{background:#245987}@media(max-width:650px){.erp-global-back{left:10px;bottom:10px;padding:9px 13px}}</style>';
    text=text.includes('</body>')?text.replace('</body>',button+css+'</body>'):text+button+css;
  }
  return new Response(text,{status:response.status,statusText:response.statusText,headers:cleanHeaders(response)})
}
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==location.origin||url.pathname.startsWith('/api/'))return;
  event.respondWith(fetch(event.request,{cache:'no-store'}).then(async r=>{
    const raw=r.clone();
    caches.open(CACHE).then(c=>c.put(event.request,raw)).catch(()=>{});
    return (shouldAddBack(url,r)||shouldFixDashboard(url,r))?decorate(r,url):r;
  }).catch(()=>caches.match(event.request).then(async r=>{
    const fallback=r||await caches.match('/erp_ariana.html');
    return fallback&&(shouldAddBack(url,fallback)||shouldFixDashboard(url,fallback))?decorate(fallback,url):fallback;
  }))
});