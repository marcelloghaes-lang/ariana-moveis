// ============================================================
// ROTAS ENTERPRISE - CATALOG
// Extraído de routes/enterpriseRoutes.js sem alterar endpoints, regras ou respostas.
// ============================================================

export default function registerEnterpriseCatalogRoutes(app, context = {}) {
  const {
    enterpriseCompatAuth,
    enterpriseOrderOperationAuth,
    enterpriseCompatProductPayload,
    enterpriseBuildProductManufacturerQuery,
    enterpriseCompatNumber,
    normalizeProductForResponse,
    normalizeImageEntry,
    changedKeys,
    Product,
    IntegrationAuditLog,
    redact
  } = context;

// ============================================================
// ENTERPRISE CATALOG PUSH
// Endpoint legado preservado sem alteração de URL, regra ou resposta.
// ============================================================
app.post('/api/enterprise/catalog/push', enterpriseCompatAuth, async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items || req.body?.products || req.body?.produtos)
      ? (req.body.items || req.body.products || req.body.produtos)
      : [];

    if (!items.length) return res.status(400).json({ ok: false, error: 'Nenhum produto enviado no catálogo' });

    const results = [];
    for (const item of items) {
      const payload = enterpriseCompatProductPayload(item, req.body, req.enterprisePartner);
      const filter = { sku: payload.sku, sellerId: payload.sellerId };
      const product = await Product.findOneAndUpdate(
        filter,
        { $set: payload, $setOnInsert: { createdAt: new Date() } },
        { upsert: true, new: true }
      );
      results.push({ ok: true, sku: payload.sku, id: String(product._id), stock: product.stock, price: product.price });
    }

    await IntegrationAuditLog.create({
      scope: 'enterprise',
      eventType: 'catalog_push',
      manufacturer: req.body?.manufacturer || req.enterprisePartner?.requestId || 'enterprise',
      status: 'success',
      statusCode: 201,
      message: `Catálogo recebido: ${results.length} produto(s)`,
      request: redact(req.body),
      response: { total: results.length }
    }).catch(() => null);

    return res.status(201).json({
      ok: true,
      manufacturer: req.body?.manufacturer || req.enterprisePartner?.requestId || 'enterprise',
      total: results.length,
      success: results.length,
      errors: 0,
      results
    });
  } catch (error) {
    console.error('[enterprise/catalog/push] erro:', error.message || error);
    return res.status(400).json({ ok: false, error: error.message || 'Erro ao receber catálogo Enterprise' });
  }
});

// ============================================================
// ENTERPRISE CATALOG SUMMARY
// Endpoint preservado sem alteração de URL, regra ou resposta.
// ============================================================
app.get('/api/enterprise/catalog/summary', enterpriseOrderOperationAuth, async (req, res) => {
  try {
    const manufacturer = String(req.query.manufacturer || req.query.sellerId || '').trim();
    const productFilter = enterpriseBuildProductManufacturerQuery(manufacturer);

    const [
      totalProducts,
      activeProducts,
      inactiveProducts,
      outOfStockProducts,
      recentProducts,
      bySeller
    ] = await Promise.all([
      Product.countDocuments(productFilter),
      Product.countDocuments({ ...productFilter, active: { $ne: false } }),
      Product.countDocuments({ ...productFilter, active: false }),
      Product.countDocuments({ ...productFilter, stock: { $lte: 0 } }),
      Product.find(productFilter)
        .sort({ updatedAt: -1, createdAt: -1 })
        .limit(10)
        .select('sellerId sellerName brand sku name price stock active updatedAt createdAt')
        .lean(),
      Product.aggregate([
        { $match: Object.keys(productFilter).length ? productFilter : { sellerId: { $exists: true, $ne: '' } } },
        {
          $group: {
            _id: '$sellerId',
            total: { $sum: 1 },
            active: { $sum: { $cond: [{ $ne: ['$active', false] }, 1, 0] } },
            outOfStock: { $sum: { $cond: [{ $lte: ['$stock', 0] }, 1, 0] } },
            stock: { $sum: { $ifNull: ['$stock', 0] } },
            lastUpdate: { $max: '$updatedAt' }
          }
        },
        { $sort: { total: -1 } },
        { $limit: 50 }
      ])
    ]);

    const lastSyncLog = await IntegrationAuditLog.findOne({
      eventType: { $in: ['enterprise_product_state_sync', 'enterprise_product_bulk_state_sync', 'enterprise_catalog_sync_completed', 'enterprise_catalog_bulk_upsert', 'enterprise_stock_update', 'enterprise_price_update'] }
    }).sort({ createdAt: -1 }).lean().catch(() => null);

    return res.json({
      ok: true,
      generatedAt: new Date(),
      filters: { manufacturer },
      summary: {
        totalProducts,
        activeProducts,
        inactiveProducts,
        outOfStockProducts,
        availableProducts: Math.max(0, activeProducts - outOfStockProducts),
        lastSyncAt: lastSyncLog?.createdAt || null,
        lastSyncEvent: lastSyncLog?.eventType || ''
      },
      manufacturers: bySeller.map((item) => ({
        manufacturer: item._id || 'sem_seller',
        total: item.total || 0,
        active: item.active || 0,
        outOfStock: item.outOfStock || 0,
        stock: item.stock || 0,
        lastUpdate: item.lastUpdate || null
      })),
      recentProducts: recentProducts.map((product) => ({
        id: String(product._id || ''),
        sellerId: product.sellerId || '',
        sellerName: product.sellerName || '',
        brand: product.brand || '',
        sku: product.sku || '',
        name: product.name || '',
        price: Number(product.price || 0),
        stock: Number(product.stock || 0),
        active: product.active !== false,
        updatedAt: product.updatedAt || product.createdAt || null
      }))
    });
  } catch (error) {
    console.error('[enterprise/catalog/summary] erro:', error.message || error);
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao gerar resumo do catálogo Enterprise' });
  }
});

