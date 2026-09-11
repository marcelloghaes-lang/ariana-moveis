import registerCoraSecureBase from './coraRoutesSecureBase.js';
import { getCoraChargeModel } from '../integrations/cora/coraChargeModel.js';
import {
  finalizeStockReservationForApprovedPayment,
  reconcileStockReservationFromOrder
} from '../services/stockReservationService.js';

// ============================================================
// CORA - VÍNCULO COM RESERVA DE ESTOQUE
// A validação oficial do webhook (cabeçalhos + consulta autenticada à Cora)
// permanece integralmente preservada em coraRoutesSecureBase.js.
// Esta camada garante apenas consistência entre crediário e estoque.
// ============================================================

export default function registerCoraRoutes(app, context = {}) {
  const { mongoose, Order } = context;
  const Product = mongoose?.models?.Product || null;
  const CoraCharge = mongoose ? getCoraChargeModel(mongoose) : null;

  function pathOnly(req = {}) {
    return String(req.path || req.originalUrl || '')
      .split('?')[0]
      .replace(/\/+$/, '');
  }

  async function rawOrder(orderId) {
    const raw = String(orderId || '').trim();
    if (!raw || !Order?.collection) return null;
    let oid = raw;
    try { oid = Order.schema.path('_id').cast(raw); } catch (_error) { return null; }
    return Order.collection.findOne({ _id: oid });
  }

  async function canUseReservedStock(orderId) {
    const order = await rawOrder(orderId);
    if (!order) return { ok: false, status: 404, code: 'ORDER_NOT_FOUND', error: 'Pedido não encontrado.' };
    const status = String(order?.stockReservation?.status || '').trim().toLowerCase();

    // Pedidos anteriores à implantação da reserva continuam compatíveis.
    if (!status || status === 'reserved' || status === 'committed') return { ok: true, order };
    if (status === 'released') {
      return {
        ok: false,
        status: 409,
        code: 'STOCK_RESERVATION_EXPIRED',
        error: 'A reserva de estoque deste pedido expirou. Refaça o pedido para validar a disponibilidade atual.'
      };
    }
    return {
      ok: false,
      status: 409,
      code: 'STOCK_RESERVATION_REVIEW_REQUIRED',
      error: 'A reserva de estoque deste pedido precisa de revisão antes de emitir o crediário.'
    };
  }

  async function markStockReview(orderId, detail = '') {
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
          statusLabel: 'Crediário em revisão de estoque',
          'payment.stockReviewRequired': true,
          'payment.stockReviewReason': String(detail || 'stock_reconciliation_failed').slice(0, 500),
          'payment.stockReviewAt': at,
          updatedAt: at
        }
      }
    ).catch(() => null);

    const Notification = mongoose?.models?.Notification;
    if (Notification) {
      await Notification.create({
        type: 'payment_stock_conflict',
        title: 'Crediário Cora exige revisão de estoque',
        message: `Pedido ${raw}: o crediário foi processado, mas o estoque precisa de revisão antes da expedição.`,
        relatedId: raw,
        severity: 'error',
        audience: 'admin',
        metadata: { provider: 'cora', detail: String(detail || '') }
      }).catch(() => null);
    }
  }

  if (Order && Product) {
    // A emissão do carnê é o fechamento financeiro do crediário. Por isso o
    // estoque reservado deixa de expirar quando a Cora confirma a emissão.
    app.use(async (req, res, next) => {
      if (req.method !== 'POST' || pathOnly(req) !== '/api/payments/cora/carne') return next();
      const orderId = String(req.body?.orderId || req.body?.pedidoId || req.body?.externalId || '').trim();
      if (!orderId) return next();

      try {
        const eligibility = await canUseReservedStock(orderId);
        if (!eligibility.ok) {
          return res.status(eligibility.status).json({
            ok: false,
            error: eligibility.error,
            code: eligibility.code
          });
        }

        const originalJson = res.json.bind(res);
        let handled = false;
        res.json = function stockAwareCoraIssueJson(payload) {
          if (handled) return originalJson(payload);
          handled = true;
          const successfulIssue = Number(res.statusCode || 200) >= 200 && Number(res.statusCode || 200) < 300 && payload?.ok === true && (payload?.charge || payload?.carne);
          if (!successfulIssue) return originalJson(payload);

          Promise.resolve(finalizeStockReservationForApprovedPayment({
            Order,
            Product,
            orderId,
            reason: 'cora_installment_book_issued'
          }))
            .then(async (stock) => {
              if (!stock?.ok) {
                await markStockReview(orderId, stock?.error || stock?.reason || 'stock_commit_failed');
                res.status(202);
                return originalJson({
                  ...payload,
                  reviewRequired: true,
                  stockStatus: 'review_required',
                  warning: 'O crediário foi emitido, mas o estoque precisa ser validado antes da expedição.'
                });
              }
              return originalJson(payload);
            })
            .catch(async (error) => {
              await markStockReview(orderId, error?.message || String(error));
              res.status(202);
              return originalJson({
                ...payload,
                reviewRequired: true,
                stockStatus: 'review_required',
                warning: 'O crediário foi emitido, mas houve falha na consolidação do estoque.'
              });
            });
          return res;
        };

        return next();
      } catch (error) {
        return res.status(503).json({
          ok: false,
          error: 'Não foi possível validar a reserva de estoque antes de emitir o crediário.',
          code: 'STOCK_RESERVATION_VALIDATION_FAILED'
        });
      }
    });

    // Depois que o webhook oficial da Cora foi autenticado/consultado pela camada
    // preservada, reconcilia apenas o estoque do pedido correspondente.
    app.use((req, res, next) => {
      if (req.method !== 'POST' || pathOnly(req) !== '/api/webhooks/cora') return next();

      const resourceId = String(
        req.headers['webhook-resource-id'] ||
        req.body?.id ||
        req.body?.invoice?.id ||
        req.body?.data?.id ||
        ''
      ).trim();

      const originalJson = res.json.bind(res);
      let handled = false;
      res.json = function stockAwareCoraWebhookJson(payload) {
        if (handled) return originalJson(payload);
        handled = true;
        if (!payload?.matched || !resourceId || !CoraCharge) return originalJson(payload);

        Promise.resolve(
          CoraCharge.findOne({
            $or: [
              { 'invoices.id': resourceId },
              { 'invoices.invoice_id': resourceId },
              { 'invoices.invoiceId': resourceId }
            ]
          }).sort({ createdAt: -1 }).lean()
        )
          .then(async (charge) => {
            const orderId = String(charge?.orderId || '').trim();
            if (!orderId) return originalJson(payload);
            const stock = await reconcileStockReservationFromOrder({
              Order,
              Product,
              orderId,
              origin: 'cora_verified_webhook'
            });
            if (stock?.reviewRequired || stock?.ok === false) {
              await markStockReview(orderId, stock?.error || stock?.reason || 'stock_reconciliation_failed');
            }
            return originalJson(payload);
          })
          .catch((error) => {
            console.error('[CORA STOCK SECURITY]', error?.message || error);
            return originalJson(payload);
          });

        return res;
      };

      return next();
    });
  }

  return registerCoraSecureBase(app, context);
}
