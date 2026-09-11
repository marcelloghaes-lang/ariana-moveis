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
  let cache = { payload: null, expiresAt: 0, loading: null };

  async function loadHomePayload() {
    const now = Date.now();
    if (cache.payload && cache.expiresAt > now) return cache.payload;
    if (cache.loading) return cache.loading;

    cache.loading = (async () => {
      const [categories, products, banners, paymentSettings] = await Promise.all([
        Category.find({ active: true })
          .sort({ sortOrder: 1, name: 1 })
          .lean(),
        Product.find({ active: true })
          .select('-posters -specs -logistics')
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
          // Esta camada nao altera configuracoes nem integracoes legadas.
          pagarme: {
            enabled: !!paymentSettings?.pagarme?.enabled
          }
        }
      };

      cache = {
        payload,
        expiresAt: Date.now() + CACHE_MS,
        loading: null
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
  }

  async function sendHome(_req, res, next) {
    try {
      const payload = await loadHomePayload();
      setPublicCacheHeaders(res);
      res.setHeader('X-Ariana-Home-Cache', cache.expiresAt > Date.now() ? 'active' : 'expired');
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
