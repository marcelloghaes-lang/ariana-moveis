// ============================================================
// ENTERPRISE OCCURRENCE ROUTES - ARIANA MÓVEIS
// Extraído de routes/enterpriseRoutes.js sem alterar endpoints, regras ou respostas.
// ============================================================

export default function registerEnterpriseOccurrenceRoutes(app, context = {}) {
  const {
    crypto,
    mongoose,
    EnterpriseOccurrenceRecord,
    IntegrationAuditLog,
    enterpriseOrderOperationAuth,
    enterpriseCompatFindOrder,
    enterpriseNormalizeOrderForResponse,
    escapeRegex,
    redact,
    toJSON
  } = context;

function enterpriseOccurrenceGenerateId(orderId = '') {
  const shortOrder = String(orderId || '').replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase() || 'ORDER';
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `OCC-${shortOrder}-${stamp}-${rand}`;
}

function enterpriseOccurrenceNormalizePayload(input = {}, order = {}, existing = null) {
  const source = input && typeof input === 'object' ? input : {};
  const occ = source.occurrence || source.ocorrencia || source.event || source;
  const existingObj = existing ? toJSON(existing) : {};
  const status = String(occ.status || source.status || existingObj.status || 'open').trim() || 'open';
  const occurredAtRaw = occ.occurredAt || occ.dataOcorrencia || source.occurredAt || existingObj.occurredAt || new Date();

  return {
    occurrenceId: String(occ.occurrenceId || occ.id || source.occurrenceId || existingObj.occurrenceId || '').trim(),
    type: String(occ.type || occ.tipo || source.type || existingObj.type || 'general').trim() || 'general',
    status,
    code: String(occ.code || occ.codigo || source.code || existingObj.code || '').trim(),
    title: String(occ.title || occ.titulo || source.title || existingObj.title || '').trim(),
    message: String(occ.message || occ.mensagem || source.message || existingObj.message || '').trim(),
    description: String(occ.description || occ.descricao || source.description || existingObj.description || '').trim(),
    severity: String(occ.severity || occ.gravidade || source.severity || existingObj.severity || 'info').trim() || 'info',
    source: String(occ.source || occ.origem || source.source || existingObj.source || 'enterprise_api').trim() || 'enterprise_api',
    occurredAt: Number.isNaN(new Date(occurredAtRaw).getTime()) ? new Date() : new Date(occurredAtRaw),
    resolvedAt: ['resolved', 'closed', 'done', 'finalized', 'resolvido', 'fechado'].includes(status.toLowerCase()) ? new Date() : (existingObj.resolvedAt || null),
    metadata: occ.metadata || occ.meta || source.metadata || existingObj.metadata || null,
    raw: source
  };
}

function enterpriseOccurrenceNormalizeResponse(doc = {}) {
  const obj = toJSON(doc) || {};
  return {
    id: String(obj.id || obj._id || ''),
    occurrenceId: String(obj.occurrenceId || ''),
    orderId: String(obj.orderId || ''),
    manufacturer: String(obj.manufacturer || ''),
    partnerRequestId: String(obj.partnerRequestId || ''),
    environment: String(obj.environment || 'sandbox'),
    type: String(obj.type || ''),
    status: String(obj.status || ''),
    code: String(obj.code || ''),
    title: String(obj.title || ''),
    message: String(obj.message || ''),
    description: String(obj.description || ''),
    severity: String(obj.severity || ''),
    source: String(obj.source || ''),
    occurredAt: obj.occurredAt || null,
    resolvedAt: obj.resolvedAt || null,
    metadata: obj.metadata || null,
    createdAt: obj.createdAt || null,
    updatedAt: obj.updatedAt || null,
    history: Array.isArray(obj.history) ? obj.history : []
  };
}

async function enterpriseFindOccurrenceRecord(orderId, occurrenceId) {
  const id = String(occurrenceId || '').trim();
  const or = [{ occurrenceId: id }];
  if (mongoose.Types.ObjectId.isValid(id)) or.push({ _id: new mongoose.Types.ObjectId(id) });
  return EnterpriseOccurrenceRecord.findOne({ orderId: String(orderId), $or: or });
}

async function enterpriseOccurrenceUpsert(order, payload = {}, req = {}, action = 'enterprise_occurrence_registered', existing = null) {
  const orderId = String(order._id);
  const partner = req.enterprisePartner || {};
  const manufacturer = String(partner.companyName || partner.tradeName || order.manufacturer || order.manufacturerDispatch?.payload?.manufacturer || 'ariana_demo').trim() || 'ariana_demo';
  const normalized = enterpriseOccurrenceNormalizePayload(payload, order, existing);
  const occurrenceId = String(existing?.occurrenceId || normalized.occurrenceId || enterpriseOccurrenceGenerateId(orderId)).trim();

  if (!normalized.message && !normalized.description && !normalized.title && action === 'enterprise_occurrence_registered') {
    const error = new Error('Informe message/description/title para registrar a ocorrência');
    error.statusCode = 400;
    throw error;
  }

  const event = {
    action,
    status: normalized.status,
    type: normalized.type,
    at: new Date(),
    by: partner.requestId || 'enterprise_api',
    payload: redact(normalized.raw || {})
  };

  const setPayload = {
    orderId,
    orderObjectId: order._id,
    manufacturer,
    partnerRequestId: partner.requestId || '',
    environment: partner.environment || 'sandbox',
    type: normalized.type,
    status: normalized.status,
    code: normalized.code,
    title: normalized.title,
    message: normalized.message,
    description: normalized.description,
    severity: normalized.severity,
    source: normalized.source,
    occurredAt: normalized.occurredAt,
    resolvedAt: normalized.resolvedAt,
    metadata: normalized.metadata,
    payload: normalized.raw
  };

  const record = await EnterpriseOccurrenceRecord.findOneAndUpdate(
    { occurrenceId, orderId },
    { $set: setPayload, $setOnInsert: { occurrenceId }, $push: { history: event } },
    { upsert: true, new: true }
  );

  const occurrenceResponse = enterpriseOccurrenceNormalizeResponse(record);
  const currentDispatch = order.manufacturerDispatch && typeof order.manufacturerDispatch === 'object' ? order.manufacturerDispatch : {};
  const occurrenceList = Array.isArray(currentDispatch.occurrences) ? currentDispatch.occurrences : [];
  const nextOccurrenceList = [occurrenceResponse, ...occurrenceList.filter((item) => String(item?.occurrenceId || item?.id || '') !== occurrenceId)].slice(0, 100);

  order.manufacturerDispatch = {
    ...currentDispatch,
    occurrences: nextOccurrenceList,
    occurrenceLatest: occurrenceResponse,
    occurrenceUpdatedAt: new Date()
  };
  order.status_integracao = 'occurrence_updated';
  await order.save();

  await IntegrationAuditLog.create({
    scope: 'enterprise',
    eventType: action,
    orderId,
    manufacturer,
    status: 'success',
    statusCode: 200,
    message: 'Ocorrência processada via Enterprise',
    request: normalized.raw,
    response: { ok: true, occurrence: occurrenceResponse },
    metadata: {
      source: 'api_enterprise_occurrences',
      environment: partner.environment || 'sandbox',
      occurrenceId,
      occurrenceStatus: normalized.status,
      occurrenceType: normalized.type
    }
  }).catch(() => null);

  return { record, occurrence: occurrenceResponse, order };
}

app.post('/api/enterprise/orders/:orderId/occurrences', enterpriseOrderOperationAuth, async (req, res) => {
  try {
    const order = await enterpriseCompatFindOrder(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para registrar ocorrência' });

    const result = await enterpriseOccurrenceUpsert(order, req.body || {}, req, 'enterprise_occurrence_registered');
    return res.status(201).json({
      ok: true,
      action: 'occurrence_registered',
      orderId: String(result.order._id),
      occurrence: result.occurrence,
      order: enterpriseNormalizeOrderForResponse(result.order)
    });
  } catch (error) {
    console.error('[enterprise/orders/:orderId/occurrences] erro:', error.message || error);
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao registrar ocorrência Enterprise' });
  }
});

app.get('/api/enterprise/orders/:orderId/occurrences', enterpriseOrderOperationAuth, async (req, res) => {
  try {
    const order = await enterpriseCompatFindOrder(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para consultar ocorrências' });

    const items = await EnterpriseOccurrenceRecord.find({ orderId: String(order._id) }).sort({ occurredAt: -1, updatedAt: -1, createdAt: -1 }).lean();
    return res.json({
      ok: true,
      orderId: String(order._id),
      total: items.length,
      occurrences: items.map(enterpriseOccurrenceNormalizeResponse)
    });
  } catch (error) {
    console.error('[enterprise/orders/:orderId/occurrences:GET] erro:', error.message || error);
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao consultar ocorrências Enterprise' });
  }
});

app.get('/api/enterprise/occurrences', enterpriseOrderOperationAuth, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const filter = {};
    if (req.query.orderId) filter.orderId = String(req.query.orderId).trim();
    if (req.query.occurrenceId) filter.occurrenceId = String(req.query.occurrenceId).trim();
    if (req.query.status) filter.status = String(req.query.status).trim();
    if (req.query.type) filter.type = String(req.query.type).trim();
    if (req.query.code) filter.code = String(req.query.code).trim();
    if (req.query.severity) filter.severity = String(req.query.severity).trim();
    if (req.query.manufacturer) filter.manufacturer = new RegExp(escapeRegex(String(req.query.manufacturer).trim()), 'i');

    const items = await EnterpriseOccurrenceRecord.find(filter).sort({ occurredAt: -1, updatedAt: -1, createdAt: -1 }).limit(limit).lean();
    const total = await EnterpriseOccurrenceRecord.countDocuments(filter).catch(() => items.length);

    return res.json({
      ok: true,
      total,
      limit,
      filters: {
        orderId: req.query.orderId || '',
        occurrenceId: req.query.occurrenceId || '',
        status: req.query.status || '',
        type: req.query.type || '',
        code: req.query.code || '',
        severity: req.query.severity || '',
        manufacturer: req.query.manufacturer || ''
      },
      items: items.map(enterpriseOccurrenceNormalizeResponse)
    });
  } catch (error) {
    console.error('[enterprise/occurrences] erro:', error.message || error);
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar ocorrências Enterprise' });
  }
});

// Compatibilidade Postman: atualiza a ocorrência mais recente do pedido sem exigir occurrenceId na URL.
app.patch('/api/enterprise/orders/:orderId/occurrences', enterpriseOrderOperationAuth, async (req, res) => {
  try {
    const order = await enterpriseCompatFindOrder(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para atualizar ocorrência' });

    const requestedOccurrenceId = String(req.body?.occurrenceId || req.query?.occurrenceId || '').trim();
    let existing = null;

    if (requestedOccurrenceId) {
      existing = await enterpriseFindOccurrenceRecord(String(order._id), requestedOccurrenceId);
    }

    if (!existing) {
      existing = await EnterpriseOccurrenceRecord
        .findOne({ orderId: String(order._id) })
        .sort({ updatedAt: -1, createdAt: -1 });
    }

    if (!existing) return res.status(404).json({ ok: false, error: 'Nenhuma ocorrência encontrada para este pedido' });

    const payload = {
      ...(toJSON(existing) || {}),
      ...(req.body || {}),
      occurrenceId: existing.occurrenceId,
      status: String(req.body?.status || req.body?.situacao || existing.status || '').trim(),
    };

    const result = await enterpriseOccurrenceUpsert(order, payload, req, 'enterprise_occurrence_updated', existing);
    return res.json({
      ok: true,
      action: 'occurrence_updated',
      orderId: String(result.order._id),
      occurrence: result.occurrence,
      order: enterpriseNormalizeOrderForResponse(result.order)
    });
  } catch (error) {
    console.error('[enterprise/orders/:orderId/occurrences:PATCH] erro:', error.message || error);
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao atualizar ocorrência Enterprise' });
  }
});

app.patch('/api/enterprise/orders/:orderId/occurrences/:occurrenceId', enterpriseOrderOperationAuth, async (req, res) => {
  try {
    const order = await enterpriseCompatFindOrder(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para atualizar ocorrência' });

    const existing = await enterpriseFindOccurrenceRecord(String(order._id), req.params.occurrenceId);
    if (!existing) return res.status(404).json({ ok: false, error: 'Ocorrência não encontrada para este pedido' });

    const result = await enterpriseOccurrenceUpsert(order, { ...(toJSON(existing) || {}), ...(req.body || {}) }, req, 'enterprise_occurrence_updated', existing);
    return res.json({
      ok: true,
      action: 'occurrence_updated',
      orderId: String(result.order._id),
      occurrence: result.occurrence,
      order: enterpriseNormalizeOrderForResponse(result.order)
    });
  } catch (error) {
    console.error('[enterprise/orders/:orderId/occurrences/:occurrenceId:PATCH] erro:', error.message || error);
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao atualizar ocorrência Enterprise' });
  }
});

app.post('/api/enterprise/orders/:orderId/occurrences/:occurrenceId/status', enterpriseOrderOperationAuth, async (req, res) => {
  try {
    const order = await enterpriseCompatFindOrder(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para atualizar status da ocorrência' });

    const existing = await enterpriseFindOccurrenceRecord(String(order._id), req.params.occurrenceId);
    if (!existing) return res.status(404).json({ ok: false, error: 'Ocorrência não encontrada para este pedido' });

    const status = String(req.body?.status || req.body?.situacao || '').trim();
    if (!status) return res.status(400).json({ ok: false, error: 'Informe status para atualizar a ocorrência' });

    const result = await enterpriseOccurrenceUpsert(order, { ...(toJSON(existing) || {}), ...(req.body || {}), status }, req, 'enterprise_occurrence_status_updated', existing);
    return res.json({
      ok: true,
      action: 'occurrence_status_updated',
      orderId: String(result.order._id),
      occurrence: result.occurrence,
      order: enterpriseNormalizeOrderForResponse(result.order)
    });
  } catch (error) {
    console.error('[enterprise/orders/:orderId/occurrences/:occurrenceId/status] erro:', error.message || error);
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao atualizar status da ocorrência Enterprise' });
  }
});


// ============================================================
// ALIASES EVENTS - COMPATIBILIDADE ENTERPRISE
// ============================================================
app.post('/api/enterprise/orders/:orderId/events', enterpriseOrderOperationAuth, async (req, res) => {
  try {
    const order = await enterpriseCompatFindOrder(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para registrar evento' });
    const result = await enterpriseOccurrenceUpsert(order, { ...(req.body || {}), event: req.body?.event || req.body }, req, 'enterprise_event_registered');
    return res.status(201).json({ ok: true, action: 'event_registered', orderId: String(result.order._id), event: result.occurrence, occurrence: result.occurrence, order: enterpriseNormalizeOrderForResponse(result.order) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao registrar evento Enterprise' });
  }
});

app.get('/api/enterprise/orders/:orderId/events', enterpriseOrderOperationAuth, async (req, res) => {
  try {
    const order = await enterpriseCompatFindOrder(req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado para consultar eventos' });
    const items = await EnterpriseOccurrenceRecord.find({ orderId: String(order._id) }).sort({ updatedAt: -1, createdAt: -1 }).lean();
    return res.json({ ok: true, orderId: String(order._id), total: items.length, events: items.map(enterpriseOccurrenceNormalizeResponse), occurrences: items.map(enterpriseOccurrenceNormalizeResponse) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao consultar eventos Enterprise' });
  }
});

app.get('/api/enterprise/events', enterpriseOrderOperationAuth, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const filter = {};
    if (req.query.orderId) filter.orderId = String(req.query.orderId);
    const items = await EnterpriseOccurrenceRecord.find(filter).sort({ updatedAt: -1, createdAt: -1 }).limit(limit).lean();
    return res.json({ ok: true, total: items.length, events: items.map(enterpriseOccurrenceNormalizeResponse) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar eventos Enterprise' });
  }
});

}
