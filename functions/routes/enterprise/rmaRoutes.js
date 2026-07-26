// ============================================================
// ENTERPRISE RMA ROUTES - ARIANA MÓVEIS
// Extraído de routes/enterpriseRoutes.js sem alterar endpoints, regras ou respostas.
// ============================================================

export default function registerEnterpriseRmaRoutes(app, context = {}) {
  const {
    DEFAULT_CURRENCY,
    EnterpriseRmaRecord,
    IntegrationAuditLog,
    crypto,
    mongoose,
    enterpriseOrderOperationAuth,
    enterpriseCompatFindOrder,
    enterpriseNormalizeOrderForResponse,
    escapeRegex,
    redact,
    toJSON
  } = context;

function enterpriseRmaGenerateId(orderId = '') {
  const shortOrder = String(orderId || '').replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase() || 'ORDER';
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `RMA-${shortOrder}-${stamp}-${rand}`;
}

function enterpriseRmaNormalizeItems(items = [], order = {}) {
  const orderItems = Array.isArray(order?.items) ? order.items : [];
  const incomingItems = Array.isArray(items) ? items : (items ? [items] : []);
  if (!incomingItems.length) return [];

  return incomingItems.map((item = {}) => {
    const sku = String(item.sku || item.productSku || item.codigo || '').trim();
    const productId = String(item.productId || item.id || '').trim();
    const matched = orderItems.find((orderItem) => (
      (sku && String(orderItem.sku || '').trim() === sku) ||
      (productId && String(orderItem.productId || '').trim() === productId)
    )) || {};

    const qty = Number(item.qty ?? item.quantity ?? item.quantidade ?? 1) || 1;
    const unitPrice = Number(item.unitPrice ?? item.price ?? item.valorUnitario ?? matched.unitPrice ?? 0) || 0;

    return {
      productId: productId || String(matched.productId || ''),
      sku: sku || String(matched.sku || ''),
      name: String(item.name || item.nome || matched.name || '').trim(),
      qty,
      quantity: qty,
      unitPrice,
      totalPrice: Number(item.totalPrice ?? item.total ?? (qty * unitPrice)) || 0,
      reason: String(item.reason || item.motivo || '').trim(),
      condition: String(item.condition || item.condicao || '').trim(),
      raw: item
    };
  });
}

function enterpriseRmaNormalizePayload(input = {}, order = {}, existing = null) {
  const source = input && typeof input === 'object' ? input : {};
  const rma = source.rma || source.return || source.devolucao || source;
  const existingObj = existing ? toJSON(existing) : {};
  const items = enterpriseRmaNormalizeItems(rma.items || rma.itens || rma.products || existingObj.items || [], order);
  const amountRaw = rma.amount ?? rma.value ?? rma.valor ?? rma.total ?? existingObj.amount ?? items.reduce((sum, item) => sum + Number(item.totalPrice || 0), 0);
  const amount = Number(String(amountRaw).replace(/R\$/gi, '').replace(/\s+/g, '').replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '')) || 0;

  return {
    status: String(rma.status || source.status || existingObj.status || 'opened').trim() || 'opened',
    type: String(rma.type || rma.tipo || source.type || existingObj.type || 'return').trim() || 'return',
    reason: String(rma.reason || rma.motivo || source.reason || existingObj.reason || '').trim(),
    reasonCode: String(rma.reasonCode || rma.codigoMotivo || source.reasonCode || existingObj.reasonCode || '').trim(),
    authorizationCode: String(rma.authorizationCode || rma.authCode || rma.codigoAutorizacao || existingObj.authorizationCode || '').trim(),
    customerName: String(rma.customerName || source.customerName || order.customerName || existingObj.customerName || '').trim(),
    customerEmail: String(rma.customerEmail || source.customerEmail || order.customerEmail || existingObj.customerEmail || '').trim(),
    customerPhone: String(rma.customerPhone || source.customerPhone || order.customerPhone || existingObj.customerPhone || '').trim(),
    items,
    amount,
    currency: String(rma.currency || source.currency || order.currency || existingObj.currency || DEFAULT_CURRENCY).trim() || DEFAULT_CURRENCY,
    pickupRequired: rma.pickupRequired === true || rma.requiresPickup === true || rma.coleta === true || existingObj.pickupRequired === true,
    pickup: rma.pickup || rma.coletaDados || source.pickup || existingObj.pickup || null,
    reverseLogistics: rma.reverseLogistics || rma.logisticaReversa || source.reverseLogistics || existingObj.reverseLogistics || null,
    attachments: Array.isArray(rma.attachments || rma.anexos) ? (rma.attachments || rma.anexos) : (Array.isArray(existingObj.attachments) ? existingObj.attachments : []),
    notes: String(rma.notes || rma.observacoes || source.notes || existingObj.notes || '').trim(),
    raw: source
  };
}

