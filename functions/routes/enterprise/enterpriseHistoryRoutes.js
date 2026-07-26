// ============================================================
// ENTERPRISE HISTORY ROUTES - ARIANA MÓVEIS
// Extraído de routes/enterpriseRoutes.js na Sprint 5.
// Mantém endpoints, regras e respostas originais.
// ============================================================

export default function registerEnterpriseHistoryRoutes(app, context = {}) {
  const {
    enterpriseOrderOperationAuth,
    IntegrationAuditLog,
    escapeRegex,
    redact
  } = context;

app.get('/api/enterprise/products/sync/history', enterpriseOrderOperationAuth, async (req, res) => {
    try {
      const sku = String(req.query.sku || '').trim();
      const manufacturer = String(req.query.manufacturer || req.query.sellerId || '').trim();
      const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
  
      const eventTypes = [
        'enterprise_product_state_sync',
        'enterprise_product_bulk_state_sync',
        'enterprise_stock_update',
        'enterprise_price_update',
        'enterprise_catalog_sync_completed',
        'enterprise_catalog_bulk_upsert',
        'enterprise_catalog_sync_dry_run',
        'enterprise_product_upsert'
      ];
  
      const filter = { eventType: { $in: eventTypes } };
  
      if (manufacturer) {
        const safeManufacturer = String(manufacturer).toLowerCase();
        filter.$and = filter.$and || [];
        filter.$and.push({
          $or: [
            { manufacturer: safeManufacturer },
            { manufacturer: new RegExp(escapeRegex(manufacturer), 'i') },
            { 'request.manufacturer': new RegExp(escapeRegex(manufacturer), 'i') },
            { 'request.sellerId': new RegExp(escapeRegex(manufacturer), 'i') },
            { 'response.sellerId': new RegExp(escapeRegex(manufacturer), 'i') }
          ]
        });
      }
  
      if (sku) {
        const safeSku = String(sku).trim();
        const skuRegex = new RegExp(`^${escapeRegex(safeSku)}$`, 'i');
        filter.$and = filter.$and || [];
        filter.$and.push({
          $or: [
            { 'response.sku': skuRegex },
            { 'request.sku': skuRegex },
            { 'request.codigo': skuRegex },
            { 'request.ean': skuRegex },
            { 'request.items.sku': skuRegex },
            { 'request.products.sku': skuRegex },
            { 'request.produtos.sku': skuRegex },
            { 'response.results.sku': skuRegex }
          ]
        });
      }
  
      const logs = await IntegrationAuditLog.find(filter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
  
      const items = logs.map((log) => ({
        id: String(log._id || ''),
        eventType: log.eventType || '',
        status: log.status || '',
        statusCode: log.statusCode || null,
        manufacturer: log.manufacturer || '',
        sku: log.response?.sku || log.request?.sku || log.request?.codigo || '',
        message: log.message || '',
        request: redact(log.request || {}),
        response: redact(log.response || {}),
        metadata: log.metadata || {},
        createdAt: log.createdAt || null
      }));
  
      return res.json({
        ok: true,
        total: items.length,
        filters: { sku, manufacturer, limit },
        logs: items
      });
    } catch (error) {
      console.error('[enterprise/products/sync/history] erro:', error.message || error);
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao consultar histórico de sincronização Enterprise' });
    }
  });
}
