// ============================================================
// ROTAS ENTERPRISE - SANDBOX / HOMOLOGAÇÃO
// Extraído de routes/enterpriseRoutes.js sem alterar endpoints, regras ou respostas.
// ============================================================

export default function registerEnterpriseSandboxRoutes(app, context = {}) {
  const {
    adminRequired,
    EnterpriseHomologationRequestCompat,
    IntegrationAuditLog,
    adminEnterpriseFindPartnerOr404,
    adminEnterpriseResolvedHomologation,
    adminEnterprisePartnerDTO,
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

    const homologation = await adminEnterpriseResolvedHomologation(partner);
    const missingSteps = Array.isArray(homologation?.report?.missingSteps)
      ? homologation.report.missingSteps
      : (homologation.steps || []).filter((step) => !step.passed).map((step) => step.key);
    const approved = Number(homologation.score || 0) >= 100 && homologation?.report?.source === 'real_api_evidence';

    await IntegrationAuditLog.create({
      scope: 'enterprise',
      eventType: approved ? 'homologation_completed_real' : 'homologation_evaluated',
      manufacturer: partner.requestId || partner.tradeName || partner.companyName || '',
      integrationId: String(partner._id || ''),
      status: 'success',
      statusCode: 200,
      message: approved ? 'Homologação real concluída com evidências do Sandbox' : `Homologação real avaliada: ${homologation.score || 0}%`,
      metadata: {
        partnerId: String(partner._id || ''),
        requestId: partner.requestId || '',
        score: Number(homologation.score || 0),
        missingSteps,
        source: 'real_api_evidence'
      }
    }).catch(() => null);

    return res.json({
      ok: true,
      approved,
      message: approved
        ? 'Homologação real aprovada com 100% das evidências.'
        : 'Homologação real avaliada. Execute no Sandbox as etapas que ainda estão pendentes.',
      score: Number(homologation.score || 0),
      missingSteps,
      homologation,
      results: homologation.steps || []
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao avaliar homologação real' });
  }
});
}
