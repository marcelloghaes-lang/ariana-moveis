// ============================================================
// ROTAS ADMIN / OPERACIONAIS / FILA DE FABRICANTES
// Extraído de legacyRoutes.js na Etapa 10.
// Objetivo: reduzir legacyRoutes.js sem alterar endpoints, regras ou respostas.
// ============================================================

export default function registerAdminOperationalRoutes(app, context = {}) {
  const {
    Order,
    Notification,
    OperationalAlert,
    IntegrationAuditLog,
    ManufacturerDispatchQueue,
    ManufacturerIntegration,
    adminRequired,
    authRequired,
    scanOperationalAlerts,
    processManufacturerQueue,
    isInternalArianaSeller,
    dispatchOrderToManufacturer,
    enqueueManufacturerDispatch,
    toJSON,
    redact,
    now
  } = context;

  app.get('/api/admin/orders', adminRequired, async (req, res) =>
    res.json((await Order.find().sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limit || 10), 100))).map(toJSON))
  );

  app.get('/api/admin/notifications', adminRequired, async (_req, res) =>
    res.json((await Notification.find({
      $or: [
        { audience: { $exists: false } },
        { audience: '' },
        { audience: 'admin' },
        { audience: 'all' }
      ]
    }).sort({ createdAt: -1 }).limit(50)).map(toJSON))
  );

  app.get('/api/admin/alerts', adminRequired, async (_req, res) =>
    res.json((await OperationalAlert.find().sort({ updatedAt: -1 }).limit(100)).map(toJSON))
  );

  app.post('/api/admin/alerts/scan', adminRequired, async (_req, res) => {
    const results = await scanOperationalAlerts();
    return res.json({ ok: true, count: results.length, alerts: results.map(toJSON) });
  });

  app.get('/api/admin/audit-logs', adminRequired, async (req, res) => {
    const limit = Math.min(Number(req.query.limit || 100), 500);
    const query = {};
    if (req.query.scope) query.scope = String(req.query.scope);
    if (req.query.orderId) query.orderId = String(req.query.orderId);
    if (req.query.manufacturer) query.manufacturer = String(req.query.manufacturer);
    return res.json((await IntegrationAuditLog.find(query).sort({ createdAt: -1 }).limit(limit)).map(toJSON));
  });

  app.get('/api/admin/queue/manufacturers', authRequired, async (_req, res) =>
    res.json((await ManufacturerDispatchQueue.find().sort({ updatedAt: -1 }).limit(200)).map(toJSON))
  );

  app.post('/api/admin/queue/manufacturers/process', authRequired, async (req, res) => {
    const results = await processManufacturerQueue(Number(req.body?.limit || 10));
    return res.json({ ok: true, processed: results.length, results });
  });

  app.post('/api/admin/queue/manufacturers/skip-internal', adminRequired, async (_req, res) => {
    try {
      const rows = await ManufacturerDispatchQueue.find({
        status: { $in: ['pending', 'processing', 'retry_processing', 'retrying'] }
      });
      const results = [];

      for (const row of rows) {
        if (!isInternalArianaSeller(row.manufacturer)) continue;
        row.status = 'skipped_internal';
        row.deadLetter = false;
        row.nextAttemptAt = null;
        row.lastError = '';
        row.lastResponse = { skipped: true, reason: 'internal_store_flow' };
        await row.save();
        await Order.findByIdAndUpdate(row.orderId, {
          $set: {
            status_integracao: 'fluxo_interno_loja',
            'manufacturerDispatch.outbound': {
              queueId: row.queueId,
              status: 'skipped_internal',
              reason: 'internal_store_flow',
              updatedAt: now()
            }
          }
        }).catch(() => null);
        results.push({ queueId: row.queueId, orderId: row.orderId, manufacturer: row.manufacturer, status: row.status });
      }

      return res.json({ ok: true, skipped: results.length, results });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao ignorar filas internas' });
    }
  });

  app.post('/api/admin/manufacturers/integrations', authRequired, async (req, res) => {
    const body = req.body || {};
    const manufacturer = String(body.manufacturer || '').trim();
    if (!manufacturer) return res.status(400).json({ ok: false, error: 'manufacturer é obrigatório' });

    const doc = await ManufacturerIntegration.findOneAndUpdate(
      { manufacturer },
      {
        $set: {
          enabled: body.enabled !== false,
          endpoint: body.endpoint || '',
          method: body.method || 'POST',
          headers: body.headers || {},
          authType: body.authType || '',
          authToken: body.authToken || '',
          apiKey: body.apiKey || '',
          sendAs: body.sendAs || 'json',
          timeoutMs: Number(body.timeoutMs || 30000),
          metadata: body.metadata || {}
        }
      },
      { upsert: true, new: true }
    );

    return res.json({ ok: true, integration: toJSON(doc) });
  });

  app.post('/api/manufacturers/orders/dispatch', adminRequired, async (req, res) => {
    try {
      const body = req.body || {};
      const orderId = String(body.orderId || body.id || '').trim();
      let orderPayload = body;

      if (orderId) {
        const order = await Order.findById(orderId);
        if (order) orderPayload = { id: String(order._id), ...toJSON(order), ...body };
      }

      const result = await dispatchOrderToManufacturer(orderPayload);
      if (orderId) await Order.findByIdAndUpdate(orderId, {
        $set: {
          status_integracao: result.ok ? 'enviado' : 'erro_envio_fabricante',
          manufacturerDispatch: {
            manufacturer: result.manufacturer,
            endpoint: result.endpoint,
            httpStatus: result.status,
            response: redact(result.data),
            sentContentType: result.sentContentType,
            status: result.ok ? 'sent' : 'error',
            updatedAt: now()
          }
        }
      });

      return res.status(result.ok ? 200 : 502).json({
        ok: result.ok,
        manufacturer: result.manufacturer,
        endpoint: result.endpoint,
        status: result.status,
        response: result.data
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Falha ao enviar pedido ao fabricante' });
    }
  });

  app.post('/api/manufacturers/orders/enqueue', adminRequired, async (req, res) => {
    try {
      const orderId = String(req.body?.orderId || '').trim();
      if (!orderId) return res.status(400).json({ ok: false, error: 'orderId é obrigatório' });
      const order = await Order.findById(orderId);
      if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado' });
      return res.json(await enqueueManufacturerDispatch(order));
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao enfileirar pedido' });
    }
  });
}
