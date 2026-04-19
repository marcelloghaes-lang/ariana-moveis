/* sw.js */
const CACHE_NAME = "ariana-cache-v1";

// Detecta ambiente:
// - No Live Server você está servindo a pasta raiz do projeto, então as páginas ficam em /public/...
// - No Firebase Hosting, a pasta public vira a raiz, então as páginas ficam em /...
const IS_LOCAL = (
  location.hostname === "127.0.0.1" ||
  location.hostname === "localhost"
);

const BASE = IS_LOCAL ? "/public" : "";

const PRECACHE_URLS = [
  `${BASE}/banner_admin.html`,
  `${BASE}/seller_login.html`,
  `${BASE}/`,
];

function isSupportedRequestForCache(requestOrUrl) {
  try {
    const url = new URL(
      typeof requestOrUrl === "string" ? requestOrUrl : requestOrUrl.url
    );
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_) {
    return false;
  }
}

async function safeCachePut(cache, requestOrUrl, response) {
  try {
    if (!response) return;
    if (!isSupportedRequestForCache(requestOrUrl)) return;
    if (!response.ok) return;
    await cache.put(requestOrUrl, response.clone());
  } catch (_) {}
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    // Precache robusto: tenta 1 por 1 (se um falhar, os outros continuam)
    await Promise.allSettled(
      PRECACHE_URLS.map(async (url) => {
        try {
          if (!isSupportedRequestForCache(new URL(url, self.location.origin).toString())) return;
          const res = await fetch(url, { cache: "no-store" });
          await safeCachePut(cache, url, res);
        } catch (_) {}
      })
    );

    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Só GET
  if (req.method !== "GET") return;

  // Ignora esquemas não suportados no Cache API
  if (!isSupportedRequestForCache(req)) return;

  // Navegação (abrir páginas HTML)
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        // Rede primeiro
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        await safeCachePut(cache, req, fresh);
        return fresh;
      } catch (_) {
        // Cache fallback (mesma rota)
        const cached = await caches.match(req);
        if (cached) return cached;

        // Fallback extra: manda a página de login
        const loginFallback = await caches.match(`${BASE}/seller_login.html`);
        if (loginFallback) return loginFallback;

        return new Response("Offline / Falha ao buscar página.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
    })());
    return;
  }

  // Assets: cache-first
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;

    try {
      const fresh = await fetch(req);
      const cache = await caches.open(CACHE_NAME);
      await safeCachePut(cache, req, fresh);
      return fresh;
    } catch (_) {
      return new Response("", { status: 504 });
    }
  })());
});
