import registerCieloSecurityBase from './cieloRoutesSecurityBase.js';
import {
  reconcileStockReservationFromOrder
} from '../services/stockReservationService.js';

// ============================================================
// CIELO - VÍNCULO COM RESERVA DE ESTOQUE
// A camada financeira completa permanece preservada em
// cieloRoutesSecurityBase.js. Este arquivo acrescenta somente a
// garantia de que cartão não autorize/capture estoque já liberado.
// ============================================================

export default function registerCieloRoutes(app, context = {}) {
  const {
    Order,
    Product,
    createAdminNotification
  } = context;

  function pathOnly(req = {}) {
    return String(req.path || req.originalUrl || '')
      .split('?')[0]
      .replace(/\/+$/, '');
  }

  async function getRawOrder(orderId) {
    const raw = String(orderId || '').trim();
    if (!raw || !Order?.collection) return null;
    let oid = raw;
    try { oid = Order.schema.path('_id').cast(raw); } catch (_error) { return null; }
    return Order.collection.findOne(
      { _id: oid },
      { projection: { stockReservation: 1, status: 1, payment: 1 } }
    );
  }

  async function reservationEligibility(orderId) {
    const order = await getRawOrder(orderId);
    if (!order) {
      return { ok: false, status: 404, code: 'ORDER_NOT_FOUND', error: 'Pedido não encontrado.' };
    }

    const status = String(order?.stockReservation?.status || '').trim().toLowerCase();
    // Compatibilidade com pedidos feitos antes desta correção.
    if (!status || status === 'reserved' || status === 'committed') {
      return { ok: true, order, reservationStatus: status || 'legacy' };
    }

    if (status === 'released') {
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
      error: 'A reserva de estoque deste pedido precisa de revisão antes do pagamento.'
    };
  }

  async function flagStockReview(orderId, result = {}) {
    const raw = String(orderId || '').trim();
    if (!raw || !Order?.collection) return;
    let oid = raw;
    try { oid = Order.schema.path('_id').cast(raw); } catch (_error) { return; }

    const at = new Date();
    await Order.collection.updateOne(
      { _id: oid },
      {
        $set: {
          status: 'payment_review',
          statusLabel: 'Pagamento em revisão de estoque',
          'payment.stockReviewRequired': true,
          'payment.stockReviewReason': String(result?.error || result?.reason || 'stock_reconciliation_failed').slice(0, 500),
          'payment.stockReviewAt': at,
          updatedAt: at
        }
      }
    ).catch(() => null);

    if (typeof createAdminNotification === 'function') {
      await createAdminNotification({
        type: 'payment_stock_conflict',
        title: 'Pagamento Cielo exige revisão de estoque',
        message: `Pedido ${raw}: houve confirmação financeira, mas a reserva de estoque não pôde ser consolidada automaticamente.`,
        relatedId: raw,
        severity: 'error',
        metadata: { provider: 'cielo', result }
      }).catch(() => null);
    }
  }

  if (Order && Product) {
    app.use(async (req, res, next) => {
      if (req.method !== 'POST') return next();
      const route = pathOnly(req);
      if (![
        '/api/payments/cielo/sop/access-token',
        '/api/payments/cielo/credit',
        '/api/payments/cielo/capture'
      ].includes(route)) return next();

      const orderId = String(
        req.body?.orderId ||
        req.body?.order_id ||
        req.body?.merchantOrderId ||
        ''
      ).trim();
      if (!orderId) return next(); // A camada financeira retorna o erro contratual apropriado.

      try {
        const eligibility = await reservationEligibility(orderId);
        if (!eligibility.ok) {
          return res.status(eligibility.status).json({
            ok: false,
            approved: false,
            provider: 'cielo',
            error: eligibility.error,
            code: eligibility.code
          });
        }

        // Access-token apenas prepara o formulário; não altera estado financeiro.
        if (route === '/api/payments/cielo/sop/access-token') return next();

        const originalJson = res.json.bind(res);
        let handled = false;
        res.json = function stockAwareCieloJson(payload) {
          if (handled) return originalJson(payload);
          handled = true;

          Promise.resolve(reconcileStockReservationFromOrder({
            Order,
            Product,
            orderId,
            origin: route === '/api/payments/cielo/capture' ? 'cielo_capture' : 'cielo_credit'
          }))
            .then(async (result) => {
              if (result?.reviewRequired || result?.ok === false) {
                await flagStockReview(orderId, result);
                res.status(202);
                return originalJson({
                  ...(payload && typeof payload === 'object' ? payload : {}),
                  ok: true,
                  provider: 'cielo',
                  reviewRequired: true,
                  status: 'payment_review',
                  statusLabel: 'Pagamento recebido - estoque em revisão',
                  warning: 'O pagamento foi recebido, mas o pedido precisa de validação de estoque antes do envio.'
                });
              }
              return originalJson(payload);
            })
            .catch(async (error) => {
              await flagStockReview(orderId, { error: error?.message || String(error) });
              res.status(202);
              return originalJson({
                ...(payload && typeof payload === 'object' ? payload : {}),
                ok: true,
                provider: 'cielo',
                reviewRequired: true,
                status: 'payment_review',
                statusLabel: 'Pagamento recebido - estoque em revisão',
                warning: 'O pagamento foi recebido, mas a validação de estoque precisa de revisão manual.'
              });
            });

          return res;
        };

        return next();
      } catch (error) {
        console.error('[CIELO STOCK SECURITY]', error?.message || error);
        return res.status(503).json({
          ok: false,
          approved: false,
          provider: 'cielo',
          error: 'Não foi possível validar a reserva de estoque antes do pagamento.',
          code: 'STOCK_RESERVATION_VALIDATION_FAILED'
        });
      }
    });
  }

  return registerCieloSecurityBase(app, context);
}
