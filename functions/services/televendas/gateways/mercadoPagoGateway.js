import crypto from 'crypto';

const MP_API_BASE = 'https://api.mercadopago.com';

function clean(value = '', max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function onlyDigits(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function money(value = 0) {
  const number = Number(value || 0);
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

function providerError(message, statusCode = 502, details = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = 'MERCADO_PAGO_ERROR';
  error.details = details;
  return error;
}

export function createMercadoPagoGateway(context = {}) {
  const {
    axios,
    accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN || '',
    webhookSecret = process.env.MERCADO_PAGO_WEBHOOK_SECRET || process.env.MP_WEBHOOK_SECRET || '',
    notificationUrl = process.env.TELEVENDAS_MP_WEBHOOK_URL || ''
  } = context;

  function assertConfigured() {
    if (!axios) throw providerError('Axios não informado ao gateway Mercado Pago.', 500);
    if (!clean(accessToken)) {
      throw providerError(
        'MERCADO_PAGO_ACCESS_TOKEN não configurado no ambiente.',
        503
      );
    }
  }

  function headers(idempotencyKey = '') {
    return {
      Authorization: `Bearer ${clean(accessToken, 1000)}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'X-Idempotency-Key': clean(idempotencyKey, 180) } : {})
    };
  }

  async function createPix({ order, payer = {}, idempotencyKey = '' } = {}) {
    assertConfigured();

    const document = onlyDigits(
      payer.document ||
      payer.cpf ||
      order.payment?.customerDocument ||
      ''
    );

    const body = {
      transaction_amount: money(order.total),
      description: clean(`Ariana Móveis - Pedido ${String(order._id).slice(-8).toUpperCase()}`, 255),
      payment_method_id: 'pix',
      external_reference: String(order._id),
      notification_url: clean(notificationUrl, 1000) || undefined,
      payer: {
        email: clean(payer.email || order.customerEmail || '', 180),
        first_name: clean(payer.firstName || order.customerName || 'Cliente', 120),
        identification: document
          ? { type: 'CPF', number: document }
          : undefined
      },
      metadata: {
        order_id: String(order._id),
        origin: 'televendas'
      }
    };

    try {
      const response = await axios.post(
        `${MP_API_BASE}/v1/payments`,
        body,
        {
          headers: headers(idempotencyKey || `tv-pix-${order._id}`),
          timeout: 30000
        }
      );

      const data = response.data || {};
      const transactionData = data.point_of_interaction?.transaction_data || {};

      return {
        provider: 'mercadopago',
        method: 'pix',
        externalId: String(data.id || ''),
        status: clean(data.status || 'pending', 80),
        statusDetail: clean(data.status_detail || '', 160),
        qrCode: transactionData.qr_code || '',
        qrCodeBase64: transactionData.qr_code_base64 || '',
        ticketUrl: transactionData.ticket_url || '',
        expiresAt: data.date_of_expiration || null,
        raw: data
      };
    } catch (error) {
      const statusCode = Number(error.response?.status || 502);
      throw providerError(
        error.response?.data?.message ||
        error.response?.data?.error ||
        error.message ||
        'Erro ao criar PIX no Mercado Pago.',
        statusCode,
        error.response?.data || null
      );
    }
  }

  async function getPayment(paymentId = '') {
    assertConfigured();
    const id = clean(paymentId, 200);
    if (!id) throw providerError('ID do pagamento Mercado Pago não informado.', 400);

    try {
      const response = await axios.get(
        `${MP_API_BASE}/v1/payments/${encodeURIComponent(id)}`,
        { headers: headers(), timeout: 30000 }
      );
      return response.data || {};
    } catch (error) {
      throw providerError(
        error.response?.data?.message ||
        error.message ||
        'Erro ao consultar pagamento no Mercado Pago.',
        Number(error.response?.status || 502),
        error.response?.data || null
      );
    }
  }

  function verifyWebhook({ headers: requestHeaders = {}, query = {}, body = {} } = {}) {
    const secret = clean(webhookSecret, 1000);

    // Em homologação local, o segredo pode ficar vazio.
    // Em produção, configure MERCADO_PAGO_WEBHOOK_SECRET.
    if (!secret) return { valid: true, skipped: true, reason: 'secret_not_configured' };

    const signature = clean(
      requestHeaders['x-signature'] ||
      requestHeaders['X-Signature'] ||
      '',
      1000
    );
    const requestId = clean(
      requestHeaders['x-request-id'] ||
      requestHeaders['X-Request-Id'] ||
      '',
      300
    );

    if (!signature || !requestId) {
      return { valid: false, skipped: false, reason: 'missing_signature_headers' };
    }

    const parts = Object.fromEntries(
      signature.split(',').map(part => {
        const [key, ...rest] = part.trim().split('=');
        return [key, rest.join('=')];
      })
    );

    const ts = clean(parts.ts || '', 80);
    const receivedHash = clean(parts.v1 || '', 200);
    const dataId = clean(
      query['data.id'] ||
      query.id ||
      body?.data?.id ||
      body?.id ||
      '',
      300
    ).toLowerCase();

    if (!ts || !receivedHash || !dataId) {
      return { valid: false, skipped: false, reason: 'incomplete_signature_data' };
    }

    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
    const calculated = crypto
      .createHmac('sha256', secret)
      .update(manifest)
      .digest('hex');

    const left = Buffer.from(calculated, 'utf8');
    const right = Buffer.from(receivedHash, 'utf8');

    const valid = left.length === right.length && crypto.timingSafeEqual(left, right);
    return { valid, skipped: false, reason: valid ? 'ok' : 'invalid_signature' };
  }

  return {
    createPix,
    getPayment,
    verifyWebhook
  };
}