function enterpriseRmaNormalizeResponse(doc = {}) {
  const obj = toJSON(doc) || {};
  return {
    id: String(obj.id || obj._id || ''),
    rmaId: String(obj.rmaId || ''),
    orderId: String(obj.orderId || ''),
    manufacturer: String(obj.manufacturer || ''),
    partnerRequestId: String(obj.partnerRequestId || ''),
    environment: String(obj.environment || 'sandbox'),
    status: String(obj.status || ''),
    type: String(obj.type || ''),
    reason: String(obj.reason || ''),
    reasonCode: String(obj.reasonCode || ''),
    authorizationCode: String(obj.authorizationCode || ''),
    customerName: String(obj.customerName || ''),
    customerEmail: String(obj.customerEmail || ''),
    customerPhone: String(obj.customerPhone || ''),
    items: Array.isArray(obj.items) ? obj.items : [],
    amount: Number(obj.amount || 0),
    currency: String(obj.currency || DEFAULT_CURRENCY),
    pickupRequired: obj.pickupRequired === true,
    pickup: obj.pickup || null,
    reverseLogistics: obj.reverseLogistics || null,
    attachments: Array.isArray(obj.attachments) ? obj.attachments : [],
    notes: String(obj.notes || ''),
    createdAt: obj.createdAt || null,
    updatedAt: obj.updatedAt || null,
    closedAt: obj.closedAt || null,
    history: Array.isArray(obj.history) ? obj.history : []
  };
}

async function enterpriseFindRmaRecord(orderId, rmaId) {
  const id = String(rmaId || '').trim();
  const or = [{ rmaId: id }];
  if (mongoose.Types.ObjectId.isValid(id)) or.push({ _id: new mongoose.Types.ObjectId(id) });
  return EnterpriseRmaRecord.findOne({ orderId: String(orderId), $or: or });
}

