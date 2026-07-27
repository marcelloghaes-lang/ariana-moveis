import express from 'express';

export default function createOrderRoutes(deps = {}) {
  const router = express.Router();

  const Order = deps.Order;
  const authRequired = deps.authRequired || ((_req, _res, next) => next());
  const adminRequired = deps.adminRequired || ((_req, _res, next) => next());
  const toJSON = deps.toJSON || ((doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject({ virtuals: true }) : doc));
  const normalizeObjectId = deps.normalizeObjectId || ((id) => id);
  const createAdminNotification = deps.createAdminNotification || (async () => null);
  const createSellerOrderNotifications = deps.createSellerOrderNotifications || (async () => []);

  function orderIdQuery(id = '') {
    const value = String(id || '').trim();
    const oid = normalizeObjectId(value);
    if (oid) return { _id: oid };
    return {
      $or: [
        { orderId: value },
        { 'payment.externalReference': value },
        { 'payment.externalId': value },
        { trackingCode: value }
      ]
    };
  }

  function userCanAccessOrder(req, order = {}) {
    if (!req?.user || !order) return false;
    const role = String(req.user.role || req.auth?.role || '').toLowerCase();
    if (role === 'admin') return true;
    const userId = String(req.user._id || req.user.id || req.auth?.id || '');
    const orderUserId = String(order.userId || '');
    if (userId && orderUserId && userId === orderUserId) return true;
    const userEmail = String(req.user.email || req.auth?.email || '').trim().toLowerCase();
    const orderEmail = String(order.customerEmail || '').trim().toLowerCase();
    return Boolean(userEmail && orderEmail && userEmail === orderEmail);
  }

  function normalizeStatusPayload(body = {}) {
    const status = String(body.status || body.statusLabel || body.statusAtual || '').trim();
    const trackingCode = String(body.trackingCode || body.codigoRastreio || body.rastreio || '').trim();
    const notes = String(body.notes || body.observacao || body.observacoes || '').trim();
    const patch = {};
    if (status) {
      patch.status = status;
      patch.statusLabel = body.statusLabel || status;
    }
    if (trackingCode) patch.trackingCode = trackingCode;
    if (notes) patch.notes = notes;
    patch.updatedAt = new Date();
    return patch;
  }

  async function updateOrderById(req, res) {
    try {
      if (!Order) return res.status(500).json({ ok: false, error: 'Model Order não injetado no módulo de pedidos' });
      const query = orderIdQuery(req.params.id || req.params.orderId);
      const order = await Order.findOne(query);
      if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado' });

      const beforeStatus = String(order.status || '');
      const beforeTracking = String(order.trackingCode || '');
      const patch = normalizeStatusPayload(req.body || {});
      Object.assign(order, patch);

      if (patch.status || patch.trackingCode) {
        order.trackingHistory = Array.isArray(order.trackingHistory) ? order.trackingHistory : [];
        order.trackingHistory.push({
          status: order.status || '',
          statusLabel: order.statusLabel || order.status || '',
          trackingCode: order.trackingCode || '',
          at: new Date(),
          source: 'orderRoutes',
          updatedBy: req.admin?.email || req.user?.email || req.auth?.email || 'system'
        });
      }

      await order.save();

      const changedStatus = beforeStatus !== String(order.status || '');
      const changedTracking = beforeTracking !== String(order.trackingCode || '');
      if (changedStatus || changedTracking) {
        await createAdminNotification({
          type: 'order_updated',
          title: 'Pedido atualizado',
          message: `Pedido ${String(order._id).slice(-8).toUpperCase()} atualizado para ${order.statusLabel || order.status || 'Atualizado'}.`,
          relatedId: String(order._id),
          severity: 'info'
        }).catch(() => null);

        await createSellerOrderNotifications(order, {
          type: 'seller_order_updated',
          title: 'Pedido atualizado',
          origin: 'orderRoutes'
        }).catch(() => []);
      }

      return res.json({ ok: true, order: toJSON(order) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao atualizar pedido' });
    }
  }

  // Cliente: criar pedido permanece no server.js original por segurança.
  // Esta etapa modulariza listagem/consulta/atualização, mantendo compatibilidade total.
  router.get('/orders/me', authRequired, async (req, res) => {
    try {
      if (!Order) return res.status(500).json({ ok: false, error: 'Model Order não injetado no módulo de pedidos' });
      const rows = await Order.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(500);
      return res.json(rows.map(toJSON));
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar pedidos do cliente' });
    }
  });

  router.get('/orders/:id', authRequired, async (req, res) => {
    try {
      if (!Order) return res.status(500).json({ ok: false, error: 'Model Order não injetado no módulo de pedidos' });
      const order = await Order.findOne(orderIdQuery(req.params.id));
      if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado' });
      if (!userCanAccessOrder(req, order)) return res.status(403).json({ ok: false, error: 'Sem permissão' });
      return res.json(toJSON(order));
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao consultar pedido' });
    }
  });

  router.patch('/orders/:id/status', authRequired, updateOrderById);

  router.get('/admin/orders', adminRequired, async (req, res) => {
    try {
      if (!Order) return res.status(500).json({ ok: false, error: 'Model Order não injetado no módulo de pedidos' });
      const limit = Math.min(Number(req.query.limit || 500), 1000);
      const status = String(req.query.status || '').trim();
      const search = String(req.query.search || req.query.q || '').trim();
      const query = {};
      if (status) query.status = status;
      if (search) {
        const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        query.$or = [
          { customerName: new RegExp(safe, 'i') },
          { customerEmail: new RegExp(safe, 'i') },
          { customerPhone: new RegExp(safe, 'i') },
          { trackingCode: new RegExp(safe, 'i') }
        ];
      }
      const rows = await Order.find(query).sort({ createdAt: -1 }).limit(limit);
      return res.json(rows.map(toJSON));
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar pedidos' });
    }
  });

  router.get('/admin/orders/:id', adminRequired, async (req, res) => {
    try {
      if (!Order) return res.status(500).json({ ok: false, error: 'Model Order não injetado no módulo de pedidos' });
      const order = await Order.findOne(orderIdQuery(req.params.id));
      if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado' });
      return res.json(toJSON(order));
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao consultar pedido' });
    }
  });

  router.patch('/admin/orders/:id', adminRequired, updateOrderById);
  router.patch('/admin/orders/:id/status', adminRequired, updateOrderById);

  return router;
}
