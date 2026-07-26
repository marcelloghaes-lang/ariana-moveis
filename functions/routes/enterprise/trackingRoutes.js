// ============================================================
// ENTERPRISE TRACKING ROUTES - ARIANA MÓVEIS
// Extraído de routes/enterpriseRoutes.js sem alterar endpoints, regras ou respostas.
// ============================================================

export default function registerEnterpriseTrackingRoutes(app, context = {}) {
  const {
    enterpriseCompatAuth,
    enterpriseOrderOperationAuth,
    enterpriseCompatFindOrder,
    enterpriseNormalizeOrderForResponse,
    LogisticsLabel
  } = context;

app.post('/api/enterprise/orders/:orderId/tracking', enterpriseCompatAuth, async (req, res) => {
  try {
    const order = await enterpriseCompatFindOrder(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para atualizar rastreio' });

    const trackingCode = String(req.body?.trackingCode || req.body?.codigoRastreio || req.body?.rastreio || '').trim();
    order.trackingCode = trackingCode || order.trackingCode;
    order.trackingHistory = Array.isArray(order.trackingHistory) ? order.trackingHistory : [];
    order.trackingHistory.push({
      status: 'Rastreio recebido via Enterprise',
      trackingCode,
      carrier: req.body?.carrier || req.body?.transportadora || '',
      trackingUrl: req.body?.trackingUrl || req.body?.urlRastreio || '',
      at: new Date()
    });
    order.status = 'enterprise_rastreio_recebido';
    order.statusLabel = 'Rastreio recebido';
    order.manufacturerDispatch = {
      ...(order.manufacturerDispatch || {}),
      tracking: req.body,
      trackingReceivedAt: new Date()
    };
    await order.save();

    return res.json({ ok: true, orderId: String(order._id), trackingCode: order.trackingCode, status: order.status });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message || 'Erro ao atualizar rastreio' });
  }
});

