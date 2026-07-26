// ============================================================
// ROTAS DE CATÁLOGO / HOME / SEO / BANNERS / ENDEREÇOS
// Extraído de legacyRoutes.js na Etapa 5.
// Objetivo: reduzir legacyRoutes.js sem alterar endpoints, regras ou respostas.
// ============================================================

export default function registerCatalogHomeProductBannerRoutes(app, context = {}) {
  const {
    Address,
    Banner,
    Category,
    Product,
    Seller,
    adminRequired,
    authRequired,
    axios,
    changedKeys,
    ensureArray,
    escapeRegex,
    getPaymentsSettings,
    normalizeBannerForResponse,
    normalizeBannerPayload,
    normalizeObjectId,
    normalizeProductForResponse,
    parseBannerInput,
    productPayloadFromBody,
    sanitizeIdPart,
    toJSON,
    writeAuditLog
  } = context;

app.get('/api/home/index-data', async (_req, res) => {
  try {
    const [categories, products, banners, paymentSettings] = await Promise.all([
      Category.find({ active: true }).sort({ sortOrder: 1, name: 1 }),
      Product.find({ active: true }).sort({ createdAt: -1 }).limit(200),
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
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar dados da home' });
  }
});

app.get('/api/index-data', async (req, res) => {
  req.url = '/api/home/index-data';
  return app._router.handle(req, res, () => {});
});

app.get('/api/home', async (req, res) => {
  req.url = '/api/home/index-data';
  return app._router.handle(req, res, () => {});
});

// ==========================================
// SEO: SITEMAP E ROBOTS DINÃ‚MICOS
// ==========================================
function getPublicSiteUrl() {
  const fromEnv = String(process.env.SITE_URL || process.env.FRONTEND_URL || 'https://arianamoveis.com.br').trim();
  return fromEnv.replace(/\/+$/, '') || 'https://arianamoveis.com.br';
}

function xmlEscape(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isoDateOnly(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString().split('T')[0];
  return date.toISOString().split('T')[0];
}

function buildProductSeoUrl(baseUrl, product = {}) {
  const id = String(product._id || product.id || '').trim();
  const slug = String(product.slug || '').trim();

  // Mantém compatível com seu site atual, que abre produto por produto.html?id=...
  // Usa o slug só se não existir _id.
  const identifier = id || slug || sanitizeIdPart(product.name || product.sku || 'produto');
  return `${baseUrl}/produto.html?id=${encodeURIComponent(identifier)}`;
}

function buildCategorySeoUrl(baseUrl, category = {}) {
  const id = String(category._id || category.id || '').trim();
  const slug = String(category.slug || category.name || '').trim();
  const identifier = id || slug;
  return `${baseUrl}/categoria.html?id=${encodeURIComponent(identifier)}`;
}

app.get('/sitemap.xml', async (_req, res) => {
  try {
    const baseUrl = getPublicSiteUrl();

    const [products, categories] = await Promise.all([
      Product.find({ active: { $ne: false } })
        .select('_id id slug name sku updatedAt createdAt active')
        .sort({ updatedAt: -1, createdAt: -1 })
        .limit(10000)
        .lean(),
      Category.find({ active: { $ne: false } })
        .select('_id id slug name updatedAt createdAt active')
        .sort({ sortOrder: 1, name: 1 })
        .limit(1000)
        .lean()
    ]);

    const urls = [];

    const addUrl = (loc, lastmod, priority = '0.8', changefreq = 'weekly') => {
      if (!loc) return;
      urls.push(
        `  <url>\n` +
        `    <loc>${xmlEscape(loc)}</loc>\n` +
        `    <lastmod>${xmlEscape(isoDateOnly(lastmod))}</lastmod>\n` +
        `    <changefreq>${xmlEscape(changefreq)}</changefreq>\n` +
        `    <priority>${xmlEscape(priority)}</priority>\n` +
        `  </url>`
      );
    };

    addUrl(`${baseUrl}/`, new Date(), '1.0', 'daily');
    addUrl(`${baseUrl}/index.html`, new Date(), '1.0', 'daily');
    addUrl(`${baseUrl}/todos_produtos.html`, new Date(), '0.9', 'daily');
    addUrl(`${baseUrl}/ofertas.html`, new Date(), '0.9', 'daily');
    addUrl(`${baseUrl}/nossas_lojas.html`, new Date(), '0.6', 'monthly');
    addUrl(`${baseUrl}/contato.html`, new Date(), '0.5', 'monthly');

    for (const category of (categories || [])) {
      addUrl(buildCategorySeoUrl(baseUrl, category), category.updatedAt || category.createdAt, '0.7', 'weekly');
    }

    for (const product of (products || [])) {
      addUrl(buildProductSeoUrl(baseUrl, product), product.updatedAt || product.createdAt, '0.8', 'weekly');
    }

    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls.join('\n') +
      `\n</urlset>\n`;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).send(xml);
  } catch (error) {
    console.error('[sitemap] erro ao gerar sitemap dinâmico:', error);
    return res.status(500).type('text/plain').send('Erro ao gerar sitemap');
  }
});

app.get('/robots.txt', (_req, res) => {
  const baseUrl = getPublicSiteUrl();
  const txt =
    `User-agent: *\n` +
    `Allow: /\n\n` +
    `Sitemap: ${baseUrl}/sitemap.xml\n`;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.status(200).send(txt);
});


// ==========================================
// SEO: INDEXNOW (BING / EDGE)
// ==========================================
const INDEXNOW_KEY = String(process.env.INDEXNOW_KEY || 'a1b2c3d4e5f67890123456789abcdef0').trim();
const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';

function getIndexNowKeyLocation() {
  return `${getPublicSiteUrl()}/${INDEXNOW_KEY}.txt`;
}

function normalizeIndexNowUrls(urls = []) {
  return Array.from(new Set(ensureArray(urls)
    .map((url) => String(url || '').trim())
    .filter((url) => /^https?:\/\//i.test(url))
  )).slice(0, 10000);
}

async function submitIndexNowUrls(urls = []) {
  const urlList = normalizeIndexNowUrls(urls);
  if (!urlList.length) return { ok: false, skipped: true, reason: 'empty_url_list' };

  const host = new URL(getPublicSiteUrl()).host;
  const payload = {
    host,
    key: INDEXNOW_KEY,
    keyLocation: getIndexNowKeyLocation(),
    urlList
  };

  const response = await axios.post(INDEXNOW_ENDPOINT, payload, {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    timeout: 30000,
    validateStatus: () => true
  });

  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    submitted: urlList.length,
    data: response.data || null
  };
}

app.get(`/${INDEXNOW_KEY}.txt`, (_req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.status(200).send(INDEXNOW_KEY);
});

app.post('/api/indexnow/submit', adminRequired, async (req, res) => {
  try {
    const urls = req.body?.urls || req.body?.urlList || req.body?.url || [];
    const result = await submitIndexNowUrls(urls);
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (error) {
    console.error('[indexnow] erro ao enviar URLs:', error);
    return res.status(500).json({ ok: false, error: error.message || 'indexnow_submit_failed' });
  }
});

app.post('/api/indexnow/submit-all-products', adminRequired, async (_req, res) => {
  try {
    const baseUrl = getPublicSiteUrl();
    const [products, categories] = await Promise.all([
      Product.find({ active: { $ne: false } })
        .select('_id id slug name sku updatedAt createdAt active')
        .sort({ updatedAt: -1, createdAt: -1 })
        .limit(10000)
        .lean(),
      Category.find({ active: { $ne: false } })
        .select('_id id slug name updatedAt createdAt active')
        .sort({ sortOrder: 1, name: 1 })
        .limit(1000)
        .lean()
    ]);

    const urls = [
      `${baseUrl}/`,
      `${baseUrl}/index.html`,
      `${baseUrl}/todos_produtos.html`,
      `${baseUrl}/ofertas.html`,
      ...(categories || []).map((category) => buildCategorySeoUrl(baseUrl, category)),
      ...(products || []).map((product) => buildProductSeoUrl(baseUrl, product))
    ];

    const result = await submitIndexNowUrls(urls);
    return res.status(result.ok ? 200 : 400).json({ ...result, products: products.length, categories: categories.length });
  } catch (error) {
    console.error('[indexnow] erro ao enviar todos os produtos:', error);
    return res.status(500).json({ ok: false, error: error.message || 'indexnow_submit_all_failed' });
  }
});


app.get('/api/categories', async (_req, res) => res.json((await Category.find({ active: true }).sort({ sortOrder: 1, name: 1 })).map(toJSON)));
app.get('/api/products', async (req, res) => {
  try {
    const query = {};
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
      const searchOr = [
        { name: rx },
        { description: rx },
        { category: rx },
        { categoria: rx },
        { categoryName: rx },
        { brand: rx },
        { sku: rx }
      ];
      query.$and = query.$and || [];
      query.$and.push({ $or: searchOr });
    }

    const rows = await Product.find(query).sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limit || 500), 1000));
    return res.json(rows.map(normalizeProductForResponse));
  } catch (error) {
    console.error('[products] erro ao listar:', error);
    return res.status(500).json({ ok: false, error: 'Erro ao listar produtos' });
  }
});
app.get('/api/products/:id', async (req, res) => { const oid = normalizeObjectId(req.params.id); let doc = oid ? await Product.findById(oid) : null; if (!doc) doc = await Product.findOne({ $or: [{ sku: req.params.id }, { slug: req.params.id }] }); if (!doc) return res.status(404).json({ ok: false, error: 'Produto não encontrado' }); return res.json(normalizeProductForResponse(doc)); });
app.get('/api/products/seller/:sellerId', async (req, res) => {
  try {
    const sellerId = String(req.params.sellerId || '').trim();
    const rows = await Product.find({ sellerId }).sort({ createdAt: -1 });
    return res.json(rows.map(normalizeProductForResponse));
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar produtos do seller' });
  }
});


