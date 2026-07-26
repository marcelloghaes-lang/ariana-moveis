// ============================================================
// ENTERPRISE PRODUCT ROUTES - ARIANA MÓVEIS
// Extraído de routes/enterpriseRoutes.js na Sprint 3.
// Mantém endpoints, regras e respostas originais.
// ============================================================

export default function registerEnterpriseProductRoutes(app, context = {}) {
  const {
    enterpriseCompatAuth,
    enterpriseRequirePermission,
    enterpriseProductSkuFromBody,
    enterpriseCompatNumber,
    enterpriseFindProductBySkuForPartner,
    enterpriseProductResponse,
    enterpriseCompatProductPayload,
    normalizeImageEntry,
    IntegrationAuditLog,
    Product,
    redact,
    changedKeys
  } = context;

  // ============================================================
  // PASSO 42 — ENTERPRISE INDIVIDUAL UPDATES
  // Atualização individual de estoque, preço e dados do produto via API Key.
  // Não altera o fluxo já validado de /api/enterprise/catalog/sync.
  // ============================================================
  // Extraído para routes/enterprise/shared/order.js sem alterar regras ou respostas: enterprisePartnerProductScope

  // Extraído para routes/enterprise/shared/order.js sem alterar regras ou respostas: enterpriseRequirePermission

  // Extraído para routes/enterprise/shared/order.js sem alterar regras ou respostas: enterpriseProductSkuFromBody

  // Extraído para routes/enterprise/shared/order.js sem alterar regras ou respostas: enterpriseFindProductBySkuForPartner

  // Extraído para routes/enterprise/shared/order.js sem alterar regras ou respostas: enterpriseProductResponse

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


  // Extraído para routes/enterprise/catalogRoutes.js sem alterar endpoints: app.post('/api/enterprise/catalog/push', enterpriseCompatAuth, async (req, res) => {



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
