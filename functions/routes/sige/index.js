import express from 'express';
import { SigeClient, SigeSyncService, buildSigePedidoPayload } from '../../services/sige/index.js';

export default function createSigeRoutes(deps = {}) {
  const router = express.Router();
  const adminRequired = deps.adminRequired || ((_req, _res, next) => next());
  const models = {
    Order: deps.Order,
    Product: deps.Product,
    User: deps.User,
    Setting: deps.Setting,
    IntegrationAuditLog: deps.IntegrationAuditLog,
    EnterpriseBillingRecord: deps.EnterpriseBillingRecord
  };
  const redact = deps.redact || ((value) => value);

  function service() {
    return new SigeSyncService(models);
  }

  router.get('/admin/sige/status', adminRequired, async (_req, res) => {
    try {
      const client = new SigeClient();
      const config = { ...client.config, token: client.config.token ? '[configurado]' : '', user: client.config.user ? '[configurado]' : '', app: client.config.app ? '[configurado]' : '' };
      return res.json({ ok: true, configured: Boolean(client.config.token && client.config.user && client.config.app), config });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao verificar SIGE' });
    }
  });

  router.post('/admin/sige/orders/:orderId/criar-venda', adminRequired, async (req, res) => {
    try {
      const result = await service().criarVenda(req.params.orderId, { ...(req.body || {}), faturar: req.body?.faturar !== false });
      return res.json({
        ok: true,
        action: result.payload?.DataFaturamento ? 'sige_venda_faturada' : 'sige_venda_criada',
        orderId: String(result.order._id),
        payload: result.payload,
        sige: result.sige.data
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao criar venda no SIGE', sigeResponse: redact(error.responseData || null) });
    }
  });

  router.get('/admin/sige/orders/:orderId/venda', adminRequired, async (req, res) => {
    try {
      const result = await service().consultarPedidoSige(req.params.orderId);
      return res.json({ ok: true, orderId: String(result.order._id), sige: result.sige.data });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao consultar venda no SIGE', sigeResponse: redact(error.responseData || null) });
    }
  });

  router.post('/admin/sige/orders/:orderId/sync-nfe', adminRequired, async (req, res) => {
    try {
      const result = await service().sincronizarNfe(req.params.orderId);
      return res.json({ ok: true, orderId: String(result.order._id), invoice: result.invoice, raw: result.raw });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao sincronizar NF-e do SIGE', sigeResponse: redact(error.responseData || null) });
    }
  });

  router.get('/admin/sige/orders/:orderId/payload-preview', adminRequired, async (req, res) => {
    try {
      const sync = service();
      const order = await sync.getOrder(req.params.orderId);
      const payload = buildSigePedidoPayload(order.toObject ? order.toObject() : order, req.query || {});
      return res.json({ ok: true, orderId: String(order._id), payload });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao gerar prévia do payload SIGE' });
    }
  });

  router.get('/enterprise/sige/status', async (_req, res) => {
    try {
      const client = new SigeClient();
      return res.json({ ok: true, configured: Boolean(client.config.token && client.config.user && client.config.app), apiUrl: client.config.apiUrl });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao verificar SIGE' });
    }
  });

  router.get('/enterprise/sige/invoices/:orderId', async (req, res) => {
    try {
      const result = await service().sincronizarNfe(req.params.orderId);
      return res.json({ ok: true, orderId: String(result.order._id), invoice: result.invoice });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Erro ao buscar invoice SIGE', sigeResponse: redact(error.responseData || null) });
    }
  });

  return router;
}