app.get('/api/seller/:sellerId/products', async (req, res) => {
  try {
    const sellerId = String(req.params.sellerId || '').trim();
    const query = { sellerId };
    if (req.query.active !== undefined) query.active = String(req.query.active) !== 'false';
    const rows = await Product.find(query).sort({ createdAt: -1 });
    return res.json(rows.map(normalizeProductForResponse));
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar produtos do seller' });
  }
});

app.get('/api/sellers/:sellerId/products', async (req, res) => {
  try {
    const sellerId = String(req.params.sellerId || '').trim();
    const query = { sellerId };
    if (req.query.active !== undefined) query.active = String(req.query.active) !== 'false';
    const rows = await Product.find(query).sort({ createdAt: -1 });
    return res.json(rows.map(normalizeProductForResponse));
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar produtos do seller' });
  }
});

app.post('/api/products', authRequired, async (req, res) => {
  try {
    const body = req.body || {};
    const userRole = String(req.user?.role || '').toLowerCase();
    const sellerId = userRole === 'admin' ? String(body.sellerId || req.user.sellerId || '').trim() : String(req.user.sellerId || '').trim();
    if (userRole === 'seller' && !sellerId) return res.status(403).json({ ok: false, error: 'Seller não identificado' });
    const seller = sellerId ? await Seller.findOne({ sellerId }) : null;
    const payload = productPayloadFromBody({ ...body, sellerId, sellerName: seller?.storeName || seller?.displayName || '' });
    const doc = await Product.create(payload);
    return res.json({ ok: true, product: normalizeProductForResponse(doc) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao cadastrar produto' });
  }
});
app.put('/api/products/:id', authRequired, async (req, res) => {
  try {
    const oid = normalizeObjectId(req.params.id);
    if (!oid) return res.status(400).json({ ok: false, error: 'ID inválido' });
    const before = await Product.findById(oid);
    if (!before) return res.status(404).json({ ok: false, error: 'Produto não encontrado' });
    const userRole = String(req.user?.role || '').toLowerCase();
    if (userRole === 'seller' && String(before.sellerId || '') !== String(req.user.sellerId || '')) {
      return res.status(403).json({ ok: false, error: 'Sem permissão para editar este produto' });
    }
    const update = productPayloadFromBody(req.body || {}, before);
    if (userRole === 'seller') update.sellerId = String(req.user.sellerId || '');
    const after = await Product.findByIdAndUpdate(oid, { $set: update }, { new: true });
    await writeAuditLog({ scope: 'catalog', eventType: 'product_updated', status: 'success', changedKeys: changedKeys(toJSON(before), toJSON(after)), metadata: { productId: String(after._id), sellerId: after.sellerId } });
    return res.json({ ok: true, product: normalizeProductForResponse(after) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao editar produto' });
  }
});
app.delete('/api/products/:id', authRequired, async (req, res) => {
  try {
    const oid = normalizeObjectId(req.params.id);
    if (!oid) return res.status(400).json({ ok: false, error: 'ID inválido' });
    const userRole = String(req.user?.role || '').toLowerCase();
    const query = userRole === 'seller' ? { _id: oid, sellerId: String(req.user.sellerId || '') } : { _id: oid };
    const deleted = await Product.findOneAndDelete(query);
    if (!deleted) return res.status(404).json({ ok: false, error: 'Produto não encontrado ou sem permissão' });
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao excluir produto' });
  }
});

app.get('/api/banners', async (req, res) => {
  try {
    const query = { active: { $ne: false } };

    if (req.query.slot) {
      query.slot = String(req.query.slot || '').trim();
    }

    const rows = await Banner.find(query).sort({
      sortOrder: 1,
      createdAt: -1
    });

    return res.json(rows.map(normalizeBannerForResponse));
  } catch (error) {
    console.error('[banners] erro ao carregar banners públicos:', error);
    return res.status(500).json({
      ok: false,
      error: error.message || 'Erro ao carregar banners'
    });
  }
});

app.get('/api/index/banners', async (req, res) => {
  req.url = '/api/banners';
  return app._router.handle(req, res, () => {});
});

app.get('/api/header_category_banner', async (_req, res) => {
  try {
    const doc = await Banner.findOne({ slot: 'header_category_banner', active: true }).sort({ sortOrder: 1, createdAt: -1 });
    if (!doc) return res.status(404).json({ ok: false, error: 'Banner não encontrado' });
    return res.json(normalizeBannerForResponse(doc));
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar banner do header' });
  }
});

app.get('/api/banners/header_category_banner', async (req, res) => {
  req.url = '/api/header_category_banner';
  return app._router.handle(req, res, () => {});
});

app.get('/api/admin/banners', adminRequired, async (_req, res) => {
  const rows = await Banner.find({}).sort({ sortOrder: 1, createdAt: -1 });
  return res.json(rows.map(normalizeBannerForResponse));
});

app.get('/api/admin/banners/:id', adminRequired, async (req, res) => {
  const key = String(req.params.id || '').trim();
  const doc = await Banner.findOne({ $or: [{ slot: key }, { _id: normalizeObjectId(key) || undefined }] });
  if (!doc) return res.status(404).json({ ok: false, error: 'not_found' });
  return res.json(normalizeBannerForResponse(doc));
});

app.post('/api/admin/banners/bulk', adminRequired, async (req, res) => {
  try {
    const banners = parseBannerInput(req.body || {});
    if (!banners.length) return res.status(400).json({ ok: false, error: 'Nenhum banner enviado' });
    const saved = [];
    for (const item of banners) {
      const payload = normalizeBannerPayload(item);
      if (!payload.slot) continue;
      const doc = await Banner.findOneAndUpdate(
        { slot: payload.slot },
        { $set: payload },
        { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
      );
      saved.push(doc);
    }
    return res.json({ ok: true, count: saved.length, banners: saved.map(normalizeBannerForResponse) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'banner_bulk_save_failed' });
  }
});

app.post('/api/banners/bulk', adminRequired, async (req, res) => {
  req.url = '/api/admin/banners/bulk';
  return app._router.handle(req, res, () => {});
});

app.post('/api/admin/banners', adminRequired, async (req, res) => {
  try {
    const banners = parseBannerInput(req.body || {});
    if (banners.length) {
      req.body = { banners };
      req.url = '/api/admin/banners/bulk';
      return app._router.handle(req, res, () => {});
    }
    const payload = normalizeBannerPayload(req.body || {});
    if (!payload.slot) return res.status(400).json({ ok: false, error: 'slot_required' });
    const doc = await Banner.findOneAndUpdate(
      { slot: payload.slot },
      { $set: payload },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
    return res.json(normalizeBannerForResponse(doc));
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'banner_save_failed' });
  }
});
app.get('/api/addresses', authRequired, async (req, res) => res.json((await Address.find({ userId: req.user._id }).sort({ isDefault: -1, createdAt: -1 })).map(toJSON)));
app.post('/api/addresses', authRequired, async (req, res) => { const body = req.body || {}; if (body.isDefault) await Address.updateMany({ userId: req.user._id }, { $set: { isDefault: false } }); const doc = await Address.create({ userId: req.user._id, name: body.name || '', phone: body.phone || '', cep: body.cep || '', logradouro: body.logradouro || '', numero: body.numero || '', bairro: body.bairro || '', cidade: body.cidade || '', uf: body.uf || '', complemento: body.complemento || '', reference: body.reference || '', isDefault: body.isDefault === true }); return res.json({ ok: true, address: toJSON(doc) }); });
app.delete('/api/addresses/:id', authRequired, async (req, res) => { const oid = normalizeObjectId(req.params.id); if (!oid) return res.status(400).json({ ok: false, error: 'ID inválido' }); await Address.deleteOne({ _id: oid, userId: req.user._id }); return res.json({ ok: true }); });

}
