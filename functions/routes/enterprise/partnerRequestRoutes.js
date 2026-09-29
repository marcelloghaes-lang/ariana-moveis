// ============================================================
// ENTERPRISE PARTNER REQUEST ROUTES - ARIANA MÓVEIS
// Extraído de routes/enterpriseRoutes.js sem alterar endpoints,
// regras de negócio, respostas ou compatibilidade.
// ============================================================

export default function registerEnterprisePartnerRequestRoutes(app, context = {}) {
  const {
    adminRequired,
    crypto,
    EnterpriseHomologationRequestCompat,
    normalizePhone,
    normalizeObjectId,
    escapeRegex,
    createAdminNotification,
    IntegrationAuditLog,
    redact,
    toJSON
  } = context;

  function createEnterpriseRequestId() {
    return `REQ-ENT-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
  }

  function createEnterprisePartnerId() {
    return `ENT-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
  }

  function enterpriseRandomKey(size = 32) {
    return crypto.randomBytes(size).toString('hex');
  }

  function enterpriseCreateApiKey(env = 'ari_sbx') {
    return `${env}_${enterpriseRandomKey(20)}`;
  }

  function enterpriseCreateOAuthId() {
    return `cli_${enterpriseRandomKey(12)}`;
  }

  function enterpriseCreateWebhookSecret() {
    return `whsec_${enterpriseRandomKey(24)}`;
  }

  function normalizeEnterprisePartnerRequestPayload(body = {}) {
    const commercialEmail = String(body.commercialEmail || body.email || '').trim().toLowerCase();
    const technicalEmail = String(body.technicalEmail || '').trim().toLowerCase();
    const responsibleName = String(body.responsibleName || body.responsavel || body.contactName || '').trim();
    return {
      requestId: String(body.requestId || createEnterpriseRequestId()).trim(),
      companyName: String(body.companyName || body.razaoSocial || '').trim(),
      tradeName: String(body.tradeName || body.nomeFantasia || '').trim(),
      brand: String(body.brand || body.marca || '').trim(),
      cnpj: String(body.cnpj || body.document || '').replace(/\D/g, ''),
      responsibleName,
      technicalEmail,
      commercialEmail,
      supportEmail: String(body.supportEmail || '').trim().toLowerCase(),
      email: commercialEmail || technicalEmail,
      phone: normalizePhone(body.phone || body.telefone || '', '55'),
      website: String(body.website || body.site || '').trim(),
      segment: String(body.segment || body.segmento || '').trim(),
      erp: String(body.erp || '').trim(),
      estimatedProducts: Number(body.estimatedProducts || body.productCount || body.productsCount || 0) || 0,
      productCount: Number(body.productCount || body.estimatedProducts || 0) || 0,
      integrationTypes: Array.isArray(body.integrationTypes) ? body.integrationTypes : [],
      notes: String(body.notes || body.message || '').trim(),
      status: 'pending',
      statusLabel: 'Pendente',
      metadata: {
        source: body.source || 'public_form',
        raw: body
      }
    };
  }

  app.post('/api/enterprise/partner-requests', async (req, res) => {
    try {
      const payload = normalizeEnterprisePartnerRequestPayload(req.body || {});
      if (!payload.companyName && !payload.tradeName && !payload.brand) {
        return res.status(400).json({ ok: false, error: 'Informe razão social, nome fantasia ou marca.' });
      }
      if (!payload.email) {
        return res.status(400).json({ ok: false, error: 'Informe um e-mail de contato.' });
      }

      const request = await EnterpriseHomologationRequestCompat.create(payload);

      await createAdminNotification({
        type: 'enterprise_partner_request',
        title: 'Nova solicitação Enterprise',
        message: `${payload.companyName || payload.tradeName || payload.brand} solicitou integração Enterprise.`,
        severity: 'info',
        relatedId: String(request._id),
        metadata: { requestId: request.requestId, companyName: payload.companyName, email: payload.email }
      });

      await IntegrationAuditLog.create({
        scope: 'enterprise_partner_request',
        eventType: 'partner_request.created',
        manufacturer: payload.companyName || payload.tradeName || payload.brand || payload.requestId,
        status: 'success',
        statusCode: 201,
        message: 'Solicitação Enterprise criada',
        request: redact(req.body || {}),
        metadata: { requestId: payload.requestId, email: payload.email }
      }).catch(() => null);

      return res.status(201).json({
        ok: true,
        message: 'Solicitação enviada com sucesso.',
        request: toJSON(request)
      });
    } catch (error) {
      console.error('[enterprise/partner-requests] erro:', error.message || error);
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao criar solicitação Enterprise' });
    }
  });

  app.get('/api/enterprise/partner-requests', adminRequired, async (req, res) => {
    try {
      const page = Math.max(1, Number(req.query.page || 1));
      const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
      const status = String(req.query.status || '').trim();
      const q = String(req.query.q || '').trim();
      const query = {};
      if (status) query.status = status;
      if (q) {
        query.$or = [
          { requestId: new RegExp(escapeRegex(q), 'i') },
          { companyName: new RegExp(escapeRegex(q), 'i') },
          { tradeName: new RegExp(escapeRegex(q), 'i') },
          { brand: new RegExp(escapeRegex(q), 'i') },
          { cnpj: new RegExp(escapeRegex(q.replace(/\D/g, '')), 'i') },
          { email: new RegExp(escapeRegex(q), 'i') }
        ];
      }

      const [total, rows] = await Promise.all([
        EnterpriseHomologationRequestCompat.countDocuments(query),
        EnterpriseHomologationRequestCompat.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean()
      ]);

      return res.json({ ok: true, total, page, limit, requests: rows.map((r) => ({ ...r, id: String(r._id), message: r.notes || '' })) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar solicitações Enterprise' });
    }
  });

  app.get('/api/enterprise/partner-requests/:id', adminRequired, async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      const oid = normalizeObjectId(id);
      const query = oid ? { $or: [{ _id: oid }, { requestId: id }] } : { requestId: id };
      const request = await EnterpriseHomologationRequestCompat.findOne(query).lean();
      if (!request) return res.status(404).json({ ok: false, error: 'Solicitação não encontrada' });
      return res.json({ ok: true, request: { ...request, id: String(request._id), message: request.notes || '' } });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao buscar solicitação Enterprise' });
    }
  });

  app.post('/api/enterprise/partner-requests/:id/status', adminRequired, async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      const status = String(req.body?.status || '').trim();
      if (!status) return res.status(400).json({ ok: false, error: 'Status obrigatório' });
      const oid = normalizeObjectId(id);
      const query = oid ? { $or: [{ _id: oid }, { requestId: id }] } : { requestId: id };
      const statusLabel = req.body?.statusLabel || ({ pending: 'Pendente', in_review: 'Em análise', approved: 'Aprovada', rejected: 'Rejeitada' }[status] || status);
      const request = await EnterpriseHomologationRequestCompat.findOneAndUpdate(
        query,
        { $set: { status, statusLabel, reviewedAt: new Date(), reviewedBy: req.admin?.email || req.admin?.id || 'admin' }, $push: { history: { status, at: new Date(), by: req.admin?.email || req.admin?.id || 'admin', source: 'partner_request_status' } } },
        { new: true }
      );
      if (!request) return res.status(404).json({ ok: false, error: 'Solicitação não encontrada' });
      return res.json({ ok: true, request: toJSON(request) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao alterar status da solicitação' });
    }
  });

  app.post('/api/enterprise/partner-requests/:id/approve', adminRequired, async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      const oid = normalizeObjectId(id);
      const query = oid ? { $or: [{ _id: oid }, { requestId: id }] } : { requestId: id };
      const request = await EnterpriseHomologationRequestCompat.findOne(query);
      if (!request) return res.status(404).json({ ok: false, error: 'Solicitação não encontrada' });

      const hashSecret = (value = '') => crypto.createHash('sha256').update(String(value || '')).digest('hex');
      const partnerId = String(request.partnerRequestId || request.partnerId || createEnterprisePartnerId()).trim();
      const sandboxApiKey = enterpriseCreateApiKey('ari_sbx');
      const sandboxApiKeyHash = hashSecret(sandboxApiKey);
      const oauthClientSecret = enterpriseRandomKey(24);
      const oauth = {
        clientId: enterpriseCreateOAuthId(),
        clientSecretHash: hashSecret(oauthClientSecret),
        clientSecretLast4: oauthClientSecret.slice(-4),
        active: true,
        environment: 'sandbox',
        createdAt: new Date()
      };
      const webhookSecret = request?.webhookSecret || request?.sandboxCredentials?.webhookSecret || enterpriseCreateWebhookSecret();
      const signingSecret = request?.signingSecret || enterpriseRandomKey(24);

      request.set({
        partnerRequestId: partnerId,
        status: 'approved',
        statusLabel: 'Aprovada',
        approvedAt: new Date(),
        reviewedAt: new Date(),
        approvedBy: req.admin?.email || req.admin?.id || 'admin',
        reviewedBy: req.admin?.email || req.admin?.id || 'admin',
        responsibleName: request.responsibleName || req.body?.responsibleName || 'Responsável não informado',
        environment: 'sandbox',
        integrationTypes: Array.isArray(request.integrationTypes) && request.integrationTypes.length ? request.integrationTypes : ['catalog', 'stock', 'price', 'orders', 'invoice', 'tracking', 'webhooks'],
        apiKeySandboxHash: sandboxApiKeyHash,
        oauthClientId: oauth.clientId,
        oauthClientSecretHash: oauth.clientSecretHash,
        webhookSecret,
        signingSecret,
        sandboxCredentials: {
          ...(request.sandboxCredentials || {}),
          apiKeyHash: sandboxApiKeyHash,
          apiKeyLast4: sandboxApiKey.slice(-4),
          active: true,
          environment: 'sandbox',
          webhookSecret,
          signingSecret,
          oauth
        },
        productionCredentials: {
          ...(request.productionCredentials || {}),
          active: false,
          environment: 'production'
        },
        credentials: {
          ...(request.credentials || {}),
          sandbox: {
            ...(request.credentials?.sandbox || {}),
            apiKeyHash: sandboxApiKeyHash,
            apiKeyLast4: sandboxApiKey.slice(-4),
            active: true,
            oauth
          },
          production: { ...(request.credentials?.production || {}), active: false }
        }
      });

      request.history = Array.isArray(request.history) ? request.history : [];
      request.history.push({ status: 'approved', at: new Date(), by: req.admin?.email || req.admin?.id || 'admin', source: 'partner_request_approve' });
      await request.save();

      await EnterpriseHomologationRequestCompat.updateOne(
        { _id: request._id },
        { $unset: {
          apiKeySandbox: '', sandboxApiKey: '', apiKeyProduction: '', enterpriseApiKey: '', apiKey: '',
          oauthClientSecret: '', oauthProductionClientSecret: '',
          'sandboxCredentials.apiKey': '', 'productionCredentials.apiKey': '',
          'sandboxCredentials.oauth.clientSecret': '', 'productionCredentials.oauth.clientSecret': '',
          'sandbox.apiKey': '', 'production.apiKey': '',
          'credentials.sandbox.apiKey': '', 'credentials.production.apiKey': '',
          'credentials.sandbox.oauth.clientSecret': '', 'credentials.production.oauth.clientSecret': ''
        } }
      ).catch(() => null);

      await IntegrationAuditLog.create({
        scope: 'enterprise_partner_request',
        eventType: 'partner_request.approved',
        manufacturer: request.companyName || request.tradeName || request.brand || request.requestId,
        status: 'success',
        statusCode: 200,
        message: 'Solicitação aprovada com credenciais Sandbox protegidas por hash',
        metadata: { requestId: request.requestId, partnerRequestId: partnerId }
      }).catch(() => null);

      const safeRequest = toJSON(request) || {};
      delete safeRequest.apiKeySandbox;
      delete safeRequest.sandboxApiKey;
      delete safeRequest.apiKeyProduction;
      delete safeRequest.enterpriseApiKey;
      delete safeRequest.apiKey;
      delete safeRequest.oauthClientSecret;
      delete safeRequest.oauthProductionClientSecret;
      delete safeRequest.webhookSecret;
      delete safeRequest.signingSecret;
      if (safeRequest.sandboxCredentials) {
        delete safeRequest.sandboxCredentials.apiKey;
        delete safeRequest.sandboxCredentials.webhookSecret;
        delete safeRequest.sandboxCredentials.signingSecret;
        if (safeRequest.sandboxCredentials.oauth) delete safeRequest.sandboxCredentials.oauth.clientSecret;
      }
      if (safeRequest.productionCredentials) delete safeRequest.productionCredentials.apiKey;
      if (safeRequest.credentials?.sandbox) {
        delete safeRequest.credentials.sandbox.apiKey;
        if (safeRequest.credentials.sandbox.oauth) delete safeRequest.credentials.sandbox.oauth.clientSecret;
      }
      if (safeRequest.credentials?.production) delete safeRequest.credentials.production.apiKey;

      return res.json({
        ok: true,
        message: 'Solicitação aprovada. Copie as credenciais abaixo agora; os segredos não poderão ser recuperados depois.',
        request: safeRequest,
        oneTimeCredentials: {
          sandboxApiKey,
          oauthClientId: oauth.clientId,
          oauthClientSecret,
          webhookSecret,
          signingSecret
        }
      });
    } catch (error) {
      console.error('[enterprise partner-request approve] erro:', error.message || error);
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao aprovar solicitação Enterprise' });
    }
  });

  app.post('/api/enterprise/partner-requests/:id/reject', adminRequired, async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      const oid = normalizeObjectId(id);
      const query = oid ? { $or: [{ _id: oid }, { requestId: id }] } : { requestId: id };
      const request = await EnterpriseHomologationRequestCompat.findOneAndUpdate(
        query,
        { $set: { status: 'rejected', statusLabel: 'Rejeitada', rejectedAt: new Date(), reviewedAt: new Date(), rejectedBy: req.admin?.email || req.admin?.id || 'admin', reviewedBy: req.admin?.email || req.admin?.id || 'admin', rejectionReason: String(req.body?.reason || req.body?.message || '').trim() }, $push: { history: { status: 'rejected', at: new Date(), by: req.admin?.email || req.admin?.id || 'admin', source: 'partner_request_reject' } } },
        { new: true }
      );
      if (!request) return res.status(404).json({ ok: false, error: 'Solicitação não encontrada' });
      return res.json({ ok: true, message: 'Solicitação recusada.', request: toJSON(request) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao recusar solicitação Enterprise' });
    }
  });


  async function runEnterpriseInternalLoadTest() {
    if (String(process.env.ENTERPRISE_INTERNAL_LOAD_TEST_ENABLED || 'false').toLowerCase() !== 'true') return;
    if (globalThis.__arianaEnterpriseInternalLoadTestStarted) return;
    globalThis.__arianaEnterpriseInternalLoadTestStarted = true;

    const apiKey = String(process.env.ENTERPRISE_INTERNAL_LOAD_TEST_API_KEY || '').trim();
    const expectedRequestId = String(process.env.ENTERPRISE_INTERNAL_LOAD_TEST_REQUEST_ID || '').trim();
    const base = String(
      process.env.ENTERPRISE_INTERNAL_LOAD_TEST_BASE_URL ||
      `http://127.0.0.1:${process.env.PORT || 10000}/api/enterprise`
    ).replace(/\/+$/, '');

    if (!apiKey || !expectedRequestId) {
      console.error('[ENTERPRISE LOAD TEST] credencial/requestId ausente');
      return;
    }

    const request = async (method, path, body, extraHeaders = {}) => {
      const started = Date.now();
      try {
        const response = await fetch(`${base}${path}`, {
          method,
          headers: {
            'x-ariana-key': apiKey,
            ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
            ...extraHeaders
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(60000)
        });
        const raw = await response.text();
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw: raw.slice(0, 300) }; }
        return { ok: response.ok && data?.ok !== false, status: response.status, ms: Date.now() - started, data };
      } catch (error) {
        return { ok: false, status: 0, ms: Date.now() - started, data: { error: error.message || String(error) } };
      }
    };

    const summarize = (rows = []) => {
      const values = rows.map((row) => Number(row.ms || 0)).sort((a, b) => a - b);
      const pct = (value) => values.length ? values[Math.min(values.length - 1, Math.floor((values.length - 1) * value))] : 0;
      return {
        total: rows.length,
        ok: rows.filter((row) => row.ok).length,
        failed: rows.filter((row) => !row.ok).length,
        http429: rows.filter((row) => row.status === 429).length,
        p50Ms: pct(0.50),
        p95Ms: pct(0.95),
        maxMs: values.length ? values[values.length - 1] : 0
      };
    };

    const runPool = async (tasks, concurrency = 10) => {
      const results = new Array(tasks.length);
      let cursor = 0;
      const worker = async () => {
        while (true) {
          const index = cursor++;
          if (index >= tasks.length) break;
          results[index] = await tasks[index]();
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
      return results;
    };

    console.log('[ENTERPRISE LOAD TEST] iniciando teste de concorrência Sandbox');

    const auth = await request('GET', '/auth/check');
    const authRequestId = String(auth.data?.partner?.requestId || '');
    const environment = String(auth.data?.environment || '');
    console.log(`[ENTERPRISE LOAD TEST] auth HTTP ${auth.status} env=${environment} requestId=${authRequestId}`);
    if (!auth.ok || environment !== 'sandbox' || authRequestId !== expectedRequestId) {
      console.error('[ENTERPRISE LOAD TEST] proteção Sandbox bloqueou a execução');
      return;
    }

    const jobs = await request('GET', '/catalog/sync/jobs?limit=10');
    if (jobs.ok) {
      const compact = (jobs.data?.jobs || []).slice(0, 10).map((job) => ({
        jobId: job.jobId,
        status: job.status,
        received: job.received,
        createdProducts: job.createdProducts,
        updatedProducts: job.updatedProducts,
        errorCount: job.errorCount,
        durationMs: job.durationMs
      }));
      console.log('[ENTERPRISE LOAD TEST] RECENT_JOBS', JSON.stringify(compact));
    }

    const prefix = `LC-${Date.now().toString(36).toUpperCase()}`;
    const seedItems = Array.from({ length: 100 }, (_, index) => ({
      sku: `${prefix}-${String(index + 1).padStart(4, '0')}`,
      name: `Produto Concorrência ${index + 1}`,
      description: 'Produto fictício exclusivo do Sandbox Ariana Enterprise.',
      category: 'Enterprise Concurrency Test',
      brand: 'Ariana Sandbox Lab',
      price: 300 + index,
      stock: 20 + (index % 30),
      active: true
    }));

    const seed = await request('POST', '/catalog/push', {
      manufacturer: 'Ariana Sandbox Factory',
      items: seedItems
    });
    console.log('[ENTERPRISE LOAD TEST] SEED', JSON.stringify({ status: seed.status, ok: seed.ok, ms: seed.ms, total: seed.data?.total || 0 }));
    if (!seed.ok) return;

    const updateTasks = [];
    for (let i = 1; i <= 60; i += 1) {
      const sku = `${prefix}-${String(i).padStart(4, '0')}`;
      updateTasks.push(() => request('PUT', `/products/${encodeURIComponent(sku)}/stock`, { stock: 100 + i }));
      updateTasks.push(() => request('PUT', `/products/${encodeURIComponent(sku)}/price`, { price: 600 + i }));
    }
    const updatesStarted = Date.now();
    const updateRows = await runPool(updateTasks, 12);
    const updateStats = { wallMs: Date.now() - updatesStarted, ...summarize(updateRows) };
    console.log('[ENTERPRISE LOAD TEST] UPDATES', JSON.stringify(updateStats));

    const orderPayload = (index) => {
      const n = index + 1;
      const externalOrderId = `${prefix}-ORDER-${String(n).padStart(3, '0')}`;
      return {
        externalOrderId,
        body: {
          manufacturer: 'Ariana Sandbox Factory',
          externalOrderId,
          customerName: `Cliente Sandbox Concorrência ${n}`,
          customerEmail: `sandbox-concurrency-${n}@example.invalid`,
          customerPhone: '00000000000',
          items: [{
            sku: `${prefix}-${String((index % 60) + 1).padStart(4, '0')}`,
            name: `Produto Concorrência ${(index % 60) + 1}`,
            qty: 1,
            unitPrice: 600 + ((index % 60) + 1)
          }]
        }
      };
    };

    const orderDefs = Array.from({ length: 30 }, (_, index) => orderPayload(index));
    const orderTasks = orderDefs.map((entry) => () => request(
      'POST',
      '/orders',
      entry.body,
      { 'idempotency-key': entry.externalOrderId }
    ));
    const ordersStarted = Date.now();
    const orderRows = await runPool(orderTasks, 8);
    const orderStats = { wallMs: Date.now() - ordersStarted, ...summarize(orderRows) };
    console.log('[ENTERPRISE LOAD TEST] ORDERS', JSON.stringify(orderStats));

    const duplicateTasks = orderDefs.slice(0, 5).map((entry) => () => request(
      'POST',
      '/orders',
      entry.body,
      { 'idempotency-key': entry.externalOrderId }
    ));
    const duplicateRows = await runPool(duplicateTasks, 5);
    const duplicateStats = summarize(duplicateRows);
    console.log('[ENTERPRISE LOAD TEST] IDEMPOTENCY', JSON.stringify(duplicateStats));

    const summary = await request('GET', '/catalog/summary');
    const final = {
      success: updateStats.failed === 0 && orderStats.failed === 0 && duplicateStats.failed === 0 && summary.ok,
      updates: updateStats,
      orders: orderStats,
      idempotency: duplicateStats,
      catalog: {
        ok: summary.ok,
        status: summary.status,
        totalProducts: Number(summary.data?.summary?.totalProducts || 0),
        activeProducts: Number(summary.data?.summary?.activeProducts || 0)
      }
    };
    console.log('[ENTERPRISE LOAD TEST] SUMMARY', JSON.stringify(final));
  }

  setTimeout(() => {
    runEnterpriseInternalLoadTest().catch((error) => {
      console.error('[ENTERPRISE LOAD TEST] erro geral:', error.message || error);
    });
  }, 8000);

}
