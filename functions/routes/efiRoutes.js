import { efiConfigSummary, testEfiAuthentication, buildPixSplitPercentagePayload, createPixSplitConfig, runPixSplitHomologationTest } from '../services/efiService.js';

function safeProviderError(error = {}) {
  const providerData = error?.providerData || {};
  return {
    code: error?.code || 'EFI_ERROR',
    stage: error?.stage || '',
    statusCode: Number(error?.statusCode || 500),
    message: providerData?.mensagem || providerData?.message || providerData?.detail || providerData?.title || error?.message || 'Erro na integração Efí.'
  };
}

export default function registerEfiRoutes(app, context = {}) {
  const { adminRequired, IntegrationAuditLog, Seller } = context;
  if (typeof adminRequired !== 'function') throw new Error('[EFI] adminRequired é obrigatório.');

  async function audit(data = {}) {
    if (!IntegrationAuditLog?.create) return null;
    return IntegrationAuditLog.create({
      scope: 'payments',
      eventType: data.eventType || 'efi_event',
      orderId: data.orderId || null,
      manufacturer: data.manufacturer || null,
      integrationId: data.integrationId || null,
      status: data.status || 'info',
      statusCode: Number(data.statusCode || 0) || null,
      message: data.message || '',
      request: data.request || null,
      response: data.response || null,
      metadata: { provider: 'efi', environment: data.environment || 'homologation', ...(data.metadata || {}) }
    }).catch(() => null);
  }

  app.get('/api/admin/payments/efi/status', adminRequired, async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      ok: true,
      provider: 'efi',
      activeCheckoutProviderChanged: false,
      checkoutAttached: false,
      homologation: efiConfigSummary('homologation'),
      production: efiConfigSummary('production')
    });
  });

  app.post('/api/admin/payments/efi/homologation/auth-test', adminRequired, async (_req, res) => {
    try {
      const result = await testEfiAuthentication('homologation');
      await audit({ eventType: 'efi_homologation_auth_test', status: 'success', statusCode: 200, message: 'Autenticação Efí Homologação validada.', environment: 'homologation', response: result });
      return res.json({ ok: true, provider: 'efi', ...result });
    } catch (error) {
      const safe = safeProviderError(error);
      await audit({ eventType: 'efi_homologation_auth_test', status: 'error', statusCode: safe.statusCode, message: safe.message, environment: 'homologation', response: safe });
      return res.status(safe.statusCode >= 400 && safe.statusCode < 600 ? safe.statusCode : 500).json({ ok: false, provider: 'efi', environment: 'homologation', ...safe });
    }
  });

  app.post('/api/admin/payments/efi/homologation/split-pix/preview', adminRequired, async (req, res) => {
    try {
      const payload = buildPixSplitPercentagePayload({
        description: req.body?.description || 'Split Ariana Marketplace - Homologação',
        platformPercent: req.body?.platformPercent,
        recipients: req.body?.recipients || [],
        feeDivision: req.body?.feeDivision || 'assumir_total'
      });
      return res.json({ ok: true, provider: 'efi', environment: 'homologation', sendsMoney: false, payload });
    } catch (error) {
      return res.status(400).json({ ok: false, provider: 'efi', error: error.message || 'Split inválido.' });
    }
  });

  app.post('/api/admin/payments/efi/homologation/split-pix/config', adminRequired, async (req, res) => {
    try {
      const result = await createPixSplitConfig({
        environment: 'homologation',
        description: req.body?.description || 'Split Ariana Marketplace - Homologação',
        platformPercent: req.body?.platformPercent,
        recipients: req.body?.recipients || [],
        feeDivision: req.body?.feeDivision || 'assumir_total'
      });
      await audit({ eventType: 'efi_homologation_split_config_created', status: 'success', statusCode: result.status, message: 'Configuração Split Pix criada na Efí Homologação.', environment: 'homologation', request: result.payload, response: result.data });
      return res.status(result.status).json({ ok: true, provider: 'efi', environment: 'homologation', data: result.data });
    } catch (error) {
      const safe = safeProviderError(error);
      await audit({ eventType: 'efi_homologation_split_config_created', status: 'error', statusCode: safe.statusCode, message: safe.message, environment: 'homologation', response: safe });
      return res.status(safe.statusCode >= 400 && safe.statusCode < 600 ? safe.statusCode : 500).json({ ok: false, provider: 'efi', environment: 'homologation', ...safe });
    }
  });

  app.get('/api/admin/payments/efi/homologation/split-pix/last-config', adminRequired, async (_req, res) => {
    try {
      if (!IntegrationAuditLog?.findOne) {
        return res.status(503).json({ ok: false, error: 'Auditoria de integrações indisponível.' });
      }
      const last = await IntegrationAuditLog.findOne({
        scope: 'payments',
        eventType: 'efi_homologation_split_config_created',
        status: 'success'
      }).sort({ createdAt: -1, _id: -1 }).lean();
      const id = String(last?.response?.id || '').trim();
      if (!id) return res.status(404).json({ ok: false, error: 'Nenhuma configuração Split Pix homologada foi encontrada.' });
      return res.json({
        ok: true,
        provider: 'efi',
        environment: 'homologation',
        splitConfigId: id,
        status: last?.response?.status || null,
        description: last?.response?.descricao || null,
        createdAt: last?.createdAt || null
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Falha ao recuperar última configuração Split Pix.' });
    }
  });

  app.post('/api/admin/payments/efi/homologation/split-pix/test-flow', adminRequired, async (req, res) => {
    try {
      const splitConfigId = String(req.body?.splitConfigId || '').trim();
      const amount = Number(req.body?.amount ?? 11);
      const result = await runPixSplitHomologationTest({
        splitConfigId,
        amount,
        expiration: 3600,
        description: 'Teste Split Pix Ariana Marketplace - Homologacao'
      });
      await audit({
        eventType: 'efi_homologation_split_test_flow',
        status: 'success',
        statusCode: 200,
        message: 'Cobrança Pix criada, vinculada e consultada com Split em Homologação.',
        environment: 'homologation',
        integrationId: splitConfigId,
        metadata: {
          txid: result.charge?.txid || null,
          amount: result.charge?.amount || null,
          linked: Boolean(result.link?.linked),
          splitDetected: Boolean(result.verification?.splitDetected)
        }
      });
      return res.json({ ok: true, provider: 'efi', ...result });
    } catch (error) {
      const safe = safeProviderError(error);
      await audit({
        eventType: 'efi_homologation_split_test_flow',
        status: 'error',
        statusCode: safe.statusCode,
        message: safe.message,
        environment: 'homologation',
        metadata: { splitConfigId: String(req.body?.splitConfigId || '').trim() }
      });
      return res.status(safe.statusCode >= 400 && safe.statusCode < 600 ? safe.statusCode : 500).json({
        ok: false,
        provider: 'efi',
        environment: 'homologation',
        ...safe
      });
    }
  });

  app.get('/api/admin/payments/efi/sellers/:sellerId/recipient', adminRequired, async (req, res) => {
    const sellerId = String(req.params.sellerId || '').trim();
    const seller = Seller ? await Seller.findOne({ sellerId }).lean().catch(() => null) : null;
    if (!seller) return res.status(404).json({ ok: false, error: 'Seller não encontrado.' });
    return res.json({ ok: true, sellerId, recipient: seller?.metadata?.efi || null });
  });

  app.put('/api/admin/payments/efi/sellers/:sellerId/recipient', adminRequired, async (req, res) => {
    const sellerId = String(req.params.sellerId || '').trim();
    const account = String(req.body?.account || req.body?.conta || '').replace(/\D/g, '');
    const document = String(req.body?.document || req.body?.cpf || req.body?.cnpj || '').replace(/\D/g, '');
    if (!account) return res.status(400).json({ ok: false, error: 'Conta Efí do seller é obrigatória.' });
    if (![11,14].includes(document.length)) return res.status(400).json({ ok: false, error: 'CPF/CNPJ do seller é inválido.' });
    const seller = Seller ? await Seller.findOne({ sellerId }) : null;
    if (!seller) return res.status(404).json({ ok: false, error: 'Seller não encontrado.' });
    const metadata = seller.metadata && typeof seller.metadata === 'object' ? { ...seller.metadata } : {};
    metadata.efi = { account, document, documentType: document.length === 14 ? 'cnpj' : 'cpf', active: req.body?.active !== false, updatedAt: new Date() };
    seller.metadata = metadata;
    await seller.save();
    await audit({ eventType: 'efi_seller_recipient_updated', status: 'success', statusCode: 200, message: 'Conta Efí do seller atualizada.', environment: 'homologation', integrationId: sellerId, metadata: { sellerId, account, documentType: metadata.efi.documentType } });
    return res.json({ ok: true, sellerId, recipient: metadata.efi });
  });


}
