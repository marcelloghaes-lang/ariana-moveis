// ============================================================
// HOME - CAMADA DE PERFORMANCE COMPATIVEL
// Mantem os endpoints e a quantidade de produtos da implementacao legada,
// mas evita carregar campos pesados que a Home nao usa e compartilha a mesma
// consulta entre requisicoes simultaneas. Em caso de falha, entrega ao handler
// legado pelo next(), preservando o comportamento anterior.
// ============================================================

export default function registerHomePerformanceRoutes(app, context = {}) {
  const {
    Category,
    Product,
    Banner,
    getPaymentsSettings,
    normalizeBannerForResponse,
    normalizeProductForResponse,
    toJSON
  } = context;

  if (!app || !Category || !Product || !Banner || typeof getPaymentsSettings !== 'function') {
    return;
  }

  const CACHE_MS = Math.max(5000, Number(process.env.HOME_INDEX_CACHE_MS || 20000));
  let cache = { payload: null, expiresAt: 0, loading: null, generatedInMs: 0 };

  // Índices específicos para o caminho crítico da Home. São incrementais: não
  // apagam nem alteram documentos e o Mongo reutiliza o índice se ele já existir.
  if (String(process.env.HOME_AUTO_INDEXES || 'true').toLowerCase() !== 'false') {
    setImmediate(() => {
      Promise.allSettled([
        Product.collection.createIndex(
          { active: 1, createdAt: -1 },
          { name: 'home_active_createdAt' }
        ),
        Banner.collection.createIndex(
          { active: 1, sortOrder: 1, createdAt: -1 },
          { name: 'home_banner_active_sortOrder_createdAt' }
        ),
        Category.collection.createIndex(
          { active: 1, sortOrder: 1, name: 1 },
          { name: 'home_category_active_sortOrder_name' }
        )
      ]).then((results) => {
        const failed = results.filter((item) => item.status === 'rejected');
        if (failed.length) {
          console.warn(`[HOME PERFORMANCE] ${failed.length} índice(s) não puderam ser garantidos; a Home continuará usando fallback normal.`);
        }
      }).catch(() => null);
    });
  }

  async function loadHomePayload() {
    const now = Date.now();
    if (cache.payload && cache.expiresAt > now) return cache.payload;
    if (cache.loading) return cache.loading;

    const startedAt = Date.now();
    cache.loading = (async () => {
      const [categories, products, banners, paymentSettings] = await Promise.all([
        Category.find({ active: true })
          .sort({ sortOrder: 1, name: 1 })
          .lean(),
        Product.find({ active: true })
          // A Home usa nome/categorias/preços/flags e a imagem principal. Mantemos
          // `images` como fallback para produtos antigos, mas retiramos duplicatas
          // e campos grandes que só são necessários na página do produto.
          .select('-posters -specs -logistics -description -imageUrls -imagePaths')
          .sort({ createdAt: -1 })
          .limit(200)
          .lean(),
        Banner.find({ active: true })
          .sort({ sortOrder: 1, createdAt: -1 })
          .lean(),
        getPaymentsSettings()
      ]);

      const payload = {
        ok: true,
        categories: categories.map(toJSON),
        products: products.map(normalizeProductForResponse),
        banners: banners.map(normalizeBannerForResponse),
        payments: {
          mercadopago: {
            enabled: !!paymentSettings?.mercadopago?.enabled,
            publicKey: paymentSettings?.mercadopago?.publicKey || '',
            splitEnabled: paymentSettings?.mercadopago?.splitEnabled !== false
          },
          // Mantido apenas por compatibilidade do contrato antigo da Home.
          // Esta camada não altera configurações nem integrações legadas.
          pagarme: {
            enabled: !!paymentSettings?.pagarme?.enabled
          }
        }
      };

      cache = {
        payload,
        expiresAt: Date.now() + CACHE_MS,
        loading: null,
        generatedInMs: Math.max(0, Date.now() - startedAt)
      };
      return payload;
    })();

    try {
      return await cache.loading;
    } catch (error) {
      cache.loading = null;
      throw error;
    }
  }

  function setPublicCacheHeaders(res) {
    res.setHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=45');
    res.setHeader('Vary', 'Accept-Encoding');
    if (cache.generatedInMs > 0) {
      res.setHeader('Server-Timing', `ariana-home;dur=${cache.generatedInMs}`);
    }
  }

  async function sendHome(_req, res, next) {
    try {
      const cacheHit = Boolean(cache.payload && cache.expiresAt > Date.now());
      const payload = await loadHomePayload();
      setPublicCacheHeaders(res);
      res.setHeader('X-Ariana-Home-Cache', cacheHit ? 'HIT' : 'MISS');
      return res.json(payload);
    } catch (error) {
      console.warn('[HOME PERFORMANCE] fallback para rota legada:', error?.message || error);
      return next();
    }
  }

  app.get('/api/home/index-data', sendHome);
  app.get('/api/index-data', sendHome);
  app.get('/api/home', sendHome);

  // A Home e o header antigo ainda chamam estes endpoints em paralelo. Servimos
  // o mesmo snapshot para impedir novas consultas Mongo no mesmo carregamento.
  app.get('/api/banners', async (_req, res, next) => {
    try {
      const payload = await loadHomePayload();
      setPublicCacheHeaders(res);
      return res.json(payload.banners || []);
    } catch (error) {
      return next();
    }
  });

  app.get('/api/categories', async (_req, res, next) => {
    try {
      const payload = await loadHomePayload();
      setPublicCacheHeaders(res);
      return res.json(payload.categories || []);
    } catch (error) {
      return next();
    }
  });
}
