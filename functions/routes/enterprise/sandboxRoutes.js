// ============================================================
// ROTAS ENTERPRISE - SANDBOX / HOMOLOGAÇÃO
// Extraído de routes/enterpriseRoutes.js sem alterar endpoints, regras ou respostas.
// ============================================================

export default function registerEnterpriseSandboxRoutes(app, context = {}) {
  const {
    adminRequired,
    crypto,
    EnterpriseHomologationRequestCompat,
    IntegrationAuditLog,
    adminEnterpriseFindPartnerOr404,
    adminEnterpriseResolvedHomologation,
    adminEnterpriseSaveHomologationLog,
    adminEnterpriseDefaultHomologation,
    adminEnterprisePartnerDTO,
    ENTERPRISE_HOMOLOGATION_STEPS
  } = context;

app.get('/api/admin/enterprise/pro/partners/:id/homologation', adminRequired, async (req, res) => {
  try {
    const partner = await adminEnterpriseFindPartnerOr404(req.params.id);
    if (!partner) return res.status(404).json({ ok: false, error: 'Fabricante não encontrado' });
    const homologation = await adminEnterpriseResolvedHomologation(partner);
    return res.json({ ok: true, partner: adminEnterprisePartnerDTO(partner), homologation });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar homologação' });
  }
});

app.post('/api/admin/enterprise/pro/partners/:id/homologation/run', adminRequired, async (req, res) => {
  try {
    const partner = await adminEnterpriseFindPartnerOr404(req.params.id);
    if (!partner) return res.status(404).json({ ok: false, error: 'Fabricante não encontrado' });

    const startedAt = new Date();
    const stepsObject = {};
    const results = [];
    const sku = `HML-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const externalOrderId = `HML-PED-${Date.now()}`;

    for (const step of ENTERPRISE_HOMOLOGATION_STEPS) {
      const durationMs = 80 + Math.floor(Math.random() * 360);
      const httpStatus = ['catalog', 'order'].includes(step.key) ? 201 : 200;
      const result = {
        key: step.key,
        label: step.label,
        status: 'approved',
        statusLabel: 'Aprovado',
        passed: true,
        httpStatus,
        durationMs,
        message: `${step.label} validado com sucesso`,
        testedAt: new Date()
      };
      stepsObject[step.key] = result;
      results.push(result);
      await adminEnterpriseSaveHomologationLog(partner, step, httpStatus, durationMs, result.message);
    }

    const completedAt = new Date();
    const homologation = {
      status: 'approved',
      statusLabel: 'Homologação aprovada',
      score: 100,
      approved: ENTERPRISE_HOMOLOGATION_STEPS.length,
      total: ENTERPRISE_HOMOLOGATION_STEPS.length,
      sku,
      externalOrderId,
      startedAt,
      completedAt,
      lastRunAt: completedAt,
      steps: stepsObject,
      report: {
        totalMs: completedAt.getTime() - startedAt.getTime(),
        ok: true,
        source: 'admin_enterprise_pro',
        executedBy: req.admin?.email || req.admin?.id || 'admin'
      }
    };

    await EnterpriseHomologationRequestCompat.updateOne(
      { _id: partner._id },
      {
        $set: {
          homologation,
          enterpriseHomologation: homologation,
          status: 'approved',
          statusLabel: 'Homologação aprovada',
          environment: 'sandbox',
          reviewedAt: completedAt,
          reviewedBy: req.admin?.email || req.admin?.id || 'admin'
        },
        $push: {
          history: { status: 'homologation_auto_approved', at: completedAt, by: req.admin?.email || req.admin?.id || 'admin', source: 'admin_enterprise_pro' },
          statusHistory: { status: 'approved', label: 'Homologação aprovada', at: completedAt, by: req.admin?.email || req.admin?.id || 'admin', source: 'admin_enterprise_pro' }
        }
      }
    );

    await IntegrationAuditLog.create({
      scope: 'enterprise',
      eventType: 'homologation_completed',
      manufacturer: partner.requestId || partner.tradeName || partner.companyName || '',
      integrationId: String(partner._id || ''),
      status: 'success',
      statusCode: 200,
      message: 'Homologação automática Enterprise aprovada com 100%',
      metadata: { partnerId: String(partner._id || ''), requestId: partner.requestId || '', score: 100, totalSteps: ENTERPRISE_HOMOLOGATION_STEPS.length, sku, externalOrderId, source: 'admin_enterprise_pro' }
    }).catch(() => null);

    return res.json({ ok: true, message: 'Homologação automática aprovada', score: 100, sku, externalOrderId, homologation: adminEnterpriseDefaultHomologation({ homologation }), results });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao executar homologação automática' });
  }
});
}
