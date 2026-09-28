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
    EnterpriseSandboxProduct,
    enterpriseProductModelForPartner,
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

    const ProductModel = enterpriseProductModelForPartner(req.enterprisePartner || {});
    const results = [];
    for (const item of items) {
      const payload = enterpriseCompatProductPayload(item, req.body, req.enterprisePartner);
      const filter = { sku: payload.sku, sellerId: payload.sellerId };
      const product = await ProductModel.findOneAndUpdate(
        filter,
        { $set: payload, $setOnInsert: { createdAt: new Date() } },
        { upsert: true, new: true }
      );
      results.push({ ok: true, sku: payload.sku, id: String(product._id), stock: product.stock, price: product.price });
    }

    await IntegrationAuditLog.create({
      scope: 'enterprise',
      eventType: 'catalog_push',
      manufacturer: req.enterprisePartner?.requestId || req.enterprisePartner?.id || req.body?.manufacturer || 'enterprise',
      status: 'success',
      statusCode: 201,
      message: `Catálogo recebido: ${results.length} produto(s)`,
      request: redact(req.body),
      response: { total: results.length }
    }).catch(() => null);

    return res.status(201).json({
      ok: true,
      manufacturer: req.enterprisePartner?.requestId || req.enterprisePartner?.id || req.body?.manufacturer || 'enterprise',
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
    const manufacturer = String(req.enterprisePartner?.requestId || req.enterprisePartner?.id || req.query.manufacturer || req.query.sellerId || '').trim();
    const ProductModel = enterpriseProductModelForPartner(req.enterprisePartner || {});
    const productFilter = enterpriseBuildProductManufacturerQuery(manufacturer);

    const [
      totalProducts,
      activeProducts,
      inactiveProducts,
      outOfStockProducts,
      recentProducts,
      bySeller
    ] = await Promise.all([
      ProductModel.countDocuments(productFilter),
      ProductModel.countDocuments({ ...productFilter, active: { $ne: false } }),
      ProductModel.countDocuments({ ...productFilter, active: false }),
      ProductModel.countDocuments({ ...productFilter, stock: { $lte: 0 } }),
      ProductModel.find(productFilter)
        .sort({ updatedAt: -1, createdAt: -1 })
        .limit(10)
        .select('sellerId sellerName brand sku name price stock active updatedAt createdAt')
        .lean(),
      ProductModel.aggregate([
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

    const partnerScope = [
      req.enterprisePartner?.requestId,
      req.enterprisePartner?.partnerId,
      req.enterprisePartner?.id,
      req.enterprisePartner?.tradeName,
      req.enterprisePartner?.companyName
    ].map((v) => String(v || '').trim()).filter(Boolean);
    const lastSyncLog = partnerScope.length ? await IntegrationAuditLog.findOne({
      eventType: { $in: ['enterprise_product_state_sync', 'enterprise_product_bulk_state_sync', 'enterprise_catalog_sync_completed', 'enterprise_catalog_bulk_upsert', 'enterprise_stock_update', 'enterprise_price_update'] },
      $or: [
        { manufacturer: { $in: partnerScope } },
        { integrationId: { $in: partnerScope } }
      ]
    }).sort({ createdAt: -1 }).lean().catch(() => null) : null;

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

// Atualizações individuais de produto/estoque/preço ficam exclusivamente em
// enterpriseProductRoutes.js. Manter uma única implementação evita colisões
// de rotas e garante que os helpers compartilhados sejam usados corretamente.

}
