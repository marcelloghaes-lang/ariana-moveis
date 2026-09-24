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
    $and: [
      { active: true },
      { 'specs.sigeSourceId': { $exists: false } },
      {
        $or: [
          { storefrontStatus: { $exists: false } },
          { storefrontStatus: '' },
          { storefrontStatus: { $in: ['approved', 'published'] } }
        ]
      }
    ]
  });

  // Storefront lists render compact cards. Avoid loading complete product
  // documents (integration data, poster history and every image), which can
  // make the public catalog exceed the request timeout as inventory grows.
  const PRODUCT_CARD_FIELD_NAMES = [
    '_id', 'name', 'slug', 'category', 'categoryId', 'categoryName', 'brand', 'sku',
    'sellerName', 'price', 'oldPrice', 'pixPrice', 'installmentCount',
    'stock', 'active',
    'isOffer', 'isHighlight', 'isBestSeller', 'isNewArrival', 'isRecommended',
    'createdAt', 'updatedAt'
  ];

  const PRODUCT_CARD_PROJECTION = PRODUCT_CARD_FIELD_NAMES.reduce((projection, field) => {
    projection[field] = 1;
    return projection;
  }, {});

  // Older records may contain multi-megabyte data: URIs duplicated across the
  // image fields. Select only the first external URL inside MongoDB so those
  // blobs never travel to the API process or get duplicated in JSON.
  PRODUCT_CARD_PROJECTION.imageUrl = {
    $switch: {
      branches: ['imageUrl', 'mainImageUrl', 'image', 'imagem'].map((field) => ({
        case: {
          $regexMatch: {
            input: { $convert: { input: `$${field}`, to: 'string', onError: '', onNull: '' } },
            regex: '^https?://',
            options: 'i'
          }
        },
        then: `$${field}`
      })),
      default: ''
    }
  };

  async function homeHandler(_req, res) {
    try {
      const [categories, products, banners, paymentSettings] = await Promise.all([
        Category.find({ active: true }).select('_id name slug parentId active sortOrder image updatedAt').sort({ sortOrder: 1, name: 1 }).lean(),
        Product.aggregate([
          { $match: storefrontBaseFilter() },
          { $sort: { createdAt: -1 } },
          { $limit: 200 },
          { $project: PRODUCT_CARD_PROJECTION }
        ]),
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
            pixEnabled: paymentSettings?.mercadopago?.pixEnabled !== false,
            boletoEnabled: paymentSettings?.mercadopago?.boletoEnabled !== false,
            splitEnabled: false
          },
          cielo: {
            enabled: !!paymentSettings?.cielo?.enabled
          },
          pagarme: {
            enabled: false
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

      // Endpoint público: nunca expõe produto inativo, pendente ou reprovado.
      // Administração e Seller possuem rotas autenticadas próprias para esses estados.
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
      const rows = await Product.aggregate([
        { $match: query },
        { $sort: { createdAt: -1 } },
        { $skip: (page - 1) * limit },
        { $limit: limit },
        { $project: PRODUCT_CARD_PROJECTION }
      ]);
      res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
      return res.json(rows.map(normalizeProductForResponse));
    } catch (error) {
      console.error('[storefront-visibility/products]', error);
      return res.status(500).json({ ok: false, error: 'Erro ao listar produtos' });
    }
  });
}
