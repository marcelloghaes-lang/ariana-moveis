// ============================================================
// MERCADO PAGO - IDEMPOTÊNCIA DE TRANSPORTE
// Mantém a mesma chave ao repetir a mesma tentativa. Para cartão, um novo
// token representa uma nova transação e portanto recebe outra chave; Pix e
// boleto continuam estáveis por pedido + meio de pagamento.
// ============================================================

function stablePaymentKey(crypto, orderId, method, attemptIdentity = '') {
  const hash = crypto
    .createHash('sha256')
    .update(`ariana-mp-v1|${String(orderId)}|${String(method)}|${String(attemptIdentity || '')}`)
    .digest('hex');

  // UUID determinístico para manter um formato aceito amplamente por gateways.
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function paymentIdentity(payload = {}) {
  const orderId = String(
    payload?.metadata?.orderId ||
    payload?.metadata?.order_id ||
    payload?.external_reference ||
    payload?.additional_info?.items?.[0]?.orderId ||
    ''
  ).trim();

  const method = String(
    payload?.payment_method_id ||
    payload?.payment_method?.id ||
    payload?.metadata?.paymentMethod ||
    'payment'
  ).trim().toLowerCase();

  // O token de cartão é descartável no Mercado Pago: a mesma tentativa mantém
  // a mesma chave, enquanto uma nova tokenização pode criar uma nova cobrança.
  const cardToken = String(
    payload?.token ||
    payload?.card?.token ||
    payload?.payment_token ||
    ''
  ).trim();
  const attemptIdentity = cardToken ? `card-token:${cardToken}` : '';

  return { orderId, method, attemptIdentity };
}

export function createMercadoPagoIdempotentAxios(axios, crypto) {
  if (!axios || !crypto) return axios;
  if (axios.__arianaMercadoPagoIdempotencyProxy) return axios;

  const wrappedPost = async (url, data, config = {}) => {
    const target = String(url || '');
    if (/^https:\/\/api\.mercadopago\.com\/v1\/payments(?:\?|$)/i.test(target)) {
      const identity = paymentIdentity(data || {});
      if (identity.orderId) {
        const key = stablePaymentKey(
          crypto,
          identity.orderId,
          identity.method,
          identity.attemptIdentity
        );
        config = {
          ...(config || {}),
          headers: {
            ...((config && config.headers) || {}),
            'X-Idempotency-Key': key
          }
        };
      }
    }
    return axios.post(url, data, config);
  };

  const proxy = new Proxy(axios, {
    apply(target, thisArg, args) {
      return Reflect.apply(target, thisArg, args);
    },
    get(target, prop, receiver) {
      if (prop === 'post') return wrappedPost;
      if (prop === '__arianaMercadoPagoIdempotencyProxy') return true;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });

  return proxy;
}
