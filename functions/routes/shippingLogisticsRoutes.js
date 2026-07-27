import express from 'express';

export default function createShippingLogisticsRoutes(deps = {}) {
  const router = express.Router();

  const adminRequired = deps.adminRequired || ((_req, _res, next) => next());
  const Order = deps.Order;
  const calculateShipping = deps.calculateShipping;
  const getShippingSettings = deps.getShippingSettings;
  const saveShippingSettings = deps.saveShippingSettings;
  const quoteCorreios = deps.quoteCorreios;
  const getCorreiosToken = deps.getCorreiosToken;
  const correiosCfg = deps.correiosCfg;
  const safeAxiosError = deps.safeAxiosError || ((error) => ({ status: error?.response?.status || 500, message: error?.message || 'Erro interno', data: error?.response?.data || null }));

  function requireDep(name, value) {
    if (!value) {
      const error = new Error(`Dependência ausente no módulo de logística/frete: ${name}`);
      error.statusCode = 500;
      throw error;
    }
    return value;
  }

  async function runShippingCalculation(req, res) {
    try {
      const fn = requireDep('calculateShipping', calculateShipping);
      return res.json(await fn(req.body || {}));
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao calcular frete' });
    }
  }

  router.post('/shipping/calculate', runShippingCalculation);
  router.post('/shipping/quote', runShippingCalculation);
  router.post('/api/shipping/calculate', runShippingCalculation);
  router.post('/api/shipping/quote', runShippingCalculation);

  router.post('/api/shipping/logistics/quote', runShippingCalculation);
  router.post('/shipping/logistics/quote', runShippingCalculation);

  router.get('/api/admin/shipping/rules', adminRequired, async (_req, res) => {
    try {
      const getter = requireDep('getShippingSettings', getShippingSettings);
      return res.json({ ok: true, settings: await getter() });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao carregar regras de frete' });
    }
  });

  router.post('/api/admin/shipping/rules', adminRequired, async (req, res) => {
    try {
      const saver = requireDep('saveShippingSettings', saveShippingSettings);
      const userId = req.user?._id || req.admin?.id || 'admin';
      return res.json({ ok: true, settings: await saver(req.body || {}, String(userId)) });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao salvar regras de frete' });
    }
  });

  router.get('/api/shipping/correios/debug', async (_req, res) => {
    try {
      const getter = requireDep('getShippingSettings', getShippingSettings);
      const cfgFn = requireDep('correiosCfg', correiosCfg);
      const cfg = cfgFn(await getter());
      return res.json({
        ok: true,
        CORREIOS_USER: cfg.user ? 'OK' : 'MISSING',
        CORREIOS_PASS: cfg.pass ? 'OK' : 'MISSING',
        CORREIOS_CARTAO: cfg.cartao ? 'OK' : 'MISSING',
        CORREIOS_CONTRATO: cfg.contrato ? 'OK' : 'MISSING',
        CORREIOS_DR: cfg.dr || '0',
        CORREIOS_SERVICOS: (cfg.services || []).join(','),
        LOJA_ORIGEM_CEP: cfg.originCep ? 'OK' : 'MISSING'
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao verificar Correios' });
    }
  });

  router.get('/api/shipping/correios/token-test', async (_req, res) => {
    try {
      const getter = requireDep('getShippingSettings', getShippingSettings);
      const tokenFn = requireDep('getCorreiosToken', getCorreiosToken);
      const token = await tokenFn(await getter());
      return res.json({ ok: true, tokenPreview: String(token).slice(0, 16) + '...' });
    } catch (error) {
      const err = safeAxiosError(error);
      return res.status(err.status || 500).json({ ok: false, stage: 'token', error: err.message, correios: err.data });
    }
  });

  async function runCorreiosQuote(req, res) {
    try {
      const getter = requireDep('getShippingSettings', getShippingSettings);
      const quoteFn = requireDep('quoteCorreios', quoteCorreios);
      return res.json(await quoteFn(req.body || {}, await getter()));
    } catch (error) {
      const err = safeAxiosError(error);
      return res.status(err.status || 500).json({ ok: false, error: err.message, correios: err.data });
    }
  }

  router.post('/api/shipping/correios/quote', runCorreiosQuote);
  router.post('/shipping/correios/quote', runCorreiosQuote);

  router.get('/api/shipping/correios/tracking/:code', async (req, res) => {
    try {
      const OrderModel = requireDep('Order', Order);
      const code = String(req.params.code || '').trim();
      if (!code) return res.status(400).json({ ok: false, error: 'tracking_code_required' });
      const order = await OrderModel.findOne({
        $or: [
          { trackingCode: code },
          { 'shipping.trackingCode': code },
          { 'payment.externalReference': code }
        ]
      }).sort({ createdAt: -1 });
      if (!order) return res.status(404).json({ ok: false, error: 'tracking_not_found' });
      return res.json({
        ok: true,
        trackingCode: code,
        orderId: String(order._id),
        status: order.status || null,
        statusLabel: order.statusLabel || null,
        customerName: order.customerName || null,
        trackingHistory: order.trackingHistory || [],
        shipping: order.shipping || null
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'tracking_failed' });
    }
  });

  router.get('/api/shipping/correios/label/:orderId/html', async (req, res) => {
    try {
      const OrderModel = requireDep('Order', Order);
      const order = await OrderModel.findById(req.params.orderId);
      if (!order) return res.status(404).send('Pedido não encontrado');
      const addr = order.shippingAddress || {};
      const items = Array.isArray(order.items) ? order.items : [];
      const html = `<!DOCTYPE html><html lang="pt-br"><head><meta charset="utf-8"><title>Etiqueta ${String(order._id)}</title><style>body{font-family:Arial,sans-serif;padding:24px}.box{border:2px solid #111;padding:24px;max-width:760px}.muted{color:#555;font-size:12px}h1{margin:0 0 12px}.row{margin:8px 0}</style></head><body><div class="box"><h1>Ariana Móveis - Etiqueta</h1><div class="row"><strong>Pedido:</strong> ${String(order._id)}</div><div class="row"><strong>Destinatário:</strong> ${String(order.customerName || addr.name || '')}</div><div class="row"><strong>Telefone:</strong> ${String(order.customerPhone || addr.phone || '')}</div><div class="row"><strong>Endereço:</strong> ${String(addr.logradouro || '')}, ${String(addr.numero || '')} - ${String(addr.bairro || '')}</div><div class="row"><strong>Cidade/UF:</strong> ${String(addr.cidade || '')}/${String(addr.uf || '')} - CEP ${String(addr.cep || '')}</div><div class="row"><strong>Itens:</strong> ${items.map(i => `${String(i.name || 'Item')} x${Number(i.qty || 1)}`).join(', ')}</div><div class="row"><strong>Código de rastreio:</strong> ${String(order.trackingCode || '') || '—'}</div><div class="muted">Etiqueta HTML de contingência. A etiqueta operacional oficial depende do fluxo contratado dos Correios.</div></div></body></html>`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    } catch (error) {
      return res.status(error.statusCode || 500).send(error.message || 'Erro ao gerar etiqueta');
    }
  });

  return router;
}
