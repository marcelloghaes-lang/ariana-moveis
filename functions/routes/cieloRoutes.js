import registerLegacyCieloRoutes from './cieloRoutesLegacy.js';

// ============================================================
// CIELO - CAMADA DE INTEGRIDADE FINANCEIRA
// Mantém a implementação Cielo anterior intacta em cieloRoutesLegacy.js
// e adiciona somente travas de pedido/valor/idempotência antes dela.
// ============================================================

export default function registerCieloRoutes(app, context = {}) {
  const {
    Order,
    axios,
    adminRequired,
    writeAuditLog,
    redact,
    toJSON,
    now
  } = context;

  function nowDate() {
    return typeof now === 'function' ? now() : new Date();
  }

  function pathOnly(req = {}) {
    return String(req.path || req.originalUrl || '')
      .split('?')[0]
      .replace(/\/+$/, '');
  }

  function normalizeMethod(value = '') {
    const method = String(value || '').trim().toLowerCase();
    if (!method) return '';
    if (
      method === 'card' ||
      method === 'credit' ||
      method === 'credit_card' ||
      method.includes('cartao') ||
      method.includes('cartão') ||
      method.includes('credit')
    ) return 'card';
    if (method.includes('pix')) return 'pix';
    if (method.includes('boleto')) return 'boleto';
    return method;
  }

  function normalizeProvider(value = '') {
    const compact = String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[._\s-]+/g, '');
    if (compact === 'cielo') return 'cielo';
    if (compact === 'mp' || compact === 'mercadopago') return 'mercadopago';
    return compact;
  }

  function cents(value = 0) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    return Math.round(amount * 100);
  }

  function getOrderAmount(order = null) {
    if (!order) return 0;

    const totals = order?.totals || {};
    const grand = Number(
      totals?.grandTotal ??
      totals?.total ??
      order?.total ??
      order?.amount ??
      0
    ) || 0;

    const original = Number(
      totals?.grandTotalOriginal ??
      totals?.totalOriginal ??
      order?.totalOriginal ??
      0
    ) || 0;

    const discount = Number(
      totals?.discountValue ??
      order?.discountValue ??
      0
    ) || 0;

    if (original > 0 && (discount > 0 || original > grand)) return original;
    return grand;
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
      'payment_confirmed'
    ].includes(status) || ['paid', 'captured'].includes(pStatus);
  }

  function paymentCanRetry(order = null) {
    return ['rejected', 'denied', 'failed', 'cancelled', 'canceled', 'voided', 'pagamento_recusado']
      .includes(paymentStatus(order));
  }

  function mappedStatus(value) {
    const status = Number(value);
    const values = {
      0:  { code: 'not_finished', label: 'Não finalizado', approved: false, captured: false },
      1:  { code: 'authorized', label: 'Pagamento autorizado', approved: true, captured: false },
      2:  { code: 'paid', label: 'Pagamento aprovado', approved: true, captured: true },
      3:  { code: 'denied', label: 'Pagamento recusado', approved: false, captured: false },
      10: { code: 'voided', label: 'Pagamento cancelado', approved: false, captured: false },
      11: { code: 'refunded', label: 'Pagamento estornado', approved: false, captured: false },
      12: { code: 'pending', label: 'Pagamento pendente', approved: false, captured: false },
      13: { code: 'aborted', label: 'Pagamento abortado', approved: false, captured: false },
      20: { code: 'scheduled', label: 'Pagamento agendado', approved: false, captured: false }
    };
    return values[status] || {
      code: 'unknown',
      label: `Status Cielo ${status}`,
      approved: false,
      captured: false
    };
  }

  function cieloBaseUrl() {
    const explicit = String(process.env.CIELO_API_URL || '').trim().replace(/\/+$/, '');
    if (explicit) return explicit;
    const mode = String(process.env.CIELO_ENV || 'production').toLowerCase().trim();
    return ['sandbox', 'test', 'teste'].includes(mode)
      ? 'https://apisandbox.cieloecommerce.cielo.com.br'
      : 'https://api.cieloecommerce.cielo.com.br';
  }

  async function cieloRequest(method, path, body) {
    const merchantId = String(process.env.CIELO_MERCHANT_ID || '').trim();
    const merchantKey = String(process.env.CIELO_MERCHANT_KEY || '').trim();
    if (!merchantId || !merchantKey) {
      const error = new Error('Cielo MerchantId/MerchantKey não configurados.');
      error.status = 503;
      throw error;
    }

    const response = await axios({
      method,
      url: `${cieloBaseUrl()}${path}`,
      data: body,
      headers: {
        MerchantId: merchantId,
        MerchantKey: merchantKey,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      timeout: 30000,
      validateStatus: () => true
    });

    if (response.status < 200 || response.status >= 300) {
      const error = new Error(
        response.data?.[0]?.Message ||
        response.data?.Message ||
        response.data?.message ||
        `Cielo HTTP ${response.status}`
      );
      error.status = response.status;
      error.details = response.data || null;
      throw error;
    }

    return { status: response.status, data: response.data || {} };
  }

  async function releaseCreateLock(orderId, lockKey) {
    if (!Order || !orderId || !lockKey) return;
    await Order.updateOne(
      { _id: orderId, 'payment.securityCreateLock.key': lockKey },
      { $unset: { 'payment.securityCreateLock': '' } }
    ).catch(() => null);
  }

  async function markAmbiguousCreate(orderId, lockKey, reason = '') {
    if (!Order || !orderId || !lockKey) return;
    const at = nowDate();
    const expiresAt = new Date(new Date(at).getTime() + 24 * 60 * 60 * 1000);
    await Order.updateOne(
      { _id: orderId, 'payment.securityCreateLock.key': lockKey },
      {
        $set: {
          'payment.securityCreateLock.expiresAt': expiresAt,
          'payment.securityCreateLock.reviewRequired': true,
          'payment.securityCreateLock.reason': String(reason || 'ambiguous_gateway_response').slice(0, 250),
          'payment.securityCreateLock.updatedAt': at
        }
      }
    ).catch(() => null);
  }

  async function validateCardIntent(order = null) {
    if (!order) return { ok: false, status: 404, code: 'ORDER_NOT_FOUND', error: 'Pedido não encontrado.' };
    if (orderIsPaid(order)) {
      return { ok: false, status: 409, code: 'ORDER_ALREADY_PAID', error: 'Este pedido já possui pagamento confirmado.' };
    }

    const intendedMethod = normalizeMethod(order?.payment?.method || order?.payment?.type || '');
    if (intendedMethod && intendedMethod !== 'card') {
      return {
        ok: false,
        status: 409,
        code: 'PAYMENT_METHOD_MISMATCH',
        error: 'A forma de pagamento solicitada não confere com a escolhida no pedido.'
      };
    }

    const provider = normalizeProvider(order?.payment?.provider || '');
    if (provider && provider !== 'cielo' && !paymentCanRetry(order)) {
      return {
        ok: false,
        status: 409,
        code: 'PAYMENT_PROVIDER_MISMATCH',
        error: 'Este pedido está vinculado a outro provedor de pagamento.'
      };
    }

    return { ok: true };
  }

  // O token público do Silent Order Post continua disponível para o checkout,
  // mas só é emitido para um pedido real que esteja elegível para cartão/Cielo.
  app.use(async (req, res, next) => {
    if (
      req.method !== 'POST' ||
      pathOnly(req) !== '/api/payments/cielo/sop/access-token'
    ) return next();

    const orderId = String(req.body?.orderId || req.body?.order_id || '').trim();
    if (!orderId) {
      return res.status(400).json({ ok: false, provider: 'cielo', error: 'orderId é obrigatório', code: 'ORDER_ID_REQUIRED' });
    }

    const order = Order ? await Order.findById(orderId).catch(() => null) : null;
    const intent = await validateCardIntent(order);
    if (!intent.ok) {
      return res.status(intent.status).json({ ok: false, provider: 'cielo', error: intent.error, code: intent.code });
    }

    return next();
  });

  // A criação do pagamento passa por uma trava atômica. Assim duas requisições
  // concorrentes do mesmo pedido não conseguem autorizar/cobrar o cartão duas vezes.
  app.use(async (req, res, next) => {
    if (req.method !== 'POST' || pathOnly(req) !== '/api/payments/cielo/credit') return next();

    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const orderId = String(body.orderId || body.order_id || body.merchantOrderId || '').trim();
      if (!orderId) {
        return res.status(400).json({ ok: false, approved: false, provider: 'cielo', error: 'orderId é obrigatório', code: 'ORDER_ID_REQUIRED' });
      }

      const order = Order ? await Order.findById(orderId).catch(() => null) : null;
      const intent = await validateCardIntent(order);
      if (!intent.ok) {
        return res.status(intent.status).json({ ok: false, approved: false, provider: 'cielo', error: intent.error, code: intent.code });
      }

      const currentPaymentId = String(order?.payment?.paymentId || order?.payment?.externalId || '').trim();
      if (currentPaymentId && !paymentCanRetry(order)) {
        return res.status(409).json({
          ok: false,
          approved: false,
          provider: 'cielo',
          error: 'Este pedido já possui uma transação Cielo em andamento.',
          code: 'PAYMENT_ALREADY_IN_PROGRESS',
          paymentId: currentPaymentId
        });
      }

      const expectedAmount = getOrderAmount(order);
      const expectedCents = cents(expectedAmount);
      if (!expectedCents) {
        return res.status(409).json({ ok: false, approved: false, provider: 'cielo', error: 'Total salvo do pedido é inválido.', code: 'ORDER_TOTAL_INVALID' });
      }

      const startedAt = nowDate();
      const expiresAt = new Date(new Date(startedAt).getTime() + 10 * 60 * 1000);
      const lockKey = `${String(order._id)}:${new Date(startedAt).getTime()}:${Math.random().toString(36).slice(2, 10)}`;

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
            'payment.provider': 'cielo',
            'payment.method': 'card',
            'payment.type': 'credit_card',
            'payment.securityCreateLock': {
              key: lockKey,
              provider: 'cielo',
              method: 'card',
              expectedAmount,
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
          approved: false,
          provider: 'cielo',
          error: 'Já existe uma tentativa de pagamento em processamento para este pedido.',
          code: 'PAYMENT_CREATE_IN_PROGRESS'
        });
      }

      body.orderId = String(order._id);
      body.order_id = String(order._id);
      delete body.amount;
      delete body.total;
      req.body = body;

      const originalJson = res.json.bind(res);
      let finalized = false;

      res.json = function securedCieloCreditJson(payload) {
        if (finalized) return originalJson(payload);
        finalized = true;
        const responseStatus = Number(res.statusCode || 200);

        if (responseStatus >= 200 && responseStatus < 300) {
          Promise.resolve(Order.findById(order._id))
            .then(async (fresh) => {
              const chargedCents = cents(fresh?.payment?.amount || 0);
              if (!fresh || !chargedCents || chargedCents !== expectedCents) {
                const observedAmount = Number(fresh?.payment?.amount || 0) || 0;
                await Order.findByIdAndUpdate(order._id, {
                  $set: {
                    status: 'payment_review',
                    statusLabel: 'Pagamento em revisão',
                    'payment.status': 'amount_mismatch',
                    'payment.securityAmountMismatch': {
                      provider: 'cielo',
                      expectedAmount,
                      observedAmount,
                      detectedAt: nowDate()
                    }
                  }
                }).catch(() => null);
                await markAmbiguousCreate(order._id, lockKey, 'cielo_amount_mismatch');
                res.status(502);
                return originalJson({
                  ok: false,
                  approved: false,
                  provider: 'cielo',
                  error: 'O valor confirmado pela Cielo não confere com o total do pedido. A venda foi bloqueada para revisão.',
                  code: 'CIELO_AMOUNT_MISMATCH'
                });
              }

              await releaseCreateLock(order._id, lockKey);
              return originalJson(payload);
            })
            .catch(async (error) => {
              await markAmbiguousCreate(order._id, lockKey, error?.message || 'post_payment_validation_failed');
              res.status(503);
              return originalJson({
                ok: false,
                approved: false,
                provider: 'cielo',
                error: 'Não foi possível validar com segurança o resultado do pagamento. A tentativa ficou bloqueada para revisão.',
                code: 'CIELO_POST_PAYMENT_VALIDATION_FAILED'
              });
            });

          return res;
        }

        if (responseStatus >= 500) {
          setImmediate(() => {
            markAmbiguousCreate(order._id, lockKey, `gateway_http_${responseStatus}`).catch(() => null);
          });
        } else {
          setImmediate(() => {
            releaseCreateLock(order._id, lockKey).catch(() => null);
          });
        }

        return originalJson(payload);
      };

      return next();
    } catch (error) {
      console.error('[CIELO SECURITY] Falha ao preparar pagamento:', error?.message || error);
      return res.status(500).json({
        ok: false,
        approved: false,
        provider: 'cielo',
        error: 'Não foi possível preparar o pagamento com segurança.',
        code: 'CIELO_SECURITY_ERROR'
      });
    }
  });

  // Captura manual protegida: o PaymentId precisa pertencer ao mesmo pedido e
  // o valor enviado pelo navegador é ignorado. A captura é sempre integral.
  const captureGuard = typeof adminRequired === 'function'
    ? adminRequired
    : (_req, res) => res.status(500).json({ ok: false, provider: 'cielo', error: 'Autorização administrativa indisponível.' });

  app.post('/api/payments/cielo/capture', captureGuard, async (req, res) => {
    let order = null;
    let captureLockKey = '';

    try {
      const paymentId = String(req.body?.paymentId || '').trim();
      const orderId = String(req.body?.orderId || '').trim();
      if (!paymentId || !orderId) {
        return res.status(400).json({
          ok: false,
          provider: 'cielo',
          error: 'orderId e paymentId são obrigatórios.',
          code: 'CIELO_CAPTURE_BINDING_REQUIRED'
        });
      }

      order = Order ? await Order.findById(orderId).catch(() => null) : null;
      if (!order) {
        return res.status(404).json({ ok: false, provider: 'cielo', error: 'Pedido não encontrado.', code: 'ORDER_NOT_FOUND' });
      }

      const provider = normalizeProvider(order?.payment?.provider || '');
      const storedPaymentId = String(order?.payment?.paymentId || order?.payment?.externalId || '').trim();
      if (provider !== 'cielo' || !storedPaymentId || storedPaymentId !== paymentId) {
        return res.status(409).json({
          ok: false,
          provider: 'cielo',
          error: 'O PaymentId informado não pertence a este pedido Cielo.',
          code: 'CIELO_CAPTURE_PAYMENT_MISMATCH'
        });
      }

      const currentStatus = paymentStatus(order);
      if (orderIsPaid(order) || currentStatus === 'paid' || currentStatus === 'captured') {
        return res.json({
          ok: true,
          reused: true,
          provider: 'cielo',
          paymentId,
          status: 'paid',
          statusLabel: 'Pagamento aprovado',
          order: typeof toJSON === 'function' ? toJSON(order) : order
        });
      }

      if (currentStatus && currentStatus !== 'authorized') {
        return res.status(409).json({
          ok: false,
          provider: 'cielo',
          error: 'Somente pagamentos Cielo autorizados podem ser capturados.',
          code: 'CIELO_CAPTURE_STATUS_INVALID'
        });
      }

      const expectedAmount = getOrderAmount(order);
      const expectedCents = cents(expectedAmount);
      const authorizedCents = cents(order?.payment?.amount || 0);
      if (!expectedCents || (authorizedCents && authorizedCents !== expectedCents)) {
        return res.status(409).json({
          ok: false,
          provider: 'cielo',
          error: 'O valor autorizado não confere com o total do pedido. Captura bloqueada.',
          code: 'CIELO_CAPTURE_AMOUNT_MISMATCH'
        });
      }

      const startedAt = nowDate();
      const expiresAt = new Date(new Date(startedAt).getTime() + 10 * 60 * 1000);
      captureLockKey = `${paymentId}:${new Date(startedAt).getTime()}`;
      const claimed = await Order.findOneAndUpdate(
        {
          _id: order._id,
          $or: [
            { 'payment.securityCaptureLock': { $exists: false } },
            { 'payment.securityCaptureLock': null },
            { 'payment.securityCaptureLock.expiresAt': { $lte: startedAt } }
          ]
        },
        {
          $set: {
            'payment.securityCaptureLock': {
              key: captureLockKey,
              paymentId,
              expectedAmount,
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
          provider: 'cielo',
          error: 'Já existe uma captura em processamento para este pedido.',
          code: 'CIELO_CAPTURE_IN_PROGRESS'
        });
      }

      // Não usa req.body.amount: captura integral da autorização vinculada ao pedido.
      const response = await cieloRequest(
        'put',
        `/1/sales/${encodeURIComponent(paymentId)}/capture`,
        null
      );
      const payment = response.data?.Payment || response.data || {};
      const returnedCents = cents(Number(payment.Amount || 0) / 100);

      if (returnedCents && returnedCents !== expectedCents) {
        await Order.findByIdAndUpdate(order._id, {
          $set: {
            status: 'payment_review',
            statusLabel: 'Pagamento em revisão',
            'payment.status': 'amount_mismatch',
            'payment.securityAmountMismatch': {
              provider: 'cielo',
              stage: 'capture',
              expectedAmount,
              observedAmount: returnedCents / 100,
              detectedAt: nowDate()
            }
          }
        });
        return res.status(502).json({
          ok: false,
          provider: 'cielo',
          error: 'O valor capturado pela Cielo não confere com o pedido. A venda foi bloqueada para revisão.',
          code: 'CIELO_CAPTURE_AMOUNT_MISMATCH'
        });
      }

      const mapped = mappedStatus(payment.Status);
      const updatedAt = nowDate();
      const patch = {
        'payment.provider': 'cielo',
        'payment.method': 'card',
        'payment.type': 'credit_card',
        'payment.paymentId': paymentId,
        'payment.externalId': paymentId,
        'payment.status': mapped.code,
        'payment.statusDetail': String(payment.ReturnMessage || mapped.label),
        'payment.amount': expectedAmount,
        'payment.authorizationCode': String(payment.AuthorizationCode || order?.payment?.authorizationCode || ''),
        'payment.proofOfSale': String(payment.ProofOfSale || order?.payment?.proofOfSale || ''),
        'payment.returnCode': String(payment.ReturnCode || ''),
        'payment.providerStatus': payment.Status,
        'payment.updatedAt': updatedAt,
        status: mapped.captured ? 'pago' : mapped.approved ? 'pagamento_autorizado' : mapped.code === 'denied' ? 'pagamento_recusado' : 'pending_payment',
        statusLabel: mapped.captured ? 'Pagamento aprovado' : mapped.approved ? 'Pagamento autorizado' : mapped.code === 'denied' ? 'Pagamento recusado' : 'Aguardando confirmação do pagamento'
      };

      const updatedOrder = await Order.findByIdAndUpdate(
        order._id,
        { $set: patch, $unset: { 'payment.securityCaptureLock': '' } },
        { new: true }
      );

      if (typeof writeAuditLog === 'function') {
        await writeAuditLog({
          scope: 'payments',
          eventType: 'cielo_card_captured_secure',
          orderId: String(order._id),
          status: mapped.captured ? 'success' : 'received',
          statusCode: response.status,
          request: { paymentId, orderId: String(order._id), amountSource: 'stored_order', expectedAmount },
          response: typeof redact === 'function' ? redact(response.data || {}) : response.data || {},
          metadata: { provider: 'cielo', captured: mapped.captured, securityBindingVerified: true }
        }).catch(() => null);
      }

      return res.status(response.status).json({
        ok: mapped.approved,
        provider: 'cielo',
        paymentId,
        status: mapped.code,
        statusLabel: mapped.label,
        order: updatedOrder
          ? (typeof toJSON === 'function' ? toJSON(updatedOrder) : updatedOrder)
          : null
      });
    } catch (error) {
      if (order?._id && captureLockKey) {
        const at = nowDate();
        const expiresAt = new Date(new Date(at).getTime() + 24 * 60 * 60 * 1000);
        await Order.updateOne(
          { _id: order._id, 'payment.securityCaptureLock.key': captureLockKey },
          {
            $set: {
              'payment.securityCaptureLock.expiresAt': expiresAt,
              'payment.securityCaptureLock.reviewRequired': true,
              'payment.securityCaptureLock.reason': String(error?.message || 'ambiguous_capture_response').slice(0, 250),
              'payment.securityCaptureLock.updatedAt': at
            }
          }
        ).catch(() => null);
      }

      return res.status(error.status || 500).json({
        ok: false,
        provider: 'cielo',
        error: error?.details?.[0]?.Message || error?.details?.Message || error?.message || 'Erro ao capturar pagamento Cielo.',
        code: 'CIELO_CAPTURE_FAILED'
      });
    }
  });

  // Registra a implementação existente depois das proteções acima.
  // As rotas normais continuam com o mesmo contrato e a mesma integração.
  return registerLegacyCieloRoutes(app, context);
}