async function enterpriseRmaUpsert(order, payload = {}, req = {}, action = 'enterprise_rma_opened', existing = null) {
  const orderId = String(order._id);
  const partner = req.enterprisePartner || {};
  const manufacturer = String(partner.companyName || partner.tradeName || order.manufacturer || order.manufacturerDispatch?.payload?.manufacturer || 'ariana_demo').trim() || 'ariana_demo';
  const normalized = enterpriseRmaNormalizePayload(payload, order, existing);
  const rmaId = String(existing?.rmaId || normalized.raw?.rmaId || normalized.raw?.rmaNumber || enterpriseRmaGenerateId(orderId)).trim();

  if (!normalized.reason && action === 'enterprise_rma_opened') {
    const error = new Error('Informe reason/motivo para abrir o RMA');
    error.statusCode = 400;
    throw error;
  }

  const event = {
    action,
    status: normalized.status,
    at: new Date(),
    by: partner.requestId || 'enterprise_api',
    reason: normalized.reason,
    payload: redact(normalized.raw || {})
  };

  const setPayload = {
    orderId,
    orderObjectId: order._id,
    manufacturer,
    partnerRequestId: partner.requestId || '',
    environment: partner.environment || 'sandbox',
    status: normalized.status,
    type: normalized.type,
    reason: normalized.reason,
    reasonCode: normalized.reasonCode,
    authorizationCode: normalized.authorizationCode || rmaId,
    customerName: normalized.customerName,
    customerEmail: normalized.customerEmail,
    customerPhone: normalized.customerPhone,
    items: normalized.items,
    amount: normalized.amount,
    currency: normalized.currency,
    pickupRequired: normalized.pickupRequired,
    pickup: normalized.pickup,
    reverseLogistics: normalized.reverseLogistics,
    attachments: normalized.attachments,
    notes: normalized.notes,
    payload: normalized.raw
  };

  if (['closed', 'cancelled', 'rejected', 'completed', 'finished'].includes(String(normalized.status).toLowerCase())) {
    setPayload.closedAt = new Date();
  }

  const record = await EnterpriseRmaRecord.findOneAndUpdate(
    { rmaId, orderId },
    { $set: setPayload, $setOnInsert: { rmaId }, $push: { history: event } },
    { upsert: true, new: true }
  );

  const rmaResponse = enterpriseRmaNormalizeResponse(record);
  const currentDispatch = order.manufacturerDispatch && typeof order.manufacturerDispatch === 'object' ? order.manufacturerDispatch : {};
  const rmaList = Array.isArray(currentDispatch.rma) ? currentDispatch.rma : [];
  const nextRmaList = [rmaResponse, ...rmaList.filter((item) => String(item?.rmaId || item?.id || '') !== rmaId)].slice(0, 50);

  order.manufacturerDispatch = {
    ...currentDispatch,
    rma: nextRmaList,
    rmaLatest: rmaResponse,
    rmaUpdatedAt: new Date()
  };
  order.status_integracao = 'rma_updated';
  await order.save();

  await IntegrationAuditLog.create({
    scope: 'enterprise',
    eventType: action,
    orderId,
    manufacturer,
    status: 'success',
    statusCode: 200,
    message: 'RMA processado via Enterprise',
    request: normalized.raw,
    response: { ok: true, rma: rmaResponse },
    metadata: {
      source: 'api_enterprise_rma',
      environment: partner.environment || 'sandbox',
      rmaId,
      rmaStatus: normalized.status,
      reason: normalized.reason
    }
  }).catch(() => null);

  return { record, rma: rmaResponse, order };
}

app.post('/api/enterprise/orders/:orderId/rma', enterpriseOrderOperationAuth, async (req, res) => {
  try {
    const order = await enterpriseCompatFindOrder(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para abrir RMA' });

    const result = await enterpriseRmaUpsert(order, req.body || {}, req, 'enterprise_rma_opened');
    return res.status(201).json({
      ok: true,
      action: 'rma_opened',
      orderId: String(result.order._id),
      rma: result.rma,
      order: enterpriseNormalizeOrderForResponse(result.order)
    });
  } catch (error) {
    console.error('[enterprise/orders/:orderId/rma] erro:', error.message || error);
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao abrir RMA Enterprise' });
  }
});

app.get('/api/enterprise/orders/:orderId/rma', enterpriseOrderOperationAuth, async (req, res) => {
  try {
    const order = await enterpriseCompatFindOrder(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para consultar RMA' });

    const items = await EnterpriseRmaRecord.find({ orderId: String(order._id) }).sort({ updatedAt: -1, createdAt: -1 }).lean();
    return res.json({
      ok: true,
      orderId: String(order._id),
      total: items.length,
      rma: items.map(enterpriseRmaNormalizeResponse)
    });
  } catch (error) {
    console.error('[enterprise/orders/:orderId/rma:GET] erro:', error.message || error);
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao consultar RMA Enterprise' });
  }
});

app.get('/api/enterprise/rma', enterpriseOrderOperationAuth, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const filter = {};
    if (req.query.orderId) filter.orderId = String(req.query.orderId).trim();
    if (req.query.rmaId) filter.rmaId = String(req.query.rmaId).trim();
    if (req.query.status) filter.status = String(req.query.status).trim();
    if (req.query.type) filter.type = String(req.query.type).trim();
    if (req.query.manufacturer) filter.manufacturer = new RegExp(escapeRegex(String(req.query.manufacturer).trim()), 'i');
    if (req.query.authorizationCode) filter.authorizationCode = String(req.query.authorizationCode).trim();

    const items = await EnterpriseRmaRecord.find(filter).sort({ updatedAt: -1, createdAt: -1 }).limit(limit).lean();
    const total = await EnterpriseRmaRecord.countDocuments(filter).catch(() => items.length);

    return res.json({
      ok: true,
      total,
      limit,
      filters: {
        orderId: req.query.orderId || '',
        rmaId: req.query.rmaId || '',
        status: req.query.status || '',
        type: req.query.type || '',
        manufacturer: req.query.manufacturer || '',
        authorizationCode: req.query.authorizationCode || ''
      },
      items: items.map(enterpriseRmaNormalizeResponse)
    });
  } catch (error) {
    console.error('[enterprise/rma] erro:', error.message || error);
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar RMA Enterprise' });
  }
});


