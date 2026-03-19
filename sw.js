// O Date.now() cria uma versão única (v123456...) toda vez que você salva
const CACHE_NAME = 'ariana-cache-' + Date.now();

// Registra os arquivos essenciais
const assets = [
  '/',
  '/index.html',
  '/admin',
  '/banner_admin.html',
  '/firebase-config.js',
  '/icon-admin-192.png'
];

self.addEventListener('install', event => {
  // Força o novo Service Worker a assumir o controle na hora
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(assets);
    })
  );
});

self.addEventListener('activate', event => {
  // Deleta o cache "v1" e qualquer outro antigo automaticamente
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  // Estratégia: Tenta a rede primeiro, se falhar (offline), usa o cache
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});