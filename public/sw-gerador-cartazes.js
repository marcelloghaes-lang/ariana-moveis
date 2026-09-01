const APP_PAGE = '/gerador_cartazes.html';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname !== APP_PAGE) return;
  event.respondWith(fetch(event.request, { cache: 'no-store' }).catch(() => new Response(
    '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Sem conexão</title><body style="font-family:Arial;padding:24px"><h1>Sem conexão</h1><p>Conecte-se à internet para gerar cartazes.</p></body></html>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )));
});
