// ============================================================
// ROTAS ENTERPRISE - PRODUCTION
// Extraído de routes/enterpriseRoutes.js sem alterar endpoints, regras ou respostas.
// ============================================================

export default function registerEnterpriseProductionRoutes(app, context = {}) {
  const {
    adminRequired,
    EnterpriseHomologationRequestCompat,
    IntegrationAuditLog,
    adminEnterpriseFindPartnerOr404,
    adminEnterpriseResolvedHomologation,
    adminEnterprisePartnerDTO,
    enterprisePartnerGenerateKey,
    enterpriseHashSecret
  } = context;

app.post('/api/admin/enterprise/pro/partners/:id/production/release', adminRequired, async (req, res) => {
  try {
    const partner = await adminEnterpriseFindPartnerOr404(req.params.id);
    if (!partner) return res.status(404).json({ ok: false, error: 'Fabricante não encontrado' });
    const homologation = await adminEnterpriseResolvedHomologation(partner);
    const realEvidenceApproved = Number(homologation.score || 0) >= 100 &&
      homologation.status === 'approved' &&
      homologation?.report?.source === 'real_api_evidence' &&
      homologation?.report?.ok === true;
    if (!realEvidenceApproved) {
      return res.status(400).json({
        ok: false,
        error: 'Produção só pode ser liberada após homologação real 100% aprovada',
        score: Number(homologation.score || 0),
        missingSteps: homologation?.report?.missingSteps || []
      });
    }

    const key = enterprisePartnerGenerateKey('production', partner);
    const keyHash = enterpriseHashSecret(key);
    const keyLast4 = key.slice(-4);
    const nowDate = new Date();
    const productionCredentials = {
      ...(partner.productionCredentials || {}),
      environment: 'production',
      apiKeyHash: keyHash,
      apiKeyLast4: keyLast4,
      active: true,
      generatedAt: partner.productionCredentials?.generatedAt || nowDate,
      rotatedAt: nowDate,
      generatedBy: req.admin?.email || req.admin?.id || 'admin',
      baseUrl: String(process.env.ENTERPRISE_PRODUCTION_BASE_URL || process.env.APP_BASE_URL || 'https://ariana-backend.onrender.com/api').replace(/\/+$/, ''),
      docsUrl: String(process.env.ENTERPRISE_DOCS_URL || 'https://arianamoveis.com.br/ariana_enterprise_docs.html').trim(),
      lastAccessAt: null,
      requestCount: 0
    };

    await EnterpriseHomologationRequestCompat.updateOne(
      { _id: partner._id },
      {
        $set: {
          productionCredentials,
          'production.apiKeyHash': keyHash,
          'production.apiKeyLast4': keyLast4,
          'production.active': true,
          'credentials.production.apiKeyHash': keyHash,
          'credentials.production.apiKeyLast4': keyLast4,
          'credentials.production.active': true,
          apiKeyProductionHash: keyHash,
          status: 'production',
          statusLabel: 'Produção liberada',
          environment: 'production',
          productionReleasedAt: nowDate,
          productionReleasedBy: req.admin?.email || req.admin?.id || 'admin'
        },
        $unset: {
          'productionCredentials.apiKey': '',
          'production.apiKey': '',
          'credentials.production.apiKey': '',
          apiKeyProduction: '',
          enterpriseApiKey: '',
          apiKey: ''
        },
        $push: {
          history: { status: 'production_released', at: nowDate, by: req.admin?.email || req.admin?.id || 'admin', source: 'admin_enterprise_pro' },
          statusHistory: { status: 'production', label: 'Produção liberada', at: nowDate, by: req.admin?.email || req.admin?.id || 'admin', source: 'admin_enterprise_pro' }
        }
      }
    );

    await IntegrationAuditLog.create({
      scope: 'enterprise',
      eventType: 'production_released',
      manufacturer: partner.requestId || partner.tradeName || partner.companyName || '',
      integrationId: String(partner._id || ''),
      status: 'success',
      statusCode: 200,
      message: 'Produção Enterprise liberada pelo Admin',
      metadata: { partnerId: String(partner._id || ''), requestId: partner.requestId || '', admin: req.admin?.email || req.admin?.id || '', source: 'admin_enterprise_pro' }
    }).catch(() => null);

    return res.json({ ok: true, environment: 'production', apiKey: key, message: 'Produção liberada com sucesso' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao liberar produção' });
  }
});

app.get('/api/admin/enterprise/pro/partners/:id/production/status', adminRequired, async (req, res) => {
  try {
    const partner = await adminEnterpriseFindPartnerOr404(req.params.id);
    if (!partner) return res.status(404).json({ ok: false, error: 'Fabricante não encontrado' });
    const dto = adminEnterprisePartnerDTO(partner);
    const homologation = await adminEnterpriseResolvedHomologation(partner);
    const prod = partner.productionCredentials || partner.production || partner.credentials?.production || {};
    return res.json({
      ok: true,
      partner: dto,
      homologation,
      production: {
        active: dto.production.active,
        apiKeyMasked: dto.production.apiKeyMasked,
        releasedAt: partner.productionReleasedAt || prod.releasedAt || prod.generatedAt || prod.rotatedAt || null,
        releasedBy: partner.productionReleasedBy || prod.generatedBy || '',
        suspendedAt: prod.suspendedAt || partner.productionSuspendedAt || null,
        suspendedBy: prod.suspendedBy || partner.productionSuspendedBy || '',
        baseUrl: prod.baseUrl || String(process.env.ENTERPRISE_PRODUCTION_BASE_URL || process.env.APP_BASE_URL || 'https://ariana-backend.onrender.com/api').replace(/\/+$/, ''),
        docsUrl: prod.docsUrl || String(process.env.ENTERPRISE_DOCS_URL || 'https://arianamoveis.com.br/ariana_enterprise_docs.html').trim(),
        rateLimit: prod.rateLimit || partner.rateLimit || { requestsPerMinute: 500, requestsPerDay: 50000 },
        scopes: prod.scopes || partner.scopes || ['catalog','stock','price','orders','invoice','tracking','webhooks']
      }
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao consultar produção' });
  }
});

app.post('/api/admin/enterprise/pro/partners/:id/production/suspend', adminRequired, async (req, res) => {
  try {
    const partner = await adminEnterpriseFindPartnerOr404(req.params.id);
    if (!partner) return res.status(404).json({ ok: false, error: 'Fabricante não encontrado' });
    const nowDate = new Date();
    const reason = String(req.body?.reason || 'Suspensão administrativa').trim();
    await EnterpriseHomologationRequestCompat.updateOne({ _id: partner._id }, {
      $set: {
        'productionCredentials.active': false,
        'productionCredentials.suspendedAt': nowDate,
        'productionCredentials.suspendedBy': req.admin?.email || req.admin?.id || 'admin',
        'productionCredentials.suspensionReason': reason,
        'production.active': false,
        'credentials.production.active': false,
        status: 'production_suspended',
        statusLabel: 'Produção suspensa',
        productionSuspendedAt: nowDate,
        productionSuspendedBy: req.admin?.email || req.admin?.id || 'admin'
      },
      $push: {
        history: { status: 'production_suspended', at: nowDate, by: req.admin?.email || req.admin?.id || 'admin', source: 'admin_enterprise_pro', reason },
        statusHistory: { status: 'production_suspended', label: 'Produção suspensa', at: nowDate, by: req.admin?.email || req.admin?.id || 'admin', source: 'admin_enterprise_pro', reason }
      }
    });
    await IntegrationAuditLog.create({ scope: 'enterprise', eventType: 'production_suspended', manufacturer: partner.requestId || partner.tradeName || partner.companyName || '', integrationId: String(partner._id || ''), status: 'success', statusCode: 200, message: 'Produção Enterprise suspensa pelo Admin', metadata: { partnerId: String(partner._id || ''), reason, admin: req.admin?.email || req.admin?.id || '' } }).catch(() => null);
    return res.json({ ok: true, message: 'Produção suspensa' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao suspender produção' });
  }
});

app.post('/api/admin/enterprise/pro/partners/:id/production/reactivate', adminRequired, async (req, res) => {
  try {
    const partner = await adminEnterpriseFindPartnerOr404(req.params.id);
    if (!partner) return res.status(404).json({ ok: false, error: 'Fabricante não encontrado' });
    const hasProdKey = Boolean(
      partner.productionCredentials?.apiKeyHash ||
      partner.production?.apiKeyHash ||
      partner.credentials?.production?.apiKeyHash ||
      partner.apiKeyProductionHash ||
      partner.productionCredentials?.apiKey ||
      partner.production?.apiKey ||
      partner.credentials?.production?.apiKey ||
      partner.enterpriseApiKey ||
      partner.apiKey
    );
    if (!hasProdKey) return res.status(400).json({ ok: false, error: 'Não existe API Key de produção para reativar' });
    const nowDate = new Date();
    await EnterpriseHomologationRequestCompat.updateOne({ _id: partner._id }, {
      $set: {
        'productionCredentials.active': true,
        'production.active': true,
        'credentials.production.active': true,
        status: 'production',
        statusLabel: 'Produção liberada',
        environment: 'production',
        productionReactivatedAt: nowDate,
        productionReactivatedBy: req.admin?.email || req.admin?.id || 'admin'
      },
      $push: {
        history: { status: 'production_reactivated', at: nowDate, by: req.admin?.email || req.admin?.id || 'admin', source: 'admin_enterprise_pro' },
        statusHistory: { status: 'production', label: 'Produção reativada', at: nowDate, by: req.admin?.email || req.admin?.id || 'admin', source: 'admin_enterprise_pro' }
      }
    });
    await IntegrationAuditLog.create({ scope: 'enterprise', eventType: 'production_reactivated', manufacturer: partner.requestId || partner.tradeName || partner.companyName || '', integrationId: String(partner._id || ''), status: 'success', statusCode: 200, message: 'Produção Enterprise reativada pelo Admin', metadata: { partnerId: String(partner._id || ''), admin: req.admin?.email || req.admin?.id || '' } }).catch(() => null);
    return res.json({ ok: true, message: 'Produção reativada' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao reativar produção' });
  }
});
}
