const CACHE_NAME='financeiro-ariana-v11';
const STATIC_ASSETS=['./financeiro_recibos.html','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(STATIC_ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  const r=e.request,u=new URL(r.url);
  if(r.method!=='GET')return;
  if(u.pathname.includes('/api/')||u.hostname.includes('onrender.com')){e.respondWith(fetch(r));return;}
  if(r.mode==='navigate'){e.respondWith(fetch(r).then(resp=>{const copy=resp.clone();caches.open(CACHE_NAME).then(c=>c.put('./financeiro_recibos.html',copy));return resp;}).catch(()=>caches.match('./financeiro_recibos.html')));return;}
  e.respondWith(caches.match(r).then(cached=>cached||fetch(r)));
});