// ============================================================
// PASSO 42 — ENTERPRISE INDIVIDUAL UPDATES
// Atualização individual de estoque, preço e dados do produto via API Key.
// Não altera o fluxo já validado de /api/enterprise/catalog/sync.
// ============================================================
function enterprisePartnerProductScope(partner = {}) {
  return [
    partner.requestId,
    partner.partnerId,
    partner.id,
    partner._id,
    partner.tradeName,
    partner.companyName
  ].map((v) => String(v || '').trim()).filter(Boolean);
}

function enterpriseRequirePermission(req, res, permission = '') {
  const permissions = req.enterprisePartner?.permissions || [];
  if (permissions.includes('*')) return true;
  const normalized = permissions.map((p) => String(p || '').toLowerCase());
  if (!permission || normalized.includes(String(permission).toLowerCase())) return true;
  res.status(403).json({ ok: false, error: `Permissão Enterprise ausente: ${permission}` });
  return false;
}

function enterpriseProductSkuFromBody(req) {
  return String(
    req.params?.sku ||
    req.body?.sku ||
    req.body?.codigo ||
    req.body?.productSku ||
    req.query?.sku ||
    ''
  ).trim();
}

async function enterpriseFindProductBySkuForPartner(sku = '', partner = {}) {
  const cleanSku = String(sku || '').trim();
  if (!cleanSku) return null;

  const sellerIds = enterprisePartnerProductScope(partner);
  const or = [
    { sku: cleanSku },
    { codigo: cleanSku },
    { productSku: cleanSku }
  ];

  const scoped = sellerIds.length
    ? {
        $and: [
          { $or: or },
          { $or: sellerIds.flatMap((id) => ([
            { sellerId: id },
            { manufacturer: id },
            { 'metadata.enterprisePartnerId': id }
          ])) }
        ]
      }
    : { $or: or };

  let product = await Product.findOne(scoped);
  if (product) return product;

  // Compatibilidade com produtos antigos que foram criados sem escopo correto.
  return Product.findOne({ sku: cleanSku });
}

function enterpriseProductResponse(productDoc = {}) {
  const obj = normalizeProductForResponse(productDoc);
  return {
    id: String(obj._id || obj.id || ''),
    sellerId: obj.sellerId || '',
    sellerName: obj.sellerName || '',
    sku: obj.sku || '',
    name: obj.name || '',
    price: obj.price || 0,
    stock: obj.stock || 0,
    active: obj.active !== false,
    updatedAt: obj.updatedAt || null
  };
}

