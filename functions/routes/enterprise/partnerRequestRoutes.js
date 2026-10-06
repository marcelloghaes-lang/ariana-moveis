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

      const partnerId = String(request.partnerRequestId || request.partnerId || createEnterprisePartnerId()).trim();
      const sandboxApiKey = request?.sandboxCredentials?.apiKey || request?.credentials?.sandbox?.apiKey || enterpriseCreateApiKey('ari_sbx');
      const productionApiKey = request?.productionCredentials?.apiKey || request?.credentials?.production?.apiKey || enterpriseCreateApiKey('ari_live');
      const oauth = request?.oauth?.sandbox || request?.sandboxCredentials?.oauth || {
        clientId: enterpriseCreateOAuthId(),
        clientSecret: enterpriseRandomKey(24),
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
        apiKeySandbox: sandboxApiKey,
        apiKeyProduction: productionApiKey,
        oauthClientId: oauth.clientId,
        oauthClientSecret: oauth.clientSecret,
        webhookSecret,
        signingSecret,
        sandboxCredentials: {
          ...(request.sandboxCredentials || {}),
          apiKey: sandboxApiKey,
          active: true,
          environment: 'sandbox',
          webhookSecret,
          signingSecret,
          oauth
        },
        productionCredentials: {
          ...(request.productionCredentials || {}),
          apiKey: productionApiKey,
          active: false,
          environment: 'production'
        },
        credentials: {
          ...(request.credentials || {}),
          sandbox: { ...(request.credentials?.sandbox || {}), apiKey: sandboxApiKey, active: true, oauth },
          production: { ...(request.credentials?.production || {}), apiKey: productionApiKey, active: false }
        }
      });

      request.history = Array.isArray(request.history) ? request.history : [];
      request.history.push({ status: 'approved', at: new Date(), by: req.admin?.email || req.admin?.id || 'admin', source: 'partner_request_approve' });
      await request.save();

      await IntegrationAuditLog.create({
        scope: 'enterprise_partner_request',
        eventType: 'partner_request.approved',
        manufacturer: request.companyName || request.tradeName || request.brand || request.requestId,
        status: 'success',
        statusCode: 200,
        message: 'Solicitação aprovada com sucesso',
        metadata: { requestId: request.requestId, partnerRequestId: partnerId }
      }).catch(() => null);

      return res.json({ ok: true, message: 'Solicitação aprovada com sucesso.', request: toJSON(request) });
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
}
