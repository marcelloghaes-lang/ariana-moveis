import { createMercadoPagoGateway } from './gateways/mercadoPagoGateway.js';
import { createPagarmeGateway } from './gateways/pagarmeGateway.js';

function clean(value = '', max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function mapMercadoPagoStatus(status = '') {
  const value = clean(status, 100).toLowerCase();
  if (value === 'approved') return 'approved';
  if (['rejected', 'cancelled', 'cancelled_by_admin', 'refunded', 'charged_back'].includes(value)) {
    return 'rejected';
  }
  if (['in_process', 'in_mediation', 'authorized'].includes(value)) return 'under_review';
  return 'pending';
}

function mapPagarmeStatus(status = '', eventType = '') {
  const value = clean(status, 100).toLowerCase();
  const event = clean(eventType, 100).toLowerCase();

  if (
    ['paid', 'closed'].includes(value) ||
    ['order.paid', 'charge.paid'].includes(event)
  ) return 'approved';

  if (
    ['failed', 'canceled', 'cancelled', 'payment_failed', 'chargedback'].includes(value) ||
    ['order.payment_failed', 'order.canceled', 'charge.payment_failed', 'charge.chargedback'].includes(event)
  ) return 'rejected';

  if (
    ['pending', 'processing'].includes(value) ||
    ['charge.pending', 'charge.processing'].includes(event)
  ) return 'under_review';

  return 'pending';
}

export function createPaymentGatewayService(context = {}) {
  const mercadoPago = createMercadoPagoGateway(context);
  const pagarme = createPagarmeGateway(context);

  async function createPix(order, payload = {}) {
    return mercadoPago.createPix({
      order,
      payer: payload.payer || payload.customer || payload,
      idempotencyKey: payload.idempotencyKey || `televendas-pix-${order._id}`
    });
  }

  async function createCard(order, payload = {}) {
    return pagarme.createCardOrder({
      order,
      cardToken: payload.cardToken,
      cardId: payload.cardId,
      payer: payload.payer || payload.customer || payload,
      installments: payload.installments || order.payment?.installments || 1,
      statementDescriptor: payload.statementDescriptor || 'ARIANA MOVEIS'
    });
  }

  async function parseMercadoPagoWebhook({ headers, query, body }) {
    const verification = mercadoPago.verifyWebhook({ headers, query, body });
    if (!verification.valid) {
      const error = new Error('Assinatura do webhook Mercado Pago inválida.');
      error.statusCode = 401;
      error.code = 'INVALID_MP_SIGNATURE';
      throw error;
    }

    const paymentId = clean(
      body?.data?.id ||
      query?.['data.id'] ||
      query?.id ||
      body?.id ||
      '',
      300
    );

    if (!paymentId) {
      return {
        ignored: true,
        reason: 'payment_id_not_found',
        verification
      };
    }

    const payment = await mercadoPago.getPayment(paymentId);
    return {
      ignored: false,
      provider: 'mercadopago',
      method: 'pix',
      externalId: String(payment.id || paymentId),
      orderId: String(payment.external_reference || payment.metadata?.order_id || ''),
      normalizedStatus: mapMercadoPagoStatus(payment.status),
      providerStatus: payment.status || '',
      payload: payment,
      verification
    };
  }

  async function parsePagarmeWebhook({ headers, query, body }) {
    const verification = pagarme.verifyWebhook({ headers, query, body });
    if (!verification.valid) {
      const error = new Error('Segredo do webhook Pagar.me inválido.');
      error.statusCode = 401;
      error.code = 'INVALID_PAGARME_SECRET';
      throw error;
    }

    const eventType = clean(body?.type || body?.event || '', 120);
    const data = body?.data || body || {};
    const orderData = data.order || data;
    const charge = data.charge || orderData.charges?.[0] || {};
    const transaction = charge.last_transaction || {};

    const externalId = clean(orderData.id || data.id || '', 300);
    const orderId = clean(
      orderData.code ||
      orderData.metadata?.ariana_order_id ||
      data.metadata?.ariana_order_id ||
      '',
      300
    );
    const providerStatus = clean(
      orderData.status ||
      charge.status ||
      transaction.status ||
      '',
      100
    );

    return {
      ignored: false,
      provider: 'pagarme',
      method: 'card',
      externalId,
      chargeId: clean(charge.id || '', 300),
      transactionId: clean(transaction.id || '', 300),
      orderId,
      normalizedStatus: mapPagarmeStatus(providerStatus, eventType),
      providerStatus,
      eventType,
      payload: body,
      verification
    };
  }

  return {
    createPix,
    createCard,
    parseMercadoPagoWebhook,
    parsePagarmeWebhook
  };
}