// Compatibilidade Postman / Etapa 4: atualiza o RMA mais recente do pedido sem exigir rmaId na URL.
// Mantém a rota principal /orders/:orderId/rma/:rmaId intacta.
app.patch('/api/enterprise/orders/:orderId/rma', enterpriseOrderOperationAuth, async (req, res) => {
  try {
    const order = await enterpriseCompatFindOrder(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para atualizar RMA' });

    const requestedRmaId = String(req.body?.rmaId || req.query?.rmaId || '').trim();
    let existing = null;

    if (requestedRmaId) {
      existing = await enterpriseFindRmaRecord(String(order._id), requestedRmaId);
    }

    if (!existing) {
      existing = await EnterpriseRmaRecord
        .findOne({ orderId: String(order._id) })
        .sort({ updatedAt: -1, createdAt: -1 });
    }

    if (!existing) return res.status(404).json({ ok: false, error: 'Nenhum RMA encontrado para este pedido' });

    const payload = {
      ...(toJSON(existing) || {}),
      ...(req.body || {}),
      rmaId: existing.rmaId,
      status: String(req.body?.status || req.body?.situacao || existing.status || '').trim(),
      notes: req.body?.notes || req.body?.observacoes || existing.notes || ''
    };

    const result = await enterpriseRmaUpsert(order, payload, req, 'enterprise_rma_updated', existing);
    return res.json({
      ok: true,
      action: 'rma_updated',
      orderId: String(result.order._id),
      rma: result.rma,
      order: enterpriseNormalizeOrderForResponse(result.order)
    });
  } catch (error) {
    console.error('[enterprise/orders/:orderId/rma:PATCH] erro:', error.message || error);
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao atualizar RMA Enterprise' });
  }
});


app.patch('/api/enterprise/orders/:orderId/rma/:rmaId', enterpriseOrderOperationAuth, async (req, res) => {
  try {
    const order = await enterpriseCompatFindOrder(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para atualizar RMA' });

    const existing = await enterpriseFindRmaRecord(String(order._id), req.params.rmaId);
    if (!existing) return res.status(404).json({ ok: false, error: 'RMA não encontrado para este pedido' });

    const result = await enterpriseRmaUpsert(order, { ...(toJSON(existing) || {}), ...(req.body || {}) }, req, 'enterprise_rma_updated', existing);
    return res.json({
      ok: true,
      action: 'rma_updated',
      orderId: String(result.order._id),
      rma: result.rma,
      order: enterpriseNormalizeOrderForResponse(result.order)
    });
  } catch (error) {
    console.error('[enterprise/orders/:orderId/rma/:rmaId:PATCH] erro:', error.message || error);
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao atualizar RMA Enterprise' });
  }
});

app.post('/api/enterprise/orders/:orderId/rma/:rmaId/status', enterpriseOrderOperationAuth, async (req, res) => {
  try {
    const order = await enterpriseCompatFindOrder(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para atualizar status do RMA' });

    const existing = await enterpriseFindRmaRecord(String(order._id), req.params.rmaId);
    if (!existing) return res.status(404).json({ ok: false, error: 'RMA não encontrado para este pedido' });

    const status = String(req.body?.status || req.body?.situacao || '').trim();
    if (!status) return res.status(400).json({ ok: false, error: 'Informe status para atualizar o RMA' });

    const payload = {
      ...(toJSON(existing) || {}),
      ...(req.body || {}),
      status,
      notes: req.body?.notes || req.body?.observacoes || existing.notes || ''
    };

    const result = await enterpriseRmaUpsert(order, payload, req, 'enterprise_rma_status_updated', existing);
    return res.json({
      ok: true,
      action: 'rma_status_updated',
      orderId: String(result.order._id),
      rma: result.rma,
      order: enterpriseNormalizeOrderForResponse(result.order)
    });
  } catch (error) {
    console.error('[enterprise/orders/:orderId/rma/:rmaId/status] erro:', error.message || error);
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao atualizar status do RMA Enterprise' });
  }
});


// ============================================================
// ALIASES RMA / COLETA REVERSA - COMPATIBILIDADE ENTERPRISE
// ============================================================
app.post('/api/enterprise/rma', enterpriseOrderOperationAuth, async (req, res) => {
  const orderId = String(req.body?.orderId || req.body?.id || req.body?.externalOrderId || '').trim();
  if (!orderId) return res.status(400).json({ ok: false, error: 'orderId obrigatório' });
  try {
    const order = await enterpriseCompatFindOrder(orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para abrir RMA' });
    const result = await enterpriseRmaUpsert(order, req.body || {}, req, 'enterprise_rma_opened');
    return res.status(201).json({ ok: true, action: 'rma_opened', orderId: String(result.order._id), rma: result.rma, order: enterpriseNormalizeOrderForResponse(result.order) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao abrir RMA Enterprise' });
  }
});

app.post('/api/enterprise/reverse-pickup', enterpriseOrderOperationAuth, async (req, res) => {
  const orderId = String(req.body?.orderId || req.body?.id || req.body?.externalOrderId || '').trim();
  if (!orderId) return res.status(400).json({ ok: false, error: 'orderId obrigatório' });
  try {
    const order = await enterpriseCompatFindOrder(orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para solicitar coleta reversa' });
    const payload = { ...(req.body || {}), pickupRequired: true, reverseLogistics: req.body?.reverseLogistics || req.body?.coleta || req.body || {}, type: req.body?.type || 'reverse_pickup', reason: req.body?.reason || req.body?.motivo || 'Coleta reversa solicitada' };
    const result = await enterpriseRmaUpsert(order, payload, req, 'enterprise_reverse_pickup_requested');
    return res.status(201).json({ ok: true, action: 'reverse_pickup_requested', orderId: String(result.order._id), pickup: result.rma.pickup || null, reverseLogistics: result.rma.reverseLogistics || null, rma: result.rma, order: enterpriseNormalizeOrderForResponse(result.order) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao solicitar coleta reversa Enterprise' });
  }
});

app.post('/api/enterprise/orders/:orderId/reverse-pickup', enterpriseOrderOperationAuth, async (req, res) => {
  req.body = { ...(req.body || {}), orderId: req.params.orderId };
  const order = await enterpriseCompatFindOrder(req.params.orderId).catch(() => null);
  if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para solicitar coleta reversa' });
  try {
    const payload = { ...(req.body || {}), pickupRequired: true, reverseLogistics: req.body?.reverseLogistics || req.body?.coleta || req.body || {}, type: req.body?.type || 'reverse_pickup', reason: req.body?.reason || req.body?.motivo || 'Coleta reversa solicitada' };
    const result = await enterpriseRmaUpsert(order, payload, req, 'enterprise_reverse_pickup_requested');
    return res.status(201).json({ ok: true, action: 'reverse_pickup_requested', orderId: String(result.order._id), pickup: result.rma.pickup || null, reverseLogistics: result.rma.reverseLogistics || null, rma: result.rma, order: enterpriseNormalizeOrderForResponse(result.order) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao solicitar coleta reversa Enterprise' });
  }
});

}
