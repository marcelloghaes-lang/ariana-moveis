// ============================================================
// ENTERPRISE BILLING ROUTES - ARIANA MÓVEIS
// Extraído de routes/enterpriseRoutes.js sem alterar endpoints,
// regras de negócio, respostas ou compatibilidade.
// ============================================================

export default function registerEnterpriseBillingRoutes(app, context = {}) {
  const {
    enterpriseOrderOperationAuth,
    enterpriseCompatFindOrder,
    enterpriseBillingUpsert,
    enterpriseBillingNormalizeResponse,
    enterpriseNormalizeOrderForResponse,
    EnterpriseBillingRecord,
    escapeRegex,
    redact
  } = context;

app.post('/api/enterprise/orders/:orderId/billing', enterpriseOrderOperationAuth, async (req, res) => {
    try {
      const order = await enterpriseCompatFindOrder(req.params.orderId);
      if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para registrar faturamento' });
  
      const result = await enterpriseBillingUpsert(order, req.body || {}, req, 'enterprise_billing_registered');
      return res.status(201).json({
        ok: true,
        action: 'billing_registered',
        orderId: String(result.order._id),
        billing: result.billing,
        order: enterpriseNormalizeOrderForResponse(result.order)
      });
    } catch (error) {
      console.error('[enterprise/orders/:orderId/billing] erro:', error.message || error);
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao registrar faturamento Enterprise' });
    }
  });
  
  app.get('/api/enterprise/orders/:orderId/billing', enterpriseOrderOperationAuth, async (req, res) => {
    try {
      const order = await enterpriseCompatFindOrder(req.params.orderId);
      if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para consultar faturamento' });
  
      const orderId = String(order._id || '').trim();
      const record = await EnterpriseBillingRecord.findOne({ orderId }).sort({ updatedAt: -1 }).lean();
      const billing = record ? enterpriseBillingNormalizeResponse(record) : (order.manufacturerDispatch?.billing || null);
  
      return res.json({
        ok: true,
        orderId,
        billing,
        history: Array.isArray(billing?.history) ? billing.history : (order.manufacturerDispatch?.billingHistory || []),
        order: enterpriseNormalizeOrderForResponse(order)
      });
    } catch (error) {
      console.error('[enterprise/orders/:orderId/billing:GET] erro:', error.message || error);
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao consultar faturamento Enterprise' });
    }
  });
  
  app.patch('/api/enterprise/orders/:orderId/billing', enterpriseOrderOperationAuth, async (req, res) => {
    try {
      const order = await enterpriseCompatFindOrder(req.params.orderId);
      if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para atualizar faturamento' });
  
      const result = await enterpriseBillingUpsert(order, req.body || {}, req, 'enterprise_billing_updated');
      return res.json({
        ok: true,
        action: 'billing_updated',
        orderId: String(result.order._id),
        billing: result.billing,
        order: enterpriseNormalizeOrderForResponse(result.order)
      });
    } catch (error) {
      console.error('[enterprise/orders/:orderId/billing:PATCH] erro:', error.message || error);
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao atualizar faturamento Enterprise' });
    }
  });
  
  app.post('/api/enterprise/orders/:orderId/billing/cancel', enterpriseOrderOperationAuth, async (req, res) => {
    try {
      const order = await enterpriseCompatFindOrder(req.params.orderId);
      if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para cancelar faturamento' });
  
      const current = order.manufacturerDispatch?.billing || {};
      const payload = {
        ...(current || {}),
        ...(req.body || {}),
        status: 'cancelled',
        cancelReason: req.body?.reason || req.body?.motivo || req.body?.cancelReason || 'Faturamento cancelado pelo parceiro Enterprise'
      };
      const result = await enterpriseBillingUpsert(order, payload, req, 'enterprise_billing_cancelled');
  
      await EnterpriseBillingRecord.updateOne({ orderId: String(order._id) }, {
        $set: {
          status: 'cancelled',
          cancelReason: String(payload.cancelReason || '').trim(),
          cancelledAt: new Date()
        },
        $push: {
          history: {
            action: 'enterprise_billing_cancelled',
            at: new Date(),
            reason: String(payload.cancelReason || '').trim(),
            payload: redact(req.body || {})
          }
        }
      }).catch(() => null);
  
      return res.json({
        ok: true,
        action: 'billing_cancelled',
        orderId: String(result.order._id),
        billing: { ...result.billing, status: 'cancelled', cancelReason: String(payload.cancelReason || '').trim() },
        order: enterpriseNormalizeOrderForResponse(result.order)
      });
    } catch (error) {
      console.error('[enterprise/orders/:orderId/billing/cancel] erro:', error.message || error);
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao cancelar faturamento Enterprise' });
    }
  });
  
  app.get('/api/enterprise/billing', enterpriseOrderOperationAuth, async (req, res) => {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
      const filter = {};
      if (req.query.orderId) filter.orderId = String(req.query.orderId).trim();
      if (req.query.status) filter.status = String(req.query.status).trim();
      if (req.query.manufacturer) filter.manufacturer = new RegExp(escapeRegex(String(req.query.manufacturer).trim()), 'i');
      if (req.query.invoiceNumber) filter.invoiceNumber = String(req.query.invoiceNumber).trim();
      if (req.query.invoiceKey) filter.invoiceKey = String(req.query.invoiceKey).trim();
  
      const items = await EnterpriseBillingRecord.find(filter).sort({ updatedAt: -1, createdAt: -1 }).limit(limit).lean();
      const total = await EnterpriseBillingRecord.countDocuments(filter).catch(() => items.length);
  
      return res.json({
        ok: true,
        total,
        limit,
        filters: {
          orderId: req.query.orderId || '',
          status: req.query.status || '',
          manufacturer: req.query.manufacturer || '',
          invoiceNumber: req.query.invoiceNumber || '',
          invoiceKey: req.query.invoiceKey || ''
        },
        items: items.map(enterpriseBillingNormalizeResponse)
      });
    } catch (error) {
      console.error('[enterprise/billing] erro:', error.message || error);
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar faturamentos Enterprise' });
    }
  });
  
}
