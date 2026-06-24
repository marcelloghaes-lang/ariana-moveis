import express from 'express';
import jwt from 'jsonwebtoken';
import { ok, fail } from '../utils/http.js';
import {
  listIntegrations,
  upsertIntegration,
  enqueueManufacturerOrder,
  dispatchQueueItem,
  registerWebhookEvent
} from '../services/manufacturerService.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'ariana_enterprise_secret';

function adminOnly(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return fail(res, 401, 'Token ausente');
    const decoded = jwt.verify(token, JWT_SECRET);
    const role = String(decoded.role || '').toLowerCase();
    if (decoded.admin === true || role === 'admin' || role === 'staff') {
      req.admin = decoded;
      return next();
    }
    return fail(res, 403, 'Acesso negado');
  } catch (_error) {
    return fail(res, 401, 'Token inválido');
  }
}

function partnerKey(req, res, next) {
  const expected = String(process.env.ENTERPRISE_WEBHOOK_SECRET || '').trim();
  if (!expected) return next();
  const received = String(req.headers['x-ariana-key'] || req.query.key || '').trim();
  if (received !== expected) return fail(res, 401, 'Chave de integração inválida');
  return next();
}

router.get('/health', (_req, res) => ok(res, { module: 'enterprise', status: 'online' }));

router.get('/manufacturers', adminOnly, async (_req, res) => {
  try { return ok(res, { integrations: await listIntegrations() }); }
  catch (error) { return fail(res, 500, error.message || 'Erro ao listar integrações'); }
});

router.post('/manufacturers', adminOnly, async (req, res) => {
  try {
    const integration = await upsertIntegration(req.body, req.admin?.email || req.admin?.id || 'admin');
    return ok(res, { integration });
  } catch (error) {
    return fail(res, 400, error.message || 'Erro ao salvar integração');
  }
});

router.post('/manufacturers/:manufacturer/orders', adminOnly, async (req, res) => {
  try {
    const manufacturer = req.params.manufacturer;
    const orderId = req.body.orderId || req.body.id || req.body.numeroPedido;
    if (!orderId) return fail(res, 400, 'orderId é obrigatório');
    const item = await enqueueManufacturerOrder({ manufacturer, orderId, payload: req.body });
    return ok(res, { queue: item }, 201);
  } catch (error) {
    return fail(res, 400, error.message || 'Erro ao enfileirar pedido');
  }
});

router.post('/queue/:queueId/dispatch', adminOnly, async (req, res) => {
  try { return ok(res, { queue: await dispatchQueueItem(req.params.queueId) }); }
  catch (error) { return fail(res, 500, error.response?.data || error.message || 'Erro ao enviar fila'); }
});

router.post('/webhooks/:manufacturer', partnerKey, async (req, res) => {
  try {
    const event = await registerWebhookEvent({
      manufacturer: req.params.manufacturer,
      eventType: req.body?.event || req.body?.type || 'manufacturer_webhook',
      payload: req.body
    });
    return ok(res, { received: true, id: String(event._id) });
  } catch (error) {
    return fail(res, 500, error.message || 'Erro ao registrar webhook');
  }
});

export default router;
