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

  // Bootstrap temporário e estritamente opt-in para criar um parceiro fictício
  // de homologação interna no Sandbox. Nunca libera produção e não expõe segredos
  // em logs/respostas. O bloco só executa quando a flag explícita estiver ativa.
  async function ensureEnterpriseInternalSandboxFixture() {
    if (String(process.env.ENTERPRISE_INTERNAL_SANDBOX_FIXTURE_ENABLED || 'false').toLowerCase() !== 'true') return;

    const requestId = String(process.env.ENTERPRISE_INTERNAL_SANDBOX_FIXTURE_REQUEST_ID || '').trim();
    const sandboxApiKey = String(process.env.ENTERPRISE_INTERNAL_SANDBOX_FIXTURE_API_KEY || '').trim();
    const oauthClientId = String(process.env.ENTERPRISE_INTERNAL_SANDBOX_FIXTURE_OAUTH_CLIENT_ID || '').trim();
    const oauthClientSecret = String(process.env.ENTERPRISE_INTERNAL_SANDBOX_FIXTURE_OAUTH_SECRET || '').trim();
    const webhookSecret = String(process.env.ENTERPRISE_INTERNAL_SANDBOX_FIXTURE_WEBHOOK_SECRET || '').trim();
    const signingSecret = String(process.env.ENTERPRISE_INTERNAL_SANDBOX_FIXTURE_SIGNING_SECRET || '').trim();

    if (!requestId || !sandboxApiKey || !oauthClientId || !oauthClientSecret || !webhookSecret || !signingSecret) {
      console.error('[ENTERPRISE TEST FIXTURE] configuração incompleta; bootstrap ignorado');
      return;
    }

    const request = await EnterpriseHomologationRequestCompat.findOne({ requestId });
    if (!request) {
      console.error('[ENTERPRISE TEST FIXTURE] solicitação não encontrada:', requestId);
      return;
    }

    const hashSecret = (value = '') => crypto.createHash('sha256').update(String(value || '')).digest('hex');
    const expectedApiKeyHash = hashSecret(sandboxApiKey);

    if (
      String(request.status || '').toLowerCase() === 'approved' &&
      String(request.sandboxCredentials?.apiKeyHash || '') === expectedApiKeyHash &&
      request.sandboxCredentials?.active === true
    ) {
      console.log('[ENTERPRISE TEST FIXTURE] parceiro Sandbox já está pronto:', requestId);
      return;
    }

    const partnerId = String(request.partnerRequestId || request.partnerId || createEnterprisePartnerId()).trim();
    const oauth = {
      clientId: oauthClientId,
      clientSecretHash: hashSecret(oauthClientSecret),
      clientSecretLast4: oauthClientSecret.slice(-4),
      active: true,
      environment: 'sandbox',
      createdAt: new Date()
    };

    request.set({
      partnerRequestId: partnerId,
      status: 'approved',
      statusLabel: 'Aprovada',
      approvedAt: new Date(),
      reviewedAt: new Date(),
      approvedBy: 'internal_sandbox_fixture',
      reviewedBy: 'internal_sandbox_fixture',
      responsibleName: request.responsibleName || 'Equipe Ariana Enterprise',
      environment: 'sandbox',
      integrationTypes: Array.isArray(request.integrationTypes) && request.integrationTypes.length
        ? request.integrationTypes
        : ['catalog', 'stock', 'price', 'orders', 'invoice', 'tracking', 'webhooks'],
      apiKeySandboxHash: expectedApiKeyHash,
      oauthClientId,
      oauthClientSecretHash: oauth.clientSecretHash,
      webhookSecret,
      signingSecret,
      sandboxCredentials: {
        ...(request.sandboxCredentials || {}),
        apiKeyHash: expectedApiKeyHash,
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
          apiKeyHash: expectedApiKeyHash,
          apiKeyLast4: sandboxApiKey.slice(-4),
          active: true,
          oauth
        },
        production: {
          ...(request.credentials?.production || {}),
          active: false
        }
      }
    });

    request.history = Array.isArray(request.history) ? request.history : [];
    request.history.push({
      status: 'approved',
      at: new Date(),
      by: 'internal_sandbox_fixture',
      source: 'internal_prelaunch_test'
    });
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
      eventType: 'partner_request.internal_sandbox_fixture',
      manufacturer: request.companyName || request.tradeName || request.requestId,
      integrationId: partnerId,
      status: 'success',
      statusCode: 200,
      message: 'Parceiro fictício Sandbox preparado para teste ponta a ponta',
      metadata: { requestId, partnerRequestId: partnerId, environment: 'sandbox' }
    }).catch(() => null);

    console.log('[ENTERPRISE TEST FIXTURE] parceiro Sandbox preparado:', requestId);
  }

  setTimeout(() => {
    ensureEnterpriseInternalSandboxFixture().catch((error) => {
      console.error('[ENTERPRISE TEST FIXTURE] erro:', error.message || error);
    });
  }, 3000);


  async function runEnterpriseInternalSandboxSmoke() {
    if (String(process.env.ENTERPRISE_INTERNAL_SANDBOX_SMOKE_ENABLED || 'false').toLowerCase() !== 'true') return;

    const apiKey = String(process.env.ENTERPRISE_INTERNAL_SANDBOX_FIXTURE_API_KEY || '').trim();
    const clientId = String(process.env.ENTERPRISE_INTERNAL_SANDBOX_FIXTURE_OAUTH_CLIENT_ID || '').trim();
    const clientSecret = String(process.env.ENTERPRISE_INTERNAL_SANDBOX_FIXTURE_OAUTH_SECRET || '').trim();
    const base = String(
      process.env.ENTERPRISE_INTERNAL_SANDBOX_SMOKE_BASE_URL ||
      `http://127.0.0.1:${process.env.PORT || 10000}/api/v1/enterprise`
    ).replace(/\/+$/, '');

    if (!apiKey || !clientId || !clientSecret) {
      console.error('[ENTERPRISE INTERNAL SMOKE] credenciais ausentes');
      return;
    }

    const results = [];
    const call = async (step, path, options = {}) => {
      try {
        const response = await fetch(`${base}${path}`, {
          ...options,
          headers: {
            ...(options.body ? { 'content-type': 'application/json' } : {}),
            ...(options.headers || {})
          }
        });
        const body = await response.json().catch(() => ({}));
        results.push({ step, status: response.status, ok: response.ok && body?.ok !== false });
        console.log(`[ENTERPRISE INTERNAL SMOKE] ${step}: HTTP ${response.status} ${response.ok && body?.ok !== false ? 'OK' : 'FAIL'}`);
        return { response, body };
      } catch (error) {
        results.push({ step, status: 0, ok: false });
        console.error(`[ENTERPRISE INTERNAL SMOKE] ${step}: ERRO`, error.message || error);
        return { response: null, body: {} };
      }
    };

    await call('auth_check', '/auth/check', { headers: { 'x-ariana-key': apiKey } });

    const login = await call('partner_login', '/partner/login', {
      method: 'POST',
      body: JSON.stringify({ apiKey })
    });
    const portalToken = String(login.body?.token || '');
    if (portalToken) {
      await call('partner_me', '/partner/me', {
        headers: { authorization: `Bearer ${portalToken}` }
      });
    }

    const oauth = await call('oauth_token', '/oauth/token', {
      method: 'POST',
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret
      })
    });

    const product = {
      sku: 'SBX-SMOKE-001',
      name: 'Produto Sandbox Smoke Test',
      description: 'Produto fictício de homologação interna. Não comercializar.',
      category: 'Sandbox',
      brand: 'Ariana Sandbox Lab',
      price: 899.9,
      stock: 10,
      active: true
    };

    await call('catalog_push', '/catalog/push', {
      method: 'POST',
      headers: { 'x-ariana-key': apiKey },
      body: JSON.stringify({ manufacturer: 'Ariana Sandbox Factory', products: [product] })
    });

    await call('product_sync', '/products/SBX-SMOKE-001/sync', {
      method: 'POST',
      headers: { 'x-ariana-key': apiKey },
      body: JSON.stringify({ stock: 9, price: 879.9, active: true })
    });

    await call('stock_update', '/products/SBX-SMOKE-001/stock', {
      method: 'PUT',
      headers: { 'x-ariana-key': apiKey },
      body: JSON.stringify({ stock: 8 })
    });

    await call('price_update', '/products/SBX-SMOKE-001/price', {
      method: 'PUT',
      headers: { 'x-ariana-key': apiKey },
      body: JSON.stringify({ price: 859.9 })
    });

    const bulkItems = Array.from({ length: 75 }, (_, index) => ({
      sku: `SBX-BULK-${String(index + 1).padStart(3, '0')}`,
      name: `Produto Sandbox Lote ${index + 1}`,
      description: 'Item fictício para validação da fila assíncrona.',
      category: 'Sandbox',
      brand: 'Ariana Sandbox Lab',
      price: 100 + index,
      stock: 5 + (index % 10),
      active: true
    }));

    const bulk = await call('catalog_sync_queue', '/catalog/sync', {
      method: 'POST',
      headers: { 'x-ariana-key': apiKey },
      body: JSON.stringify({ manufacturer: 'Ariana Sandbox Factory', products: bulkItems })
    });

    const jobId = String(bulk.body?.jobId || '');
    if (jobId) {
      for (let attempt = 1; attempt <= 8; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10000));
        const status = await call(`catalog_sync_status_${attempt}`, `/catalog/sync/${encodeURIComponent(jobId)}`, {
          headers: { 'x-ariana-key': apiKey }
        });
        const jobStatus = String(status.body?.job?.status || '');
        if (['completed', 'completed_with_errors', 'failed'].includes(jobStatus)) break;
      }
    }

    const orderCreate = await call('order_create', '/orders', {
      method: 'POST',
      headers: { 'x-ariana-key': apiKey, 'idempotency-key': 'SBX-SMOKE-ORDER-001' },
      body: JSON.stringify({
        manufacturer: 'Ariana Sandbox Factory',
        externalOrderId: 'SBX-SMOKE-ORDER-001',
        customerName: 'Cliente Sandbox',
        customerEmail: 'sandbox@example.invalid',
        customerPhone: '00000000000',
        items: [{ sku: 'SBX-SMOKE-001', name: 'Produto Sandbox Smoke Test', qty: 1, unitPrice: 859.9 }]
      })
    });

    const orderId = String(orderCreate.body?.orderId || '');
    if (orderId) {
      await call('order_get', `/orders/${encodeURIComponent(orderId)}`, {
        headers: { 'x-ariana-key': apiKey }
      });

      await call('invoice_send', `/orders/${encodeURIComponent(orderId)}/invoice`, {
        method: 'POST',
        headers: { 'x-ariana-key': apiKey },
        body: JSON.stringify({
          invoice: {
            number: 'SBX-000001',
            series: 'TESTE',
            accessKey: '00000000000000000000000000000000000000000000',
            total: 859.9,
            xmlUrl: 'https://example.invalid/sandbox-nfe.xml',
            danfeUrl: 'https://example.invalid/sandbox-danfe.pdf'
          }
        })
      });

      await call('tracking_send', `/orders/${encodeURIComponent(orderId)}/tracking`, {
        method: 'POST',
        headers: { 'x-ariana-key': apiKey },
        body: JSON.stringify({
          trackingCode: 'SBXTEST123BR',
          carrier: 'Transportadora Sandbox',
          trackingUrl: 'https://example.invalid/rastreio/SBXTEST123BR'
        })
      });

      await call('tracking_get', `/orders/${encodeURIComponent(orderId)}/tracking`, {
        headers: { 'x-ariana-key': apiKey }
      });
    }

    await call('webhook_test', '/webhooks/test', {
      method: 'POST',
      headers: { 'x-ariana-key': apiKey },
      body: JSON.stringify({ event: 'order_ack', message: 'Smoke test interno Ariana Enterprise' })
    });

    if (String(oauth.body?.access_token || '')) {
      await call('oauth_check', '/oauth/check', {
        headers: { authorization: `Bearer ${oauth.body.access_token}` }
      });
    }

    const passed = results.filter((item) => item.ok).length;
    const failed = results.filter((item) => !item.ok);
    console.log(`[ENTERPRISE INTERNAL SMOKE] RESUMO: ${passed}/${results.length} etapas OK; falhas=${failed.length}`);
    if (failed.length) {
      console.error('[ENTERPRISE INTERNAL SMOKE] ETAPAS COM FALHA:', failed.map((item) => `${item.step}:${item.status}`).join(', '));
    }
  }

  setTimeout(() => {
    runEnterpriseInternalSandboxSmoke().catch((error) => {
      console.error('[ENTERPRISE INTERNAL SMOKE] erro geral:', error.message || error);
    });
  }, 7000);

}
