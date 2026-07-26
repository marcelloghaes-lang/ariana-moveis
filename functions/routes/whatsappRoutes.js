// ============================================================
// ROTAS DE WHATSAPP / EVOLUTION API
// Extraído de legacyRoutes.js na Etapa 8.
// Objetivo: reduzir legacyRoutes.js sem alterar endpoints, regras ou respostas.
// ============================================================

export default function registerWhatsappRoutes(app, context = {}) {
  const {
    Order,
    authRequired,
    getWhatsappSettings,
    saveWhatsappSettings,
    redactWhatsappSettings,
    waSyncWebhook,
    waSendTextMessage,
    waSendMediaMessage,
    waMaybeNotifyOrderStatusChange,
    waNotifyOrderChatMessage,
    waPersistWebhook,
    toJSON
  } = context;

  app.get('/api/admin/whatsapp/settings', authRequired, async (_req, res) => {
    try {
      return res.json({ ok: true, config: redactWhatsappSettings(await getWhatsappSettings()) });
    } catch (_error) {
      return res.status(500).json({ ok: false, error: 'Erro ao consultar configuração do WhatsApp' });
    }
  });

  app.post('/api/admin/whatsapp/settings', authRequired, async (req, res) => {
    try {
      return res.json({ ok: true, config: redactWhatsappSettings(await saveWhatsappSettings(req.body || {}, String(req.user._id))) });
    } catch (_error) {
      return res.status(500).json({ ok: false, error: 'Erro ao salvar configuração do WhatsApp' });
    }
  });

  app.post('/api/admin/whatsapp/webhook/sync', authRequired, async (_req, res) => {
    try {
      return res.json(await waSyncWebhook());
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao sincronizar webhook da Evolution' });
    }
  });

  app.post('/api/admin/whatsapp/test-text', authRequired, async (req, res) => {
    try {
      const settings = await getWhatsappSettings();
      const target = req.body?.number || settings.testNumber || '';
      const text = String(req.body?.text || settings.testMessage || '').trim();
      return res.json(await waSendTextMessage({ number: target, text, settings }));
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao enviar mensagem pela Evolution' });
    }
  });

  app.post('/api/admin/whatsapp/test-media', authRequired, async (req, res) => {
    try {
      const settings = await getWhatsappSettings();
      const target = req.body?.number || settings.testNumber || '';
      const mediaUrl = String(req.body?.mediaUrl || req.body?.media || '').trim();
      const caption = String(req.body?.caption || '').trim();
      const mediaType = String(req.body?.mediaType || req.body?.mediatype || 'image').trim().toLowerCase();
      const fileName = String(req.body?.fileName || '').trim();
      return res.json(await waSendMediaMessage({ number: target, mediaUrl, caption, mediaType, fileName, settings }));
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao enviar mídia pela Evolution' });
    }
  });

  app.post('/api/orders/:id/notify-whatsapp', authRequired, async (req, res) => {
    try {
      const order = await Order.findById(req.params.id);
      if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado' });
      return res.json({
        ok: true,
        result: await waMaybeNotifyOrderStatusChange(
          String(order._id),
          { status: req.body?.previousStatus || '__manual__' },
          toJSON(order),
          'manual_route'
        )
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao notificar status do pedido' });
    }
  });

  app.post('/api/orders/:id/chat-notify-whatsapp', authRequired, async (req, res) => {
    try {
      const order = await Order.findById(req.params.id);
      if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado' });
      return res.json({ ok: true, result: await waNotifyOrderChatMessage(String(order._id), toJSON(order), req.body || {}, 'manual_route') });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao notificar chat do pedido' });
    }
  });

  app.post('/api/whatsapp/webhook', async (req, res) => {
    try {
      const parsed = await waPersistWebhook(req.body || {});
      return res.json({ ok: true, received: true, event: parsed.event || null });
    } catch (_error) {
      return res.status(500).json({ ok: false, error: 'Erro ao processar webhook da Evolution' });
    }
  });
}
