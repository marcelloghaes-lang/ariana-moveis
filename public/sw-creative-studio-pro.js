const APP_PAGE = '/creative_studio_pro.html';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname !== APP_PAGE) return;

  event.respondWith(
    fetch(event.request, { cache: 'no-store' }).catch(() =>
      new Response(
        '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="theme-color" content="#0047AB"><title>Creative Studio sem conexão</title><body style="font-family:Arial,sans-serif;padding:24px;background:#eef3f9;color:#08285A"><h1>Sem conexão</h1><p>Conecte-se à internet para gerar banners no Ariana Creative Studio Pro.</p></body></html>',
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      )
    )
  );
});
