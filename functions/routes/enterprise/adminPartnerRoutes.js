// ============================================================
// ROTAS ENTERPRISE - ADMIN PARTNER
// Extraído de routes/enterpriseRoutes.js sem alterar endpoints, regras ou respostas.
// ============================================================

export default function registerEnterpriseAdminPartnerRoutes(app, context = {}) {
  const {
    EnterpriseHomologationRequestCompat,
    adminRequired,
    escapeRegex,
    enterpriseAdminFindPartner,
    toJSON
  } = context;

  function enterpriseAdminPartnerDTO(partner = {}) {
    const obj = toJSON(partner) || {};
    return {
      id: String(obj._id || obj.id || ''),
      partnerId: String(obj.partnerRequestId || obj.partnerId || obj.requestId || obj._id || ''),
      requestId: String(obj.requestId || ''),
      companyName: String(obj.companyName || ''),
      tradeName: String(obj.tradeName || ''),
      brand: String(obj.brand || ''),
      cnpj: String(obj.cnpj || ''),
      email: String(obj.email || obj.commercialEmail || obj.technicalEmail || ''),
      status: String(obj.status || ''),
      statusLabel: String(obj.statusLabel || ''),
      environment: String(obj.environment || 'sandbox'),
      integrationTypes: Array.isArray(obj.integrationTypes) ? obj.integrationTypes : [],
      createdAt: obj.createdAt || null,
      updatedAt: obj.updatedAt || null,
      approvedAt: obj.approvedAt || null,
      hasSandboxApiKey: Boolean(obj.sandboxCredentials?.apiKey || obj.credentials?.sandbox?.apiKey || obj.apiKeySandbox || obj.sandboxApiKey),
      hasProductionApiKey: Boolean(obj.productionCredentials?.apiKey || obj.credentials?.production?.apiKey || obj.apiKeyProduction || obj.enterpriseApiKey),
      hasOAuth: Boolean(obj.oauthClientId || obj.oauth?.sandbox?.clientId || obj.sandboxCredentials?.oauth?.clientId),
      hasWebhookSecret: Boolean(obj.webhookSecret || obj.sandboxCredentials?.webhookSecret)
    };
  }

  app.get('/api/enterprise/partners', adminRequired, async (req, res) => {
    try {
      const page = Math.max(1, Number(req.query.page || 1));
      const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
      const status = String(req.query.status || '').trim();
      const q = String(req.query.q || '').trim();
      const query = {};

      if (status && status !== 'todos' && status !== 'all') query.status = status;
      if (q) {
        const qDigits = q.replace(/\D/g, '');
        query.$or = [
          { requestId: new RegExp(escapeRegex(q), 'i') },
          { partnerRequestId: new RegExp(escapeRegex(q), 'i') },
          { partnerId: new RegExp(escapeRegex(q), 'i') },
          { companyName: new RegExp(escapeRegex(q), 'i') },
          { tradeName: new RegExp(escapeRegex(q), 'i') },
          { brand: new RegExp(escapeRegex(q), 'i') },
          { email: new RegExp(escapeRegex(q), 'i') }
        ];
        if (qDigits) query.$or.push({ cnpj: new RegExp(escapeRegex(qDigits), 'i') });
      }

      const [total, partners] = await Promise.all([
        EnterpriseHomologationRequestCompat.countDocuments(query),
        EnterpriseHomologationRequestCompat.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean()
      ]);

      return res.json({
        ok: true,
        total,
        page,
        limit,
        partners: partners.map(enterpriseAdminPartnerDTO)
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar parceiros Enterprise' });
    }
  });

  app.get('/api/enterprise/partners/:id', adminRequired, async (req, res) => {
    try {
      const partner = await enterpriseAdminFindPartner(req.params.id);
      if (!partner) return res.status(404).json({ ok: false, error: 'Parceiro Enterprise não encontrado' });
      return res.json({ ok: true, partner: enterpriseAdminPartnerDTO(partner) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao buscar parceiro Enterprise' });
    }
  });
}