app.post('/api/enterprise/stock/update', enterpriseCompatAuth, async (req, res) => {
  try {
    if (!enterpriseRequirePermission(req, res, 'stock')) return;

    const sku = enterpriseProductSkuFromBody(req);
    const stock = enterpriseCompatNumber(req.body?.stock ?? req.body?.estoque ?? req.body?.quantity, NaN);

    if (!sku) return res.status(400).json({ ok: false, error: 'SKU obrigatório' });
    if (!Number.isFinite(stock) || stock < 0) return res.status(400).json({ ok: false, error: 'Estoque inválido' });

    const partner = req.enterprisePartner || {};
    const product = await enterpriseFindProductBySkuForPartner(sku, partner);
    if (!product) return res.status(404).json({ ok: false, error: 'Produto não encontrado para este parceiro', sku });

    const beforeStock = Number(product.stock || 0);
    product.stock = stock;
    product.updatedAt = new Date();
    product.metadata = {
      ...(product.metadata || {}),
      enterpriseLastUpdate: {
        type: 'stock',
        partnerId: partner.requestId || partner.id || '',
        environment: partner.environment || 'sandbox',
        at: new Date()
      }
    };
    await product.save();

    await IntegrationAuditLog.create({
      scope: 'enterprise',
      eventType: 'product.stock.updated',
      manufacturer: partner.tradeName || partner.companyName || partner.requestId || '',
      integrationId: partner.requestId || partner.id || '',
      status: 'success',
      statusCode: 200,
      message: `Estoque atualizado para SKU ${sku}`,
      request: redact(req.body || {}),
      response: { sku, beforeStock, stock },
      metadata: { environment: partner.environment || 'sandbox' }
    }).catch(() => null);

    return res.json({ ok: true, action: 'stock_updated', sku, beforeStock, stock, product: enterpriseProductResponse(product) });
  } catch (error) {
    console.error('[enterprise/stock/update] erro:', error.message || error);
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao atualizar estoque Enterprise' });
  }
});

app.post('/api/enterprise/price/update', enterpriseCompatAuth, async (req, res) => {
  try {
    if (!enterpriseRequirePermission(req, res, 'price')) return;

    const sku = enterpriseProductSkuFromBody(req);
    const price = enterpriseCompatNumber(req.body?.price ?? req.body?.preco ?? req.body?.unitPrice, NaN);

    if (!sku) return res.status(400).json({ ok: false, error: 'SKU obrigatório' });
    if (!Number.isFinite(price) || price < 0) return res.status(400).json({ ok: false, error: 'Preço inválido' });

    const partner = req.enterprisePartner || {};
    const product = await enterpriseFindProductBySkuForPartner(sku, partner);
    if (!product) return res.status(404).json({ ok: false, error: 'Produto não encontrado para este parceiro', sku });

    const beforePrice = Number(product.price || 0);
    product.price = price;
    if (req.body?.oldPrice !== undefined) product.oldPrice = enterpriseCompatNumber(req.body.oldPrice, null);
    if (req.body?.pixPrice !== undefined) product.pixPrice = enterpriseCompatNumber(req.body.pixPrice, null);
    product.updatedAt = new Date();
    product.metadata = {
      ...(product.metadata || {}),
      enterpriseLastUpdate: {
        type: 'price',
        partnerId: partner.requestId || partner.id || '',
        environment: partner.environment || 'sandbox',
        at: new Date()
      }
    };
    await product.save();

    await IntegrationAuditLog.create({
      scope: 'enterprise',
      eventType: 'product.price.updated',
      manufacturer: partner.tradeName || partner.companyName || partner.requestId || '',
      integrationId: partner.requestId || partner.id || '',
      status: 'success',
      statusCode: 200,
      message: `Preço atualizado para SKU ${sku}`,
      request: redact(req.body || {}),
      response: { sku, beforePrice, price },
      metadata: { environment: partner.environment || 'sandbox' }
    }).catch(() => null);

    return res.json({ ok: true, action: 'price_updated', sku, beforePrice, price, product: enterpriseProductResponse(product) });
  } catch (error) {
    console.error('[enterprise/price/update] erro:', error.message || error);
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao atualizar preço Enterprise' });
  }
});

