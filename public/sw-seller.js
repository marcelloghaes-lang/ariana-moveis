const APP_ID = "seller";
const APP_PAGE = "/seller_dashboard.html";
const SELLER_PAGE = /^\/seller_(?!login|cadastro|recuperar_senha|onboarding|pending|status|sucesso)[a-z0-9_-]*\.html$/i;
const LOGOUT_SCRIPT = '<script src="/seller-logout.js" defer></script>';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

async function sellerNavigationResponse(request) {
  const response = await fetch(request, { cache: 'no-store' });
  if (!response.ok) return response;

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  let html = await response.text();
  if (!html.includes('/seller-logout.js')) {
    html = html.includes('</body>')
      ? html.replace('</body>', `${LOGOUT_SCRIPT}\n</body>`)
      : `${html}\n${LOGOUT_SCRIPT}`;
  }

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  if (SELLER_PAGE.test(requestUrl.pathname)) {
    event.respondWith(
      sellerNavigationResponse(event.request).catch(() =>
        new Response(
          '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Sem conexão</title><body style="font-family:Arial;padding:24px"><h1>Sem conexão</h1><p>Conecte-se à internet e tente novamente.</p></body></html>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
        )
      )
    );
    return;
  }

  if (requestUrl.pathname !== APP_PAGE) return;
  event.respondWith(fetch(event.request, { cache: 'no-store' }));
});
