/* sw.js */
const CACHE_NAME = "ariana-cache-v1";

// Detecta ambiente:
// - No Live Server você está servindo a pasta raiz do projeto, então as páginas ficam em /public/...
// - No Firebase Hosting, a pasta public vira a raiz, então as páginas ficam em /...
const IS_LOCAL = (
  location.hostname === "127.0.0.1" ||
  location.hostname === "localhost"
);

const BASE = IS_LOCAL ? "/public" : "";  // <-- aqui está a mágica

const PRECACHE_URLS = [
  `${BASE}/banner_admin.html`,
  `${BASE}/seller_login.html`,
  `${BASE}/`,
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    // Precache robusto: tenta 1 por 1 (se um falhar, os outros continuam)
    await Promise.allSettled(
      PRECACHE_URLS.map(async (url) => {
        try {
          const res = await fetch(url, { cache: "no-store" });
          if (res.ok) await cache.put(url, res.clone());
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

  // Navegação (abrir páginas HTML)
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        // Rede primeiro
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone());
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
      cache.put(req, fresh.clone());
      return fresh;
    } catch (_) {
      return new Response("", { status: 504 });
    }
  })());
});
