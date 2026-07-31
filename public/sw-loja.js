const APP_ID = "loja";
const APP_PAGE = "/index.html";

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  if (requestUrl.pathname !== APP_PAGE) return;

  event.respondWith(
    fetch(event.request, { cache: 'no-store' }).catch(() =>
      new Response(
        '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Sem conexão</title><body style="font-family:Arial;padding:24px"><h1>Sem conexão</h1><p>Conecte-se à internet e tente novamente.</p></body></html>',
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      )
    )
  );
});
