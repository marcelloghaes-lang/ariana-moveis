// ============================================================
// ROTAS DE FRETE / SHIPPING / CORREIOS
// Extraído de legacyRoutes.js na Etapa 11.
// Objetivo: reduzir legacyRoutes.js sem alterar endpoints, regras ou respostas.
// ============================================================

export default function registerShippingRoutes(app, context = {}) {
  const {
    Order,
    adminRequired,
    calculateShipping,
    getShippingSettings,
    saveShippingSettings,
    correiosCfg,
    getCorreiosToken,
    quoteCorreios,
    safeAxiosError
  } = context;

  if (typeof calculateShipping !== 'function') {
    throw new Error('registerShippingRoutes: calculateShipping não foi informado no context.');
  }
  if (typeof getShippingSettings !== 'function') {
    throw new Error('registerShippingRoutes: getShippingSettings não foi informado no context.');
  }

app.post('/api/shipping/calculate', async (req, res) => { try { return res.json(await calculateShipping(req.body || {})); } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Erro ao calcular frete' }); } });
app.post('/shipping/calculate', async (req, res) => { try { return res.json(await calculateShipping(req.body || {})); } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Erro ao calcular frete' }); } });
app.post('/api/shipping/quote', async (req, res) => { try { return res.json(await calculateShipping(req.body || {})); } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Erro ao calcular frete' }); } });
app.post('/shipping/quote', async (req, res) => { try { return res.json(await calculateShipping(req.body || {})); } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Erro ao calcular frete' }); } });
app.post('/api/shipping/logistics/quote', async (req, res) => {
  try {
    const result = await calculateShipping(req.body || {});
    const quotes = Array.isArray(result?.options) ? result.options.map((q) => ({
      service: q.service,
      label: q.label || q.name || 'Logística',
      name: q.label || q.name || 'Logística',
      price: Number(q.price || 0),
      prazo: q.prazo || null,
      deadlineDays: q.deadlineDays || null,
      provider: q.provider || 'configured',
      raw: q.raw || null,
      metadata: q.metadata || null
    })) : [];
    const errors = Array.isArray(result?.options) ? result.options.filter((q) => q && q.unavailable).map((q) => ({
      service: q.service || 'LOGISTICA',
      name: q.label || 'Logística',
      message: q.error || 'Indisponível',
      metadata: q.metadata || null
    })) : [];
    return res.json({ ok: true, quotes, errors, bestQuote: quotes[0] || null, context: result?.context || null });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao calcular frete logístico' });
  }
});
app.post('/shipping/logistics/quote', async (req, res) => {
  try {
    const result = await calculateShipping(req.body || {});
    const quotes = Array.isArray(result?.options) ? result.options.map((q) => ({
      service: q.service,
      label: q.label || q.name || 'Logística',
      name: q.label || q.name || 'Logística',
      price: Number(q.price || 0),
      prazo: q.prazo || null,
      deadlineDays: q.deadlineDays || null,
      provider: q.provider || 'configured',
      raw: q.raw || null,
      metadata: q.metadata || null
    })) : [];
    const errors = Array.isArray(result?.options) ? result.options.filter((q) => q && q.unavailable).map((q) => ({
      service: q.service || 'LOGISTICA',
      name: q.label || 'Logística',
      message: q.error || 'Indisponível',
      metadata: q.metadata || null
    })) : [];
    return res.json({ ok: true, quotes, errors, bestQuote: quotes[0] || null, context: result?.context || null });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao calcular frete logístico' });
  }
});
app.get('/api/admin/shipping/rules', adminRequired, async (_req, res) => res.json({ ok: true, settings: await getShippingSettings() }));
app.post('/api/admin/shipping/rules', adminRequired, async (req, res) => res.json({ ok: true, settings: await saveShippingSettings(req.body || {}, String(req.user._id)) }));

app.get('/api/shipping/correios/debug', async (_req, res) => { const cfg = correiosCfg(await getShippingSettings()); return res.json({ ok: true, CORREIOS_USER: cfg.user ? 'OK' : 'MISSING', CORREIOS_PASS: cfg.pass ? 'OK' : 'MISSING', CORREIOS_CARTAO: cfg.cartao ? 'OK' : 'MISSING', CORREIOS_CONTRATO: cfg.contrato ? 'OK' : 'MISSING', CORREIOS_DR: cfg.dr || '0', CORREIOS_SERVICOS: (cfg.services || []).join(','), LOJA_ORIGEM_CEP: cfg.originCep ? 'OK' : 'MISSING' }); });
app.get('/api/shipping/correios/token-test', async (_req, res) => { try { const token = await getCorreiosToken(await getShippingSettings()); return res.json({ ok: true, tokenPreview: String(token).slice(0, 16) + '...' }); } catch (e) { const err = safeAxiosError(e); return res.status(err.status || 500).json({ ok: false, stage: 'token', error: err.message, correios: err.data }); } });
app.post('/api/shipping/correios/quote', async (req, res) => { try { return res.json(await quoteCorreios(req.body || {}, await getShippingSettings())); } catch (e) { const err = safeAxiosError(e); return res.status(err.status || 500).json({ ok: false, error: err.message, correios: err.data }); } });
app.post('/shipping/correios/quote', async (req, res) => { try { return res.json(await quoteCorreios(req.body || {}, await getShippingSettings())); } catch (e) { const err = safeAxiosError(e); return res.status(err.status || 500).json({ ok: false, error: err.message, correios: err.data }); } });
app.get('/api/shipping/correios/tracking/:code', async (req, res) => { try { const code = String(req.params.code || '').trim(); if (!code) return res.status(400).json({ ok: false, error: 'tracking_code_required' }); const order = await Order.findOne({ $or: [{ trackingCode: code }, { 'shipping.trackingCode': code }, { 'payment.externalReference': code }] }).sort({ createdAt: -1 }); if (!order) return res.status(404).json({ ok: false, error: 'tracking_not_found' }); return res.json({ ok: true, trackingCode: code, orderId: String(order._id), status: order.status || null, statusLabel: order.statusLabel || null, customerName: order.customerName || null, trackingHistory: order.trackingHistory || [], shipping: order.shipping || null }); } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'tracking_failed' }); } });
app.get('/api/shipping/correios/label/:orderId/html', async (req, res) => { try { const order = await Order.findById(req.params.orderId); if (!order) return res.status(404).send('Pedido não encontrado'); const addr = order.shippingAddress || {}; const items = Array.isArray(order.items) ? order.items : []; const html = `<!DOCTYPE html><html lang="pt-br"><head><meta charset="utf-8"><title>Etiqueta ${String(order._id)}</title><style>body{font-family:Arial,sans-serif;padding:24px} .box{border:2px solid #111;padding:24px;max-width:760px} .muted{color:#555;font-size:12px} h1{margin:0 0 12px} .row{margin:8px 0}</style></head><body><div class="box"><h1>Ariana Móveis - Etiqueta</h1><div class="row"><strong>Pedido:</strong> ${String(order._id)}</div><div class="row"><strong>Destinatário:</strong> ${String(order.customerName || addr.name || '')}</div><div class="row"><strong>Telefone:</strong> ${String(order.customerPhone || addr.phone || '')}</div><div class="row"><strong>Endereço:</strong> ${String(addr.logradouro || '')}, ${String(addr.numero || '')} - ${String(addr.bairro || '')}</div><div class="row"><strong>Cidade/UF:</strong> ${String(addr.cidade || '')}/${String(addr.uf || '')} - CEP ${String(addr.cep || '')}</div><div class="row"><strong>Itens:</strong> ${items.map(i => `${String(i.name || 'Item')} x${Number(i.qty || 1)}`).join(', ')}</div><div class="row"><strong>Código de rastreio:</strong> ${String(order.trackingCode || '') || '—'}</div><div class="muted">Etiqueta HTML de contingência. A etiqueta operacional oficial depende do fluxo contratado dos Correios.</div></div></body></html>`; res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.send(html); } catch (error) { return res.status(500).send(error.message || 'Erro ao gerar etiqueta'); } });
}
