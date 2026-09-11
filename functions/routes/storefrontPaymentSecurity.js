// ============================================================
// SEGURANÇA DE CHECKOUT / MERCADO PAGO
// Camada de integridade registrada antes das rotas legadas.
// Não altera nem intercepta rotas Pagar.me.
// ============================================================

export default function registerStorefrontPaymentSecurity(app, context = {}) {
  const {
    APP_BASE_URL,
    Order,
    axios,
    crypto,
    getPaymentsSettings
  } = context;

  const mpCache = new Map();

  function nowDate() {
    return typeof context.now === 'function' ? context.now() : new Date();
  }

  function pathOnly(req = {}) {
    return String(req.path || req.originalUrl || '')
      .split('?')[0]
      .replace(/\/+$/, '');
  }

  function normalizeMethod(value = '') {
    const method = String(value || '').trim().toLowerCase();
    if (!method) return '';
    if (method === 'pix' || method.includes('pix')) return 'pix';
    if (method === 'boleto' || method.includes('boleto') || method === 'bolbradesco') return 'boleto';
    if (
      method === 'card' ||
      method === 'credit' ||
      method === 'credit_card' ||
      method.includes('cartao') ||
      method.includes('cartão') ||
      method.includes('credit')
    ) return 'card';
    return method;
  }

  function normalizeProvider(value = '') {
    return String(value || '').trim().toLowerCase().replace(/[._\s-]+/g, '');
  }

  function cents(value = 0) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return 0;
    return Math.round(number * 100);
  }

  function getOrderTotal(order = null) {
    if (!order) return 0;
    const value = Number(order.total || 0);
    return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 0;
  }

  function paymentStatus(order = null) {
    return String(order?.payment?.status || '').trim().toLowerCase();
  }

  function orderIsPaid(order = null) {
    const status = String(order?.status || '').trim().toLowerCase();
    const pStatus = paymentStatus(order);
    return [
      'pago',
      'paid',
      'payment_confirmed',
      'pagamento_autorizado'
    ].includes(status) || ['approved', 'paid', 'captured', 'authorized'].includes(pStatus);
  }

  function paymentCanRetry(order = null) {
    return ['rejected', 'denied', 'failed', 'cancelled', 'canceled', 'voided', 'pagamento_recusado']
      .includes(paymentStatus(order));
  }

  function safePaymentIntent(body = {}) {
    const source = body.payment && typeof body.payment === 'object' ? body.payment : {};
    const provider = String(source.provider || body.paymentProvider || body.provider || '').trim().toLowerCase();
    const method = normalizeMethod(source.method || source.type || body.paymentMethod || '');
    const installmentsRaw = Number(source.installments || body.installments || 0);
    const installments = Number.isInteger(installmentsRaw) && installmentsRaw >= 1 && installmentsRaw <= 12
      ? installmentsRaw
      : undefined;

    const payment = {};
    if (provider) payment.provider = provider;
    if (method) {
      payment.method = method;
      payment.type = method === 'card' ? 'credit_card' : method;
    }
    if (installments) payment.installments = installments;
    return payment;
  }

  function mercadoPagoNotificationUrl() {
    const base = String(APP_BASE_URL || '').trim().replace(/\/+$/, '');
    if (!base) return '';
    return `${base}/api/webhooks/mercadopago`;
  }

  function mercadoPagoOrderId(mpData = {}) {
    return String(
      mpData?.external_reference ||
      mpData?.metadata?.orderId ||
      mpData?.metadata?.order_id ||
      mpData?.metadata?.orderid ||
      ''
    ).trim();
  }

  function mercadoPagoMethod(mpData = {}) {
    const methodId = normalizeMethod(mpData?.payment_method_id || '');
    const paymentType = String(mpData?.payment_type_id || '').trim().toLowerCase();

    // Para cartão, payment_method_id normalmente é a bandeira (Visa/Master),
    // enquanto payment_type_id informa credit_card/debit_card. Para Pix e boleto,
    // o identificador do método continua sendo a referência mais específica.
    if (methodId === 'pix') return 'pix';
    if (methodId === 'boleto' || paymentType === 'ticket' || paymentType === 'atm') return 'boleto';
    if (['credit_card', 'debit_card', 'prepaid_card'].includes(paymentType)) return 'card';
    return methodId || normalizeMethod(paymentType);
  }

  function apiError(status, message, code = 'PAYMENT_INTEGRITY_ERROR') {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
  }

  async function getMpAccessToken() {
    const settings = typeof getPaymentsSettings === 'function'
      ? await getPaymentsSettings()
      : {};
    const accessToken = String(settings?.mercadopago?.accessToken || process.env.MP_ACCESS_TOKEN || '').trim();
    if (!accessToken) throw apiError(503, 'Mercado Pago access token não configurado.', 'MP_NOT_CONFIGURED');
    return accessToken;
  }

  async function secureGetMercadoPagoPaymentById(paymentId) {
    const id = String(paymentId || '').trim();
    if (!id) throw apiError(400, 'paymentId do Mercado Pago é obrigatório.', 'MP_PAYMENT_ID_REQUIRED');

    const cached = mpCache.get(id);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    const accessToken = await getMpAccessToken();
    const response = await axios.get(
      `https://api.mercadopago.com/v1/payments/${encodeURIComponent(id)}`,
      {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        timeout: 30000,
        validateStatus: () => true
      }
    );

    if (response.status < 200 || response.status >= 300) {
      throw apiError(
        response.status || 502,
        response.data?.message || `Mercado Pago HTTP ${response.status}`,
        'MP_PAYMENT_LOOKUP_FAILED'
      );
    }

    const mpData = response.data || {};
    const orderId = mercadoPagoOrderId(mpData);
    if (!orderId) {
      throw apiError(409, 'Pagamento Mercado Pago sem vínculo verificável com um pedido Ariana.', 'MP_ORDER_REFERENCE_MISSING');
    }

    const order = Order ? await Order.findById(orderId).catch(() => null) : null;
    if (!order) {
      throw apiError(404, 'Pedido vinculado ao pagamento Mercado Pago não encontrado.', 'MP_ORDER_NOT_FOUND');
    }

    const expectedCents = cents(getOrderTotal(order));
    const paidCents = cents(mpData.transaction_amount);
    if (!expectedCents || !paidCents || expectedCents !== paidCents) {
      throw apiError(409, 'Valor retornado pelo Mercado Pago não confere com o total salvo do pedido.', 'MP_AMOUNT_MISMATCH');
    }

    const currency = String(mpData.currency_id || 'BRL').trim().toUpperCase();
    if (currency !== 'BRL') {
      throw apiError(409, 'Moeda retornada pelo Mercado Pago não confere com o pedido.', 'MP_CURRENCY_MISMATCH');
    }

    const method = mercadoPagoMethod(mpData);
    const intendedMethod = normalizeMethod(order?.payment?.method || order?.payment?.type || '');
    if (intendedMethod && method && intendedMethod !== method) {
      throw apiError(409, 'Forma de pagamento do Mercado Pago não confere com a escolhida no pedido.', 'MP_METHOD_MISMATCH');
    }

    const provider = normalizeProvider(order?.payment?.provider || '');
    if (provider && provider !== 'mercadopago') {
      throw apiError(409, 'O pedido está vinculado a outro provedor de pagamento.', 'MP_PROVIDER_MISMATCH');
    }

    const existingPaymentId = String(order?.payment?.paymentId || order?.payment?.externalId || '').trim();
    if (existingPaymentId && existingPaymentId !== id && !paymentCanRetry(order)) {
      throw apiError(409, 'O pedido já está vinculado a outra transação de pagamento.', 'MP_PAYMENT_CONFLICT');
    }

    Object.defineProperty(mpData, '_arianaValidatedOrderId', {
      value: String(order._id),
      enumerable: false,
      configurable: true
    });

    mpCache.set(id, { data: mpData, expiresAt: Date.now() + 10000 });
    if (mpCache.size > 500) {
      const cutoff = Date.now();
      for (const [key, value] of mpCache.entries()) {
        if (!value || value.expiresAt <= cutoff) mpCache.delete(key);
      }
    }

    return mpData;
  }

  function resolveOrderIdFromMpPayment(mpData = {}, fallback = '') {
    return String(
      mpData?._arianaValidatedOrderId ||
      mercadoPagoOrderId(mpData) ||
      fallback ||
      ''
    ).trim();
  }

  // O cliente nunca pode criar um pedido já pago nem definir o total final.
  // A rota existente recalcula os itens pelo catálogo; total=0 força o uso desse cálculo.
  app.use((req, _res, next) => {
    if (req.method !== 'POST' || pathOnly(req) !== '/api/orders') return next();
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    body.total = 0;
    body.status = 'pendente';
    body.statusLabel = 'pendente';
    body.payment = safePaymentIntent(body);
    req.body = body;
    return next();
  });

  // Antes das rotas legadas do Mercado Pago, trava valor, método, provedor e concorrência.
  app.use(async (req, res, next) => {
    const route = pathOnly(req);
    if (req.method !== 'POST') return next();

    const methodByRoute = {
      '/api/payments/mp/pix': 'pix',
      '/api/payments/mp/credit': 'card',
      '/api/payments/mp/card': 'card',
      '/api/payments/mp/boleto': 'boleto'
    };
    const expectedMethod = methodByRoute[route];
    if (!expectedMethod) return next();

    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const orderId = String(body.orderId || body.order_id || '').trim();
      if (!orderId) {
        return res.status(400).json({ ok: false, error: 'orderId é obrigatório', code: 'ORDER_ID_REQUIRED' });
      }

      const order = Order ? await Order.findById(orderId).catch(() => null) : null;
      if (!order) {
        return res.status(404).json({ ok: false, error: 'Pedido não encontrado.', code: 'ORDER_NOT_FOUND' });
      }

      if (orderIsPaid(order)) {
        return res.status(409).json({ ok: false, error: 'Este pedido já possui pagamento aprovado.', code: 'ORDER_ALREADY_PAID' });
      }

      const intendedMethod = normalizeMethod(order?.payment?.method || order?.payment?.type || '');
      if (intendedMethod && intendedMethod !== expectedMethod) {
        return res.status(409).json({
          ok: false,
          error: 'A forma de pagamento solicitada não confere com a escolhida no pedido.',
          code: 'PAYMENT_METHOD_MISMATCH'
        });
      }

      const provider = normalizeProvider(order?.payment?.provider || '');
      if (provider && provider !== 'mercadopago') {
        return res.status(409).json({
          ok: false,
          error: 'Este pedido está vinculado a outro provedor de pagamento.',
          code: 'PAYMENT_PROVIDER_MISMATCH'
        });
      }

      const currentPaymentId = String(order?.payment?.paymentId || order?.payment?.externalId || '').trim();
      if (currentPaymentId && !paymentCanRetry(order)) {
        if (expectedMethod === 'pix' || expectedMethod === 'boleto') {
          return res.json({
            ok: true,
            reused: true,
            provider: 'mercadopago',
            method: expectedMethod,
            id: currentPaymentId,
            paymentId: currentPaymentId,
            status: order?.payment?.status || 'pending',
            statusDetail: order?.payment?.statusDetail || '',
            qrCode: order?.payment?.pixCode || order?.payment?.qrCode || order?.payment?.qr_code || '',
            qr_code: order?.payment?.pixCode || order?.payment?.qrCode || order?.payment?.qr_code || '',
            qrCodeBase64: order?.payment?.qrCodeBase64 || order?.payment?.qr_code_base64 || '',
            ticketUrl: order?.payment?.ticketUrl || '',
            ticket_url: order?.payment?.ticketUrl || ''
          });
        }

        return res.status(409).json({
          ok: false,
          error: 'Este pedido já possui uma transação de cartão em andamento.',
          code: 'PAYMENT_ALREADY_IN_PROGRESS',
          paymentId: currentPaymentId
        });
      }

      const total = getOrderTotal(order);
      if (!total) {
        return res.status(409).json({ ok: false, error: 'Total salvo do pedido é inválido.', code: 'ORDER_TOTAL_INVALID' });
      }

      const notificationUrl = mercadoPagoNotificationUrl();
      if (!notificationUrl) {
        return res.status(503).json({
          ok: false,
          error: 'APP_BASE_URL não configurada para receber confirmações do Mercado Pago.',
          code: 'MP_WEBHOOK_URL_NOT_CONFIGURED'
        });
      }

      const lockKey = crypto?.randomBytes
        ? crypto.randomBytes(18).toString('hex')
        : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const startedAt = nowDate();
      const expiresAt = new Date(new Date(startedAt).getTime() + 5 * 60 * 1000);

      const claimed = await Order.findOneAndUpdate(
        {
          _id: order._id,
          $or: [
            { 'payment.securityCreateLock': { $exists: false } },
            { 'payment.securityCreateLock': null },
            { 'payment.securityCreateLock.expiresAt': { $lte: startedAt } }
          ]
        },
        {
          $set: {
            'payment.provider': 'mercadopago',
            'payment.method': expectedMethod,
            'payment.type': expectedMethod === 'card' ? 'credit_card' : expectedMethod,
            'payment.securityCreateLock': {
              key: lockKey,
              provider: 'mercadopago',
              method: expectedMethod,
              startedAt,
              expiresAt
            }
          }
        },
        { new: true }
      );

      if (!claimed) {
        return res.status(409).json({
          ok: false,
          error: 'Já existe uma tentativa de pagamento em processamento para este pedido.',
          code: 'PAYMENT_CREATE_IN_PROGRESS'
        });
      }

      body.orderId = String(order._id);
      body.order_id = String(order._id);
      body.amount = total;
      body.total = total;
      body.transaction_amount = total;
      body.notification_url = notificationUrl;
      req.body = body;

      const originalJson = res.json.bind(res);
      let cleanupScheduled = false;
      res.json = function securePaymentJson(payload) {
        if (!cleanupScheduled) {
          cleanupScheduled = true;
          const statusCode = Number(res.statusCode || 200);
          const shouldRelease = statusCode < 500;
          if (shouldRelease) {
            setImmediate(() => {
              Order.updateOne(
                { _id: order._id, 'payment.securityCreateLock.key': lockKey },
                { $unset: { 'payment.securityCreateLock': '' } }
              ).catch(() => null);
            });
          }
        }
        return originalJson(payload);
      };

      return next();
    } catch (error) {
      console.error('[PAYMENT SECURITY] Mercado Pago:', error?.message || error);
      return res.status(error.status || 500).json({
        ok: false,
        error: error.message || 'Falha de segurança ao preparar pagamento.',
        code: error.code || 'PAYMENT_SECURITY_ERROR'
      });
    }
  });

  // Valida o webhook consultando a transação diretamente no Mercado Pago e
  // impede que reentregas repitam a baixa/notificação de uma venda já processada.
  app.post('/api/webhooks/mercadopago', async (req, res, next) => {
    try {
      const payload = req.body || {};
      const paymentId = String(payload?.data?.id || payload?.id || '').trim();
      if (!paymentId) {
        return res.json({ ok: true, received: true, ignored: true, reason: 'missing_payment_id' });
      }

      const mpData = await secureGetMercadoPagoPaymentById(paymentId);
      const orderId = resolveOrderIdFromMpPayment(mpData);
      const order = Order ? await Order.findById(orderId).catch(() => null) : null;
      if (!order) throw apiError(404, 'Pedido do webhook não encontrado.', 'MP_ORDER_NOT_FOUND');

      const existingId = String(order?.payment?.paymentId || order?.payment?.externalId || '').trim();
      const existingStatus = paymentStatus(order);
      const sameProcessedPayment =
        existingId === paymentId &&
        (orderIsPaid(order) || existingStatus === String(mpData?.status || '').toLowerCase());

      if (sameProcessedPayment) {
        return res.json({ ok: true, received: true, duplicate: true, paymentId, orderId });
      }

      const startedAt = nowDate();
      const expiresAt = new Date(new Date(startedAt).getTime() + 5 * 60 * 1000);
      const lock = await Order.findOneAndUpdate(
        {
          _id: order._id,
          $or: [
            { 'payment.securityWebhookLock': { $exists: false } },
            { 'payment.securityWebhookLock': null },
            { 'payment.securityWebhookLock.expiresAt': { $lte: startedAt } }
          ]
        },
        {
          $set: {
            'payment.securityWebhookLock': {
              paymentId,
              startedAt,
              expiresAt
            }
          }
        },
        { new: true }
      );

      if (!lock) {
        return res.json({ ok: true, received: true, duplicate: true, inProgress: true, paymentId, orderId });
      }

      return next();
    } catch (error) {
      console.error('[PAYMENT SECURITY] Webhook Mercado Pago rejeitado:', error?.message || error);
      const status = Number(error.status || 500);
      return res.status(status).json({
        ok: false,
        received: false,
        error: error.message || 'Webhook Mercado Pago inválido.',
        code: error.code || 'MP_WEBHOOK_VALIDATION_FAILED'
      });
    }
  });

  return {
    getMercadoPagoPaymentById: secureGetMercadoPagoPaymentById,
    resolveOrderIdFromMpPayment
  };
}
