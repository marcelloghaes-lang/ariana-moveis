const PAGARME_API_BASE = 'https://api.pagar.me/core/v5';

function clean(value = '', max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function onlyDigits(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function cents(value = 0) {
  return Math.round(Number(value || 0) * 100);
}

function providerError(message, statusCode = 502, details = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = 'PAGARME_ERROR';
  error.details = details;
  return error;
}

function normalizePhone(phone = '') {
  const digits = onlyDigits(phone);
  let national = digits;
  if (national.startsWith('55') && national.length >= 12) national = national.slice(2);

  return {
    country_code: '55',
    area_code: national.slice(0, 2),
    number: national.slice(2)
  };
}

function normalizeAddress(address = {}) {
  const zipCode = onlyDigits(address.zip_code || address.cep || address.postalCode || '');
  return {
    line_1: clean(
      address.line_1 ||
      [address.numero || address.number, address.logradouro || address.street, address.bairro || address.neighborhood]
        .filter(Boolean)
        .join(', '),
      256
    ),
    line_2: clean(address.line_2 || address.complemento || address.complement || '', 128),
    zip_code: zipCode,
    city: clean(address.city || address.cidade || '', 128),
    state: clean(address.state || address.uf || '', 2).toUpperCase(),
    country: 'BR'
  };
}

export function createPagarmeGateway(context = {}) {
  const {
    axios,
    secretKey = process.env.PAGARME_SECRET_KEY || '',
    webhookSecret = process.env.PAGARME_WEBHOOK_SECRET || ''
  } = context;

  function assertConfigured() {
    if (!axios) throw providerError('Axios não informado ao gateway Pagar.me.', 500);
    if (!clean(secretKey)) {
      throw providerError('PAGARME_SECRET_KEY não configurada no ambiente.', 503);
    }
  }

  function headers() {
    const auth = Buffer.from(`${clean(secretKey, 1000)}:`).toString('base64');
    return {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json'
    };
  }

  async function createCardOrder({
    order,
    cardToken = '',
    cardId = '',
    payer = {},
    installments = 1,
    statementDescriptor = 'ARIANA MOVEIS'
  } = {}) {
    assertConfigured();

    const token = clean(cardToken, 500);
    const savedCardId = clean(cardId, 500);

    if (!token && !savedCardId) {
      throw providerError(
        'Informe cardToken ou cardId. Os dados completos do cartão não devem ser enviados ao backend.',
        400
      );
    }

    const document = onlyDigits(
      payer.document ||
      payer.cpf ||
      order.payment?.customerDocument ||
      ''
    );
    const phone = normalizePhone(payer.phone || order.customerPhone || '');
    const address = normalizeAddress(payer.address || order.shippingAddress || {});

    const customer = {
      name: clean(payer.name || order.customerName || 'Cliente', 128),
      email: clean(payer.email || order.customerEmail || '', 180),
      type: 'individual',
      document,
      phones: phone.area_code && phone.number
        ? { mobile_phone: phone }
        : undefined,
      address: address.zip_code && address.city && address.state
        ? address
        : undefined,
      metadata: {
        origin: 'televendas',
        order_id: String(order._id)
      }
    };

    const body = {
      code: String(order._id),
      closed: true,
      customer,
      items: (order.items || []).map(item => ({
        amount: cents(item.unitPrice),
        description: clean(item.name || 'Produto Ariana Móveis', 256),
        quantity: Math.max(1, Number(item.qty || 1)),
        code: clean(item.sku || item.productId || 'produto', 100)
      })),
      payments: [{
        payment_method: 'credit_card',
        credit_card: {
          installments: Math.max(1, Number(installments || 1)),
          statement_descriptor: clean(statementDescriptor, 13).toUpperCase(),
          card: token ? { token } : { id: savedCardId }
        }
      }],
      metadata: {
        origin: 'televendas',
        ariana_order_id: String(order._id)
      }
    };

    try {
      const response = await axios.post(
        `${PAGARME_API_BASE}/orders`,
        body,
        { headers: headers(), timeout: 45000 }
      );

      const data = response.data || {};
      const charge = Array.isArray(data.charges) ? data.charges[0] : null;
      const transaction = charge?.last_transaction || {};

      return {
        provider: 'pagarme',
        method: 'card',
        externalId: String(data.id || ''),
        chargeId: String(charge?.id || ''),
        transactionId: String(transaction?.id || ''),
        status: clean(data.status || charge?.status || transaction?.status || 'pending', 80),
        gatewayResponseCode: clean(transaction?.gateway_response?.code || '', 100),
        gatewayResponseMessage: clean(transaction?.gateway_response?.errors?.[0]?.message || '', 500),
        raw: data
      };
    } catch (error) {
      throw providerError(
        error.response?.data?.message ||
        error.response?.data?.errors?.[0]?.message ||
        error.message ||
        'Erro ao criar pedido com cartão na Pagar.me.',
        Number(error.response?.status || 502),
        error.response?.data || null
      );
    }
  }

  async function getOrder(externalOrderId = '') {
    assertConfigured();
    const id = clean(externalOrderId, 300);
    if (!id) throw providerError('ID do pedido Pagar.me não informado.', 400);

    try {
      const response = await axios.get(
        `${PAGARME_API_BASE}/orders/${encodeURIComponent(id)}`,
        { headers: headers(), timeout: 30000 }
      );
      return response.data || {};
    } catch (error) {
      throw providerError(
        error.response?.data?.message ||
        error.message ||
        'Erro ao consultar pedido na Pagar.me.',
        Number(error.response?.status || 502),
        error.response?.data || null
      );
    }
  }

  function verifyWebhook({ headers: requestHeaders = {}, query = {} } = {}) {
    const expected = clean(webhookSecret, 1000);

    // A Pagar.me permite proteger a URL por segredo próprio.
    // Configure PAGARME_WEBHOOK_SECRET e envie esse valor em
    // x-ariana-webhook-secret ou ?secret=...
    if (!expected) return { valid: true, skipped: true, reason: 'secret_not_configured' };

    const received = clean(
      requestHeaders['x-ariana-webhook-secret'] ||
      requestHeaders['x-webhook-secret'] ||
      query.secret ||
      '',
      1000
    );

    return {
      valid: Boolean(received && received === expected),
      skipped: false,
      reason: received === expected ? 'ok' : 'invalid_secret'
    };
  }

  return {
    createCardOrder,
    getOrder,
    verifyWebhook
  };
}
