// ============================================================
// STOREFRONT PRODUCT VISIBILITY - ARIANA MÓVEIS
// Mantém produtos importados apenas para o Ariana ERP fora da vitrine pública.
// Produtos SIGE criados na migração recebem specs.sigeSourceId e não possuem
// necessariamente imagens/descrição comercial para o e-commerce.
// ============================================================

export default function registerStorefrontProductVisibilityRoutes(app, context = {}) {
  const {
    Banner,
    Category,
    Product,
    escapeRegex,
    getPaymentsSettings,
    normalizeBannerForResponse,
    normalizeProductForResponse,
    toJSON
  } = context;

  if (!Product || !Category || !Banner) {
    throw new Error('[storefront-visibility] Models de catálogo indisponíveis');
  }

  const storefrontBaseFilter = () => ({
    'specs.sigeSourceId': { $exists: false }
  });

  async function homeHandler(_req, res) {
    try {
      const [categories, products, banners, paymentSettings] = await Promise.all([
        Category.find({ active: true }).sort({ sortOrder: 1, name: 1 }),
        Product.find({ active: true, ...storefrontBaseFilter() }).sort({ createdAt: -1 }).limit(200),
        Banner.find({ active: true }).sort({ sortOrder: 1, createdAt: -1 }),
        getPaymentsSettings()
      ]);

      return res.json({
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
          pagarme: {
            enabled: !!paymentSettings?.pagarme?.enabled
          }
        }
      });
    } catch (error) {
      console.error('[storefront-visibility/home]', error);
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar dados da home' });
    }
  }

  app.get('/api/home/index-data', homeHandler);
  app.get('/api/index-data', homeHandler);
  app.get('/api/home', homeHandler);

  app.get('/api/products', async (req, res) => {
    try {
      const query = storefrontBaseFilter();

      if (req.query.active !== undefined) query.active = String(req.query.active) !== 'false';
      if (req.query.sellerId) query.sellerId = String(req.query.sellerId);

      if (req.query.category) {
        const cat = String(req.query.category).trim();
        const catRx = new RegExp(escapeRegex(cat), 'i');
        query.$or = [
          { category: catRx },
          { categoria: catRx },
          { categoryName: catRx },
          { categorySlug: catRx },
          { categoryId: cat },
          { subcategory: catRx },
          { subcategoria: catRx },
          { subcategoryName: catRx },
          { subcategoryId: cat }
        ];
      }

      if (req.query.q) {
        const q = String(req.query.q).trim();
        const rx = new RegExp(escapeRegex(q), 'i');
        query.$and = query.$and || [];
        query.$and.push({
          $or: [
            { name: rx },
            { description: rx },
            { category: rx },
            { categoria: rx },
            { categoryName: rx },
            { brand: rx },
            { sku: rx }
          ]
        });
      }

      const limit = Math.min(Math.max(Number(req.query.limit || 500), 1), 1000);
      const rows = await Product.find(query).sort({ createdAt: -1 }).limit(limit);
      return res.json(rows.map(normalizeProductForResponse));
    } catch (error) {
      console.error('[storefront-visibility/products]', error);
      return res.status(500).json({ ok: false, error: 'Erro ao listar produtos' });
    }
  });
}
