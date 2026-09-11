// ============================================================
// PAGAR.ME - PROVEDOR DESATIVADO
// A Ariana Móveis não usa mais Pagar.me no checkout.
// O código histórico permanece no repositório para auditoria, porém nenhuma
// rota ativa pode criar cobrança, expor chave pública ou alterar pedidos.
// ============================================================

export default function registerRetiredPagarmeRoutes(app) {
  if (!app) throw new Error('[PAGARME RETIRED] app é obrigatório.');

  function pathOnly(req = {}) {
    return String(req.path || req.originalUrl || '')
      .split('?')[0]
      .replace(/\/+$/, '');
  }

  app.use((req, res, next) => {
    const path = pathOnly(req);

    // Webhooks antigos são reconhecidos para evitar retentativas infinitas do
    // provedor, mas são deliberadamente ignorados e nunca alteram um pedido.
    if (path === '/api/webhooks/pagarme') {
      return res.status(200).json({
        ok: true,
        received: true,
        ignored: true,
        retired: true,
        provider: 'pagarme'
      });
    }

    const paymentRoute = /^\/api\/payments\/pagarme(?:\/|$)/i.test(path);
    const adminPaymentRoute = /^\/api\/admin\/payments\/pagarme(?:\/|$)/i.test(path);
    const recipientRoute = /^\/api\/admin\/sellers\/[^/]+\/pagarme-recipient(?:\/|$)/i.test(path);

    if (!paymentRoute && !adminPaymentRoute && !recipientRoute) return next();

    return res.status(410).json({
      ok: false,
      provider: 'pagarme',
      retired: true,
      code: 'PAGARME_RETIRED',
      error: 'Pagar.me não faz mais parte dos meios de pagamento da Ariana Móveis.'
    });
  });

  // Mantém respostas de configuração compatíveis, mas garante que interfaces
  // administrativas nunca interpretem Pagar.me como provedor ativo.
  app.use((req, res, next) => {
    const path = pathOnly(req);
    if (![
      '/api/admin/store-settings',
      '/api/settings/payments',
      '/api/payments/settings',
      '/api/store/settings'
    ].includes(path)) return next();

    const originalJson = res.json.bind(res);
    res.json = function retiredPagarmeJson(payload) {
      if (payload && typeof payload === 'object') {
        const disabled = {
          enabled: false,
          creditCardEnabled: false,
          enableCard: false,
          enablePix: false,
          enableBoleto: false,
          retired: true
        };

        if (payload.pagarme !== undefined) payload.pagarme = disabled;
        if (payload.payments && typeof payload.payments === 'object') payload.payments.pagarme = disabled;
        if (payload.settings?.payments && typeof payload.settings.payments === 'object') {
          payload.settings.payments.pagarme = disabled;
        }
        if (payload.item?.pagarme !== undefined) payload.item.pagarme = disabled;
      }
      return originalJson(payload);
    };

    return next();
  });
}
