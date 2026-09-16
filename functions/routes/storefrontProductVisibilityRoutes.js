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

  // Storefront lists render compact cards. Avoid loading complete product
  // documents (integration data, poster history and every image), which can
  // make the public catalog exceed the request timeout as inventory grows.
  const PRODUCT_CARD_FIELDS = [
    '_id', 'name', 'slug', 'category', 'categoryId', 'categoryName', 'brand', 'sku',
    'sellerName', 'price', 'oldPrice', 'pixPrice', 'installmentCount',
    'image', 'imageUrl', 'imagem', 'mainImageUrl', 'mainImagePath',
    'images', 'imageUrls', 'imagePaths', 'stock', 'active',
    'isOffer', 'isHighlight', 'isBestSeller', 'isNewArrival', 'isRecommended',
    'createdAt', 'updatedAt'
  ].join(' ');

  async function homeHandler(_req, res) {
    try {
      const [categories, products, banners, paymentSettings] = await Promise.all([
        Category.find({ active: true }).select('_id name slug parentId active sortOrder image updatedAt').sort({ sortOrder: 1, name: 1 }).lean(),
        Product.find({ active: true, ...storefrontBaseFilter() }).select(PRODUCT_CARD_FIELDS).slice('images', 1).slice('imageUrls', 1).slice('imagePaths', 1).sort({ createdAt: -1 }).limit(200).lean(),
        Banner.find({ active: true }).select('_id slot targetSlot title subtitle image href alt active status source sortOrder device createdAt updatedAt').sort({ sortOrder: 1, createdAt: -1 }).lean(),
        getPaymentsSettings()
      ]);

      res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
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

      const requestedLimit = Number(req.query.limit || 500);
      const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 500, 1), 500);
      const requestedPage = Number(req.query.page || 1);
      const page = Math.max(Number.isFinite(requestedPage) ? requestedPage : 1, 1);
      const rows = await Product.find(query)
        .select(PRODUCT_CARD_FIELDS)
        .slice('images', 1)
        .slice('imageUrls', 1)
        .slice('imagePaths', 1)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();
      res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
      return res.json(rows.map(normalizeProductForResponse));
    } catch (error) {
      console.error('[storefront-visibility/products]', error);
      return res.status(500).json({ ok: false, error: 'Erro ao listar produtos' });
    }
  });
}