app.post('/api/enterprise/product/update', enterpriseCompatAuth, async (req, res) => {
  try {
    if (!enterpriseRequirePermission(req, res, 'catalog')) return;

    const sku = enterpriseProductSkuFromBody(req);
    if (!sku) return res.status(400).json({ ok: false, error: 'SKU obrigatório' });

    const partner = req.enterprisePartner || {};
    const product = await enterpriseFindProductBySkuForPartner(sku, partner);
    if (!product) return res.status(404).json({ ok: false, error: 'Produto não encontrado para este parceiro', sku });

    const before = product.toObject ? product.toObject() : { ...product };
    const payload = enterpriseCompatProductPayload({ ...req.body, sku }, req.body || {}, partner);

    // Atualiza somente campos seguros do produto. Não troca _id nem remove o histórico existente.
    const allowedFields = [
      'name', 'slug', 'description', 'category', 'categoryName', 'brand', 'price', 'oldPrice', 'image',
      'imageUrl', 'imagem', 'mainImageUrl', 'stock', 'active', 'specs', 'dimensions', 'logistics',
      'weight', 'height', 'width', 'length'
    ];

    for (const field of allowedFields) {
      if (payload[field] !== undefined && payload[field] !== null && payload[field] !== '') {
        product[field] = payload[field];
      }
    }

    if (Array.isArray(req.body?.images)) product.images = req.body.images.map(normalizeImageEntry).filter(Boolean);
    if (Array.isArray(req.body?.imageUrls)) product.imageUrls = req.body.imageUrls.map((v) => String(v || '').trim()).filter(Boolean);
    if (Array.isArray(req.body?.imagePaths)) product.imagePaths = req.body.imagePaths.map((v) => String(v || '').trim()).filter(Boolean);

    product.updatedAt = new Date();
    product.metadata = {
      ...(product.metadata || {}),
      enterpriseLastUpdate: {
        type: 'product',
        partnerId: partner.requestId || partner.id || '',
        environment: partner.environment || 'sandbox',
        at: new Date()
      }
    };
    await product.save();

    await IntegrationAuditLog.create({
      scope: 'enterprise',
      eventType: 'product.updated',
      manufacturer: partner.tradeName || partner.companyName || partner.requestId || '',
      integrationId: partner.requestId || partner.id || '',
      status: 'success',
      statusCode: 200,
      message: `Produto atualizado para SKU ${sku}`,
      changedKeys: changedKeys(before, product.toObject ? product.toObject() : product).slice(0, 50),
      request: redact(req.body || {}),
      response: { sku, productId: String(product._id) },
      metadata: { environment: partner.environment || 'sandbox' }
    }).catch(() => null);

    return res.json({ ok: true, action: 'product_updated', sku, product: enterpriseProductResponse(product) });
  } catch (error) {
    console.error('[enterprise/product/update] erro:', error.message || error);
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao atualizar produto Enterprise' });
  }
});

// Extraído para routes/enterprise/catalogRoutes.js sem alterar endpoints.

app.post('/api/enterprise/products/:sku/sync', enterpriseCompatAuth, async (req, res) => {
  try {
    const sku = String(req.params.sku || req.body?.sku || '').trim();
    if (!sku) return res.status(400).json({ ok: false, error: 'SKU obrigatório' });

    const sellerId = String(req.body?.sellerId || req.body?.manufacturer || req.enterprisePartner?.requestId || 'enterprise').trim();
    const update = {
      sku,
      sellerId,
      stock: enterpriseCompatNumber(req.body?.stock, 0),
      active: req.body?.active !== false,
      updatedAt: new Date()
    };
    if (req.body?.price !== undefined) update.price = enterpriseCompatNumber(req.body.price, 0);
    if (req.body?.status) update.status_integracao = String(req.body.status);

    const product = await Product.findOneAndUpdate(
      { sku, sellerId },
      { $set: update, $setOnInsert: { name: sku, sellerName: req.enterprisePartner?.tradeName || req.enterprisePartner?.companyName || 'Enterprise' } },
      { upsert: true, new: true }
    );

    return res.json({ ok: true, sku, productId: String(product._id), stock: product.stock, price: product.price, active: product.active });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message || 'Erro ao sincronizar produto' });
  }
});

app.put('/api/enterprise/products/:sku/stock', enterpriseCompatAuth, async (req, res) => {
  try {
    const sku = String(req.params.sku || '').trim();
    const sellerId = String(req.body?.sellerId || req.body?.manufacturer || req.enterprisePartner?.requestId || 'enterprise').trim();
    const stock = enterpriseCompatNumber(req.body?.stock ?? req.body?.estoque, 0);

    const product = await Product.findOneAndUpdate(
      { sku, sellerId },
      { $set: { stock, updatedAt: new Date() }, $setOnInsert: { name: sku, sellerId, sellerName: req.enterprisePartner?.tradeName || 'Enterprise', price: 0, active: true } },
      { upsert: true, new: true }
    );

    return res.json({ ok: true, sku, stock: product.stock });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message || 'Erro ao atualizar estoque' });
  }
});

app.put('/api/enterprise/products/:sku/price', enterpriseCompatAuth, async (req, res) => {
  try {
    const sku = String(req.params.sku || '').trim();
    const sellerId = String(req.body?.sellerId || req.body?.manufacturer || req.enterprisePartner?.requestId || 'enterprise').trim();
    const price = enterpriseCompatNumber(req.body?.price ?? req.body?.preco, 0);

    const product = await Product.findOneAndUpdate(
      { sku, sellerId },
      { $set: { price, updatedAt: new Date() }, $setOnInsert: { name: sku, sellerId, sellerName: req.enterprisePartner?.tradeName || 'Enterprise', stock: 0, active: true } },
      { upsert: true, new: true }
    );

    return res.json({ ok: true, sku, price: product.price });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message || 'Erro ao atualizar preço' });
  }
});


}
