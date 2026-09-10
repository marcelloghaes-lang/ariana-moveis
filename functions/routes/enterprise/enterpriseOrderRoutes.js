// ============================================================
// ENTERPRISE ORDER ROUTES - ARIANA MÓVEIS
// Pedidos com idempotência resiliente a timeout/restart.
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
    EnterpriseSandboxOrder,
    enterpriseOrderModelForPartner,
    EnterpriseIdempotencyRecord,
    crypto,
    IntegrationAuditLog,
    redact
  } = context;

  function orderRequestHash(body = {}, normalizedItems = [], externalOrderId = '') {
    return crypto.createHash('sha256').update(JSON.stringify({
      externalOrderId,
      customerName: body?.customerName || body?.customer?.name || '',
      customerEmail: body?.customerEmail || body?.customer?.email || '',
      items: normalizedItems.map((item) => ({ sku: item.sku, qty: item.qty, unitPrice: item.unitPrice }))
    })).digest('hex');
  }

  function normalizedItemsFromStoredOrder(order = {}) {
    const items = Array.isArray(order.items) ? order.items : [];
    return items.map((item) => ({
      sku: String(item.sku || item.productSku || ''),
      qty: Number(item.qty ?? item.quantity ?? 0),
      unitPrice: Number(item.unitPrice ?? item.price ?? 0)
    }));
  }

  app.post('/api/enterprise/orders', enterpriseCompatAuth, async (req, res) => {
    let idempotencyClaim = null;
    try {
      const partner = req.enterprisePartner || {};
      const environment = String(partner.environment || 'sandbox').toLowerCase() === 'production' ? 'production' : 'sandbox';
      const partnerSellerId = String(partner.requestId || partner.id || '').trim();
      const manufacturer = String(partnerSellerId || req.body?.manufacturer || 'enterprise');
      const externalOrderId = String(req.body?.externalOrderId || req.body?.orderId || '').trim();
      const headerIdempotencyKey = String(req.headers['idempotency-key'] || req.headers['x-idempotency-key'] || '').trim();
      const canonicalIdempotencyKey = externalOrderId ? `external:${externalOrderId}` : (headerIdempotencyKey ? `header:${headerIdempotencyKey}` : '');

      if (!canonicalIdempotencyKey) {
        return res.status(400).json({ ok: false, error: 'Informe externalOrderId/orderId ou o header Idempotency-Key para criar pedidos Enterprise com segurança.' });
      }

      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      if (!items.length) return res.status(400).json({ ok: false, error: 'Pedido precisa conter ao menos um item' });
      if (items.length > 200) return res.status(413).json({ ok: false, error: 'Máximo de 200 itens por pedido Enterprise' });

      const validationErrors = [];
      const normalizedItems = items.map((item, index) => {
        const sku = String(item.sku || item.productSku || '').trim();
        const qty = enterpriseCompatNumber(item.qty ?? item.quantity, NaN);
        const unitPrice = enterpriseCompatNumber(item.unitPrice ?? item.price, NaN);
        if (!sku) validationErrors.push({ index, field: 'sku', error: 'sku_required' });
        if (!Number.isFinite(qty) || qty <= 0 || !Number.isInteger(qty)) validationErrors.push({ index, field: 'qty', error: 'invalid_quantity' });
        if (!Number.isFinite(unitPrice) || unitPrice < 0) validationErrors.push({ index, field: 'unitPrice', error: 'invalid_unit_price' });
        return {
          productId: String(item.productId || ''),
          sellerId: manufacturer,
          name: String(item.name || item.nome || sku || 'Produto Enterprise'),
          sku,
          qty: Number.isFinite(qty) ? qty : 0,
          unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
          totalPrice: Number.isFinite(qty) && Number.isFinite(unitPrice) ? qty * unitPrice : 0
        };
      });
      if (validationErrors.length) return res.status(422).json({ ok: false, error: 'Pedido Enterprise contém itens inválidos', details: validationErrors });

      const OrderModel = enterpriseOrderModelForPartner(partner);
      const requestHash = orderRequestHash(req.body, normalizedItems, externalOrderId);
      const keyHash = crypto.createHash('sha256')
        .update(['enterprise_order', environment, partnerSellerId || partner.id || 'partner', canonicalIdempotencyKey].join(':'))
        .digest('hex');

      // 1) Registro de idempotência já concluído: devolve exatamente a resposta anterior.
      let existingClaim = await EnterpriseIdempotencyRecord.findOne({ keyHash }).lean();
      if (existingClaim?.requestHash && existingClaim.requestHash !== requestHash) {
        return res.status(409).json({ ok: false, error: 'Idempotency-Key/externalOrderId já utilizado com payload diferente' });
      }
      if (existingClaim?.status === 'completed' && existingClaim?.response) {
        return res.status(200).json({ ...existingClaim.response, idempotentReplay: true });
      }

      // 2) Recuperação após crash entre Order.create e conclusão do registro idempotente.
      let existingOrder = await OrderModel.findOne({
        manufacturer,
        'manufacturerDispatch.idempotencyKeyHash': keyHash
      });

      // Compatibilidade com pedidos criados por versões anteriores, antes do hash persistido.
      if (!existingOrder && externalOrderId) {
        existingOrder = await OrderModel.findOne({ manufacturer, 'manufacturerDispatch.externalOrderId': externalOrderId });
        if (existingOrder) {
          const storedPayload = existingOrder.manufacturerDispatch?.payload || {};
          const storedExternal = String(existingOrder.manufacturerDispatch?.externalOrderId || externalOrderId);
          const storedItems = normalizedItemsFromStoredOrder(existingOrder);
          const storedHash = orderRequestHash(storedPayload, storedItems, storedExternal);
          if (storedHash !== requestHash) {
            return res.status(409).json({ ok: false, error: 'externalOrderId já existe com conteúdo diferente' });
          }
        }
      }

      if (existingOrder) {
        const replay = {
          ok: true,
          orderId: String(existingOrder._id),
          externalOrderId,
          status: existingOrder.status,
          environment
        };
        await EnterpriseIdempotencyRecord.findOneAndUpdate(
          { keyHash },
          {
            $set: {
              partnerId: partnerSellerId || String(partner.id || ''),
              environment,
              externalOrderId,
              requestHash,
              status: 'completed',
              orderId: String(existingOrder._id),
              response: replay,
              completedAt: new Date(),
              lastError: ''
            }
          },
          { upsert: true, new: true }
        ).catch(() => null);
        return res.status(200).json({ ...replay, idempotentReplay: true, recoveredAfterRestart: true });
      }

      // 3) Reserva atômica da chave. Um segundo request simultâneo não cria outro pedido.
      if (!existingClaim) {
        try {
          idempotencyClaim = await EnterpriseIdempotencyRecord.create({
            keyHash,
            partnerId: partnerSellerId || String(partner.id || ''),
            environment,
            externalOrderId,
            requestHash,
            status: 'processing'
          });
        } catch (claimError) {
          if (claimError?.code !== 11000) throw claimError;
          existingClaim = await EnterpriseIdempotencyRecord.findOne({ keyHash }).lean();
        }
      }

      if (!idempotencyClaim && existingClaim) {
        if (existingClaim.requestHash && existingClaim.requestHash !== requestHash) {
          return res.status(409).json({ ok: false, error: 'Idempotency-Key já utilizado com payload diferente' });
        }
        const staleBefore = new Date(Date.now() - 5 * 60 * 1000);
        const canRecover = ['failed', 'error'].includes(existingClaim.status) ||
          (existingClaim.status === 'processing' && new Date(existingClaim.updatedAt || existingClaim.createdAt || 0) <= staleBefore);
        if (!canRecover) {
          return res.status(409).json({ ok: false, error: 'Pedido com esta chave de idempotência já está sendo processado. Tente novamente em instantes.' });
        }
        idempotencyClaim = await EnterpriseIdempotencyRecord.findOneAndUpdate(
          {
            keyHash,
            requestHash,
            $or: [
              { status: { $in: ['failed', 'error'] } },
              { status: 'processing', updatedAt: { $lte: staleBefore } }
            ]
          },
          { $set: { status: 'processing', lastError: '', completedAt: null } },
          { new: true }
        );
        if (!idempotencyClaim) return res.status(409).json({ ok: false, error: 'Não foi possível recuperar a chave de idempotência' });
      }

      const subtotal = normalizedItems.reduce((sum, item) => sum + Number(item.totalPrice || 0), 0);
      const order = await OrderModel.create({
        sellerIds: Array.from(new Set(normalizedItems.map((i) => i.sellerId).filter(Boolean))),
        customerName: String(req.body?.customerName || req.body?.customer?.name || 'Cliente Enterprise'),
        customerEmail: String(req.body?.customerEmail || req.body?.customer?.email || ''),
        customerPhone: String(req.body?.customerPhone || req.body?.customer?.phone || ''),
        status: 'enterprise_recebido',
        statusLabel: environment === 'sandbox' ? 'Pedido Enterprise Sandbox recebido' : 'Pedido Enterprise recebido',
        items: normalizedItems,
        subtotal,
        total: subtotal,
        currency: DEFAULT_CURRENCY,
        shippingAddress: req.body?.shippingAddress || req.body?.customer?.shippingAddress || {},
        manufacturer,
        manufacturerDispatch: {
          source: 'api_enterprise',
          environment,
          externalOrderId,
          idempotencyKeyHash: keyHash,
          requestHash,
          payload: req.body,
          receivedAt: new Date()
        },
        status_integracao: externalOrderId
      });

      const responsePayload = { ok: true, orderId: String(order._id), externalOrderId, status: order.status, environment };
      await EnterpriseIdempotencyRecord.updateOne(
        { _id: idempotencyClaim._id },
        { $set: { status: 'completed', orderId: String(order._id), response: responsePayload, completedAt: new Date(), lastError: '' } }
      ).catch(() => null);

      await IntegrationAuditLog.create({
        scope: 'enterprise',
        eventType: 'enterprise_order_created',
        orderId: String(order._id || ''),
        manufacturer: partner.requestId || partner.id || partnerSellerId || '',
        integrationId: String(partner.id || ''),
        status: 'success',
        statusCode: 201,
        message: environment === 'sandbox' ? 'Pedido criado na coleção isolada Sandbox' : 'Pedido criado via Ariana Enterprise API',
        request: redact(req.body || {}),
        response: responsePayload,
        metadata: { source: 'api_enterprise_orders', environment, requestId: partner.requestId || '', externalOrderId, idempotencyKeyHash: keyHash, sandboxIsolated: environment === 'sandbox' }
      }).catch(() => null);

      return res.status(201).json(responsePayload);
    } catch (error) {
      if (idempotencyClaim?._id) {
        await EnterpriseIdempotencyRecord.updateOne(
          { _id: idempotencyClaim._id },
          { $set: { status: 'failed', lastError: String(error.message || 'order_create_failed') } }
        ).catch(() => null);
      }
      console.error('[enterprise/orders] erro:', error.message || error);
      return res.status(400).json({ ok: false, error: error.message || 'Erro ao receber pedido Enterprise' });
    }
  });

  app.get('/api/enterprise/orders/:orderId', enterpriseOrderOperationAuth, async (req, res) => {
    try {
      const order = await enterpriseCompatFindOrder(req.params.orderId, req.enterprisePartner || req.enterprisePortal || {});
      if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado' });
      return res.json({ ok: true, order: enterpriseNormalizeOrderForResponse(order) });
    } catch (error) {
      console.error('[enterprise/orders/:orderId] erro:', error.message || error);
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao consultar pedido Enterprise' });
    }
  });

  app.post('/api/enterprise/orders/:orderId/status', enterpriseOrderOperationAuth, async (req, res) => {
    try {
      const order = await enterpriseCompatFindOrder(req.params.orderId, req.enterprisePartner || req.enterprisePortal || {});
      if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para atualizar status' });
      const status = String(req.body?.status || req.body?.code || req.body?.newStatus || '').trim();
      if (!status) return res.status(400).json({ ok: false, error: 'Status obrigatório' });
      const statusLabel = String(req.body?.statusLabel || req.body?.label || enterpriseStatusLabel(status)).trim();
      const nowDate = new Date();
      order.status = status;
      order.statusLabel = statusLabel;
      order.manufacturerDispatch = {
        ...(order.manufacturerDispatch || {}),
        lastStatusUpdate: { status, statusLabel, message: String(req.body?.message || req.body?.observacao || ''), payload: req.body || {}, receivedAt: nowDate },
        lastStatusReceivedAt: nowDate
      };
      await order.save();
      await IntegrationAuditLog.create({
        scope: 'enterprise', eventType: 'enterprise_order_status_updated', orderId: String(order._id || ''),
        manufacturer: order.manufacturer || req.enterprisePartner?.requestId || '', status: 'success', statusCode: 200,
        message: `Status Enterprise atualizado para ${status}`, request: redact(req.body || {}),
        response: { ok: true, orderId: String(order._id || ''), status, statusLabel },
        metadata: { source: 'api_enterprise', environment: req.enterprisePartner?.environment || 'sandbox' }
      }).catch(() => null);
      return res.json({ ok: true, action: 'status_updated', orderId: String(order._id), status: order.status, statusLabel: order.statusLabel, order: enterpriseNormalizeOrderForResponse(order) });
    } catch (error) {
      console.error('[enterprise/orders/:orderId/status] erro:', error.message || error);
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao atualizar status Enterprise' });
    }
  });

  app.post('/api/enterprise/orders/:orderId/cancel', enterpriseOrderOperationAuth, async (req, res) => {
    try {
      const order = await enterpriseCompatFindOrder(req.params.orderId, req.enterprisePartner || req.enterprisePortal || {});
      if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para cancelar' });
      const reason = String(req.body?.reason || req.body?.motivo || req.body?.message || 'Cancelado pelo fabricante').trim();
      const nowDate = new Date();
      order.status = 'enterprise_cancelado';
      order.statusLabel = 'Pedido cancelado pelo Enterprise';
      order.manufacturerDispatch = { ...(order.manufacturerDispatch || {}), cancellation: { reason, payload: req.body || {}, receivedAt: nowDate }, cancelledAt: nowDate };
      order.status_integracao = 'cancelled';
      await order.save();
      await IntegrationAuditLog.create({
        scope: 'enterprise', eventType: 'enterprise_order_cancelled', orderId: String(order._id || ''),
        manufacturer: order.manufacturer || req.enterprisePartner?.requestId || '', status: 'success', statusCode: 200,
        message: reason, request: redact(req.body || {}), response: { ok: true, orderId: String(order._id || ''), status: order.status },
        metadata: { source: 'api_enterprise', environment: req.enterprisePartner?.environment || 'sandbox' }
      }).catch(() => null);
      return res.json({ ok: true, action: 'order_cancelled', orderId: String(order._id), status: order.status, statusLabel: order.statusLabel, reason, order: enterpriseNormalizeOrderForResponse(order) });
    } catch (error) {
      console.error('[enterprise/orders/:orderId/cancel] erro:', error.message || error);
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao cancelar pedido Enterprise' });
    }
  });

  app.post('/api/enterprise/order/status', enterpriseOrderOperationAuth, async (req, res) => {
    req.params.orderId = String(req.body?.orderId || req.body?.id || req.body?.externalOrderId || '').trim();
    if (!req.params.orderId) return res.status(400).json({ ok: false, error: 'orderId obrigatório' });
    try {
      const order = await enterpriseCompatFindOrder(req.params.orderId, req.enterprisePartner || req.enterprisePortal || {});
      if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para atualizar status' });
      const status = String(req.body?.status || req.body?.code || req.body?.newStatus || '').trim();
      if (!status) return res.status(400).json({ ok: false, error: 'Status obrigatório' });
      const statusLabel = String(req.body?.statusLabel || req.body?.label || enterpriseStatusLabel(status)).trim();
      const nowDate = new Date();
      order.status = status;
      order.statusLabel = statusLabel;
      order.manufacturerDispatch = { ...(order.manufacturerDispatch || {}), lastStatusUpdate: { status, statusLabel, message: String(req.body?.message || ''), payload: req.body || {}, receivedAt: nowDate }, lastStatusReceivedAt: nowDate };
      await order.save();
      return res.json({ ok: true, action: 'status_updated', orderId: String(order._id), status: order.status, statusLabel: order.statusLabel, order: enterpriseNormalizeOrderForResponse(order) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao atualizar status Enterprise' });
    }
  });

  app.post('/api/enterprise/order/cancel', enterpriseOrderOperationAuth, async (req, res) => {
    const orderId = String(req.body?.orderId || req.body?.id || req.body?.externalOrderId || '').trim();
    if (!orderId) return res.status(400).json({ ok: false, error: 'orderId obrigatório' });
    try {
      const order = await enterpriseCompatFindOrder(orderId, req.enterprisePartner || req.enterprisePortal || {});
      if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para cancelar' });
      const reason = String(req.body?.reason || req.body?.motivo || req.body?.message || 'Cancelado pelo fabricante').trim();
      order.status = 'enterprise_cancelado';
      order.statusLabel = 'Pedido cancelado pelo Enterprise';
      order.status_integracao = 'cancelled';
      order.manufacturerDispatch = { ...(order.manufacturerDispatch || {}), cancellation: { reason, payload: req.body || {}, receivedAt: new Date() }, cancelledAt: new Date() };
      await order.save();
      await IntegrationAuditLog.create({
        scope: 'enterprise', eventType: 'enterprise_order_cancelled', orderId: String(order._id || ''),
        manufacturer: order.manufacturer || req.enterprisePartner?.requestId || '', status: 'success', statusCode: 200,
        message: reason, request: redact(req.body || {}), response: { ok: true, orderId: String(order._id || ''), status: order.status },
        metadata: { source: 'api_enterprise', environment: req.enterprisePartner?.environment || 'sandbox' }
      }).catch(() => null);
      return res.json({ ok: true, action: 'order_cancelled', orderId: String(order._id), status: order.status, statusLabel: order.statusLabel, reason, order: enterpriseNormalizeOrderForResponse(order) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao cancelar pedido Enterprise' });
    }
  });
}
