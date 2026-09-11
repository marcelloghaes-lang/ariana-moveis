import {
  finalizeStockReservationForApprovedPayment,
  persistInitialStockReservation,
  reconcileStockReservationFromOrder,
  releaseStockReservationForFailedPayment,
  startStockReservationSweeper
} from '../services/stockReservationService.js';

// ============================================================
// CHECKOUT - CICLO DE ESTOQUE
// Registra a reserva depois que o pedido é criado, libera em falha/cancelamento
// e confirma antes de aceitar um pagamento aprovado fora do prazo da reserva.
// ============================================================

export default function registerStorefrontStockSecurity(app, context = {}) {
  const {
    Order,
    Product,
    createAdminNotification,
    getMercadoPagoPaymentById,
    resolveOrderIdFromMpPayment
  } = context;

  if (!app || !Order || !Product) {
    throw new Error('[STOCK SECURITY] app, Order e Product são obrigatórios.');
  }

  startStockReservationSweeper({ Order, Product });

  function pathOnly(req = {}) {
    return String(req.path || req.originalUrl || '')
      .split('?')[0]
      .replace(/\/+$/, '');
  }

  function paymentMethodFromOrder(order = {}, fallback = '') {
    return String(order?.payment?.method || order?.payment?.type || fallback || '').trim();
  }

  function responseOrder(payload = {}) {
    if (!payload || typeof payload !== 'object') return null;
    return payload.order || payload.orderUpdate || payload.data?.order || null;
  }

  function responseOrderId(payload = {}, fallback = '') {
    const order = responseOrder(payload) || {};
    return String(order._id || order.id || payload.orderId || fallback || '').trim();
  }

  async function rawOrder(orderId, projection = {}) {
    const raw = String(orderId || '').trim();
    if (!raw) return null;
    let oid = raw;
    try { oid = Order.schema.path('_id').cast(raw); } catch (_error) { return null; }
    return Order.collection.findOne({ _id: oid }, Object.keys(projection).length ? { projection } : undefined);
  }

  async function ensureReservationCanStartPayment(orderId) {
    const order = await rawOrder(orderId, { stockReservation: 1, status: 1, payment: 1 });
    if (!order) return { ok: false, status: 404, code: 'ORDER_NOT_FOUND', error: 'Pedido não encontrado.' };
    const reservationStatus = String(order?.stockReservation?.status || '').trim().toLowerCase();

    // Pedidos antigos não tinham marcador e continuam compatíveis.
    if (!reservationStatus || reservationStatus === 'reserved' || reservationStatus === 'committed') {
      return { ok: true, order, reservationStatus: reservationStatus || 'legacy' };
    }

    if (reservationStatus === 'released') {
      return {
        ok: false,
        status: 409,
        code: 'STOCK_RESERVATION_EXPIRED',
        error: 'A reserva de estoque deste pedido expirou. Refaça o pedido para validar o estoque atual.'
      };
    }

    return {
      ok: false,
      status: 409,
      code: 'STOCK_RESERVATION_REVIEW_REQUIRED',
      error: 'A reserva de estoque deste pedido precisa de revisão antes de uma nova tentativa de pagamento.'
    };
  }

  async function markPaidStockConflict(orderId, provider, paymentId, detail = '') {
    const raw = String(orderId || '').trim();
    let oid = raw;
    try { oid = Order.schema.path('_id').cast(raw); } catch (_error) { return; }
    const at = new Date();
    await Order.collection.updateOne(
      { _id: oid },
      {
        $set: {
          status: 'payment_review',
          statusLabel: 'Pagamento aprovado - revisar estoque',
          'payment.provider': provider,
          'payment.status': 'approved',
          'payment.paymentId': String(paymentId || ''),
          'payment.stockReviewRequired': true,
          'payment.stockReviewReason': String(detail || 'stock_unavailable_after_payment').slice(0, 500),
          'payment.stockReviewAt': at,
          updatedAt: at
        }
      }
    );

    if (typeof createAdminNotification === 'function') {
      await createAdminNotification({
        type: 'payment_stock_conflict',
        title: 'Pagamento aprovado com conflito de estoque',
        message: `Pedido ${raw}: pagamento confirmado, mas o estoque não pôde ser revalidado. Não enviar ao fabricante antes da revisão.`,
        relatedId: raw,
        severity: 'error',
        metadata: { provider, paymentId: String(paymentId || ''), detail: String(detail || '') }
      }).catch(() => null);
    }
  }

  // 1) Depois da criação do pedido, grava o marcador da reserva antes de responder ao checkout.
  app.use((req, res, next) => {
    if (req.method !== 'POST' || pathOnly(req) !== '/api/orders') return next();

    const originalJson = res.json.bind(res);
    let handled = false;
    res.json = function stockAwareOrderJson(payload) {
      if (handled) return originalJson(payload);
      handled = true;

      const statusCode = Number(res.statusCode || 200);
      const order = responseOrder(payload);
      const orderId = responseOrderId(payload);
      if (statusCode < 200 || statusCode >= 300 || !orderId || !order) return originalJson(payload);

      const items = Array.isArray(order.items) ? order.items : [];
      const method = paymentMethodFromOrder(order, req.body?.payment?.method || '');
      Promise.resolve(persistInitialStockReservation({ Order, orderId, items, method, at: new Date() }))
        .then((result) => {
          if (!result?.ok) console.error('[STOCK SECURITY] Não foi possível registrar reserva do pedido', orderId, result);
          return originalJson(payload);
        })
        .catch((error) => {
          console.error('[STOCK SECURITY] Erro ao registrar reserva do pedido', orderId, error?.message || error);
          return originalJson(payload);
        });
      return res;
    };

    return next();
  });

  // 2) Pedido cuja reserva já expirou não pode iniciar uma nova cobrança usando estoque antigo.
  app.use(async (req, res, next) => {
    if (req.method !== 'POST') return next();
    const route = pathOnly(req);
    const guarded = new Set([
      '/api/payments/mp/pix',
      '/api/payments/mp/boleto',
      '/api/payments/mp/card',
      '/api/payments/mp/credit'
    ]);
    if (!guarded.has(route)) return next();

    const orderId = String(req.body?.orderId || req.body?.order_id || '').trim();
    if (!orderId) return next();
    const eligibility = await ensureReservationCanStartPayment(orderId);
    if (!eligibility.ok) {
      return res.status(eligibility.status).json({
        ok: false,
        error: eligibility.error,
        code: eligibility.code
      });
    }

    // Após a resposta do gateway, confirma/libera a reserva conforme o estado salvo no pedido.
    const originalJson = res.json.bind(res);
    let handled = false;
    res.json = function stockAwarePaymentJson(payload) {
      if (handled) return originalJson(payload);
      handled = true;
      Promise.resolve(reconcileStockReservationFromOrder({ Order, Product, orderId, origin: route.replace(/[^a-z0-9]+/gi, '_') }))
        .then((result) => {
          if (result?.reviewRequired) console.error('[STOCK SECURITY] Revisão necessária', orderId, result);
          return originalJson(payload);
        })
        .catch((error) => {
          console.error('[STOCK SECURITY] Reconciliação de estoque falhou', orderId, error?.message || error);
          return originalJson(payload);
        });
      return res;
    };

    return next();
  });

  // 3) Webhook Mercado Pago: antes de o fluxo legado marcar a venda como concluída
  // e enviá-la ao fabricante, garante que a reserva ainda existe ou consegue
  // rebaixar o estoque de forma segura caso ela já tenha expirado.
  app.use(async (req, res, next) => {
    if (req.method !== 'POST' || pathOnly(req) !== '/api/webhooks/mercadopago') return next();
    if (typeof getMercadoPagoPaymentById !== 'function' || typeof resolveOrderIdFromMpPayment !== 'function') return next();

    try {
      const paymentId = String(req.body?.data?.id || req.body?.id || '').trim();
      if (!paymentId) return next();
      const mpData = await getMercadoPagoPaymentById(paymentId);
      const orderId = String(resolveOrderIdFromMpPayment(mpData || {}, '') || '').trim();
      if (!orderId) return next();
      const status = String(mpData?.status || '').trim().toLowerCase();

      if (status === 'approved') {
        const stock = await finalizeStockReservationForApprovedPayment({
          Order,
          Product,
          orderId,
          reason: 'mercadopago_webhook_approved'
        });
        if (!stock?.ok) {
          await markPaidStockConflict(orderId, 'mercadopago', paymentId, stock?.error || stock?.reason || 'stock_validation_failed');
          return res.status(200).json({
            ok: true,
            received: true,
            reviewRequired: true,
            orderId,
            paymentId,
            reason: 'payment_approved_stock_unavailable'
          });
        }
      } else if (['rejected', 'cancelled', 'canceled', 'failed', 'voided'].includes(status)) {
        await releaseStockReservationForFailedPayment({
          Order,
          Product,
          orderId,
          reason: `mercadopago_webhook_${status}`
        });
      }

      return next();
    } catch (error) {
      // A camada anterior de segurança do Mercado Pago é a autoridade da validação.
      // Aqui não inventamos aprovação; apenas deixamos o fluxo existente tratar o erro.
      console.error('[STOCK SECURITY] Webhook MP:', error?.message || error);
      return next();
    }
  });

  // 4) Cancelamentos/recusas administrativas devolvem a reserva uma única vez.
  app.use((req, res, next) => {
    if (!['PATCH', 'PUT'].includes(req.method)) return next();
    const route = pathOnly(req);
    const match = route.match(/^\/api\/(?:admin\/)?orders\/([^/]+)(?:\/status)?$/i);
    if (!match) return next();
    const orderId = String(match[1] || '').trim();
    if (!orderId) return next();

    const originalJson = res.json.bind(res);
    let handled = false;
    res.json = function stockAwareStatusJson(payload) {
      if (handled) return originalJson(payload);
      handled = true;
      Promise.resolve(reconcileStockReservationFromOrder({ Order, Product, orderId, origin: 'order_status_update' }))
        .then(() => originalJson(payload))
        .catch((error) => {
          console.error('[STOCK SECURITY] Status/estoque:', error?.message || error);
          return originalJson(payload);
        });
      return res;
    };
    return next();
  });
}