app.post('/api/enterprise/tracking', enterpriseOrderOperationAuth, async (req, res) => {
  const orderId = String(req.body?.orderId || req.body?.id || req.body?.externalOrderId || '').trim();
  if (!orderId) return res.status(400).json({ ok: false, error: 'orderId obrigatório' });

  try {
    const order = await enterpriseCompatFindOrder(orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para atualizar rastreio' });

    const trackingCode = String(req.body?.trackingCode || req.body?.codigoRastreio || req.body?.code || '').trim();
    if (!trackingCode) return res.status(400).json({ ok: false, error: 'trackingCode obrigatório' });

    const tracking = {
      trackingCode,
      carrier: req.body?.carrier || req.body?.transportadora || '',
      trackingUrl: req.body?.trackingUrl || req.body?.urlRastreio || '',
      status: req.body?.status || 'enviado',
      at: new Date()
    };

    order.trackingCode = trackingCode;
    order.trackingHistory = Array.isArray(order.trackingHistory) ? order.trackingHistory : [];
    order.trackingHistory.push({ status: 'Rastreio recebido via Enterprise', ...tracking });
    order.status = 'enterprise_rastreio_recebido';
    order.statusLabel = 'Rastreio recebido';
    order.status_integracao = 'tracking_received';
    order.manufacturerDispatch = { ...(order.manufacturerDispatch || {}), tracking: req.body || tracking, trackingReceivedAt: new Date() };
    await order.save();

    return res.json({ ok: true, action: 'tracking_updated', orderId: String(order._id), trackingCode: order.trackingCode, status: order.status, tracking, order: enterpriseNormalizeOrderForResponse(order) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao atualizar rastreio Enterprise' });
  }
});


// ============================================================
// CONSULTA DE RASTREIO / ETIQUETA - COMPATIBILIDADE ENTERPRISE
// ============================================================
function enterpriseNormalizeTracking(order = {}) {
  const dispatch = order.manufacturerDispatch || {};
  const current = dispatch.tracking || {};
  const history = Array.isArray(order.trackingHistory) ? order.trackingHistory : [];
  return {
    trackingCode: String(order.trackingCode || current.trackingCode || current.codigoRastreio || current.rastreio || '').trim(),
    carrier: String(current.carrier || current.transportadora || current.shippingCarrier || '').trim(),
    trackingUrl: String(current.trackingUrl || current.urlRastreio || current.url || '').trim(),
    status: String(current.status || order.status || '').trim(),
    statusLabel: String(order.statusLabel || '').trim(),
    receivedAt: dispatch.trackingReceivedAt || null,
    history
  };
}

app.get('/api/enterprise/orders/:orderId/tracking', enterpriseCompatAuth, async (req, res) => {
  try {
    const order = await enterpriseCompatFindOrder(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para consultar rastreio' });
    const tracking = enterpriseNormalizeTracking(order);
    return res.json({ ok: true, orderId: String(order._id), tracking, hasTracking: Boolean(tracking.trackingCode || tracking.carrier || tracking.trackingUrl || tracking.history.length) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao consultar rastreio Enterprise' });
  }
});

app.get('/api/enterprise/tracking', enterpriseOrderOperationAuth, async (req, res) => {
  const orderId = String(req.query.orderId || req.query.id || req.query.externalOrderId || '').trim();
  if (!orderId) return res.status(400).json({ ok: false, error: 'orderId obrigatório' });
  try {
    const order = await enterpriseCompatFindOrder(orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para consultar rastreio' });
    const tracking = enterpriseNormalizeTracking(order);
    return res.json({ ok: true, orderId: String(order._id), tracking, hasTracking: Boolean(tracking.trackingCode || tracking.carrier || tracking.trackingUrl || tracking.history.length) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao consultar rastreio Enterprise' });
  }
});

function enterprisePickLabelFromOrder(order = {}, labelDoc = null) {
  const dispatch = order.manufacturerDispatch || {};
  const direct = dispatch.label || dispatch.shippingLabel || order.shippingLabel || order.label || null;
  const doc = labelDoc && typeof labelDoc.toObject === 'function' ? labelDoc.toObject() : labelDoc;
  const label = direct || doc || null;
  if (!label) return null;
  return {
    labelId: String(label.labelId || label.etiquetaId || label.id || label._id || '').trim(),
    provider: String(label.provider || label.carrier || label.transportadora || '').trim(),
    trackingCode: String(label.trackingCode || label.codigoRastreio || label.rastreio || '').trim(),
    labelUrl: String(label.labelUrl || label.url || label.pdfUrl || label.etiquetaUrl || '').trim(),
    pdfUrl: String(label.pdfUrl || label.labelUrl || label.url || '').trim(),
    status: String(label.status || '').trim(),
    raw: label
  };
}

app.get('/api/enterprise/orders/:orderId/label', enterpriseCompatAuth, async (req, res) => {
  try {
    const order = await enterpriseCompatFindOrder(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para consultar etiqueta' });
    const orderIdString = String(order._id || '').trim();

const labelDoc = LogisticsLabel
  ? await LogisticsLabel.findOne({
      $or: [
        { orderId: orderIdString },
        { orderId: order._id },
        { orderId: req.params.orderId },
        { 'order._id': orderIdString },
        { 'order.id': orderIdString }
      ]
    })
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean()
      .catch(() => null)
  : null;
    const label = enterprisePickLabelFromOrder(order, labelDoc);
    if (!label) return res.status(404).json({ ok: false, error: 'Etiqueta ainda não foi gerada para este pedido' });
    if ((req.query.download === '1' || req.query.redirect === 'true') && (label.labelUrl || label.pdfUrl)) return res.redirect(label.labelUrl || label.pdfUrl);
    return res.json({ ok: true, orderId: String(order._id), label, hasLabel: true });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao consultar etiqueta Enterprise' });
  }
});

}
