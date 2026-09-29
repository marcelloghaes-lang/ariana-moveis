import crypto from 'crypto';
import { efiConfigSummary, testEfiAuthentication, buildPixSplitPercentagePayload, createPixSplitConfig, createPixHomologationTestCharge, linkPixChargeToSplit, getPixSplitCharge, runPixSplitHomologationTest, configurePixWebhook, getPixWebhook } from '../services/efiService.js';

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

  function safeEqualText(a = '', b = '') {
    const left = Buffer.from(String(a || ''), 'utf8');
    const right = Buffer.from(String(b || ''), 'utf8');
    return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
  }

  app.post('/api/webhooks/efi/pix-homologation', async (req, res) => {
    const expected = String(process.env.EFI_HOMOLOG_WEBHOOK_FORWARD_TOKEN || '').trim();
    const received = String(req.headers['x-efi-webhook-forward-token'] || '').trim();
    if (!expected || !safeEqualText(received, expected)) {
      return res.status(401).json({ ok: false, error: 'Webhook não autorizado.' });
    }

    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const items = Array.isArray(body.pix) ? body.pix : [];
      if (!items.length) {
        await audit({
          eventType: 'efi_homologation_webhook_handshake',
          status: 'success',
          statusCode: 200,
          message: 'Handshake/teste de webhook Efí recebido.',
          environment: 'homologation'
        });
        return res.status(200).send('200');
      }

      for (const item of items) {
        const txid = String(item?.txid || '').trim();
        const endToEndId = String(item?.endToEndId || '').trim();
        const splitId = String(item?.gnExtras?.split?.id || '').trim();
        const splitRevision = item?.gnExtras?.split?.revisao ?? null;
        const value = String(item?.valor || '').trim();
        const timestamp = String(item?.horario || '').trim();

        await audit({
          eventType: 'efi_homologation_pix_received',
          status: 'success',
          statusCode: 200,
          message: splitId ? 'Pix recebido com Split em Homologação.' : 'Pix recebido em Homologação.',
          environment: 'homologation',
          integrationId: txid || endToEndId || null,
          response: {
            txid: txid || null,
            endToEndId: endToEndId || null,
            value: value || null,
            timestamp: timestamp || null,
            split: splitId ? { id: splitId, revisao: splitRevision } : null
          },
          metadata: {
            txid: txid || null,
            endToEndId: endToEndId || null,
            splitConfigId: splitId || null,
            splitRevision,
            value: value || null
          }
        });
      }

      console.log('[EFI WEBHOOK HOMOLOG] callback recebido', {
        count: items.length,
        splitCount: items.filter((item) => item?.gnExtras?.split?.id).length
      });
      return res.status(200).send('200');
    } catch (error) {
      console.error('[EFI WEBHOOK HOMOLOG] erro', error?.message || error);
      return res.status(500).json({ ok: false, error: 'Falha ao processar webhook Efí.' });
    }
  });

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

  app.get('/api/admin/payments/efi/homologation/webhook/status', adminRequired, async (_req, res) => {
    try {
      const result = await getPixWebhook({ environment: 'homologation' });
      return res.json({
        ok: true,
        provider: 'efi',
        environment: 'homologation',
        configured: true,
        data: result.data || null
      });
    } catch (error) {
      const safe = safeProviderError(error);
      if (safe.statusCode === 404) {
        return res.json({ ok: true, provider: 'efi', environment: 'homologation', configured: false, data: null });
      }
      return res.status(safe.statusCode >= 400 && safe.statusCode < 600 ? safe.statusCode : 500).json({
        ok: false, provider: 'efi', environment: 'homologation', ...safe
      });
    }
  });

  app.post('/api/admin/payments/efi/homologation/webhook/configure', adminRequired, async (req, res) => {
    try {
      const webhookUrl = String(req.body?.webhookUrl || process.env.EFI_HOMOLOG_WEBHOOK_URL || '').trim();
      const result = await configurePixWebhook({ environment: 'homologation', webhookUrl });
      await audit({
        eventType: 'efi_homologation_webhook_configured',
        status: 'success',
        statusCode: result.status,
        message: 'Webhook Pix Efí configurado em Homologação.',
        environment: 'homologation',
        request: { webhookUrl },
        response: result.data || null
      });
      return res.status(result.status).json({
        ok: true,
        provider: 'efi',
        environment: 'homologation',
        webhookUrl,
        data: result.data || null
      });
    } catch (error) {
      const safe = safeProviderError(error);
      await audit({
        eventType: 'efi_homologation_webhook_configured',
        status: 'error',
        statusCode: safe.statusCode,
        message: safe.message,
        environment: 'homologation'
      });
      return res.status(safe.statusCode >= 400 && safe.statusCode < 600 ? safe.statusCode : 500).json({
        ok: false, provider: 'efi', environment: 'homologation', ...safe
      });
    }
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

  app.post('/api/admin/payments/efi/homologation/split-pix/test-charge', adminRequired, async (req, res) => {
    try {
      const amount = Number(req.body?.amount ?? 11);
      console.log('[EFI SPLIT HOMOLOG] stage=create-charge start', { amount });
      const result = await createPixHomologationTestCharge({
        environment: 'homologation',
        amount,
        expiration: 3600,
        description: 'Teste Split Pix Ariana Marketplace - Homologacao'
      });
      const response = {
        ok: true,
        provider: 'efi',
        environment: 'homologation',
        txid: result.txid,
        status: result.data?.status || null,
        amount: result.data?.valor?.original || result.payload?.valor?.original || null,
        httpStatus: result.status,
        location: result.data?.location || result.data?.loc?.location || null,
        pixCopiaECola: result.data?.pixCopiaECola || null
      };
      console.log('[EFI SPLIT HOMOLOG] stage=create-charge success', { txid: response.txid, status: response.status, httpStatus: response.httpStatus });
      await audit({
        eventType: 'efi_homologation_split_test_charge',
        status: 'success',
        statusCode: result.status,
        message: 'Cobrança Pix de teste criada em Homologação.',
        environment: 'homologation',
        metadata: { txid: result.txid, amount: response.amount, chargeStatus: response.status }
      });
      return res.status(result.status).json(response);
    } catch (error) {
      const safe = safeProviderError(error);
      console.error('[EFI SPLIT HOMOLOG] stage=create-charge error', safe);
      return res.status(safe.statusCode >= 400 && safe.statusCode < 600 ? safe.statusCode : 500).json({ ok: false, provider: 'efi', environment: 'homologation', ...safe });
    }
  });

  app.post('/api/admin/payments/efi/homologation/split-pix/link', adminRequired, async (req, res) => {
    try {
      const txid = String(req.body?.txid || '').trim();
      const splitConfigId = String(req.body?.splitConfigId || '').trim();
      console.log('[EFI SPLIT HOMOLOG] stage=link start', { txid, splitConfigId });
      const result = await linkPixChargeToSplit({ environment: 'homologation', txid, splitConfigId });
      const response = {
        ok: true,
        provider: 'efi',
        environment: 'homologation',
        txid,
        splitConfigId,
        linked: result.status === 204,
        httpStatus: result.status
      };
      console.log('[EFI SPLIT HOMOLOG] stage=link success', response);
      await audit({
        eventType: 'efi_homologation_split_test_link',
        status: 'success',
        statusCode: result.status,
        message: 'Cobrança Pix vinculada ao Split em Homologação.',
        environment: 'homologation',
        integrationId: splitConfigId,
        metadata: { txid, linked: response.linked }
      });
      return res.status(200).json(response);
    } catch (error) {
      const safe = safeProviderError(error);
      console.error('[EFI SPLIT HOMOLOG] stage=link error', safe);
      return res.status(safe.statusCode >= 400 && safe.statusCode < 600 ? safe.statusCode : 500).json({ ok: false, provider: 'efi', environment: 'homologation', ...safe });
    }
  });

  app.get('/api/admin/payments/efi/homologation/split-pix/query/:txid', adminRequired, async (req, res) => {
    try {
      const txid = String(req.params.txid || '').trim();
      console.log('[EFI SPLIT HOMOLOG] stage=query start', { txid });
      const result = await getPixSplitCharge({ environment: 'homologation', txid });
      const data = result.data || {};
      const response = {
        ok: true,
        provider: 'efi',
        environment: 'homologation',
        txid: data.txid || txid,
        status: data.status || null,
        amount: data.valor?.original || null,
        httpStatus: result.status,
        config: data.config ? {
          id: data.config.id || null,
          status: data.config.status || null,
          revisao: data.config.revisao ?? null,
          descricao: data.config.descricao || null,
          tipo: data.config.tipo || null
        } : null,
        splitDetected: Boolean(data.split || data.config)
      };
      console.log('[EFI SPLIT HOMOLOG] stage=query success', { txid: response.txid, status: response.status, splitDetected: response.splitDetected, configId: response.config?.id || null });
      await audit({
        eventType: 'efi_homologation_split_test_query',
        status: 'success',
        statusCode: result.status,
        message: 'Cobrança Pix com Split consultada em Homologação.',
        environment: 'homologation',
        metadata: { txid, splitDetected: response.splitDetected, configId: response.config?.id || null }
      });
      return res.json(response);
    } catch (error) {
      const safe = safeProviderError(error);
      console.error('[EFI SPLIT HOMOLOG] stage=query error', safe);
      return res.status(safe.statusCode >= 400 && safe.statusCode < 600 ? safe.statusCode : 500).json({ ok: false, provider: 'efi', environment: 'homologation', ...safe });
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



  if (
    String(process.env.EFI_INTERNAL_CONFIGURE_WEBHOOK_ON_START || 'false').toLowerCase() === 'true' &&
    !globalThis.__arianaEfiWebhookBootstrapStarted
  ) {
    globalThis.__arianaEfiWebhookBootstrapStarted = true;
    const timer = setTimeout(async () => {
      const webhookUrl = String(process.env.EFI_HOMOLOG_WEBHOOK_URL || '').trim();
      try {
        const configured = await configurePixWebhook({ environment: 'homologation', webhookUrl });
        const verified = await getPixWebhook({ environment: 'homologation' });
        console.log('[EFI WEBHOOK BOOTSTRAP] RESULT', JSON.stringify({
          ok: true,
          configureStatus: configured.status,
          verifyStatus: verified.status,
          configured: Boolean(verified.data?.webhookUrl),
          environment: 'homologation'
        }));
      } catch (error) {
        const safe = safeProviderError(error);
        console.error('[EFI WEBHOOK BOOTSTRAP] ERROR', JSON.stringify(safe));
      }
    }, 8000);
    timer.unref?.();
  }

}
