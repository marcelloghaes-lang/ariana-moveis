// ============================================================
// ENTERPRISE ORDER ROUTES - ARIANA MÓVEIS
// Extraído de routes/enterpriseRoutes.js na Sprint 4.
// Mantém endpoints, regras e respostas originais.
// ============================================================

export default function registerEnterpriseOrderRoutes(app, context = {}) {
  const {
    enterpriseCompatAuth,
    enterpriseOrderOperationAuth,
    enterpriseCompatFindOrder,
    enterpriseNormalizeOrderForResponse,
    enterpriseStatusLabel,
    enterpriseCompatNumber,
    DEFAULT_CURRENCY,
    Order,
    IntegrationAuditLog,
    redact
  } = context;

  app.post('/api/enterprise/orders', enterpriseCompatAuth, async (req, res) => {
    try {
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      const normalizedItems = items.map((item) => {
        const qty = enterpriseCompatNumber(item.qty ?? item.quantity, 1);
        const unitPrice = enterpriseCompatNumber(item.unitPrice ?? item.price, 0);
        return {
          productId: String(item.productId || ''),
          sellerId: String(item.sellerId || req.body?.manufacturer || req.enterprisePartner?.requestId || 'enterprise'),
          name: String(item.name || item.nome || item.sku || 'Produto Enterprise'),
          sku: String(item.sku || ''),
          qty,
          unitPrice,
          totalPrice: qty * unitPrice
        };
      });

      const subtotal = normalizedItems.reduce((sum, item) => sum + Number(item.totalPrice || 0), 0);
      const order = await Order.create({
        sellerIds: Array.from(new Set(normalizedItems.map((i) => i.sellerId).filter(Boolean))),
        customerName: String(req.body?.customerName || req.body?.customer?.name || 'Cliente Enterprise'),
        customerEmail: String(req.body?.customerEmail || req.body?.customer?.email || ''),
        customerPhone: String(req.body?.customerPhone || req.body?.customer?.phone || ''),
        status: 'enterprise_recebido',
        statusLabel: 'Pedido Enterprise recebido',
        items: normalizedItems,
        subtotal,
        total: subtotal,
        currency: DEFAULT_CURRENCY,
        shippingAddress: req.body?.shippingAddress || req.body?.customer?.shippingAddress || {},
        manufacturer: String(req.body?.manufacturer || req.enterprisePartner?.requestId || 'enterprise'),
        manufacturerDispatch: {
          source: 'api_enterprise',
          externalOrderId: String(req.body?.externalOrderId || req.body?.orderId || ''),
          payload: req.body,
          receivedAt: new Date()
        },
        status_integracao: String(req.body?.externalOrderId || req.body?.orderId || '')
      });

      return res.status(201).json({
        ok: true,
        orderId: String(order._id),
        externalOrderId: req.body?.externalOrderId || req.body?.orderId || '',
        status: order.status
      });
    } catch (error) {
      console.error('[enterprise/orders] erro:', error.message || error);
      return res.status(400).json({ ok: false, error: error.message || 'Erro ao receber pedido Enterprise' });
    }
  });

  // ============================================================
  // PASSO 43 - PEDIDOS ENTERPRISE: detalhes, status, NF-e,
  // rastreamento e cancelamento sem alterar rotas já homologadas.
  // Aceita Bearer Token do parceiro (portal) ou x-ariana-key.
  // ============================================================
  // Extraído para routes/enterprise/shared/order.js sem alterar regras ou respostas: enterpriseOrderOperationAuth

  // ============================================================
  // ENTERPRISE XML - módulo incremental
  // Rotas adicionadas sem alterar as rotas Enterprise já homologadas.
  // ============================================================

  app.get('/api/enterprise/orders/:orderId', enterpriseOrderOperationAuth, async (req, res) => {
    try {
      const order = await enterpriseCompatFindOrder(req.params.orderId);
      if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado' });

      return res.json({
        ok: true,
        order: enterpriseNormalizeOrderForResponse(order)
      });
    } catch (error) {
      console.error('[enterprise/orders/:orderId] erro:', error.message || error);
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao consultar pedido Enterprise' });
    }
  });

  app.post('/api/enterprise/orders/:orderId/status', enterpriseOrderOperationAuth, async (req, res) => {
    try {
      const order = await enterpriseCompatFindOrder(req.params.orderId);
      if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para atualizar status' });

      const status = String(req.body?.status || req.body?.code || req.body?.newStatus || '').trim();
      if (!status) return res.status(400).json({ ok: false, error: 'Status obrigatório' });

      const statusLabel = String(req.body?.statusLabel || req.body?.label || enterpriseStatusLabel(status)).trim();
      const nowDate = new Date();

      order.status = status;
      order.statusLabel = statusLabel;
      order.manufacturerDispatch = {
        ...(order.manufacturerDispatch || {}),
        lastStatusUpdate: {
          status,
          statusLabel,
          message: String(req.body?.message || req.body?.observacao || ''),
          payload: req.body || {},
          receivedAt: nowDate
        },
        lastStatusReceivedAt: nowDate
      };

      await order.save();

      await IntegrationAuditLog.create({
        scope: 'enterprise',
        eventType: 'enterprise_order_status_updated',
        orderId: String(order._id || ''),
        manufacturer: order.manufacturer || req.enterprisePartner?.requestId || '',
        status: 'success',
        statusCode: 200,
        message: `Status Enterprise atualizado para ${status}`,
        request: redact(req.body || {}),
        response: { ok: true, orderId: String(order._id || ''), status, statusLabel },
        metadata: {
          source: 'api_enterprise',
          environment: req.enterprisePartner?.environment || 'sandbox'
        }
      }).catch(() => null);

      return res.json({
        ok: true,
        action: 'status_updated',
        orderId: String(order._id),
        status: order.status,
        statusLabel: order.statusLabel,
        order: enterpriseNormalizeOrderForResponse(order)
      });
    } catch (error) {
      console.error('[enterprise/orders/:orderId/status] erro:', error.message || error);
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao atualizar status Enterprise' });
    }
  });

  app.post('/api/enterprise/orders/:orderId/cancel', enterpriseOrderOperationAuth, async (req, res) => {
    try {
      const order = await enterpriseCompatFindOrder(req.params.orderId);
      if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para cancelar' });

      const reason = String(req.body?.reason || req.body?.motivo || req.body?.message || 'Cancelado pelo fabricante').trim();
      const nowDate = new Date();

      order.status = 'enterprise_cancelado';
      order.statusLabel = 'Pedido cancelado pelo Enterprise';
      order.manufacturerDispatch = {
        ...(order.manufacturerDispatch || {}),
        cancellation: {
          reason,
          payload: req.body || {},
          receivedAt: nowDate
        },
        cancelledAt: nowDate
      };
      order.status_integracao = order.status_integracao || 'cancelled';

      await order.save();

      await IntegrationAuditLog.create({
        scope: 'enterprise',
        eventType: 'enterprise_order_cancelled',
        orderId: String(order._id || ''),
        manufacturer: order.manufacturer || req.enterprisePartner?.requestId || '',
        status: 'success',
        statusCode: 200,
        message: reason,
        request: redact(req.body || {}),
        response: { ok: true, orderId: String(order._id || ''), status: order.status },
        metadata: {
          source: 'api_enterprise',
          environment: req.enterprisePartner?.environment || 'sandbox'
        }
      }).catch(() => null);

      return res.json({
        ok: true,
        action: 'order_cancelled',
        orderId: String(order._id),
        status: order.status,
        statusLabel: order.statusLabel,
        reason,
        order: enterpriseNormalizeOrderForResponse(order)
      });
    } catch (error) {
      console.error('[enterprise/orders/:orderId/cancel] erro:', error.message || error);
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao cancelar pedido Enterprise' });
    }
  });

  // Aliases compatíveis com testes anteriores e alguns SDKs/portais.
  app.post('/api/enterprise/order/status', enterpriseOrderOperationAuth, async (req, res) => {
    req.params.orderId = String(req.body?.orderId || req.body?.id || req.body?.externalOrderId || '').trim();
    if (!req.params.orderId) return res.status(400).json({ ok: false, error: 'orderId obrigatório' });

    try {
      const order = await enterpriseCompatFindOrder(req.params.orderId);
      if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para atualizar status' });

      const status = String(req.body?.status || req.body?.code || req.body?.newStatus || '').trim();
      if (!status) return res.status(400).json({ ok: false, error: 'Status obrigatório' });

      const statusLabel = String(req.body?.statusLabel || req.body?.label || enterpriseStatusLabel(status)).trim();
      const nowDate = new Date();
      order.status = status;
      order.statusLabel = statusLabel;
      order.manufacturerDispatch = {
        ...(order.manufacturerDispatch || {}),
        lastStatusUpdate: { status, statusLabel, message: String(req.body?.message || ''), payload: req.body || {}, receivedAt: nowDate },
        lastStatusReceivedAt: nowDate
      };
      await order.save();
      return res.json({ ok: true, action: 'status_updated', orderId: String(order._id), status: order.status, statusLabel: order.statusLabel, order: enterpriseNormalizeOrderForResponse(order) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao atualizar status Enterprise' });
    }
  });

  // Extraído para routes/enterprise/invoiceRoutes.js sem alterar endpoints: app.post('/api/enterprise/invoice', enterpriseOrderOperationAuth, async (req, res) => {



  app.post('/api/enterprise/order/cancel', enterpriseOrderOperationAuth, async (req, res) => {
    const orderId = String(req.body?.orderId || req.body?.id || req.body?.externalOrderId || '').trim();
    if (!orderId) return res.status(400).json({ ok: false, error: 'orderId obrigatório' });

    try {
      const order = await enterpriseCompatFindOrder(orderId);
      if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para cancelar' });

      const reason = String(req.body?.reason || req.body?.motivo || req.body?.message || 'Cancelado pelo fabricante').trim();
      order.status = 'enterprise_cancelado';
      order.statusLabel = 'Pedido cancelado pelo Enterprise';
      order.status_integracao = 'cancelled';
      order.manufacturerDispatch = { ...(order.manufacturerDispatch || {}), cancellation: { reason, payload: req.body || {}, receivedAt: new Date() }, cancelledAt: new Date() };
      await order.save();

      return res.json({ ok: true, action: 'order_cancelled', orderId: String(order._id), status: order.status, statusLabel: order.statusLabel, reason, order: enterpriseNormalizeOrderForResponse(order) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao cancelar pedido Enterprise' });
    }
  });
}
